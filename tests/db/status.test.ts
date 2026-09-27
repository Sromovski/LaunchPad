import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  MAX_RETRIES,
  MAX_REVISIONS,
  STATUSES,
  canTransition,
  manualReset,
  nextState,
  type Status,
  type VideoState,
} from '../../src/db/status.js';

const at = (status: Status, extra: Partial<VideoState> = {}): VideoState => ({
  status,
  revision_count: 0,
  retry_count: 0,
  failed_from_status: null,
  ...extra,
});

describe('happy path', () => {
  const path: Status[] = [
    'idea',
    'researched',
    'scripted',
    'fact_checked',
    'rendered',
    'qa_passed',
    'in_review',
    'approved',
    'scheduled',
    'published',
  ];

  it('walks idea → published one step at a time', () => {
    let state = at('idea');
    for (const to of path.slice(1)) {
      state = nextState(state, to);
      expect(state.status).toBe(to);
    }
  });

  it.each(path.slice(0, -1).map((from, i) => [from, path[i + 1]!]))('%s → %s is legal', (from, to) => {
    expect(canTransition(at(from), to)).toBe(true);
  });
});

describe('illegal moves throw', () => {
  it.each<[Status, Status]>([
    ['idea', 'scripted'], // skipping research
    ['researched', 'rendered'], // skipping script + fact check
    ['scripted', 'rendered'], // skipping fact check
    ['rendered', 'in_review'], // skipping QA
    ['qa_passed', 'approved'], // skipping human review
    ['idea', 'approved'],
    ['in_review', 'published'],
    ['in_review', 'scheduled'],
    ['approved', 'published'], // must be scheduled first
    ['rejected', 'in_review'],
    ['published', 'idea'],
    ['scripted', 'idea'], // no going backwards
    ['rendered', 'rendered'], // no self-loops
  ])('%s → %s', (from, to) => {
    expect(canTransition(at(from), to)).toBe(false);
    expect(() => nextState(at(from), to)).toThrow(IllegalTransitionError);
  });

  it('error message names both statuses', () => {
    expect(() => nextState(at('idea'), 'approved')).toThrow(/idea.*approved/);
  });

  it('rejects unknown statuses', () => {
    expect(() => nextState(at('idea'), 'bogus' as Status)).toThrow(IllegalTransitionError);
  });
});

describe('human approval gate', () => {
  it('only in_review can become approved', () => {
    for (const from of STATUSES) {
      if (from === 'in_review') continue;
      expect(canTransition(at(from), 'approved')).toBe(false);
    }
  });

  it('only approved can become scheduled, only scheduled can become published', () => {
    for (const from of STATUSES) {
      expect(canTransition(at(from), 'scheduled')).toBe(from === 'approved');
      expect(canTransition(at(from), 'published')).toBe(from === 'scheduled');
    }
  });
});

describe('review decisions', () => {
  it.each<Status>(['approved', 'changes_requested', 'rejected'])('in_review → %s', (to) => {
    expect(nextState(at('in_review'), to).status).toBe(to);
  });

  it('changes_requested → scripted counts as a revision', () => {
    const s = nextState(at('changes_requested'), 'scripted');
    expect(s.status).toBe('scripted');
    expect(s.revision_count).toBe(1);
  });

  it('changes_requested → fact_checked (visual-only revision, re-runs producer) counts as a revision', () => {
    const s = nextState(at('changes_requested'), 'fact_checked');
    expect(s.status).toBe('fact_checked');
    expect(s.revision_count).toBe(1);
  });

  it('changes_requested → rejected is allowed', () => {
    expect(nextState(at('changes_requested'), 'rejected').status).toBe('rejected');
  });
});

describe('revision cap', () => {
  it(`allows exactly ${MAX_REVISIONS} revisions`, () => {
    expect(MAX_REVISIONS).toBe(2);
    let s = at('in_review');
    for (let i = 0; i < MAX_REVISIONS; i++) {
      s = nextState(s, 'changes_requested');
      s = nextState(s, 'scripted');
      s = nextState(s, 'fact_checked');
      s = nextState(s, 'rendered');
      s = nextState(s, 'qa_passed');
      s = nextState(s, 'in_review');
    }
    expect(s.revision_count).toBe(MAX_REVISIONS);
    // Third request for changes is not allowed: reviewer must reject (or approve).
    expect(canTransition(s, 'changes_requested')).toBe(false);
    expect(() => nextState(s, 'changes_requested')).toThrow(/revision/i);
    expect(nextState(s, 'rejected').status).toBe('rejected');
    expect(nextState(s, 'approved').status).toBe('approved');
  });

  it('cannot start a revision once the cap is reached', () => {
    const s = at('changes_requested', { revision_count: MAX_REVISIONS });
    expect(canTransition(s, 'scripted')).toBe(false);
    expect(canTransition(s, 'fact_checked')).toBe(false);
    expect(canTransition(s, 'rejected')).toBe(true);
  });
});

describe('failure and retry', () => {
  const failable = STATUSES.filter((s) => !['failed', 'rejected', 'published'].includes(s));

  it.each(failable)('%s → failed records where it failed', (from) => {
    const s = nextState(at(from), 'failed');
    expect(s.status).toBe('failed');
    expect(s.failed_from_status).toBe(from);
  });

  it.each<Status>(['failed', 'rejected', 'published'])('%s → failed is illegal', (from) => {
    expect(canTransition(at(from), 'failed')).toBe(false);
  });

  it(`retries exactly ${MAX_RETRIES} time, back to the status it failed from`, () => {
    expect(MAX_RETRIES).toBe(1);
    let s = nextState(at('scripted'), 'failed');
    s = nextState(s, 'scripted');
    expect(s).toEqual({ status: 'scripted', revision_count: 0, retry_count: 1, failed_from_status: null });

    s = nextState(s, 'failed');
    expect(canTransition(s, 'scripted')).toBe(false);
    expect(() => nextState(s, 'scripted')).toThrow(/retr/i);
  });

  it('failed can only retry to the status it failed from', () => {
    const s = nextState(at('rendered'), 'failed');
    expect(canTransition(s, 'qa_passed')).toBe(false);
    expect(canTransition(s, 'idea')).toBe(false);
    expect(canTransition(s, 'rendered')).toBe(true);
  });

  it('failed can be rejected by a human', () => {
    const s = nextState(at('rendered'), 'failed');
    expect(nextState(s, 'rejected').status).toBe('rejected');
  });

  it('does not mutate the input state', () => {
    const s = at('idea');
    nextState(s, 'researched');
    expect(s.status).toBe('idea');
  });
});

describe('terminal statuses', () => {
  it.each<Status>(['rejected', 'published'])('%s has no way out', (from) => {
    for (const to of STATUSES) expect(canTransition(at(from), to)).toBe(false);
  });
});

describe('manualReset (Thomas only, after a pipeline bug)', () => {
  it('puts a failed video back where it failed, even after the automatic retry was used', () => {
    let s = nextState(at('rendered'), 'failed');
    s = nextState(s, 'rendered'); // automatic retry used
    s = nextState(s, 'failed');
    expect(canTransition(s, 'rendered')).toBe(false); // the automatic rule still says no
    const r = manualReset(s);
    expect(r).toMatchObject({ status: 'rendered', failed_from_status: null, retry_count: 1 });
  });

  it('only works on failed videos', () => {
    expect(() => manualReset(at('in_review'))).toThrow(IllegalTransitionError);
  });

  it('refuses when the failed step is unknown', () => {
    expect(() => manualReset(at('failed', { failed_from_status: null }))).toThrow(/unknown/);
  });
});
