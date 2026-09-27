/**
 * Flesch-Kincaid grade level with a standard English syllable heuristic.
 * Not perfect, but deterministic and good enough to keep scripts at grade 2–4.
 */

/** A "." between two digits (1.61) is a decimal point, not the end of a sentence. */
export function splitSentences(text: string): string[] {
  return (text.match(/(?:\d\.\d|[^.!?])+[.!?]+|(?:\d\.\d|[^.!?])+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * Words = numbers (keeping thousands commas and decimals: "2,400", "1.61" — video 3
 * showed "2" / "400" as separate captions) or runs of letters/digits with inner ' and -.
 */
export function words(text: string): string[] {
  return text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? [];
}

export function countSyllables(word: string): number {
  if (/\d/.test(word)) return 2; // numbers: rough average when spoken
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function fleschKincaidGrade(text: string): number {
  const ws = words(text);
  const sentences = Math.max(1, splitSentences(text).length);
  if (ws.length === 0) return 0;
  const syllables = ws.reduce((n, w) => n + countSyllables(w), 0);
  const grade = 0.39 * (ws.length / sentences) + 11.8 * (syllables / ws.length) - 15.59;
  return Math.round(grade * 10) / 10;
}
