/** Minimal mono 16-bit PCM WAV encoder/decoder (no dependency needed for this). */

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

export function decodeWav(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12;
  let sampleRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      if (buf.readUInt16LE(off + 8) !== 1 || buf.readUInt16LE(off + 10) !== 1 || buf.readUInt16LE(off + 22) !== 16) {
        throw new Error('only mono 16-bit PCM WAV is supported');
      }
      sampleRate = buf.readUInt32LE(off + 12);
    } else if (id === 'data') {
      const n = size / 2;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(off + 8 + i * 2) / 0x8000;
      return { samples, sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Index range [start, end) of samples louder than `threshold` (for trimming TTS padding). */
export function nonSilentRange(samples: Float32Array, threshold = 0.01): [number, number] {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]!) < threshold) start++;
  let end = samples.length;
  while (end > start && Math.abs(samples[end - 1]!) < threshold) end--;
  return [start, end];
}

export function concatWithGaps(parts: Float32Array[], gapSamples: number, leadSamples = 0, tailSamples = 0): Float32Array {
  const total = leadSamples + tailSamples + parts.reduce((n, p) => n + p.length, 0) + gapSamples * Math.max(0, parts.length - 1);
  const out = new Float32Array(total);
  let off = leadSamples;
  parts.forEach((p, i) => {
    out.set(p, off);
    off += p.length + (i < parts.length - 1 ? gapSamples : 0);
  });
  return out;
}
