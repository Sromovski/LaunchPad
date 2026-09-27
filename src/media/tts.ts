/**
 * Kokoro voiceover. Each script segment (hook, lines, end question) is spoken
 * separately, trimmed, and joined with short pauses — so we know exactly when
 * every line starts without guessing, and the hook starts right away.
 */
import { concatWithGaps, nonSilentRange } from './wav.js';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const DEFAULT_VOICE = process.env.LAUNCHPAD_VOICE ?? 'af_heart';
/** Slower than Kokoro's default: the audience is 6–10. Thomas asked for ~10% slower than 0.95 after video 1. */
export const DEFAULT_SPEED = 0.86;

/** Pauses scale with speed so the whole video slows evenly, not just the words. */
export const DEFAULT_GAP_MS = 400;
export const DEFAULT_LEAD_MS = 150;
export const DEFAULT_TAIL_MS = 300;

export interface TtsOptions {
  voice?: string;
  speed?: number;
  /** Silence between segments. */
  gapMs?: number;
  /** Silence before the first word — keep tiny so the hook lands in the first 2 s. */
  leadMs?: number;
  tailMs?: number;
}

export interface SpokenSegment {
  index: number;
  text: string;
  start_s: number;
  end_s: number;
}

export interface TtsResult {
  samples: Float32Array;
  sampleRate: number;
  segments: SpokenSegment[];
  voice: string;
  speed: number;
}

type Kokoro = {
  generate(text: string, opts: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
};

let cached: Kokoro | null = null;
async function loadKokoro(): Promise<Kokoro> {
  if (!cached) {
    const { KokoroTTS } = await import('kokoro-js');
    cached = (await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'cpu' })) as unknown as Kokoro;
  }
  return cached;
}

export async function synthesize(texts: string[], opts: TtsOptions = {}): Promise<TtsResult> {
  const voice = opts.voice ?? DEFAULT_VOICE;
  const speed = opts.speed ?? DEFAULT_SPEED;
  const tts = await loadKokoro();

  const parts: Float32Array[] = [];
  let sampleRate = 24000;
  for (const text of texts) {
    const out = await tts.generate(text, { voice, speed });
    sampleRate = out.sampling_rate;
    const [a, b] = nonSilentRange(out.audio, 0.005);
    parts.push(out.audio.slice(a, b));
  }

  const ms = (v: number) => Math.round((v / 1000) * sampleRate);
  const gap = ms(opts.gapMs ?? DEFAULT_GAP_MS);
  const lead = ms(opts.leadMs ?? DEFAULT_LEAD_MS);
  const tail = ms(opts.tailMs ?? DEFAULT_TAIL_MS);

  const segments: SpokenSegment[] = [];
  let off = lead;
  parts.forEach((p, i) => {
    segments.push({ index: i, text: texts[i]!, start_s: off / sampleRate, end_s: (off + p.length) / sampleRate });
    off += p.length + gap;
  });

  return { samples: concatWithGaps(parts, gap, lead, tail), sampleRate, segments, voice, speed };
}
