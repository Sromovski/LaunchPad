/**
 * Human review decisions (CLAUDE.md §9). The ONLY way a video becomes
 * `approved`. Rules are enforced here, not just in the UI:
 *  - approve needs "rights checked" when any asset is needs_review
 *  - request changes needs notes
 *  - status moves go through the state machine (revision cap etc.)
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { AI_VOICE_LINE } from '../agents/schemas.js';
import { transitionVideo, type VideoState } from '../db/status.js';

export class ReviewError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

export const ReviewInput = z.object({
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  notes: z.string().max(4000).default(''),
  rights_checked: z.boolean().default(false),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

export interface ReviewResult {
  review_id: number;
  state: VideoState;
  cleared_assets: string[];
}

export function assetsNeedingReview(db: Database.Database, videoId: number): { nasa_id: string; credit: string | null }[] {
  return db
    .prepare("SELECT nasa_id, credit FROM assets WHERE video_id = ? AND rights_status = 'needs_review' ORDER BY nasa_id")
    .all(videoId) as { nasa_id: string; credit: string | null }[];
}

export function decide(db: Database.Database, videoId: number, raw: unknown, now = new Date()): ReviewResult {
  const input = ReviewInput.parse(raw);
  const video = db.prepare('SELECT status FROM videos WHERE id = ?').get(videoId) as { status: string } | undefined;
  if (!video) throw new ReviewError(`video ${videoId} not found`, 404);
  if (video.status !== 'in_review') throw new ReviewError(`video ${videoId} is ${video.status}, not in_review`, 409);

  const needs = assetsNeedingReview(db, videoId);
  if (input.decision === 'approved' && needs.length > 0 && !input.rights_checked) {
    throw new ReviewError(`rights not checked for: ${needs.map((n) => n.nasa_id).join(', ')}`);
  }
  if (input.decision === 'changes_requested' && !input.notes.trim()) {
    throw new ReviewError('request changes needs notes');
  }

  return db.transaction(() => {
    let state: VideoState;
    try {
      state = transitionVideo(db, videoId, input.decision);
    } catch (e) {
      throw new ReviewError((e as Error).message, 409);
    }
    const reviewId = Number(
      db.prepare('INSERT INTO reviews (video_id, decision, notes) VALUES (?, ?, ?)').run(videoId, input.decision, input.notes.trim() || null)
        .lastInsertRowid,
    );

    // Thomas checked the rights: record it on the assets so re-used assets come up cleared next time.
    let cleared: string[] = [];
    if (input.decision === 'approved' && input.rights_checked && needs.length > 0) {
      const note = `cleared by Thomas on ${now.toISOString().slice(0, 10)} (video ${videoId} review ${reviewId})`;
      db.prepare(
        `UPDATE assets SET rights_status = 'clear',
                rights_note = CASE WHEN rights_note IS NULL OR rights_note = '' THEN ? ELSE rights_note || '; ' || ? END
         WHERE video_id = ? AND rights_status = 'needs_review'`,
      ).run(note, note, videoId);
      cleared = needs.map((n) => n.nasa_id);
    }
    return { review_id: reviewId, state, cleared_assets: cleared };
  })();
}

export const Draft = z.object({
  title: z.string().trim().min(1).max(100),
  description: z
    .string()
    .trim()
    .min(1)
    .max(5000)
    .refine((d) => d.includes(AI_VOICE_LINE), `description must include "${AI_VOICE_LINE}"`),
  hashtags: z.array(z.string().regex(/^#\w+$/, 'hashtags look like #Mars')).min(3).max(5),
});
export type Draft = z.infer<typeof Draft>;

export function saveDraft(db: Database.Database, videoId: number, raw: unknown): Draft {
  const d = Draft.parse(raw);
  const r = db
    .prepare("UPDATE videos SET title = ?, description = ?, hashtags = ?, updated_at = datetime('now') WHERE id = ?")
    .run(d.title, d.description, JSON.stringify(d.hashtags), videoId);
  if (r.changes === 0) throw new ReviewError(`video ${videoId} not found`, 404);
  return d;
}
