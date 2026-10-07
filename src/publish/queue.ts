/** What gets posted next: approved, not held back by Thomas, not yet on YouTube — oldest approval first. */
import type Database from 'better-sqlite3';
import type { ChannelKey } from '../channels.js';

export interface QueuedVideo {
  id: number;
  channel: ChannelKey;
  title: string | null;
  topic: string;
  description: string | null;
  hashtags: string | null;
  playlist: string | null;
  approved_at: string | null;
}

/** One channel's queue, or (channel omitted, review site only) every channel's. */
export function postingQueue(db: Database.Database, channel?: ChannelKey): QueuedVideo[] {
  return db
    .prepare(
      `SELECT v.id, v.channel, v.title, v.topic, v.description, v.hashtags, v.playlist,
              (SELECT MIN(r.created_at) FROM reviews r WHERE r.video_id = v.id AND r.decision = 'approved') AS approved_at
       FROM videos v
       WHERE v.status = 'approved' AND v.do_not_post = 0
         AND (@channel IS NULL OR v.channel = @channel)
         AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.video_id = v.id AND p.platform = 'youtube')
       ORDER BY approved_at IS NULL, approved_at, v.id`,
    )
    .all({ channel: channel ?? null }) as QueuedVideo[];
}

/** Posting always names the channel: a run is signed in to exactly one. */
export const nextToPost = (db: Database.Database, channel: ChannelKey): QueuedVideo | undefined => postingQueue(db, channel)[0];

/** Thomas-only (denied to agents): keep an approved video off the channel, with a reason. */
export function holdVideo(db: Database.Database, videoId: number, reason: string): void {
  if (!reason.trim()) throw new Error('a reason is required');
  const r = db.prepare("UPDATE videos SET do_not_post = 1, do_not_post_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason.trim(), videoId);
  if (r.changes === 0) throw new Error(`video ${videoId} not found`);
}
