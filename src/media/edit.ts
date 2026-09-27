/**
 * edit.json — the producer agent's editing choices (which clip plays when,
 * and how it's framed). The render script turns this into ffmpeg; the agent
 * never writes ffmpeg itself.
 */
import { z } from 'zod';
import { END_CARD_MIN_S, FPS, H, KENBURNS_MAX_ZOOM, W } from './layout.js';
import type { SegmentTiming } from './align.js';

export const EditClip = z.object({
  nasa_id: z.string().min(1),
  start_s: z.number().min(0),
  end_s: z.number().positive(),
  /**
   * blur_bg: fit width over a blurred copy (default). pan: fill the frame, slide sideways.
   * kenburns: fill frame, slow zoom (stills). pano: panoramas — a tall band over a blurred copy,
   * sliding slowly across part of the picture (centred on focus.x).
   */
  mode: z.enum(['blur_bg', 'pan', 'kenburns', 'pano']).default('blur_bg'),
  /** pan: which way the view moves. kenburns / blur_bg stills: zoom in or out. */
  direction: z.enum(['left', 'right', 'in', 'out']).optional(),
  /** Stills: point to zoom toward, as fractions of the picture (0,0 = top-left). Default: centre. */
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  /** Stills: how far to zoom over the clip (1 = none). Capped at KENBURNS_MAX_ZOOM (§6). */
  zoom: z.number().min(1).max(KENBURNS_MAX_ZOOM).optional(),
  /** Video only: where in the source clip to start. */
  source_in_s: z.number().min(0).default(0),
  why: z.string().default(''),
});
export type EditClip = z.infer<typeof EditClip>;

export const Edit = z.object({ clips: z.array(EditClip).min(1) });
export type Edit = z.infer<typeof Edit>;

export const MIN_CLIP_S = 1.5;
const TOLERANCE_S = 0.1;

const toFrame = (s: number) => Math.ceil(s * FPS) / FPS;

/**
 * Timeline from the voiceover: the end card appears when the closing question
 * starts and stays at least END_CARD_MIN_S, with ~1 s of air after the voice.
 */
export function computeTimeline(segments: SegmentTiming[]): { duration_s: number; end_card_start_s: number } {
  const last = segments[segments.length - 1];
  if (!last) throw new Error('no voice segments');
  const duration = Math.max(last.start_s + END_CARD_MIN_S, last.end_s + 1.0);
  return { duration_s: toFrame(duration), end_card_start_s: last.start_s };
}

export interface AssetInfo {
  nasa_id: string;
  media_type: string;
  rights_status: string;
  credit: string | null;
  duration_s?: number | null;
  width?: number;
  height?: number;
}

/** Filling 1080×1920 from a smaller still looks soft past this; prefer blur_bg. */
export const MAX_FILL_UPSCALE = 1.6;

/** Validates an edit against the timeline + assets and snaps it to cover exactly [0, duration]. */
export function normalizeEdit(
  edit: Edit,
  duration: number,
  assets: AssetInfo[],
): { clips: EditClip[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(assets.map((a) => [a.nasa_id, a]));
  const clips = edit.clips.map((c) => ({ ...c }));

  if (Math.abs(clips[0]!.start_s) > TOLERANCE_S) errors.push('first clip must start at 0');
  clips[0]!.start_s = 0;
  for (let i = 1; i < clips.length; i++) {
    const gap = clips[i]!.start_s - clips[i - 1]!.end_s;
    if (Math.abs(gap) > TOLERANCE_S) errors.push(`gap/overlap of ${gap.toFixed(2)} s before clip ${i + 1}`);
    clips[i]!.start_s = clips[i - 1]!.end_s;
  }
  const last = clips[clips.length - 1]!;
  if (duration - last.end_s > 5) errors.push(`clips end at ${last.end_s} s but video is ${duration} s`);
  last.end_s = duration;

  clips.forEach((c, i) => {
    const n = i + 1;
    const len = c.end_s - c.start_s;
    if (len < MIN_CLIP_S) errors.push(`clip ${n} is ${len.toFixed(2)} s; min ${MIN_CLIP_S} s`);
    const a = byId.get(c.nasa_id);
    if (!a) {
      errors.push(`clip ${n}: asset ${c.nasa_id} not fetched for this video`);
      return;
    }
    if (a.rights_status === 'rejected') errors.push(`clip ${n}: asset ${c.nasa_id} has rejected rights`);
    if (c.mode === 'kenburns' && a.media_type !== 'image') errors.push(`clip ${n}: kenburns is for stills only`);
    if (a.media_type === 'video' && a.duration_s && c.source_in_s + len > a.duration_s + TOLERANCE_S) {
      errors.push(`clip ${n}: needs ${len.toFixed(1)} s from ${c.source_in_s} s but source is ${a.duration_s.toFixed(1)} s`);
    }
    if ((c.mode === 'pan' || c.mode === 'pano') && c.direction && !['left', 'right'].includes(c.direction)) {
      errors.push(`clip ${n}: ${c.mode} direction must be left|right`);
    }
    if (c.mode === 'pano' && a.width && a.height && a.width / a.height < 1.8) {
      warnings.push(`clip ${n}: pano is meant for wide pictures; ${c.nasa_id} is ${a.width}×${a.height}`);
    }
    if ((c.mode === 'pan' || c.mode === 'kenburns') && a.width && a.height) {
      const upscale = Math.max(W / a.width, H / a.height);
      if (upscale > MAX_FILL_UPSCALE) {
        warnings.push(`clip ${n}: ${c.mode} upscales ${c.nasa_id} (${a.width}×${a.height}) ${upscale.toFixed(1)}× — will look soft; consider blur_bg`);
      }
    }
  });
  return { clips, errors, warnings };
}
