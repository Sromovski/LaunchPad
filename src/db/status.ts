/**
 * Video status state machine (CLAUDE.md §5). Every status change in the
 * codebase must go through `nextState` / `transitionVideo` so illegal moves —
 * especially anything that skips human approval — are impossible.
 */
import type Database from 'better-sqlite3';

export const STATUSES = [
  'idea',
  'researched',
  'scripted',
  'fact_checked',
  'rendered',
  'qa_passed',
  'in_review',
  'approved',
  'changes_requested',
  'rejected',
  'scheduled',
  'published',
  'failed',
] as const;

export type Status = (typeof STATUSES)[number];

export const MAX_REVISIONS = 2;
export const MAX_RETRIES = 1;

export interface VideoState {
  status: Status;
  revision_count: number;
  retry_count: number;
  /** Set while `failed`, so a retry resumes the step that broke. */
  failed_from_status: Status | null;
}

export class IllegalTransitionError extends Error {
  constructor(from: Status, to: string, reason = 'not an allowed transition') {
    super(`Illegal status transition ${from} → ${to}: ${reason}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Forward moves. `failed` and retries are handled separately below. */
const EDGES: Record<Status, readonly Status[]> = {
  idea: ['researched'],
  researched: ['scripted'],
  scripted: ['fact_checked'],
  fact_checked: ['rendered'],
  rendered: ['qa_passed'],
  qa_passed: ['in_review'],
  in_review: ['approved', 'changes_requested', 'rejected'],
  // → scripted re-runs from the scriptwriter; → fact_checked re-runs only the
  // producer (visual-only notes). Both count as one revision.
  changes_requested: ['scripted', 'fact_checked', 'rejected'],
  approved: ['scheduled'],
  scheduled: ['published'],
  failed: ['rejected'],
  rejected: [],
  published: [],
};

const TERMINAL: readonly Status[] = ['rejected', 'published'];

const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s);

/** Returns the new state or throws IllegalTransitionError. Pure. */
export function nextState(state: VideoState, to: Status): VideoState {
  const from = state.status;
  if (!isStatus(to)) throw new IllegalTransitionError(from, to, 'unknown status');

  if (to === 'failed') {
    if (from === 'failed' || TERMINAL.includes(from)) throw new IllegalTransitionError(from, to);
    return { ...state, status: 'failed', failed_from_status: from };
  }

  if (from === 'failed' && to !== 'rejected') {
    if (to !== state.failed_from_status) {
      throw new IllegalTransitionError(from, to, `can only retry to ${state.failed_from_status ?? '(unknown)'}`);
    }
    if (state.retry_count >= MAX_RETRIES) {
      throw new IllegalTransitionError(from, to, `already retried ${MAX_RETRIES} time(s)`);
    }
    return { ...state, status: to, retry_count: state.retry_count + 1, failed_from_status: null };
  }

  if (!EDGES[from].includes(to)) throw new IllegalTransitionError(from, to);

  if (from === 'in_review' && to === 'changes_requested' && state.revision_count >= MAX_REVISIONS) {
    throw new IllegalTransitionError(from, to, `max ${MAX_REVISIONS} revisions reached; approve or reject`);
  }

  if (from === 'changes_requested' && to !== 'rejected') {
    if (state.revision_count >= MAX_REVISIONS) {
      throw new IllegalTransitionError(from, to, `max ${MAX_REVISIONS} revisions reached; reject instead`);
    }
    return { ...state, status: to, revision_count: state.revision_count + 1 };
  }

  return { ...state, status: to, failed_from_status: from === 'failed' ? null : state.failed_from_status };
}

export function canTransition(state: VideoState, to: Status): boolean {
  try {
    nextState(state, to);
    return true;
  } catch (e) {
    if (e instanceof IllegalTransitionError) return false;
    throw e;
  }
}

/**
 * Apply a transition to a `videos` row atomically. `error` is stored when
 * moving to `failed` and cleared on any other move.
 */
export function transitionVideo(
  db: Database.Database,
  videoId: number,
  to: Status,
  opts: { error?: string } = {},
): VideoState {
  return db.transaction(() => {
    const row = db
      .prepare('SELECT status, revision_count, retry_count, failed_from_status FROM videos WHERE id = ?')
      .get(videoId) as VideoState | undefined;
    if (!row) throw new Error(`Video ${videoId} not found`);

    const next = nextState(row, to);
    db.prepare(
      `UPDATE videos
         SET status = ?, revision_count = ?, retry_count = ?, failed_from_status = ?,
             error = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      next.status,
      next.revision_count,
      next.retry_count,
      next.failed_from_status,
      to === 'failed' ? (opts.error ?? 'unknown error') : null,
      videoId,
    );
    return next;
  })();
}

/**
 * Thomas-only escape hatch (not used by any agent; `video:reset` is denied in
 * .claude/settings.json). Puts a failed video back at the step it failed, even
 * after its one automatic retry — for failures caused by a pipeline bug that has
 * since been fixed. The automatic rule in nextState() is unchanged.
 */
export function manualReset(state: VideoState): VideoState {
  if (state.status !== 'failed') throw new IllegalTransitionError(state.status, 'reset', 'only failed videos can be reset');
  if (!state.failed_from_status) throw new IllegalTransitionError(state.status, 'reset', 'failed step is unknown');
  return { ...state, status: state.failed_from_status, failed_from_status: null };
}
