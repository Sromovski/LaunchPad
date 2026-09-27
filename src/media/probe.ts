/** Thin wrappers around ffmpeg/ffprobe processes. */
import { spawnSync } from 'node:child_process';
import { ffmpegPath, ffprobePath } from './tools.js';

export function ffmpegBin(): string {
  const p = ffmpegPath();
  if (!p) throw new Error('ffmpeg not found (run npm run doctor)');
  return p;
}

function ffprobeBin(): string {
  const p = ffprobePath();
  if (!p) throw new Error('ffprobe not found (run npm run doctor)');
  return p;
}

export function run(cmd: string, args: string[], opts: { cwd?: string } = {}): { stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd.split(/[\\/]/).pop()} exited ${r.status}: ${r.stderr.trim().split('\n').slice(-6).join('\n')}`);
  return { stdout: r.stdout, stderr: r.stderr };
}

export interface ProbeStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
}

export interface Probe {
  duration: number;
  streams: ProbeStream[];
}

export function probe(path: string): Probe {
  const { stdout } = run(ffprobeBin(), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]);
  const j = JSON.parse(stdout) as { format: { duration?: string }; streams: ProbeStream[] };
  return { duration: Number(j.format.duration ?? 0), streams: j.streams };
}

export interface Loudness {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** First pass of two-pass loudnorm: measure. */
export function measureLoudness(path: string, target = { I: -14, TP: -1.5, LRA: 11 }): Loudness {
  const { stderr } = run(ffmpegBin(), [
    '-hide_banner', '-nostats', '-i', path,
    '-af', `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}:print_format=json`,
    '-f', 'null', '-',
  ]);
  const json = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  return JSON.parse(json) as Loudness;
}
