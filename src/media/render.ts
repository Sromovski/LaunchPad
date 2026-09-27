/**
 * Builds the ffmpeg command for the final MP4 from the normalized edit.
 * Pure (no I/O) so the filter graph can be unit-tested.
 *
 * Per clip → 1080×1920 @30 fps → crossfades → burn in captions.ass →
 * voice with two-pass loudnorm to −14 LUFS → H.264/AAC MP4.
 */
import type { EditClip } from './edit.js';
import type { Loudness } from './probe.js';
import { FPS, H, KENBURNS_MAX_ZOOM, SAFE_BOTTOM_Y, W } from './layout.js';

export const XFADE_S = 0.4;
/** Gentle zoom on stills shown over a blurred background. */
const BLUR_BG_ZOOM = 1.08;

export interface RenderClip extends EditClip {
  local_path: string;
  media_type: string;
}

export interface RenderPlanInput {
  clips: RenderClip[];
  duration_s: number;
  voicePath: string;
  loudness: Loudness;
  /** Paths used inside the filter graph are relative to ffmpeg's cwd (the run dir) to avoid Windows drive-letter escaping. */
  captionsFile: string;
  fontsDir: string;
  output: string;
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

function clipChain(c: RenderClip, i: number, d: number): string {
  const isImage = c.media_type === 'image';
  // Stills: shave 4 px per edge — some NASA JPEGs have coloured sensor/border rows that show as lines.
  const src = `[${i}:v]fps=${FPS},setsar=1${isImage ? ',crop=iw-8:ih-8' : ''}`;
  const tail = `trim=duration=${f(d)},setpts=PTS-STARTPTS,format=yuv420p,setsar=1,settb=AVTB[c${i}]`;
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;

  switch (c.mode) {
    case 'pan': {
      const progress = c.direction === 'left' ? `(1-t/${f(d)})` : `(t/${f(d)})`;
      return `${src},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:x='(iw-ow)*${progress}':y='(ih-oh)/2',${tail}`;
    }
    case 'kenburns': {
      const z = zoomExpr(KENBURNS_MAX_ZOOM, d, c.direction);
      return `${src},${cover},scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame,crop=${W}:${H},${tail}`;
    }
    case 'blur_bg':
    default: {
      // Foreground fits the width and is centred in the safe area (above the platform UI band).
      const fgScale = isImage
        ? `scale=w='trunc(${W}*${zoomExpr(BLUR_BG_ZOOM, d, c.direction)}/2)*2':h=-2:eval=frame`
        : `scale=${W}:-2`;
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

  const L = p.loudness;
  chains.push(
    `[${audioIndex}:a]loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${L.input_i}:measured_TP=${L.input_tp}:` +
      `measured_LRA=${L.input_lra}:measured_thresh=${L.input_thresh}:offset=${L.target_offset}:linear=true,` +
      `aresample=48000,apad=whole_dur=${f(p.duration_s)}[aout]`,
  );

  const filter = chains.join(';\n');
  args.push(
    '-/filter_complex', 'filter.txt',
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', f(p.duration_s),
    '-movflags', '+faststart',
    p.output,
  );
  return { args, filter };
}
