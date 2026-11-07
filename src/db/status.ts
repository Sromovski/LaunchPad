/**
 * Video status state machine (CLAUDE.md §5, channels/fables/CLAUDE.md §1). Every
 * status change in the codebase must go through `nextState` / `transitionVideo` so
 * illegal moves — especially anything that skips human approval — are impossible.
 *
 * Two workflows share the `videos` table, picked by `videos.channel`:
 *  - NASA channels (blast, wonder): one human gate, `in_review`.
 *  - Pocket Fables (fables): two human gates, `script_review` (before any Everygen
 *    credits are spent) and `video_review`. Leaving a gate needs `via: 'review'`,
 *    which only the review decision code (src/review/) passes. No CLI or agent can
 *    set `script_approved` (the hard rule in channels/fables/CLAUDE.md).
 */
import type Database from 'better-sqlite3';

export const NASA_STATUSES = [
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

export const FABLES_STATUSES = [
  'idea',
  'scripted',
  'script_review',
  'script_approved',
  'script_changes',
  'rendering',
  'rendered',
  'video_review',
  'approved',
  'video_changes',
  'uploaded',
  'rejected',
  'failed',
] as const;

export type Status = (typeof NASA_STATUSES)[number] | (typeof FABLES_STATUSES)[number];

/** Every status any channel uses (the videos.status CHECK in schema.sql lists exactly these). */
export const STATUSES: readonly Status[] = [...new Set<Status>([...NASA_STATUSES, ...FABLES_STATUSES])];

/**
 * Which workflow a channel runs. Curious Clips (`clips`) has the same two gates as Pocket Fables.
 * Anything else is the NASA one, as before Pocket Fables.
 */
export type Workflow = 'nasa' | 'fables';
export const workflowOf = (channel: string | null | undefined): Workflow => (channel === 'fables' || channel === 'clips' ? 'fables' : 'nasa');

export interface TransitionOptions {
  /** videos.channel: picks which workflow's moves apply. Default: NASA. */
  channel?: string | null;
  /** Set only by human review decisions (src/review/). Required to leave a Pocket Fables gate. */
  via?: 'review';
}

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

/** Forward moves, NASA channels. `failed` and retries are handled separately below. */
const NASA_EDGES: Partial<Record<Status, readonly Status[]>> = {
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

/** Forward moves, Pocket Fables (channels/fables/CLAUDE.md §1). */
const FABLES_EDGES: Partial<Record<Status, readonly Status[]>> = {
  idea: ['scripted'],
  scripted: ['script_review'],
  script_review: ['script_approved', 'script_changes', 'rejected'],
  script_changes: ['scripted', 'rejected'], // Claude revises the script: one revision
  script_approved: ['rendering'],
  rendering: ['rendered'],
  rendered: ['video_review'],
  video_review: ['approved', 'video_changes', 'rejected'],
  video_changes: ['script_review', 'rejected'], // revised script goes back to gate 1: one revision
  approved: ['uploaded'], // Thomas uploads by hand in YouTube Studio, then clicks Mark uploaded
  failed: ['rejected'],
  rejected: [],
  uploaded: [],
};

interface WorkflowRules {
  statuses: readonly Status[];
  edges: Partial<Record<Status, readonly Status[]>>;
  terminal: readonly Status[];
  /** Statuses only a human review decision may move on from (except to `failed`). */
  reviewOnlyFrom: readonly Status[];
  /** Entering one of these asks for a revision; leaving it to work counts one (max MAX_REVISIONS). */
  revisionRequests: readonly Status[];
}

const RULES: Record<Workflow, WorkflowRules> = {
  nasa: {
    statuses: NASA_STATUSES,
    edges: NASA_EDGES,
    terminal: ['rejected', 'published'],
    // The NASA gate is enforced by src/review/decide.ts, unchanged since before Pocket Fables.
    reviewOnlyFrom: [],
    revisionRequests: ['changes_requested'],
  },
  fables: {
    statuses: FABLES_STATUSES,
    edges: FABLES_EDGES,
    terminal: ['rejected', 'uploaded'],
    reviewOnlyFrom: ['script_review', 'video_review', 'approved'],
    // One shared count for both gates: max 2 revision loops per video, at either gate.
    revisionRequests: ['script_changes', 'video_changes'],
  },
};

const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s);

/** Returns the new state or throws IllegalTransitionError. Pure. */
export function nextState(state: VideoState, to: Status, opts: TransitionOptions = {}): VideoState {
  const from = state.status;
  const workflow = workflowOf(opts.channel);
  const rules = RULES[workflow];
  if (!isStatus(to)) throw new IllegalTransitionError(from, to, 'unknown status');
  if (!rules.statuses.includes(to) || !rules.statuses.includes(from)) {
    throw new IllegalTransitionError(from, to, `not a status of the ${workflow} workflow`);
  }

  if (to === 'failed') {
    if (from === 'failed' || rules.terminal.includes(from)) throw new IllegalTransitionError(from, to);
    return { ...state, status: 'failed', failed_from_status: from };
  }

  if (from === 'failed' && to !== 'rejected') {
    // A retry only goes back to where the video already was, so it never crosses a review gate.
    if (to !== state.failed_from_status) {
      throw new IllegalTransitionError(from, to, `can only retry to ${state.failed_from_status ?? '(unknown)'}`);
    }
    if (state.retry_count >= MAX_RETRIES) {
      throw new IllegalTransitionError(from, to, `already retried ${MAX_RETRIES} time(s)`);
    }
    return { ...state, status: to, retry_count: state.retry_count + 1, failed_from_status: null };
  }

  if (!(rules.edges[from] ?? []).includes(to)) throw new IllegalTransitionError(from, to);

  if (rules.reviewOnlyFrom.includes(from) && opts.via !== 'review') {
    throw new IllegalTransitionError(from, to, 'only a review decision in the review site can do this');
  }

  if (rules.revisionRequests.includes(to) && state.revision_count >= MAX_REVISIONS) {
    throw new IllegalTransitionError(from, to, `max ${MAX_REVISIONS} revisions reached; approve or reject`);
  }

  if (rules.revisionRequests.includes(from) && to !== 'rejected') {
    if (state.revision_count >= MAX_REVISIONS) {
      throw new IllegalTransitionError(from, to, `max ${MAX_REVISIONS} revisions reached; reject instead`);
    }
    return { ...state, status: to, revision_count: state.revision_count + 1 };
  }

  return { ...state, status: to, failed_from_status: from === 'failed' ? null : state.failed_from_status };
}

export function canTransition(state: VideoState, to: Status, opts: TransitionOptions = {}): boolean {
  try {
    nextState(state, to, opts);
    return true;
  } catch (e) {
    if (e instanceof IllegalTransitionError) return false;
    throw e;
  }
}

/**
 * Apply a transition to a `videos` row atomically, using the row's channel's workflow.
 * `error` is stored when moving to `failed` and cleared on any other move.
 */
export function transitionVideo(
  db: Database.Database,
  videoId: number,
  to: Status,
  opts: { error?: string; via?: 'review' } = {},
): VideoState {
  return db.transaction(() => {
    const row = db
      .prepare('SELECT status, revision_count, retry_count, failed_from_status, channel FROM videos WHERE id = ?')
      .get(videoId) as (VideoState & { channel: string }) | undefined;
    if (!row) throw new Error(`Video ${videoId} not found`);

    const { channel, ...state } = row;
    const next = nextState(state, to, { channel, via: opts.via });
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
