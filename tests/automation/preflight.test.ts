import { describe, expect, it } from 'vitest';
import { QUEUE_CAP, evaluatePreflight, type PreflightFacts } from '../../src/automation/preflight.js';

const ok = (): PreflightFacts => ({
  inReview: 2,
  tools: [
    { name: 'ffmpeg', ok: true },
    { name: 'whisper', ok: true },
  ],
  freeBytes: 50 * 1024 ** 3,
  nextTopic: 'How did a helicopter fly on Mars?',
});

describe('evaluatePreflight', () => {
  it('goes when everything is fine', () => {
    expect(evaluatePreflight(ok())).toEqual({ go: true, outcome: 'go', reasons: [] });
  });

  it(`skips (not fails) when ${QUEUE_CAP} videos are already waiting`, () => {
    const r = evaluatePreflight({ ...ok(), inReview: QUEUE_CAP });
    expect(r).toMatchObject({ go: false, outcome: 'skip' });
    expect(r.reasons[0]).toMatch(/queue is full/);
    expect(evaluatePreflight({ ...ok(), inReview: QUEUE_CAP - 1 }).go).toBe(true);
  });

  it('skips when the backlog is empty', () => {
    expect(evaluatePreflight({ ...ok(), nextTopic: null })).toMatchObject({ outcome: 'skip' });
  });

  it('fails on missing tools or low disk, even if it would also skip', () => {
    const r = evaluatePreflight({ ...ok(), inReview: 9, tools: [{ name: 'ffmpeg', ok: false }] });
    expect(r.outcome).toBe('fail');
    expect(r.reasons.join()).toMatch(/ffmpeg/);
    expect(evaluatePreflight({ ...ok(), freeBytes: 1024 ** 3 }).outcome).toBe('fail');
  });
});
