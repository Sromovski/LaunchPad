/**
 * Checks before a scheduled run spends any Claude usage. A failed preflight
 * is a clean "skip", not a failure (e.g. the review queue is already full).
 */
export const QUEUE_CAP = 6; // Thomas: stop producing when 6 videos are waiting (3 days' worth)
export const MIN_FREE_BYTES = 2 * 1024 ** 3;

export interface PreflightFacts {
  inReview: number;
  tools: { name: string; ok: boolean }[];
  freeBytes: number | null;
  nextTopic: string | null;
}

export interface PreflightResult {
  go: boolean;
  /** skip = nothing to do right now (not an error); fail = something is broken. */
  outcome: 'go' | 'skip' | 'fail';
  reasons: string[];
}

export function evaluatePreflight(f: PreflightFacts, cap = QUEUE_CAP): PreflightResult {
  const fail: string[] = [];
  const skip: string[] = [];
  const missing = f.tools.filter((t) => !t.ok).map((t) => t.name);
  if (missing.length) fail.push(`missing tools: ${missing.join(', ')} (run npm run doctor)`);
  if (f.freeBytes !== null && f.freeBytes < MIN_FREE_BYTES) fail.push(`low disk space: ${(f.freeBytes / 1024 ** 3).toFixed(1)} GB free`);
  if (f.inReview >= cap) skip.push(`review queue is full (${f.inReview} waiting, cap ${cap})`);
  if (!f.nextTopic) skip.push("no open topics left in this channel's TOPICS file");
  if (fail.length) return { go: false, outcome: 'fail', reasons: [...fail, ...skip] };
  if (skip.length) return { go: false, outcome: 'skip', reasons: skip };
  return { go: true, outcome: 'go', reasons: [] };
}
