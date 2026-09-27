/**
 * npm run script:validate -- --video <id>
 * Checks runs/<id>/script.json and writes runs/<id>/script-validation.json,
 * stamped with the script's hash so qa:check can tell if it changed since.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Research, Script } from '../agents/schemas.js';
import { validateScript } from '../script/validate.js';
import { args, logger, main, requireVideoId, runPath, sha256 } from './_lib.js';

const a = args({ video: { type: 'string' } });

await main(() => {
  const videoId = requireVideoId(a.video);
  const log = logger(videoId, 'script-validate');
  const scriptFile = runPath(videoId, 'script.json');
  const researchFile = runPath(videoId, 'research.json');
  if (!existsSync(scriptFile)) throw new Error(`missing ${scriptFile}`);
  if (!existsSync(researchFile)) throw new Error(`missing ${researchFile}`);

  const raw = readFileSync(scriptFile, 'utf8');
  const script = Script.parse(JSON.parse(raw));
  const research = Research.parse(JSON.parse(readFileSync(researchFile, 'utf8')));
  const result = validateScript(script, new Set(research.sources.map((s) => s.id)));

  writeFileSync(runPath(videoId, 'script-validation.json'), JSON.stringify({ ...result, script_sha256: sha256(raw) }, null, 2));
  log(`${result.ok ? 'PASS' : 'FAIL'} words=${result.word_count} grade=${result.reading_grade} ${result.errors.join('; ')}`);
  if (!result.ok) process.exitCode = 1;
  return result; // its own ok:false overrides main()'s default ok:true
});
