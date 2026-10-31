/**
 * Pocket Fables: put a script into the review site's "Scripts to review" queue.
 *   npm run fables:script -- --file channels/fables/samples/pf-001/script.json            (new video)
 *   npm run fables:script -- --file runs/<id>/script.json --video <id> [--by scriptwriter]  (revision after Thomas's notes)
 * Copies it to runs/<id>/script.json + script.md, stores a new scripts version and sets script_review.
 * Never calls Everygen and never approves: only Thomas can, in the review site.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { saveFableScript } from '../fables/script.js';
import { RUNS_ROOT, args, main } from './_lib.js';

const a = args({ file: { type: 'string' }, video: { type: 'string' }, by: { type: 'string' } });

await main((db) => {
  if (!a.file) throw new Error('--file <script.json> is required');
  const raw: unknown = JSON.parse(readFileSync(resolve(PROJECT_ROOT, a.file), 'utf8'));
  const videoId = a.video === undefined ? undefined : Number(a.video);
  if (videoId !== undefined && !(Number.isInteger(videoId) && videoId > 0)) throw new Error('--video must be a video id');
  return saveFableScript(db, raw, { videoId, createdBy: a.by ?? (videoId ? 'scriptwriter' : 'hand-written'), runsRoot: RUNS_ROOT });
});
