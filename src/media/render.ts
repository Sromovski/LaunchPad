/**
 * Builds the ffmpeg command for the final MP4 from the normalized edit.
 * Pure (no I/O) so the filter graph can be unit-tested.
 *
 * Per clip → 1080×1920 @30 fps → crossfades → burn in captions.ass →
 * voice with two-pass loudnorm to −14 LUFS → H.264/AAC MP4.
 */
import type { EditClip } from './edit.js';
import type { Loudness } from './probe.js';
import { buildAudioGraph } from './audio-mix.js';
import type { PauseWindow } from './timeline.js';
import { FPS, H, KENBURNS_MAX_ZOOM, SAFE_BOTTOM_Y, W } from './layout.js';

export const XFADE_S = 0.4;
/** pano: band height cap, max upscale, and slide speed (px/s) so short clips don't whip past. */
export const PANO = { maxBandH: 1100, maxUpscale: 1.2, speedPxPerS: 80 } as const;

/** Gentle zoom on stills shown over a blurred background. */
const BLUR_BG_ZOOM = 1.08;

export interface RenderClip extends EditClip {
  local_path: string;
  media_type: string;
  /** Source pixel size — needed to frame stills over the blurred background. */
  width?: number;
  height?: number;
  /** Fixed gain for this clip's own sound (clipGainDb of the whole recording); only used with audio "full". */
  audio_gain_db?: number;
}

export interface RenderPlanInput {
  clips: RenderClip[];
  duration_s: number;
  voicePath: string;
  loudness: Loudness;
  /** Narration pauses in final time; clips with audio "full" are heard only inside them. */
  windows?: PauseWindow[];
  /** Paths used inside the filter graph are relative to ffmpeg's cwd (the run dir) to avoid Windows drive-letter escaping. */
  captionsFile: string;
  fontsDir: string;
  output: string;
  /** Where the caller writes `filter` (relative to the run dir). Separate names let two plans coexist. */
  filterFile?: string;
}

export interface RenderPlan {
  args: string[];
  filter: string;
}

const f = (n: number) => Number(n.toFixed(3)).toString();

/** Zoom factor expression over the clip: in = 1 → max, out = max → 1. */
function zoomExpr(max: number, d: number, direction: EditClip['direction']): string {
  const k = f(max - 1);
  return direction === 'out' ? `(${f(max)}-${k}*t/${f(d)})` : `(1+${k}*t/${f(d)})`;
}

/**
 * Crop offsets that keep the focus point fixed on screen while zooming.
 * For a box w×h scaled by z, x = fx·(w·z − w) pins the point at fx.
 * Written in terms of z (not iw/ih): crop reads iw/ih once at startup, before
 * the per-frame scale has grown the picture, so iw−ow would always be 0.
 */
function focusXY(c: EditClip, w: number, h: number, z: string): string {
  const fx = f(c.focus?.x ?? 0.5);
  const fy = f(c.focus?.y ?? 0.5);
  return `x='${fx}*(${w}*${z}-${w})':y='${fy}*(${h}*${z}-${h})'`;
}

function clipChain(c: RenderClip, i: number, d: number): string {
  const isImage = c.media_type === 'image';
  // Stills: shave 4 px per edge — some NASA JPEGs have coloured sensor/border rows that show as lines.
  const trim = isImage ? 8 : 0;
  let src = `[${i}:v]fps=${FPS},setsar=1${isImage ? ',crop=iw-8:ih-8' : ''}`;
  // Effective picture size after trim + optional crop (e.g. one camera view out of a NASA split screen).
  let effW = c.width ? c.width - trim : undefined;
  let effH = c.height ? c.height - trim : undefined;
  if (c.crop) {
    if (!effW || !effH) throw new Error(`clip ${c.nasa_id} needs width/height to crop`);
    const cw = Math.round((effW * c.crop.w) / 2) * 2;
    const ch = Math.round((effH * c.crop.h) / 2) * 2;
    src += `,crop=${cw}:${ch}:${Math.round(effW * c.crop.x)}:${Math.round(effH * c.crop.y)}`;
    effW = cw;
    effH = ch;
  }
  const tail = `trim=duration=${f(d)},setpts=PTS-STARTPTS,format=yuv420p,setsar=1,settb=AVTB[c${i}]`;
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;

  switch (c.mode) {
    case 'pan': {
      const progress = c.direction === 'left' ? `(1-t/${f(d)})` : `(t/${f(d)})`;
      return `${src},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:x='(iw-ow)*${progress}':y='(ih-oh)/2',${tail}`;
    }
    case 'pano': {
      if (!effW || !effH) throw new Error(`pano clip ${c.nasa_id} needs width/height`);
      const srcW = effW;
      const srcH = effH;
      const bandH = Math.round(Math.min(PANO.maxBandH, srcH * PANO.maxUpscale) / 2) * 2;
      const scaledW = Math.round((srcW * bandH) / srcH / 2) * 2;
      const maxX = Math.max(0, scaledW - W);
      // Slide a limited distance around focus.x instead of sweeping the whole panorama.
      const travel = Math.min(maxX, PANO.speedPxPerS * d);
      const centre = Math.min(maxX, Math.max(0, (c.focus?.x ?? 0.5) * scaledW - W / 2));
      const start = Math.min(maxX - travel, Math.max(0, centre - travel / 2));
      const [x0, x1] = c.direction === 'left' ? [start + travel, start] : [start, start + travel];
      return (
        `${src},split[bgsrc${i}][fgsrc${i}];` +
        `[bgsrc${i}]${cover},boxblur=40:4,eq=brightness=-0.15:saturation=1.1[bg${i}];` +
        `[fgsrc${i}]scale=${scaledW}:${bandH},crop=${W}:${bandH}:x='${f(x0)}+${f(x1 - x0)}*t/${f(d)}':y=0[fg${i}];` +
        `[bg${i}][fg${i}]overlay=x=0:y=${Math.round((SAFE_BOTTOM_Y - bandH) / 2)},${tail}`
      );
    }
    case 'kenburns': {
      const z = zoomExpr(c.zoom ?? KENBURNS_MAX_ZOOM, d, c.direction);
      return `${src},${cover},scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame,crop=${W}:${H}:${focusXY(c, W, H, z)},${tail}`;
    }
    case 'blur_bg':
    default: {
      // Foreground fits the width and is centred in the safe area (above the platform UI band).
      // Stills zoom *inside* a fixed picture box (the box doesn't grow), toward the focus point.
      let fgScale = `scale=${W}:-2`;
      if (isImage) {
        if (!effW || !effH) throw new Error(`still ${c.nasa_id} needs width/height to frame`);
        const boxH = Math.round((W * effH) / effW / 2) * 2;
        const z = zoomExpr(c.zoom ?? BLUR_BG_ZOOM, d, c.direction);
        fgScale = `scale=w='trunc(${W}*${z}/2)*2':h=-2:eval=frame,crop=${W}:${boxH}:${focusXY(c, W, boxH, z)}`;
      }
      return (
        `${src},split[bgsrc${i}][fgsrc${i}];` +
        `[bgsrc${i}]${cover},boxblur=40:4,eq=brightness=-0.15:saturation=1.1[bg${i}];` +
        `[fgsrc${i}]${fgScale}[fg${i}];` +
        `[bg${i}][fg${i}]overlay=x='(W-w)/2':y='(${SAFE_BOTTOM_Y}-h)/2':eval=frame,${tail}`
      );
    }
  }
}

export function buildRenderPlan(p: RenderPlanInput): RenderPlan {
  const n = p.clips.length;
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'warning', '-stats'];
  const chains: string[] = [];
  const lengths: number[] = [];

  p.clips.forEach((c, i) => {
    // Every clip but the last runs XFADE_S longer so the crossfade overlaps instead of shortening the video.
    const d = c.end_s - c.start_s + (i < n - 1 ? XFADE_S : 0);
    lengths.push(c.end_s - c.start_s);
    if (c.media_type === 'image') args.push('-loop', '1', '-framerate', String(FPS), '-t', f(d), '-i', c.local_path);
    else args.push('-ss', f(c.source_in_s), '-t', f(d), '-i', c.local_path);
    chains.push(clipChain(c, i, d));
  });
  args.push('-i', p.voicePath);
  const audioIndex = n;

  // Crossfade chain: offset_k = sum of the first k clip lengths.
  let last = 'c0';
  let offset = 0;
  for (let i = 1; i < n; i++) {
    offset += lengths[i - 1]!;
    const out = i === n - 1 ? 'vx' : `x${i}`;
    chains.push(`[${last}][c${i}]xfade=transition=fade:duration=${XFADE_S}:offset=${f(offset)}[${out}]`);
    last = out;
  }
  const videoIn = n === 1 ? 'c0' : 'vx';
  // NASA JPEGs are full-range (yuvj420p); convert to TV range so every player shows the same levels.
  chains.push(`[${videoIn}]subtitles=${p.captionsFile}:fontsdir=${p.fontsDir},scale=out_range=tv,format=yuv420p[vout]`);

  // Narration + any clips' own sound (heard only inside narration pauses), then the peak limiter.
  const clipAudio = p.clips
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.audio === 'full' && c.media_type === 'video')
    .map(({ c, i }) => ({ inputIndex: i, start_s: c.start_s, end_s: c.end_s, gain_db: c.audio_gain_db ?? 0 }));
  chains.push(...buildAudioGraph({ voiceIndex: audioIndex, loudness: p.loudness, duration_s: p.duration_s, clips: clipAudio, windows: p.windows ?? [] }));

  const filter = chains.join(';\n');
  args.push(
    '-/filter_complex', p.filterFile ?? 'filter.txt',
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', f(p.duration_s),
    '-movflags', '+faststart',
    p.output,
  );
  return { args, filter };
}
