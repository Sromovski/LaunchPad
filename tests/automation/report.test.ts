import { describe, expect, it } from 'vitest';
import { buildRunLog, scheduledStreak, type RunRow } from '../../src/automation/report.js';

let n = 0;
const row = (o: Partial<RunRow>): RunRow => ({
  id: ++n,
  trigger: 'scheduled',
  started_at: '2026-09-28 07:00:00',
  topic: 'How did a helicopter fly on Mars?',
  video_id: n,
  outcome: 'in_review',
  duration_s: 900,
  num_turns: 40,
  input_tokens: 2_000_000,
  output_tokens: 30_000,
  cost_usd_equiv: 4,
  permission_denials: 0,
  error: null,
  video_status: 'in_review',
  first_decision: null,
  ...o,
});

describe('scheduledStreak', () => {
  it('counts trailing scheduled successes, ignoring skips and manual runs', () => {
    n = 0;
    const rows = [
      row({ outcome: 'failed' }),
      row({}),
      row({ outcome: 'skip' }),
      row({ trigger: 'manual', outcome: 'failed' }),
      row({}),
      row({ outcome: 'locked' }),
    ];
    expect(scheduledStreak(rows)).toBe(2);
  });

  it('a failure resets it', () => {
    n = 0;
    expect(scheduledStreak([row({}), row({}), row({ outcome: 'timeout' })])).toBe(0);
  });
});

describe('buildRunLog', () => {
  it('summarises failure rate, time, usage and review verdicts', () => {
    n = 0;
    const md = buildRunLog(
      [row({ first_decision: 'approved' }), row({ first_decision: 'changes_requested' }), row({ outcome: 'failed', error: 'NASA API | timeout' }), row({ outcome: 'skip' })],
      [{ step: 'render', runs: 3, failures: 0, avg_s: 440 }],
      new Date('2026-09-28T12:00:00Z'),
    );
    expect(md).toContain('Runs that tried to make a video: **3**, reached review: **2**, failure rate: **33%**');
    expect(md).toContain('Average time per successful video: **15.0 min**');
    expect(md).toContain('Thomas approved first time: **1 of 2** reviewed');
    expect(md).toContain('NASA API / timeout'); // pipes escaped so the table doesn't break
    expect(md).toContain('| render | 3 | 0 | 440 s |');
  });
});
