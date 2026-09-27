/**
 * npm run media:preview -- --video <id> --nasa-id <nasa_id> --at 12,15.5,20
 *   → runs/<id>/preview/<nasa_id>-<t>.png (small frames from the SOURCE clip)
 * npm run media:preview -- --video <id> --final --at 36.4,38
 *   → frames from runs/<id>/final.mp4
 * Lets the producer find good start points / check a stretch without hand-typed ffmpeg.
 */
import { mkdirSync } from 'node:fs';
import { ffmpegBin, probe, run } from '../media/probe.js';
import { safeFileName } from '../nasa/fetch.js';
import { args, main, requireVideoId, runPath } from './_lib.js';

const a = args({ video: { type: 'string' }, 'nasa-id': { type: 'string' }, final: { type: 'boolean', default: false }, at: { type: 'string' } });
const MAX_FRAMES = 12;

await main((db) => {
  const videoId = requireVideoId(a.video);
  const times = (a.at ?? '').split(',').map((s) => Number(s.trim())).filter((t) => Number.isFinite(t) && t >= 0);
  if (times.length === 0 || times.length > MAX_FRAMES) throw new Error(`--at needs 1–${MAX_FRAMES} times in seconds, e.g. --at 3,7.5,12`);

  let source: string;
  let label: string;
  if (a.final) {
    source = runPath(videoId, 'final.mp4');
    label = 'final';
  } else {
    if (!a['nasa-id']) throw new Error('--nasa-id or --final is required');
    const row = db.prepare('SELECT local_path FROM assets WHERE video_id = ? AND nasa_id = ?').get(videoId, a['nasa-id']) as { local_path: string } | undefined;
    if (!row) throw new Error(`asset ${a['nasa-id']} not fetched for video ${videoId}`);
    source = row.local_path;
    label = safeFileName(a['nasa-id']);
  }
  const duration = probe(source).duration;
  const dir = runPath(videoId, 'preview');
  mkdirSync(dir, { recursive: true });
  const frames = times.map((t) => {
    if (duration && t > duration) return { t, error: `past the end (${duration.toFixed(1)} s)` };
    const file = `${label}-${t.toFixed(1)}.png`;
    run(ffmpegBin(), ['-y', '-loglevel', 'error', '-ss', String(t), '-i', source, '-frames:v', '1', '-vf', 'scale=540:-2', `${dir}/${file}`]);
    return { t, file: `runs/${videoId}/preview/${file}` };
  });
  return { source_duration_s: duration, frames };
});
