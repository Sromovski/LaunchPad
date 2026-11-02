/**
 * Uploads one approved Pocket Fables video to the Pocket Fables YouTube channel.
 * Called only from the review site, when Thomas approves a video (or clicks "Upload to
 * YouTube" on Ready to upload), so it goes through the review path of the state machine:
 * approved → uploaded happens only on his click. Same guards as the NASA poster: the
 * signed-in channel is checked by ID, and a marker file stops a crash from uploading twice.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { FABLES } from '../channels.js';
import { transitionVideo } from '../db/status.js';
import { isOurChannel } from '../publish/config.js';
import type { VideoMetadata, YouTube } from '../publish/youtube-api.js';
import { latestScript } from './render.js';
import { pairVideos, type FableScript } from './script.js';

export type FablesYouTube = Pick<YouTube, 'channel' | 'upload' | 'findOrCreatePlaylist' | 'addToPlaylist'>;

/** YouTube category 1 = Film & Animation: these are animated stories (the NASA channels use 27, Education). */
export const FABLES_CATEGORY_ID = '1';

/** YouTube rejects < and > in titles/descriptions; tags are capped at about 500 characters in total. */
export function fableMetadata(s: FableScript): VideoMetadata {
  const clean = (t: string) => t.replace(/[<>]/g, '');
  const tags: string[] = [];
  let len = 0;
  for (const t of s.youtube.tags.map((x) => clean(x.replace(/^#/, '')))) {
    if (len + t.length + 1 > 450) break;
    tags.push(t);
    len += t.length + 1;
  }
  return {
    snippet: {
      title: clean(s.youtube.title).slice(0, 100),
      description: clean(s.youtube.description).slice(0, 5000),
      tags,
      categoryId: FABLES_CATEGORY_ID,
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: true, embeddable: true },
  };
}

export interface FablePublishResult {
  url: string;
  visibility: 'public' | 'unlisted' | 'private';
  /** Part 2 of an episode: when YouTube makes it public by itself (ISO). */
  scheduled_for?: string;
  playlist: 'added' | 'failed';
  note?: string;
}

export class FablePublishError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

/** YouTube wants publishAt comfortably in the future; closer than this, the part just goes public now. */
const MIN_LEAD_MS = 15 * 60 * 1000;

/** posts.posted_at is SQLite datetime('now'): UTC without a zone. */
const sqliteUtc = (t: string) => Date.parse(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`);

/**
 * Part 1 of an episode goes public on approval; each later part goes up private with YouTube's
 * publishAt, `partGapHours` after the part before it went public (there's no local scheduler
 * for Pocket Fables). Returns null when the part should simply go public now.
 */
export function partSchedule(db: Database.Database, script: FableScript, now = new Date()): string | null {
  const e = script.episode;
  if (!e || e.part === 1) return null;
  const prev = pairVideos(db, e.pair_id).find((p) => p.part === e.part - 1);
  const post = prev
    ? (db.prepare("SELECT posted_at, publish_at FROM posts WHERE video_id = ? AND platform = 'youtube'").get(prev.video_id) as
        | { posted_at: string; publish_at: string | null }
        | undefined)
    : undefined;
  if (!prev || !post) {
    throw new FablePublishError(`upload ${e.pair_id} Part ${e.part - 1}${prev ? ` (video ${prev.video_id})` : ''} first; Part ${e.part} goes public the day after it`);
  }
  const at = sqliteUtc(post.publish_at ?? post.posted_at) + FABLES.partGapHours * 3600 * 1000;
  return at - now.getTime() < MIN_LEAD_MS ? null : new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function publishFable(
  db: Database.Database,
  videoId: number,
  yt: FablesYouTube,
  opts: { runsRoot: string; pendingDir: string; readFile?: (p: string) => Uint8Array; log?: (m: string) => void; now?: Date },
): Promise<FablePublishResult> {
  const log = opts.log ?? (() => {});
  const v = db.prepare('SELECT channel, status FROM videos WHERE id = ?').get(videoId) as { channel: string; status: string } | undefined;
  if (!v || v.channel !== FABLES.key) throw new FablePublishError(`Pocket Fables video ${videoId} not found`, 404);
  if (v.status !== 'approved') throw new FablePublishError(`video ${videoId} is ${v.status}, not approved`);
  const file = resolve(opts.runsRoot, String(videoId), 'final.mp4');
  if (!existsSync(file)) throw new FablePublishError(`video ${videoId} has no final.mp4`);
  const { script } = latestScript(db, videoId);
  const publishAt = partSchedule(db, script, opts.now);

  mkdirSync(opts.pendingDir, { recursive: true });
  const pending = resolve(opts.pendingDir, `pending-fables-${videoId}.json`);
  if (existsSync(pending)) {
    throw new FablePublishError(
      `video ${videoId} has an unfinished upload from earlier (${pending}). Check YouTube Studio: if it's there, paste its link under "upload by hand"; if not, delete that file and try again.`,
    );
  }

  // Never post to the wrong channel: several channels share the same Google login.
  const signedIn = await yt.channel();
  if (!isOurChannel(signedIn, FABLES.youtubeId)) {
    throw new FablePublishError(`signed in to "${signedIn.title}", not Pocket Fables: run npm run youtube:auth -- --channel fables and pick Pocket Fables`);
  }

  const meta = fableMetadata(script);
  if (publishAt) meta.status = { ...meta.status, privacyStatus: 'private', publishAt };
  writeFileSync(pending, JSON.stringify({ video_id: videoId, started: new Date().toISOString(), title: meta.snippet.title }));
  log(`uploading Pocket Fables video ${videoId}: ${meta.snippet.title}`);
  const res = await yt.upload((opts.readFile ?? readFileSync)(file), meta);
  const url = `https://www.youtube.com/shorts/${res.id}`;
  db.transaction(() => {
    transitionVideo(db, videoId, 'uploaded', { via: 'review' });
    db.prepare("INSERT INTO posts (video_id, platform, external_id, url, method, visibility, publish_at) VALUES (?, 'youtube', ?, ?, 'api', ?, ?)").run(
      videoId,
      res.id,
      url,
      res.privacyStatus,
      publishAt,
    );
  })();
  rmSync(pending, { force: true });
  log(`uploaded ${url} (${res.privacyStatus}${publishAt ? `, goes public ${publishAt}` : ''})`);

  let playlist: FablePublishResult['playlist'] = 'added';
  try {
    const list = script.episode ? FABLES.adventurePlaylist : FABLES.playlist;
    const id = await yt.findOrCreatePlaylist(list.title, list.description);
    await yt.addToPlaylist(id, res.id);
    db.prepare("UPDATE posts SET playlist_id = ? WHERE video_id = ? AND platform = 'youtube'").run(id, videoId);
  } catch (e) {
    playlist = 'failed';
    log(`playlist add failed for video ${videoId}: ${(e as Error).message}`);
  }
  const note = publishAt
    ? `Scheduled: YouTube makes it public on its own at ${publishAt} (a day after Part ${script.episode!.part - 1}).`
    : res.privacyStatus !== 'public'
      ? 'YouTube kept it private (uploads from an unaudited API project). Make it public in YouTube Studio.'
      : undefined;
  return { url, visibility: res.privacyStatus, playlist, ...(publishAt ? { scheduled_for: publishAt } : {}), ...(note ? { note } : {}) };
}
