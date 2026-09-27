/** Deterministic checks on script.json (CLAUDE.md §6 step 3 + §7 scriptwriter style). */
import type { Script } from '../agents/schemas.js';
import { fleschKincaidGrade, splitSentences, words } from './readability.js';

export const WORDS_MIN = 90;
export const WORDS_MAX = 130;
export const GRADE_MAX = 4.5;
/** ~2.5 words/s speaking pace → a hook this short is spoken within 2 s + a little slack. */
export const HOOK_MAX_WORDS = 10;
export const SENTENCE_MAX_WORDS = 18;

const CALL_TO_ACTION = /\b(subscribe|comment|like and|follow us|click|link in|visit)\b/i;
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(gov|com|org|net)\b/i;

export function spokenText(s: Script): string {
  return [s.hook, ...s.lines.map((l) => l.text), s.end_question].map((t) => t.trim()).join(' ');
}

export interface ScriptValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  word_count: number;
  reading_grade: number;
  estimated_seconds: number;
}

export function validateScript(s: Script, sourceIds: Set<string>): ScriptValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = spokenText(s);
  const wordCount = words(text).length;
  const grade = fleschKincaidGrade(text);

  if (!s.hook.trim()) errors.push('hook is missing');
  else if (words(s.hook).length > HOOK_MAX_WORDS) {
    errors.push(`hook is ${words(s.hook).length} words; max ${HOOK_MAX_WORDS} so it is spoken within 2 s`);
  }
  if (!s.hook.trim().endsWith('?')) warnings.push('hook is not a question');

  if (!s.end_question.trim().endsWith('?')) errors.push('end question must end with "?"');

  if (wordCount < WORDS_MIN || wordCount > WORDS_MAX) {
    errors.push(`word count ${wordCount} is outside ${WORDS_MIN}–${WORDS_MAX}`);
  }
  if (grade > GRADE_MAX) errors.push(`reading grade ${grade} is above ${GRADE_MAX} (target 2–4)`);

  s.lines.forEach((line, i) => {
    if (!line.text.trim()) errors.push(`line ${i + 1} is empty`);
    if (line.source_ids.length === 0) errors.push(`line ${i + 1} has no source_ids`);
    for (const id of line.source_ids) {
      if (!sourceIds.has(id)) errors.push(`line ${i + 1} cites unknown source "${id}"`);
    }
  });
  for (const id of s.hook_source_ids ?? []) {
    if (!sourceIds.has(id)) errors.push(`hook cites unknown source "${id}"`);
  }

  for (const sentence of splitSentences(text)) {
    const n = words(sentence).length;
    if (n > SENTENCE_MAX_WORDS) errors.push(`sentence too long (${n} words): "${sentence.slice(0, 60)}…"`);
  }

  for (const part of [text, s.title, ...s.on_screen_text]) {
    if (CALL_TO_ACTION.test(part)) errors.push(`call to action not allowed: "${part.match(CALL_TO_ACTION)![0]}"`);
    if (LINK.test(part)) errors.push(`link not allowed: "${part.match(LINK)![0]}"`);
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings,
    word_count: wordCount,
    reading_grade: grade,
    estimated_seconds: Math.round((wordCount / 2.6) * 10) / 10,
  };
}
