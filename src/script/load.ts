import { existsSync, readFileSync } from 'node:fs';
import { Script } from '../agents/schemas.js';
import { runPath, sha256 } from '../cli/_lib.js';

/** Loads script.json, refusing if script:validate hasn't passed on exactly this content. */
export function loadValidatedScript(videoId: number): { script: Script; raw: string } {
  const raw = readFileSync(runPath(videoId, 'script.json'), 'utf8');
  const vPath = runPath(videoId, 'script-validation.json');
  if (!existsSync(vPath)) throw new Error('run script:validate first');
  const v = JSON.parse(readFileSync(vPath, 'utf8')) as { ok: boolean; script_sha256: string };
  if (!v.ok) throw new Error('script failed validation');
  if (v.script_sha256 !== sha256(raw)) throw new Error('script.json changed since script:validate — re-run it');
  return { script: Script.parse(JSON.parse(raw)), raw };
}
