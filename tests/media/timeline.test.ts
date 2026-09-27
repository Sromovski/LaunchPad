import { describe, expect, it } from 'vitest';
import { insertSilence, pauseWindows, shiftSegments, shiftWords, toFinalTime } from '../../src/media/timeline.js';

const segs = [
  { index: 0, text: 'Hook?', start_s: 0.15, end_s: 2 },
  { index: 1, text: 'Line one.', start_s: 2.4, end_s: 5 },
  { index: 2, text: 'Line two.', start_s: 5.4, end_s: 8 },
  { index: 3, text: 'Question?', start_s: 8.4, end_s: 10 },
];

describe('pauseWindows', () => {
  it('places each pause after its line, later pauses shifted by earlier ones', () => {
    const w = pauseWindows(segs, [
      { after_segment: 2, seconds: 3 },
      { after_segment: 0, seconds: 1 },
    ]);
    expect(w).toEqual([
      { at_voice_s: 2, start_s: 2, end_s: 3 },
      { at_voice_s: 8, start_s: 9, end_s: 12 },
    ]);
  });

  it('rejects an unknown line', () => {
    expect(() => pauseWindows(segs, [{ after_segment: 9, seconds: 1 }])).toThrow(/unknown segment 9/);
  });
});

describe('shifting', () => {
  const w = pauseWindows(segs, [{ after_segment: 1, seconds: 3 }]);

  it('moves everything after the pause, nothing before it', () => {
    expect(toFinalTime(1, w)).toBe(1);
    expect(toFinalTime(5.4, w)).toBeCloseTo(8.4);
  });

  it('keeps the paused line ending where the pause starts', () => {
    const s = shiftSegments(segs, w);
    expect(s[1]!.end_s).toBeCloseTo(5);
    expect(s[2]!.start_s).toBeCloseTo(8.4);
    expect(s[3]!.end_s).toBeCloseTo(13);
  });

  it('shifts words the same way', () => {
    const words = [
      { text: 'one.', start: 4.5, end: 5, segment: 1, matched: true },
      { text: 'Line', start: 5.4, end: 5.8, segment: 2, matched: true },
    ];
    const s = shiftWords(words, w);
    expect(s[0]!.end).toBeCloseTo(5);
    expect(s[1]!.start).toBeCloseTo(8.4);
  });

  it('no pauses → no change', () => {
    expect(shiftSegments(segs, [])).toEqual(segs.map((x) => ({ ...x, end_s: x.end_s - 1e-6 + 1e-6 })));
  });
});

describe('insertSilence', () => {
  it('inserts zeros at the pause point', () => {
    const w = pauseWindows([{ index: 0, text: 'a', start_s: 0, end_s: 0.2 }], [{ after_segment: 0, seconds: 0.3 }]);
    const out = insertSilence(new Float32Array([1, 1, 1, 1, 1]), 10, w);
    expect(Array.from(out)).toEqual([1, 1, 0, 0, 0, 1, 1, 1]);
  });
});
