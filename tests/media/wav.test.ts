import { describe, expect, it } from 'vitest';
import { concatWithGaps, decodeWav, encodeWav, nonSilentRange } from '../../src/media/wav.js';

describe('wav', () => {
  it('round-trips samples within 16-bit precision', () => {
    const s = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123]);
    const { samples, sampleRate } = decodeWav(encodeWav(s, 24000));
    expect(sampleRate).toBe(24000);
    expect(samples.length).toBe(s.length);
    s.forEach((v, i) => expect(samples[i]).toBeCloseTo(v, 3));
  });

  it('clamps out-of-range samples instead of wrapping', () => {
    const { samples } = decodeWav(encodeWav(new Float32Array([2, -2]), 8000));
    expect(samples[0]).toBeCloseTo(1, 3);
    expect(samples[1]).toBeCloseTo(-1, 3);
  });

  it('header says 44 bytes + 2 per sample', () => {
    expect(encodeWav(new Float32Array(100), 16000).length).toBe(244);
  });

  it('finds the non-silent range', () => {
    expect(nonSilentRange(new Float32Array([0, 0.001, 0.5, 0.2, 0, 0]))).toEqual([2, 4]);
    expect(nonSilentRange(new Float32Array([0, 0]))).toEqual([2, 2]);
  });

  it('concatenates with gaps, lead and tail', () => {
    const out = concatWithGaps([new Float32Array([1, 1]), new Float32Array([2])], 3, 1, 2);
    expect(Array.from(out)).toEqual([0, 1, 1, 0, 0, 0, 2, 0, 0]);
  });
});
