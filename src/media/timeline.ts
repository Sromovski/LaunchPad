/**
 * "Sound moments": the producer can pause the narration after a line so a
 * clip's own audio (e.g. a real Mars recording) plays by itself. Pauses shift
 * everything after them — voice, words, captions, end card — so all of that
 * goes through one mapping from voice time to final video time.
 */
import type { AlignedWord, SegmentTiming } from './align.js';

export interface Pause {
  after_segment: number;
  seconds: number;
}

export interface PauseWindow {
  /** Where the narration stops, in voice time (end of that line's speech). */
  at_voice_s: number;
  /** The silent window in final video time. */
  start_s: number;
  end_s: number;
}

/** Pause windows, sorted, in both voice time and final time. */
export function pauseWindows(segments: SegmentTiming[], pauses: Pause[]): PauseWindow[] {
  const sorted = [...pauses].sort((a, b) => a.after_segment - b.after_segment);
  let shift = 0;
  return sorted.map((p) => {
    const seg = segments.find((s) => s.index === p.after_segment);
    if (!seg) throw new Error(`pause after unknown segment ${p.after_segment}`);
    const w = { at_voice_s: seg.end_s, start_s: seg.end_s + shift, end_s: seg.end_s + shift + p.seconds };
    shift += p.seconds;
    return w;
  });
}

/** Voice time → final time: add every pause that starts at or before t. */
export function toFinalTime(t: number, windows: PauseWindow[]): number {
  let shift = 0;
  for (const w of windows) if (w.at_voice_s <= t + 1e-9) shift += w.end_s - w.start_s;
  return t + shift;
}

export function shiftSegments(segments: SegmentTiming[], windows: PauseWindow[]): SegmentTiming[] {
  // A segment's end sits exactly on its own pause point; it must not jump past the pause.
  return segments.map((s) => ({ ...s, start_s: toFinalTime(s.start_s, windows), end_s: toFinalTime(s.end_s - 1e-6, windows) + 1e-6 }));
}

export function shiftWords(words: AlignedWord[], windows: PauseWindow[]): AlignedWord[] {
  return words.map((w) => ({ ...w, start: toFinalTime(w.start, windows), end: toFinalTime(w.end - 1e-6, windows) + 1e-6 }));
}

/** Insert silence into a sample buffer at each pause point. */
export function insertSilence(samples: Float32Array, sampleRate: number, windows: PauseWindow[]): Float32Array {
  const extra = windows.reduce((n, w) => n + Math.round((w.end_s - w.start_s) * sampleRate), 0);
  const out = new Float32Array(samples.length + extra);
  let src = 0;
  let dst = 0;
  for (const w of windows) {
    const cut = Math.min(samples.length, Math.round(w.at_voice_s * sampleRate));
    out.set(samples.subarray(src, cut), dst);
    dst += cut - src;
    src = cut;
    dst += Math.round((w.end_s - w.start_s) * sampleRate); // zeros
  }
  out.set(samples.subarray(src), dst);
  return out;
}
