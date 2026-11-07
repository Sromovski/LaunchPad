/**
 * npm run clips:import -- --manifest <file.json> --stage script
 * npm run clips:import -- --manifest <file.json> --stage video --file <video.mp4>
 * Brings a Curious Clips script or finished video in from stick-ai-shorts (channels/clips/CLAUDE.md).
 * It only ever lands at a review gate; nothing here approves or posts anything.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { importScript, importVideo } from '../clips/import.js';
import { main, RUNS_ROOT } from './_lib.js';

const { values: a } = parseArgs({ options: { manifest: { type: 'string' }, stage: { type: 'string' }, file: { type: 'string' } } });

const seconds = (file: string): number | null => {
  try {
    return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
  } catch {
    return null;
  }
};

await main((db) => {
  if (!a.manifest) throw new Error('--manifest <file.json> is required');
  const manifest: unknown = JSON.parse(readFileSync(a.manifest, 'utf8'));
  if (a.stage === 'script') return importScript(db, manifest);
  if (a.stage === 'video') {
    if (!a.file) throw new Error('--file <video.mp4> is required with --stage video');
    return importVideo(db, manifest, { file: a.file, durationS: seconds(a.file), runsRoot: RUNS_ROOT });
  }
  throw new Error('--stage script|video is required');
});
