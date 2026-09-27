import { describe, expect, it } from 'vitest';
import { decideOutcome, parseClaudeJson, type RunStats } from '../../src/automation/claude-result.js';

// Trimmed from a real `claude -p --output-format json` run (2026-09-27).
const REAL = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 10554,
  num_turns: 4,
  result: '1. topic ...',
  total_cost_usd: 0.305054,
  usage: { input_tokens: 4, cache_creation_input_tokens: 27590, cache_read_input_tokens: 49756, output_tokens: 486 },
  permission_denials: [],
  session_id: 'x',
});

describe('parseClaudeJson', () => {
  it('reads a real result', () => {
    expect(parseClaudeJson(REAL)).toEqual({
      is_error: false,
      result: '1. topic ...',
      num_turns: 4,
      input_tokens: 4 + 27590 + 49756,
      output_tokens: 486,
      cost_usd_equiv: 0.305054,
      permission_denials: 0,
    });
  });

  it('tolerates a warning line before the JSON', () => {
    expect(parseClaudeJson(`Warning: something\n${REAL}`)?.num_turns).toBe(4);
  });

  it('returns null for empty or broken output', () => {
    expect(parseClaudeJson('')).toBeNull();
    expect(parseClaudeJson('{not json')).toBeNull();
  });

  it('counts permission denials', () => {
    const j = JSON.parse(REAL);
    j.permission_denials = [{ tool_name: 'Write' }, { tool_name: 'Bash' }];
    expect(parseClaudeJson(JSON.stringify(j))?.permission_denials).toBe(2);
  });
});

describe('decideOutcome', () => {
  const stats = parseClaudeJson(REAL) as RunStats;
  it.each<[string, Parameters<typeof decideOutcome>[0], string]>([
    ['video reached review', { timedOut: false, exitCode: 0, stats, videoStatus: 'in_review' }, 'in_review'],
    ['agent says done but video is not in review', { timedOut: false, exitCode: 0, stats, videoStatus: 'rendered' }, 'incomplete'],
    ['video marked failed', { timedOut: false, exitCode: 0, stats, videoStatus: 'failed' }, 'failed'],
    ['timeout wins over everything', { timedOut: true, exitCode: null, stats: null, videoStatus: 'in_review' }, 'timeout'],
    ['crash with no video', { timedOut: false, exitCode: 1, stats: null, videoStatus: null }, 'error'],
    ['claude reported an error', { timedOut: false, exitCode: 0, stats: { ...stats, is_error: true }, videoStatus: null }, 'error'],
  ])('%s', (_l, input, expected) => {
    expect(decideOutcome(input)).toBe(expected);
  });
});
