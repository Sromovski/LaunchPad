/**
 * Final audio graph: narration (two-pass loudnorm) plus, optionally, clips'
 * own sound. A clip's sound is only audible inside narration pauses (gated
 * with short fades), so it never talks over the narrator. Then one hard peak
 * limiter and padding to the video length.
 */
import type { Loudness } from './probe.js';
import type { PauseWindow } from './timeline.js';

export interface ClipAudio {
  /** ffmpeg input index of the clip (its -ss/-t already trim it). */
  inputIndex: number;
  /** Where the clip starts/ends in the final video. */
  start_s: number;
  end_s: number;
  /** One fixed gain for the whole source recording (see clipGainDb). */
  gain_db: number;
}

/** Clip sound sits a little under the narration (−14 LUFS). */
export const CLIP_TARGET_LUFS = -18;

/**
 * A single gain for a whole NASA recording, from its integrated loudness. Deliberately NOT
 * per-moment loudnorm: that flattened NASA's loud-Earth-bell / quiet-Mars-bell comparison
 * in video 9 (the quiet one came out louder). Capped at ±20 dB.
 */
export function clipGainDb(integratedLufs: number): number {
  if (!Number.isFinite(integratedLufs)) return 0;
  return Math.max(-20, Math.min(20, Math.round((CLIP_TARGET_LUFS - integratedLufs) * 10) / 10));
}

export const FADE_S = 0.15;
const f = (n: number) => Number(n.toFixed(3)).toString();

/** 0 outside the pause windows that overlap the clip, 1 inside, with linear fades. ffmpeg min/max take two args. */
export function gateExpr(clip: Pick<ClipAudio, 'start_s' | 'end_s'>, windows: PauseWindow[]): string | null {
  const parts = windows
    .map((w) => ({ s: Math.max(w.start_s, clip.start_s), e: Math.min(w.end_s, clip.end_s) }))
    .filter((w) => w.e - w.s > 2 * FADE_S)
    .map((w) => `max(0,min(1,min((t-${f(w.s)})/${FADE_S},(${f(w.e)}-t)/${FADE_S})))`);
  return parts.length ? parts.join('+') : null;
}

export function buildAudioGraph(o: { voiceIndex: number; loudness: Loudness; duration_s: number; clips: ClipAudio[]; windows: PauseWindow[] }): string[] {
  const L = o.loudness;
  const voice =
    `[${o.voiceIndex}:a]loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${L.input_i}:measured_TP=${L.input_tp}:` +
    `measured_LRA=${L.input_lra}:measured_thresh=${L.input_thresh}:offset=${L.target_offset}:linear=true,` +
    `aresample=48000`;
  // Hard peak limit after resampling (video 7 clipped at 0 dB): −2 dBFS leaves room for AAC overshoot. level=false: no make-up gain.
  const tail = `alimiter=limit=0.8:level=false:attack=5:release=50,apad=whole_dur=${f(o.duration_s)}[aout]`;

  const gated = o.clips.map((c) => ({ c, gate: gateExpr(c, o.windows) })).filter((x): x is { c: ClipAudio; gate: string } => x.gate !== null);
  if (gated.length === 0) return [`${voice},${tail}`];

  const chains = [`${voice},aformat=sample_rates=48000:channel_layouts=stereo[voice]`];
  gated.forEach(({ c, gate }, k) => {
    const delayMs = Math.round(c.start_s * 1000);
    chains.push(
      // NASA clips vary a lot in level: one fixed gain per recording keeps its own loud/quiet contrasts.
      `[${c.inputIndex}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,volume=${f(c.gain_db)}dB,` +
        `adelay=${delayMs}:all=1,volume='${gate}':eval=frame[clipa${k}]`,
    );
  });
  chains.push(`[voice]${gated.map((_, k) => `[clipa${k}]`).join('')}amix=inputs=${gated.length + 1}:normalize=0:duration=first:dropout_transition=0,${tail}`);
  return chains;
}
