/**
 * Credit checker (CLAUDE.md §6). Decides whether a NASA library asset is
 * safe to use. When in doubt it answers `needs_review` — a human decides.
 */

export type RightsStatus = 'clear' | 'needs_review' | 'rejected';

/** Credits that mean "NASA work, public domain". Exact match after normalizing. */
export const CLEAR_CREDITS = [
  'NASA',
  'NASA/JPL',
  'NASA/JPL-Caltech',
  'NASA/GSFC',
  'NASA/JSC',
  'NASA/KSC',
  'NASA/MSFC',
] as const;

/**
 * Spelled-out forms of allowlisted credits, as they appear in the library's
 * `photographer` / `secondary_creator` fields. Keys are lowercase with
 * straight apostrophes. Only exact matches are aliased.
 */
const ALIASES: Record<string, string> = {
  'national aeronautics and space administration': 'NASA',
  "nasa's jet propulsion laboratory": 'NASA/JPL',
  'nasa jet propulsion laboratory': 'NASA/JPL',
  'nasa jpl': 'NASA/JPL',
  "nasa's goddard space flight center": 'NASA/GSFC',
  'nasa goddard space flight center': 'NASA/GSFC',
  'nasa goddard': 'NASA/GSFC',
  "nasa's johnson space center": 'NASA/JSC',
  'nasa johnson space center': 'NASA/JSC',
  'nasa johnson': 'NASA/JSC',
  "nasa's kennedy space center": 'NASA/KSC',
  'nasa kennedy space center': 'NASA/KSC',
  'nasa kennedy': 'NASA/KSC',
  "nasa's marshall space flight center": 'NASA/MSFC',
  'nasa marshall space flight center': 'NASA/MSFC',
  'nasa marshall': 'NASA/MSFC',
};

const NEWS_AGENCY = /\b(AP|Associated Press|Reuters|Getty|AFP|Agence France-Presse)\b/i;
const OWNERSHIP = /©|\bcopyright\b/i;
const DESCRIPTION_FLAGS = /courtesy of|©|used with permission|\bcopyright\b/i;

export function normalizeCredit(raw: string): string {
  const s = raw
    .replace(/[’‘]/g, "'")
    .replace(/\s*\/+\s*/g, '/') // also collapses NASA's occasional "//"
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
  const alias = ALIASES[s.toLowerCase()];
  if (alias) return alias;
  const allow = CLEAR_CREDITS.find((c) => c.toLowerCase() === s.toLowerCase());
  return allow ?? s;
}

/** Pull "Credit: X" / "Image credit: X" out of a description. */
export function extractDescriptionCredits(description: string): string[] {
  const out: string[] = [];
  // Descriptions join paragraphs with double spaces; a credit runs to one of those or the end.
  const re = /\b(?:image |video |photo )?credits?\s*:\s*(.+?)(?=\s{2,}|\n|$)/gi;
  for (const m of description.matchAll(re)) {
    const c = m[1]!.trim().replace(/\.$/, '');
    if (c) out.push(c);
  }
  return out;
}

const RANK: Record<RightsStatus, number> = { clear: 0, needs_review: 1, rejected: 2 };

function judgeOne(credit: string): { status: RightsStatus; note: string } {
  const hasNasa = /\bNASA\b/i.test(credit);
  const parts = credit.split(/[/,;]| and /i).map((p) => p.trim()).filter(Boolean);

  if (NEWS_AGENCY.test(credit)) return { status: 'rejected', note: `news agency credit: "${credit}"` };
  if (OWNERSHIP.test(credit) && !hasNasa) return { status: 'rejected', note: `privately owned: "${credit}"` };
  if (!hasNasa && parts.some((p) => /^ESA\b/i.test(p))) return { status: 'rejected', note: `ESA-only credit: "${credit}"` };
  if ((CLEAR_CREDITS as readonly string[]).includes(credit)) return { status: 'clear', note: '' };
  if (!hasNasa) return { status: 'needs_review', note: `no NASA credit: "${credit}" (confirm NASA staff or public domain)` };
  return { status: 'needs_review', note: `co-credit: "${credit}"` };
}

export interface CreditCheck {
  status: RightsStatus;
  /** Credit to show on screen / in descriptions — the most specific one found. */
  credit: string | null;
  note: string;
}

/**
 * `credits` = the library's credit fields (secondary_creator, photographer…).
 * Credits named in the description are checked too; the strictest verdict wins.
 */
export function checkCredit(input: { credits: (string | undefined | null)[]; description?: string }): CreditCheck {
  const description = input.description ?? '';
  const fromDescription = extractDescriptionCredits(description);
  const all = [...input.credits, ...fromDescription]
    .filter((c): c is string => !!c && !!c.trim())
    .map(normalizeCredit);
  const unique = [...new Set(all)];

  if (unique.length === 0) {
    return { status: 'needs_review', credit: null, note: 'no credit found' };
  }

  let status: RightsStatus = 'clear';
  const notes: string[] = [];
  for (const c of unique) {
    const r = judgeOne(c);
    if (RANK[r.status] > RANK[status]) status = r.status;
    if (r.note) notes.push(r.note);
  }

  if (DESCRIPTION_FLAGS.test(description)) {
    if (status === 'clear') status = 'needs_review';
    notes.push('description mentions courtesy/©/copyright/permission');
  }

  // Most specific = longest; a description credit usually lists every owner.
  const credit = [...unique].sort((a, b) => b.length - a.length)[0]!;
  return { status, credit, note: notes.join('; ') };
}
