/**
 * Word timings for captions. whisper.cpp tells us *when* words were said;
 * the script tells us *what* was said. We align the two so captions always
 * show the script's spelling ("Gale", not whisper's "Gail"), and interpolate
 * any word whisper missed within the TTS segment it belongs to.
 */
import { words as splitWords } from '../script/readability.js';

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface AlignedWord extends TimedWord {
  segment: number;
  matched: boolean;
}

export interface SegmentTiming {
  index: number;
  text: string;
  start_s: number;
  end_s: number;
}

/** A matched word more than this far outside its TTS segment is a false match. */
const SEGMENT_SLACK_S = 0.3;
const MIN_WORD_S = 0.05;

export const normalizeWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function similar(a: string, b: string): boolean {
  const x = normalizeWord(a);
  const y = normalizeWord(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const len = Math.min(x.length, y.length);
  if (len < 4) return false;
  if (levenshtein(x, y) <= (len >= 7 ? 2 : 1)) return true;
  // Homophones whisper spells differently ("gale"/"gail"): same first letter + same consonants.
  const skeleton = (s: string) => s[0] + s.slice(1).replace(/[aeiouy]/g, '');
  return skeleton(x) === skeleton(y);
}

/** whisper-cli -ojf -ml 1 -sow output → words (drops [_BEG_], [_TT_n] etc.). */
export function parseWhisperJson(json: unknown): TimedWord[] {
  const t = (json as { transcription: { offsets: { from: number; to: number }; text: string }[] }).transcription;
  return t
    .map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
    .filter((w) => w.text && !/^\[_.*\]$/.test(w.text) && normalizeWord(w.text));
}

/** LCS-style alignment: returns pairs [scriptIndex, heardIndex]. */
function lcsPairs(expected: string[], heard: string[]): [number, number][] {
  const n = expected.length;
  const m = heard.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = similar(expected[i]!, heard[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (similar(expected[i]!, heard[j]!) && dp[i]![j] === dp[i + 1]![j + 1]! + 1) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

export function alignWords(segments: SegmentTiming[], heard: TimedWord[]): { words: AlignedWord[]; match_rate: number } {
  const expected: { text: string; segment: number }[] = segments.flatMap((s) =>
    splitWords(s.text).map((text) => ({ text, segment: s.index })),
  );
  // Keep trailing punctuation from the script for display ("blue?").
  const display = segments.flatMap((s) => s.text.trim().split(/\s+/).filter((t) => normalizeWord(t)));
  const shown = display.length === expected.length ? display : expected.map((e) => e.text);

  const sorted = [...heard].sort((a, b) => a.start - b.start);
  const segById = new Map(segments.map((s) => [s.index, s]));
  const times: (TimedWord | null)[] = expected.map(() => null);
  for (const [i, j] of lcsPairs(
    expected.map((e) => e.text),
    sorted.map((h) => h.text),
  )) {
    const seg = segById.get(expected[i]!.segment)!;
    const h = sorted[j]!;
    if (h.start < seg.start_s - SEGMENT_SLACK_S || h.start > seg.end_s + SEGMENT_SLACK_S) continue;
    times[i] = h;
  }

  const words: AlignedWord[] = expected.map((e, i) => ({
    text: shown[i]!,
    segment: e.segment,
    start: times[i]?.start ?? NaN,
    end: times[i]?.end ?? NaN,
    matched: times[i] !== null,
  }));

  // Fill gaps segment by segment, bounded by matched neighbours or the segment's edges.
  for (const seg of segments) {
    const idx = words.map((w, i) => (w.segment === seg.index ? i : -1)).filter((i) => i >= 0);
    let k = 0;
    while (k < idx.length) {
      if (words[idx[k]!]!.matched) {
        k++;
        continue;
      }
      let e = k;
      while (e < idx.length && !words[idx[e]!]!.matched) e++;
      const left = k > 0 ? words[idx[k - 1]!]!.end : seg.start_s;
      const right = e < idx.length ? words[idx[e]!]!.start : seg.end_s;
      const run = idx.slice(k, e);
      const weights = run.map((i) => Math.max(1, normalizeWord(words[i]!.text).length));
      const total = weights.reduce((a, b) => a + b, 0);
      const span = Math.max(right - left, MIN_WORD_S * run.length);
      let t = left;
      run.forEach((i, r) => {
        const d = (span * weights[r]!) / total;
        words[i]!.start = t;
        words[i]!.end = t + d;
        t += d;
      });
      k = e;
    }
  }

  // Enforce monotonic, positive-length words.
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (i > 0) w.start = Math.max(w.start, words[i - 1]!.end);
    if (w.end < w.start + MIN_WORD_S) w.end = w.start + MIN_WORD_S;
  }

  const matched = words.filter((w) => w.matched).length;
  return { words, match_rate: words.length ? Math.round((matched / words.length) * 1000) / 1000 : 0 };
}
