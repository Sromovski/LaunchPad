/** runs/<id>/bonus.json — written by media:bonus, read by media:render, qa and the review site. */
import { z } from 'zod';

export const BonusMeta = z.object({
  asset_id: z.string().startsWith('iotd:'),
  title: z.string().min(1),
  date: z.string(),
  date_text: z.string(),
  credit: z.string().nullable(),
  rights_status: z.enum(['clear', 'needs_review', 'rejected']),
  page: z.string().url(),
  image: z.string(), // relative to the run dir
  voice: z.string(),
  duration_s: z.number().positive().max(10),
  title_start_s: z.number().min(0),
});
export type BonusMeta = z.infer<typeof BonusMeta>;

/** No usable picture that day: the video simply has no bonus outro. */
export const NoBonus = z.object({ none: z.literal(true), skipped: z.array(z.object({ title: z.string(), why: z.string() })) });

export const BonusFile = z.union([BonusMeta, NoBonus]);

/** Parsed bonus.json, or null when there is no bonus (file missing or "none"). */
export function parseBonus(json: unknown): BonusMeta | null {
  if (json == null) return null;
  const b = BonusFile.parse(json);
  return 'none' in b ? null : b;
}
