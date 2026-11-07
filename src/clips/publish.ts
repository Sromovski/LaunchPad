/**
 * Uploads one approved Curious Clips video. Called only from the review site, after Thomas
 * approves it. Every video goes up private with YouTube's publishAt on the next open day, so
 * approving several at once still posts one a day, in the order he approved them, with no local
 * scheduler. Same guards as Pocket Fables: the channel is checked by ID, and a marker file stops
 * a crash from uploading twice. These are NOT made for kids (the other channels' uploads are).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { CLIPS } from '../channels.js';
import { transitionVideo } from '../db/status.js';
import { isOurChannel } from '../publish/config.js';
import type { VideoMetadata, YouTube } from '../publish/youtube-api.js';

export type ClipsYouTube = Pick<YouTube, 'channel' | 'upload' | 'findOrCreatePlaylist' | 'addToPlaylist'>;

export type ClipKind = keyof typeof CLIPS.playlists;

const AI_VOICES = 'Voices are AI-generated.';
const PARODY = 'Parody and commentary. Not affiliated with or endorsed by any AI company.';

export interface ClipDraft {
  title: string;
  description: string;
  hashtags: string[];
  kind: ClipKind;
}

/** YouTube rejects < and > in titles and descriptions; tags are capped at about 500 characters in total. */
export function clipMetadata(d: ClipDraft): VideoMetadata {
  const clean = (t: string) => t.replace(/[<>]/g, '');
  const missing = d.hashtags.map((t) => `#${t.replace(/^#/, '')}`).filter((t) => !new RegExp(`${t}(\\s|$)`, 'i').test(d.description));
  const body = [d.description, missing.join(' '), /AI-generated/i.test(d.description) ? '' : AI_VOICES, d.kind === 'show' && !/affiliated/i.test(d.description) ? PARODY : '']
    .filter(Boolean)
    .join('\n\n');
  const tags: string[] = [];
  let len = 0;
  for (const t of d.hashtags.map((x) => clean(x.replace(/^#/, '')))) {
    if (len + t.length + 1 > 450) break;
    tags.push(t);
    len += t.length + 1;
  }
  return {
    snippet: {
      title: clean(d.title).slice(0, 100),
      description: clean(body).slice(0, 5000),
      tags,
      categoryId: CLIPS.categoryId,
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: CLIPS.madeForKids, embeddable: true },
  };
}

export class ClipPublishError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

/** YouTube wants publishAt comfortably in the future. */
const MIN_LEAD_MS = 15 * 60 * 1000;

/** posts.posted_at is SQLite datetime('now'): UTC without a zone. */
const sqliteUtc = (t: string) => new Date(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`);

/** The next `postHour` (local time) on a day with no Curious Clips post yet. */
export function nextOpenSlot(db: Database.Database, now = new Date()): Date {
  const rows = db
    .prepare("SELECT COALESCE(p.publish_at, p.posted_at) AS at FROM posts p JOIN videos v ON v.id = p.video_id WHERE v.channel = ? AND p.platform = 'youtube'")
    .all(CLIPS.key) as { at: string }[];
  const used = new Set(rows.map((r) => sqliteUtc(r.at).toDateString()));
  const slot = new Date(now);
  slot.setHours(CLIPS.postHour, 0, 0, 0);
  while (slot.getTime() - now.getTime() < MIN_LEAD_MS || used.has(slot.toDateString())) slot.setDate(slot.getDate() + 1);
  return slot;
}

/** A video's YouTube text, from its row and newest script. */
export function clipDraft(db: Database.Database, videoId: number): ClipDraft {
  const v = db.prepare('SELECT title, description, hashtags FROM videos WHERE id = ?').get(videoId) as { title: string | null; description: string | null; hashtags: string | null };
  const s = db.prepare('SELECT body_json FROM scripts WHERE video_id = ? ORDER BY version DESC LIMIT 1').get(videoId) as { body_json: string } | undefined;
  const kind = s ? (JSON.parse(s.body_json) as { kind: ClipKind }).kind : 'reel';
  return { title: v.title ?? '', description: v.description ?? '', hashtags: v.hashtags ? (JSON.parse(v.hashtags) as string[]) : [], kind };
}

export interface ClipPublishResult {
  url: string;
  visibility: 'public' | 'unlisted' | 'private';
  scheduled_for: string;
  playlist: 'added' | 'failed';
}

export async function publishClip(
  db: Database.Database,
  videoId: number,
  yt: ClipsYouTube,
  opts: { runsRoot: string; pendingDir: string; readFile?: (p: string) => Uint8Array; log?: (m: string) => void; now?: Date },
): Promise<ClipPublishResult> {
  const log = opts.log ?? (() => {});
  const v = db.prepare('SELECT channel, status FROM videos WHERE id = ?').get(videoId) as { channel: string; status: string } | undefined;
  if (!v || v.channel !== CLIPS.key) throw new ClipPublishError(`Curious Clips video ${videoId} not found`, 404);
  if (v.status !== 'approved') throw new ClipPublishError(`video ${videoId} is ${v.status}, not approved`);
  if (!CLIPS.youtubeId) throw new ClipPublishError('Curious Clips has no channel ID yet: add it to src/channels.ts');
  const file = resolve(opts.runsRoot, String(videoId), 'final.mp4');
  if (!existsSync(file)) throw new ClipPublishError(`video ${videoId} has no final.mp4`);

  mkdirSync(opts.pendingDir, { recursive: true });
  const pending = resolve(opts.pendingDir, `pending-clips-${videoId}.json`);
  if (existsSync(pending)) {
    throw new ClipPublishError(
      `video ${videoId} has an unfinished upload from earlier (${pending}). Check YouTube Studio: if it's there, paste its link under "upload by hand"; if not, delete that file and try again.`,
    );
  }

  // Never post to the wrong channel: the kids' channels share the same Google login.
  const signedIn = await yt.channel();
  if (!isOurChannel(signedIn, CLIPS.youtubeId)) {
    throw new ClipPublishError(`signed in to "${signedIn.title}", not Curious Clips: run npm run youtube:auth -- --channel clips and pick Curious Clips`);
  }

  const draft = clipDraft(db, videoId);
  const meta = clipMetadata(draft);
  const publishAt = nextOpenSlot(db, opts.now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  meta.status = { ...meta.status, privacyStatus: 'private', publishAt };
  writeFileSync(pending, JSON.stringify({ video_id: videoId, started: new Date().toISOString(), title: meta.snippet.title }));
  log(`uploading Curious Clips video ${videoId}: ${meta.snippet.title}`);
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
  log(`uploaded ${url}, goes public ${publishAt}`);

  let playlist: ClipPublishResult['playlist'] = 'added';
  try {
    const list = CLIPS.playlists[draft.kind];
    const id = await yt.findOrCreatePlaylist(list.title, list.description);
    await yt.addToPlaylist(id, res.id);
    db.prepare("UPDATE posts SET playlist_id = ? WHERE video_id = ? AND platform = 'youtube'").run(id, videoId);
  } catch (e) {
    playlist = 'failed';
    log(`playlist add failed for video ${videoId}: ${(e as Error).message}`);
  }
  return { url, visibility: res.privacyStatus, scheduled_for: publishAt, playlist };
}
