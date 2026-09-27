/**
 * npm run media:test-clip -- --file <image|video> --mode pano [--seconds 8] [--direction right]
 *                            [--focus 0.34,0.59] [--zoom 1.15] [--credit "Image: NASA"]
 * Renders one clip through the real render path into runs/_test/, with a
 * silent track and only a credit line. For checking media changes without
 * touching a video's status (CLAUDE.md §12: render a test clip).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildAss } from '../media/captions.js';
import { EditClip } from '../media/edit.js';
import { FONTS_DIR } from '../media/layout.js';
import { ffmpegBin, probe, run } from '../media/probe.js';
import { buildRenderPlan } from '../media/render.js';
import { encodeWav } from '../media/wav.js';
import { PROJECT_ROOT } from '../db/index.js';
import { RUNS_ROOT, args, main } from './_lib.js';

const a = args({
  file: { type: 'string' },
  mode: { type: 'string', default: 'blur_bg' },
  seconds: { type: 'string', default: '8' },
  direction: { type: 'string' },
  focus: { type: 'string' },
  zoom: { type: 'string' },
  crop: { type: 'string' }, // x,y,w,h fractions
  in: { type: 'string', default: '0' }, // video: start point in the source
  credit: { type: 'string', default: 'Image: TEST' },
});

await main(() => {
  if (!a.file) throw new Error('--file is required');
  const file = resolve(a.file);
  const d = Number(a.seconds);
  const dir = resolve(RUNS_ROOT, '_test');
  mkdirSync(dir, { recursive: true });

  const p = probe(file);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const isImage = /\.(jpe?g|png)$/i.test(file);
  const [fx, fy] = (a.focus ?? '').split(',').map(Number);
  const clip = EditClip.parse({
    nasa_id: basename(file),
    start_s: 0,
    end_s: d,
    mode: a.mode,
    direction: a.direction,
    focus: a.focus ? { x: fx, y: fy } : undefined,
    zoom: a.zoom ? Number(a.zoom) : undefined,
    crop: a.crop ? (([x, y, w, h]) => ({ x, y, w, h }))(a.crop.split(',').map(Number)) : undefined,
    source_in_s: Number(a.in),
  });

  writeFileSync(resolve(dir, 'silence.wav'), encodeWav(new Float32Array(Math.round(d * 24000)), 24000));
  writeFileSync(
    resolve(dir, 'test.ass'),
    buildAss({ words: [], endQuestionSegment: -1, endQuestion: '', endCardStart: d, duration: d, credits: [{ text: a.credit, start: 0, end: d }] }),
  );

  const name = `${basename(file).replace(/\.[^.]+$/, '')}-${clip.mode}`;
  const plan = buildRenderPlan({
    clips: [{ ...clip, local_path: file, media_type: isImage ? 'image' : 'video', width: v?.width, height: v?.height }],
    duration_s: d,
    voicePath: 'silence.wav',
    // Silence: loudnorm's measured values don't matter, it stays silent.
    loudness: { input_i: '-70', input_tp: '-70', input_lra: '0', input_thresh: '-80', target_offset: '0' },
    captionsFile: 'test.ass',
    fontsDir: `../../${FONTS_DIR}`,
    output: `${name}.mp4`,
  });
  writeFileSync(resolve(dir, 'filter.txt'), plan.filter);
  run(ffmpegBin(), plan.args, { cwd: dir });

  // Three frames: start, middle, end.
  const frames = [0.2, d / 2, d - 0.2].map((t, i) => {
    const out = resolve(dir, `${name}-${i + 1}.png`);
    run(ffmpegBin(), ['-y', '-loglevel', 'error', '-ss', String(t), '-i', resolve(dir, `${name}.mp4`), '-frames:v', '1', out]);
    return out.replace(PROJECT_ROOT, '').replace(/^[\\/]/, '');
  });
  return { output: `runs/_test/${name}.mp4`, duration_s: probe(resolve(dir, `${name}.mp4`)).duration, frames };
});
