/** What gets posted next: approved, not held back by Thomas, not yet on YouTube — oldest approval first. */
import type Database from 'better-sqlite3';

export interface QueuedVideo {
  id: number;
  title: string | null;
  topic: string;
  description: string | null;
  hashtags: string | null;
  approved_at: string | null;
}

export function postingQueue(db: Database.Database): QueuedVideo[] {
  return db
    .prepare(
      `SELECT v.id, v.title, v.topic, v.description, v.hashtags,
              (SELECT MIN(r.created_at) FROM reviews r WHERE r.video_id = v.id AND r.decision = 'approved') AS approved_at
       FROM videos v
       WHERE v.status = 'approved' AND v.do_not_post = 0
         AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.video_id = v.id AND p.platform = 'youtube')
       ORDER BY approved_at IS NULL, approved_at, v.id`,
    )
    .all() as QueuedVideo[];
}

export const nextToPost = (db: Database.Database): QueuedVideo | undefined => postingQueue(db)[0];

/** Thomas-only (denied to agents): keep an approved video off the channel, with a reason. */
export function holdVideo(db: Database.Database, videoId: number, reason: string): void {
  if (!reason.trim()) throw new Error('a reason is required');
  const r = db.prepare("UPDATE videos SET do_not_post = 1, do_not_post_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason.trim(), videoId);
  if (r.changes === 0) throw new Error(`video ${videoId} not found`);
}
