import { describe, expect, it } from 'vitest';
import { alignWords, normalizeWord, parseWhisperJson, similar } from '../../src/media/align.js';

describe('normalizeWord / similar', () => {
  it('strips punctuation and case', () => {
    expect(normalizeWord(' Blue?')).toBe('blue');
    expect(normalizeWord("Mars's")).toBe('marss');
  });
  it('tolerates small spelling differences on longer words', () => {
    expect(similar('gale', 'gail')).toBe(true);
    expect(similar('curiosity', 'curiousity')).toBe(true);
    expect(similar('is', 'it')).toBe(false); // short words must match exactly
    expect(similar('blue', 'red')).toBe(false);
  });
});

describe('parseWhisperJson', () => {
  it('reads word segments and drops special tokens', () => {
    const json = {
      transcription: [
        { offsets: { from: 0, to: 210 }, text: '' },
        { offsets: { from: 210, to: 320 }, text: ' Did' },
        { offsets: { from: 2090, to: 2640 }, text: ' blue?' },
        { offsets: { from: 2640, to: 2700 }, text: ' [_TT_132]' },
      ],
    };
    expect(parseWhisperJson(json)).toEqual([
      { text: 'Did', start: 0.21, end: 0.32 },
      { text: 'blue?', start: 2.09, end: 2.64 },
    ]);
  });
});

const seg = (index: number, text: string, start_s: number, end_s: number) => ({ index, text, start_s, end_s });

describe('alignWords', () => {
  it('uses whisper timings but keeps the script spelling', () => {
    const out = alignWords(
      [seg(0, 'Gale Crater is big.', 0, 2)],
      [
        { text: 'Gail', start: 0.1, end: 0.4 },
        { text: 'crater', start: 0.4, end: 0.9 },
        { text: 'is', start: 0.9, end: 1.1 },
        { text: 'big.', start: 1.1, end: 1.6 },
      ],
    );
    expect(out.words.map((w) => w.text)).toEqual(['Gale', 'Crater', 'is', 'big.']);
    expect(out.words[0]).toMatchObject({ start: 0.1, end: 0.4, matched: true });
    expect(out.match_rate).toBe(1);
  });

  it('interpolates words whisper missed, inside known neighbours', () => {
    const out = alignWords(
      [seg(0, 'The dust is tiny.', 0, 2)],
      [
        { text: 'The', start: 0.0, end: 0.2 },
        { text: 'tiny.', start: 1.2, end: 1.8 },
      ],
    );
    const [the, dust, is, tiny] = out.words;
    expect(dust!.matched).toBe(false);
    expect(dust!.start).toBeGreaterThanOrEqual(the!.end);
    expect(is!.end).toBeLessThanOrEqual(tiny!.start + 1e-9);
    expect(out.match_rate).toBe(0.5);
  });

  it('bounds unmatched words at segment edges by the TTS segment times', () => {
    const out = alignWords([seg(0, 'Hello there.', 0.15, 1.0), seg(1, 'Bye now.', 1.4, 2.0)], []);
    expect(out.words[0]!.start).toBeCloseTo(0.15);
    expect(out.words[1]!.end).toBeCloseTo(1.0);
    expect(out.words[2]!.start).toBeCloseTo(1.4);
    expect(out.words[3]!.end).toBeCloseTo(2.0);
  });

  it('ignores a match that lands far outside its segment', () => {
    const out = alignWords(
      [seg(0, 'Mars is red.', 0, 1), seg(1, 'Mars is cold.', 5, 6)],
      [
        { text: 'Mars', start: 5.0, end: 5.3 },
        { text: 'is', start: 5.3, end: 5.4 },
        { text: 'cold', start: 5.4, end: 5.9 },
      ],
    );
    // First "Mars" must not steal the second segment's timing.
    expect(out.words[0]!.start).toBeLessThan(1);
    expect(out.words[3]!.start).toBeCloseTo(5.0);
  });

  it('times are monotonic and every word has positive length', () => {
    const out = alignWords(
      [seg(0, 'one two three four five', 0, 2)],
      [
        { text: 'three', start: 1.0, end: 1.0 },
        { text: 'two', start: 0.5, end: 0.8 }, // out of order in whisper output
      ],
    );
    for (let i = 0; i < out.words.length; i++) {
      expect(out.words[i]!.end).toBeGreaterThan(out.words[i]!.start);
      if (i > 0) expect(out.words[i]!.start).toBeGreaterThanOrEqual(out.words[i - 1]!.end - 1e-9);
    }
  });
});
