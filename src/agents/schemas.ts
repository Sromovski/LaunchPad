/**
 * zod schemas for every agent output file in runs/<id>/ (CLAUDE.md §7).
 * The orchestrator must not advance status until the file parses.
 */
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

/** Any https page on a nasa.gov host (science., jpl., photojournal.jpl., mars. …). */
export const NasaUrl = z.url().refine((u) => {
  const { protocol, hostname } = new URL(u);
  return protocol === 'https:' && (hostname === 'nasa.gov' || hostname.endsWith('.nasa.gov'));
}, 'source must be an https://*.nasa.gov page');

export const Research = z.object({
  primary_asset: z.object({ nasa_id: nonEmpty, why: nonEmpty }),
  supporting_assets: z.array(z.object({ nasa_id: nonEmpty, why: nonEmpty })).max(3),
  sources: z
    .array(
      z.object({
        id: z.string().regex(/^s\d+$/, 'source ids look like s1, s2…'),
        url: NasaUrl,
        title: nonEmpty,
        excerpt: nonEmpty.max(800),
      }),
    )
    .min(3)
    .max(8)
    .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'source ids must be unique'),
  kid_angle: nonEmpty,
  surprising_fact: nonEmpty,
});
export type Research = z.infer<typeof Research>;

export const Script = z.object({
  title: nonEmpty.max(100),
  hook: z.string(),
  /** Optional: the hook often states the big fact ("sunsets on Mars are BLUE"). */
  hook_source_ids: z.array(z.string()).optional(),
  lines: z.array(z.object({ text: z.string(), source_ids: z.array(z.string()) })).min(3),
  end_question: z.string(),
  on_screen_text: z.array(z.string()),
  revision_notes: z.string().optional(),
});
export type Script = z.infer<typeof Script>;

export const FactCheck = z
  .object({
    claims: z
      .array(
        z.object({
          claim: nonEmpty,
          /** -1 = hook, lines.length = end question */
          line_index: z.number().int().min(-1),
          source_id: z.string().nullable(),
          verdict: z.enum(['supported', 'unsupported', 'unclear']),
          note: z.string().default(''),
        }),
      )
      .min(1),
    pass: z.boolean(),
    notes_for_scriptwriter: z.string().default(''),
    /** Pages the fact-checker had to fetch beyond research.json. Saved as sources so every fact maps to a stored URL (§2.5). */
    extra_sources: z
      .array(z.object({ id: z.string().regex(/^s\d+$/), url: NasaUrl, title: nonEmpty, excerpt: nonEmpty.max(800) }))
      .default([]),
  })
  .refine((f) => f.claims.every((c) => c.verdict !== 'supported' || !!c.source_id), {
    message: 'every supported claim needs a source_id (add pages you fetched to extra_sources)',
  })
  .refine((f) => f.pass === f.claims.every((c) => c.verdict === 'supported'), {
    message: '"pass" must be true exactly when every claim is supported',
  })
  .refine((f) => f.pass || f.notes_for_scriptwriter.trim().length > 0, {
    message: 'a failing fact check needs notes_for_scriptwriter',
  });
export type FactCheck = z.infer<typeof FactCheck>;

export const Render = z.object({
  final_path: nonEmpty,
  duration_s: z.number().min(30).max(60),
  edit_decisions: z
    .array(
      z.object({
        start_s: z.number().min(0),
        end_s: z.number().positive(),
        nasa_id: nonEmpty,
        mode: z.enum(['blur_bg', 'pan', 'kenburns', 'pano']),
        why: z.string(),
      }),
    )
    .min(1),
});
export type Render = z.infer<typeof Render>;

export const AI_VOICE_LINE = 'Narration voice is AI-generated.';

export const QaReview = z.object({
  pass: z.boolean(),
  reasons: z.array(z.string()),
  frame_notes: z.array(z.object({ frame: z.string(), ok: z.boolean(), note: z.string() })).min(6),
  title: nonEmpty.max(100),
  description: nonEmpty.refine((d) => d.includes(AI_VOICE_LINE), `description must include "${AI_VOICE_LINE}"`),
  hashtags: z.array(z.string().regex(/^#\w+$/, 'hashtags look like #Mars')).min(3).max(5),
});
export type QaReview = z.infer<typeof QaReview>;

export const STEP_FILES = {
  research: { file: 'research.json', schema: Research },
  script: { file: 'script.json', schema: Script },
  factcheck: { file: 'factcheck.json', schema: FactCheck },
  render: { file: 'render.json', schema: Render },
  'qa-review': { file: 'qa-review.json', schema: QaReview },
} as const;
export type Step = keyof typeof STEP_FILES;
