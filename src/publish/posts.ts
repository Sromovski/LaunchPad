/**
 * Records that a video is live on a platform (hand-posted, or by the Phase 4
 * poster). Only approved, not-held videos, never twice.
 */
import type Database from 'better-sqlite3';
import { transitionVideo } from '../db/status.js';
import { canonicalShortUrl, youtubeId } from './youtube-url.js';

export type Platform = 'youtube' | 'facebook';
export type Visibility = 'public' | 'unlisted' | 'private';

export interface PostRow {
  video_id: number;
  platform: Platform;
  external_id: string;
  url: string;
  method: 'manual' | 'api';
  visibility: Visibility;
}

export function recordPost(
  db: Database.Database,
  videoId: number,
  platform: Platform,
  url: string,
  method: 'manual' | 'api',
  visibility: Visibility = 'public',
): PostRow {
  if (platform !== 'youtube') throw new Error('only YouTube is set up (Facebook is on hold)');
  const externalId = youtubeId(url);
  const row: PostRow = { video_id: videoId, platform, external_id: externalId, url: canonicalShortUrl(externalId), method, visibility };

  return db.transaction(() => {
    const v = db.prepare('SELECT status, do_not_post FROM videos WHERE id = ?').get(videoId) as { status: string; do_not_post: number } | undefined;
    if (!v) throw new Error(`video ${videoId} not found`);
    const existing = db.prepare('SELECT url FROM posts WHERE video_id = ? AND platform = ?').get(videoId, platform) as { url: string } | undefined;
    if (existing) throw new Error(`video ${videoId} is already posted on ${platform}: ${existing.url}`);
    const taken = db.prepare('SELECT video_id FROM posts WHERE platform = ? AND external_id = ?').get(platform, externalId) as { video_id: number } | undefined;
    if (taken) throw new Error(`${platform} video ${externalId} is already recorded for video ${taken.video_id}`);
    if (v.status !== 'approved' && v.status !== 'scheduled') throw new Error(`video ${videoId} is ${v.status}, not approved`);
    if (v.do_not_post && method === 'api') throw new Error(`video ${videoId} is held back from posting`);

    if (v.status === 'approved') transitionVideo(db, videoId, 'scheduled');
    transitionVideo(db, videoId, 'published');
    db.prepare(
      'INSERT INTO posts (video_id, platform, external_id, url, method, visibility) VALUES (@video_id, @platform, @external_id, @url, @method, @visibility)',
    ).run(row);
    return row;
  })();
}

export function setPlaylist(db: Database.Database, videoId: number, platform: Platform, playlistId: string): void {
  db.prepare('UPDATE posts SET playlist_id = ? WHERE video_id = ? AND platform = ?').run(playlistId, videoId, platform);
}

/** Posts that are live but not yet in the playlist (a failed add is retried on the next run). */
export function postsMissingPlaylist(db: Database.Database): { video_id: number; external_id: string }[] {
  return db.prepare("SELECT video_id, external_id FROM posts WHERE platform = 'youtube' AND method = 'api' AND playlist_id IS NULL").all() as {
    video_id: number;
    external_id: string;
  }[];
}
