import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import {
  FABLES_STATUSES,
  IllegalTransitionError,
  MAX_REVISIONS,
  NASA_STATUSES,
  STATUSES,
  canTransition,
  nextState,
  transitionVideo,
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
const F = { channel: 'fables' } as const;
const R = { channel: 'fables', via: 'review' } as const;

describe('Pocket Fables happy path (channels/fables/CLAUDE.md §1)', () => {
  it('walks idea → uploaded, with review decisions at both gates', () => {
    const steps: [Status, typeof F | typeof R][] = [
      ['scripted', F],
      ['script_review', F],
      ['script_approved', R], // Thomas: Approve & send to Everygen
      ['rendering', F],
      ['rendered', F],
      ['video_review', F],
      ['approved', R], // Thomas: Approve
      ['uploaded', R], // Thomas: Mark uploaded
    ];
    let s = at('idea');
    for (const [to, opts] of steps) {
      s = nextState(s, to, opts);
      expect(s.status).toBe(to);
    }
  });
});

describe('only a review action can produce script_approved', () => {
  it('script_review → script_approved without via review is refused', () => {
    expect(() => nextState(at('script_review'), 'script_approved', F)).toThrow(/review decision/);
    expect(canTransition(at('script_review'), 'script_approved', F)).toBe(false);
  });

  it('with via review it is allowed', () => {
    expect(nextState(at('script_review'), 'script_approved', R).status).toBe('script_approved');
  });

  it('no other status can become script_approved, review or not', () => {
    for (const from of STATUSES) {
      if (from === 'script_review') continue;
      expect(canTransition(at(from), 'script_approved', F)).toBe(false);
      expect(canTransition(at(from), 'script_approved', R)).toBe(false);
    }
  });

  it('a NASA video can never be script_approved', () => {
    for (const from of STATUSES) {
      expect(canTransition(at(from), 'script_approved')).toBe(false);
      expect(canTransition(at(from), 'script_approved', { channel: 'blast', via: 'review' })).toBe(false);
    }
  });

  it('every move out of a gate needs a review (reject and changes too)', () => {
    for (const [from, to] of [
      ['script_review', 'script_changes'],
      ['script_review', 'rejected'],
      ['video_review', 'approved'],
      ['video_review', 'video_changes'],
      ['video_review', 'rejected'],
      ['approved', 'uploaded'],
    ] as [Status, Status][]) {
      expect(canTransition(at(from), to, F), `${from} → ${to}`).toBe(false);
      expect(canTransition(at(from), to, R), `${from} → ${to}`).toBe(true);
    }
  });

  it('a retry after a failure in script_approved goes back there (Thomas already approved), but nowhere past a gate', () => {
    const failed = nextState(at('script_approved'), 'failed', F);
    expect(nextState(failed, 'script_approved', F).status).toBe('script_approved');
    const failedInReview = nextState(at('script_review'), 'failed', F);
    expect(canTransition(failedInReview, 'script_approved', F)).toBe(false);
    expect(canTransition(failedInReview, 'script_approved', R)).toBe(false);
    expect(nextState(failedInReview, 'script_review', F).status).toBe('script_review');
  });
});

describe('Pocket Fables illegal moves', () => {
  it.each<[Status, Status]>([
    ['scripted', 'script_approved'], // skipping the script gate
    ['script_review', 'rendering'], // rendering without approval
    ['idea', 'rendering'],
    ['script_changes', 'script_review'], // must be rewritten (scripted) first
    ['rendering', 'video_review'], // skipping rendered (QA)
    ['rendered', 'approved'], // skipping the video gate
    ['video_changes', 'rendering'], // re-render needs the script re-approved
    ['uploaded', 'approved'],
    ['rejected', 'script_review'],
  ])('%s → %s', (from, to) => {
    expect(canTransition(at(from), to, R)).toBe(false);
    expect(() => nextState(at(from), to, R)).toThrow(IllegalTransitionError);
  });

  it('fables videos cannot use NASA statuses, and NASA videos cannot use fables ones', () => {
    expect(canTransition(at('scripted'), 'fact_checked', F)).toBe(false);
    expect(canTransition(at('rendered'), 'qa_passed', F)).toBe(false);
    expect(canTransition(at('scripted'), 'script_review')).toBe(false);
    expect(canTransition(at('approved'), 'uploaded', { channel: 'wonder', via: 'review' })).toBe(false);
  });

  it('uploaded and rejected are terminal', () => {
    for (const from of ['uploaded', 'rejected'] as Status[]) {
      for (const to of FABLES_STATUSES) expect(canTransition(at(from), to, R)).toBe(false);
    }
  });

  it('every non-terminal fables status can fail', () => {
    for (const from of FABLES_STATUSES.filter((s) => !['failed', 'rejected', 'uploaded'].includes(s))) {
      expect(nextState(at(from), 'failed', F)).toMatchObject({ status: 'failed', failed_from_status: from });
    }
  });

  it('STATUSES is the union of both workflows', () => {
    expect(new Set(STATUSES)).toEqual(new Set([...NASA_STATUSES, ...FABLES_STATUSES]));
  });
});

describe('Pocket Fables revisions (max 2 per video, either gate)', () => {
  it('script_changes → scripted counts one revision', () => {
    const s = nextState(at('script_changes'), 'scripted', F);
    expect(s.revision_count).toBe(1);
  });

  it('video_changes → script_review counts one revision', () => {
    expect(nextState(at('video_changes'), 'script_review', F).revision_count).toBe(1);
  });

  it(`stops at ${MAX_REVISIONS}, counting both gates together`, () => {
    let s = at('script_review');
    s = nextState(s, 'script_changes', R);
    s = nextState(s, 'scripted', F);
    s = nextState(s, 'script_review', F);
    s = nextState(s, 'script_approved', R);
    for (const to of ['rendering', 'rendered', 'video_review'] as Status[]) s = nextState(s, to, F);
    s = nextState(s, 'video_changes', R);
    s = nextState(s, 'script_review', F);
    expect(s.revision_count).toBe(MAX_REVISIONS);
    expect(() => nextState(s, 'script_changes', R)).toThrow(/revision/i);
    expect(nextState(s, 'script_approved', R).status).toBe('script_approved');
    expect(nextState(s, 'rejected', R).status).toBe('rejected');
  });
});

describe('transitionVideo uses the row’s channel', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb(':memory:');
  });
  const fable = (status: Status) =>
    Number(db.prepare("INSERT INTO videos (topic, channel, status) VALUES ('The Magic Paintbrush', 'fables', ?)").run(status).lastInsertRowid);

  it('fables rows follow the fables workflow', () => {
    const id = fable('idea');
    transitionVideo(db, id, 'scripted');
    transitionVideo(db, id, 'script_review');
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'script_review' });
  });

  it('refuses script_approved unless via review, and leaves the row untouched', () => {
    const id = fable('script_review');
    expect(() => transitionVideo(db, id, 'script_approved')).toThrow(/review decision/);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'script_review' });
    transitionVideo(db, id, 'script_approved', { via: 'review' });
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'script_approved' });
  });

  it('NASA rows are unchanged by the new workflow', () => {
    const id = Number(db.prepare("INSERT INTO videos (topic) VALUES ('Blue sunsets')").run().lastInsertRowid);
    expect(() => transitionVideo(db, id, 'scripted')).toThrow(IllegalTransitionError);
    transitionVideo(db, id, 'researched');
    expect(db.prepare('SELECT status, channel FROM videos WHERE id = ?').get(id)).toEqual({ status: 'researched', channel: 'blast' });
  });
});
