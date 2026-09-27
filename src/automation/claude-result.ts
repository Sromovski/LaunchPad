/**
 * Parses `claude -p --output-format json` and decides the run outcome.
 * Field names verified against Claude Code 2.1.283 output (2026-09-27).
 */
import { z } from 'zod';

const ClaudeResult = z.looseObject({
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  total_cost_usd: z.number().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
  permission_denials: z.array(z.unknown()).optional(),
});

export interface RunStats {
  is_error: boolean;
  result: string;
  num_turns: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd_equiv: number | null;
  permission_denials: number;
}

/** Tolerates junk before the JSON (e.g. warnings on stdout). */
export function parseClaudeJson(stdout: string): RunStats | null {
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  let parsed: z.infer<typeof ClaudeResult>;
  try {
    parsed = ClaudeResult.parse(JSON.parse(stdout.slice(start)));
  } catch {
    return null;
  }
  const u = parsed.usage;
  const input = u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : null;
  return {
    is_error: parsed.is_error ?? false,
    result: parsed.result ?? '',
    num_turns: parsed.num_turns ?? null,
    input_tokens: input,
    output_tokens: u?.output_tokens ?? null,
    cost_usd_equiv: parsed.total_cost_usd ?? null,
    permission_denials: parsed.permission_denials?.length ?? 0,
  };
}

export type Outcome = 'in_review' | 'failed' | 'incomplete' | 'timeout' | 'error';

/** Success is judged from the DB (the video reached in_review), never from the agent's own words. */
export function decideOutcome(o: { timedOut: boolean; exitCode: number | null; stats: RunStats | null; videoStatus: string | null }): Outcome {
  if (o.timedOut) return 'timeout';
  if (o.videoStatus === 'in_review') return 'in_review';
  if (o.videoStatus === 'failed') return 'failed';
  if (o.stats === null || o.stats.is_error || (o.exitCode ?? 1) !== 0) return 'error';
  return 'incomplete';
}
