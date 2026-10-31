/**
 * Pocket Fables review decisions (channels/fables/CLAUDE.md §1, §3). The ONLY code that
 * moves a fables video out of a review gate: it passes `via: 'review'` to the state
 * machine, which refuses that move from anywhere else. `script_approved` is what lets
 * Everygen spend credits, so it can only come from Thomas clicking in the review site.
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { FABLES } from '../channels.js';
import { transitionVideo, type Status, type VideoState } from '../db/status.js';
import { ReviewError } from './decide.js';

export const ScriptReviewInput = z.object({
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  notes: z.string().max(4000).default(''),
  /** The script version Thomas was looking at; refuses if Claude saved a newer one meanwhile. */
  version: z.number().int().positive().optional(),
});

const SCRIPT_GATE: Record<z.infer<typeof ScriptReviewInput>['decision'], Status> = {
  approved: 'script_approved',
  changes_requested: 'script_changes',
  rejected: 'rejected',
};

const VIDEO_GATE: Record<z.infer<typeof ScriptReviewInput>['decision'], Status> = {
  approved: 'approved',
  changes_requested: 'video_changes',
  rejected: 'rejected',
};

/** Gate 2: the rendered video. Changes send the script back through gate 1 (and cost a re-render). */
export function decideVideo(db: Database.Database, videoId: number, raw: unknown): { review_id: number; state: VideoState } {
  const input = ScriptReviewInput.omit({ version: true }).parse(raw);
  const video = db.prepare('SELECT channel, status FROM videos WHERE id = ?').get(videoId) as { channel: string; status: string } | undefined;
  if (!video || video.channel !== FABLES.key) throw new ReviewError(`Pocket Fables video ${videoId} not found`, 404);
  if (video.status !== 'video_review') throw new ReviewError(`video ${videoId} is ${video.status}, not video_review`, 409);
  if (input.decision === 'changes_requested' && !input.notes.trim()) throw new ReviewError('request changes needs notes');
  return db.transaction(() => {
    let state: VideoState;
    try {
      state = transitionVideo(db, videoId, VIDEO_GATE[input.decision], { via: 'review' });
    } catch (e) {
      throw new ReviewError((e as Error).message, 409);
    }
    const reviewId = Number(
      db.prepare("INSERT INTO reviews (video_id, decision, notes, gate) VALUES (?, ?, ?, 'video')").run(videoId, input.decision, input.notes.trim() || null).lastInsertRowid,
    );
    return { review_id: reviewId, state };
  })();
}

export function decideScript(db: Database.Database, videoId: number, raw: unknown): { review_id: number; state: VideoState } {
  const input = ScriptReviewInput.parse(raw);
  const video = db.prepare('SELECT channel, status FROM videos WHERE id = ?').get(videoId) as { channel: string; status: string } | undefined;
  if (!video || video.channel !== FABLES.key) throw new ReviewError(`Pocket Fables video ${videoId} not found`, 404);
  if (video.status !== 'script_review') throw new ReviewError(`video ${videoId} is ${video.status}, not script_review`, 409);
  if (input.decision === 'changes_requested' && !input.notes.trim()) throw new ReviewError('request changes needs notes');

  const latest = (db.prepare('SELECT MAX(version) AS v FROM scripts WHERE video_id = ?').get(videoId) as { v: number | null }).v;
  if (latest === null) throw new ReviewError(`video ${videoId} has no script`, 409);
  if (input.version !== undefined && input.version !== latest) {
    throw new ReviewError(`script changed to version ${latest} while you were reviewing version ${input.version}; reload`, 409);
  }

  return db.transaction(() => {
    let state: VideoState;
    try {
      state = transitionVideo(db, videoId, SCRIPT_GATE[input.decision], { via: 'review' });
    } catch (e) {
      throw new ReviewError((e as Error).message, 409);
    }
    // Notes say which version they're about, so a revision knows what it answers.
    const notes = input.notes.trim() ? `[script v${latest}] ${input.notes.trim()}` : `[script v${latest}]`;
    const reviewId = Number(
      db.prepare("INSERT INTO reviews (video_id, decision, notes, gate) VALUES (?, ?, ?, 'script')").run(videoId, input.decision, notes).lastInsertRowid,
    );
    return { review_id: reviewId, state };
  })();
}
