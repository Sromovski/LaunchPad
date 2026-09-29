/**
 * One posting run: verify the channel, retry any missing playlist adds, then
 * upload at most ONE video (the oldest approved, not held, not yet posted),
 * record it, and add it to the playlist. No AI involved — plain code.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { descriptionText } from '../export/package.js';
import { CATEGORY_ID, CHANNEL_ID, CHANNEL_TITLE, PLAYLIST_TITLE, isOurChannel, playlistDescription } from './config.js';
import { THUMBNAIL_RETRY_DAYS, postsMissingPlaylist, postsNeedingThumbnail, recentApiPosts, recordPost, setPlaylist, setThumbnailStatus, setVisibility } from './posts.js';
import { nextToPost, type QueuedVideo } from './queue.js';
import type { VideoMetadata, YouTube } from './youtube-api.js';

/** YouTube rejects < and > in titles/descriptions; titles max 100, descriptions 5000, tags ~500 chars total. */
export function buildMetadata(v: QueuedVideo): VideoMetadata {
  const clean = (s: string) => s.replace(/[<>]/g, '');
  const hashtags = v.hashtags ? (JSON.parse(v.hashtags) as string[]) : [];
  const tags: string[] = [];
  let len = 0;
  for (const t of hashtags.map((h) => h.replace(/^#/, ''))) {
    if (len + t.length + 1 > 450) break;
    tags.push(t);
    len += t.length + 1;
  }
  return {
    snippet: {
      title: clean(v.title ?? v.topic).slice(0, 100),
      description: clean(descriptionText(v.description ?? '', hashtags)).slice(0, 5000),
      tags,
      categoryId: CATEGORY_ID,
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: true, embeddable: true },
  };
}

export interface PublishDeps {
  db: Database.Database;
  yt: YouTube;
  runsRoot: string;
  /** Marker files guarding against a crash between upload and record (never re-upload blindly). */
  pendingDir: string;
  log: (msg: string) => void;
  readFile?: (path: string) => Uint8Array;
  /** Builds the title thumbnail (JPEG) for a video. Omitted = no custom thumbnails. */
  thumbnail?: (videoId: number, title: string) => Uint8Array;
}

type ThumbResult = 'set' | 'failed' | 'skipped';

/**
 * Best effort: a missing thumbnail must never fail or repeat a post. YouTube refuses
 * custom Shorts thumbnails for channels that aren't eligible yet; refusals are retried
 * after THUMBNAIL_RETRY_DAYS, so they start working on their own once it's allowed.
 */
async function tryThumbnail(d: PublishDeps, videoId: number, externalId: string, title: string): Promise<ThumbResult> {
  if (!d.thumbnail) return 'skipped';
  try {
    await d.yt.setThumbnail(externalId, d.thumbnail(videoId, title));
    setThumbnailStatus(d.db, videoId, 'set');
    d.log(`thumbnail set for video ${videoId}`);
    return 'set';
  } catch (e) {
    const msg = (e as Error).message;
    setThumbnailStatus(d.db, videoId, 'failed', msg.slice(0, 300));
    d.log(`thumbnail not set for video ${videoId} (retry in ${THUMBNAIL_RETRY_DAYS} days): ${msg}`);
    return 'failed';
  }
}

export type PublishOutcome =
  | { outcome: 'posted'; video_id: number; url: string; visibility: string; playlist: 'added' | 'failed'; thumbnail: ThumbResult; thumbnails_backfilled: number; note?: string }
  | { outcome: 'nothing_to_post'; playlist_retries: number; thumbnails_backfilled: number }
  | { outcome: 'dry_run'; video_id: number; metadata: VideoMetadata };

export async function publishNext(d: PublishDeps, opts: { dryRun?: boolean; expectedChannelId?: string } = {}): Promise<PublishOutcome> {
  const next = nextToPost(d.db);
  if (opts.dryRun) {
    if (!next) return { outcome: 'nothing_to_post', playlist_retries: 0, thumbnails_backfilled: 0 };
    return { outcome: 'dry_run', video_id: next.id, metadata: buildMetadata(next) };
  }

  // Never post to the wrong channel (Thomas has other channels under the same Google login).
  const channel = await d.yt.channel();
  const expectedId = opts.expectedChannelId ?? CHANNEL_ID;
  if (!isOurChannel(channel, expectedId)) {
    throw new Error(`signed in to "${channel.title}" (${channel.id}), expected "${CHANNEL_TITLE}" (${expectedId}): run npm run youtube:auth and pick ${CHANNEL_TITLE}`);
  }

  // One playlist per world (docs/TOPICS.md sections); looked up or created once per run.
  const playlistIds = new Map<string, string>();
  const playlistFor = async (title: string | null) => {
    const t = title ?? PLAYLIST_TITLE;
    if (!playlistIds.has(t)) playlistIds.set(t, await d.yt.findOrCreatePlaylist(t, playlistDescription(t)));
    return playlistIds.get(t)!;
  };
  let retries = 0;
  for (const p of postsMissingPlaylist(d.db)) {
    try {
      const playlistId = await playlistFor(p.playlist);
      await d.yt.addToPlaylist(playlistId, p.external_id);
      setPlaylist(d.db, p.video_id, 'youtube', playlistId);
      retries++;
      d.log(`playlist retry: added video ${p.video_id}`);
    } catch (e) {
      d.log(`playlist retry failed for video ${p.video_id}: ${(e as Error).message}`);
    }
  }

  // YouTube can lock unaudited uploads to private after processing: record what it really shows now.
  const recent = recentApiPosts(d.db);
  try {
    const now = await d.yt.visibility(recent.map((p) => p.external_id));
    for (const p of recent) {
      const v = now.get(p.external_id);
      if (v && v !== p.visibility) {
        setVisibility(d.db, p.video_id, v);
        d.log(`video ${p.video_id} is now ${v} on YouTube (was recorded as ${p.visibility})`);
      }
    }
  } catch (e) {
    d.log(`visibility check failed: ${(e as Error).message}`);
  }

  // Thumbnails for earlier posts (posted before this existed, or refused a while ago).
  // Stop at the first refusal: if YouTube says no to one, it says no to all this run.
  let backfilled = 0;
  if (d.thumbnail) {
    for (const p of postsNeedingThumbnail(d.db)) {
      const r = await tryThumbnail(d, p.video_id, p.external_id, p.title);
      if (r !== 'set') break;
      backfilled++;
    }
  }

  if (!next) return { outcome: 'nothing_to_post', playlist_retries: retries, thumbnails_backfilled: backfilled };

  const pending = resolve(d.pendingDir, `pending-video-${next.id}.json`);
  if (existsSync(pending)) {
    throw new Error(
      `video ${next.id} has an unfinished upload from an earlier run (${pending}). Check YouTube Studio: if it's there, record it with video:mark-posted; if not, delete the marker file.`,
    );
  }
  const file = resolve(d.runsRoot, String(next.id), 'final.mp4');
  if (!existsSync(file)) throw new Error(`video ${next.id} has no final.mp4`);
  const meta = buildMetadata(next);

  writeFileSync(pending, JSON.stringify({ video_id: next.id, started: new Date().toISOString(), title: meta.snippet.title }));
  d.log(`uploading video ${next.id}: ${meta.snippet.title}`);
  const res = await d.yt.upload((d.readFile ?? readFileSync)(file), meta);
  const post = recordPost(d.db, next.id, 'youtube', `https://youtu.be/${res.id}`, 'api', res.privacyStatus);
  rmSync(pending, { force: true });
  d.log(`uploaded ${post.url} (${res.privacyStatus}, ${res.uploadStatus})`);

  let playlist: 'added' | 'failed' = 'added';
  try {
    const playlistId = await playlistFor(next.playlist);
    await d.yt.addToPlaylist(playlistId, res.id);
    setPlaylist(d.db, next.id, 'youtube', playlistId);
  } catch (e) {
    playlist = 'failed'; // retried at the start of the next run
    d.log(`playlist add failed (will retry): ${(e as Error).message}`);
  }
  const thumbnail = await tryThumbnail(d, next.id, res.id, meta.snippet.title);
  const note =
    res.privacyStatus !== 'public'
      ? "YouTube kept it private: uploads from an unaudited API project are locked to private until Google's free audit is approved. Make it public in Studio for now."
      : undefined;
  return { outcome: 'posted', video_id: next.id, url: post.url, visibility: res.privacyStatus, playlist, thumbnail, thumbnails_backfilled: backfilled, note };
}
