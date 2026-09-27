/**
 * npm run agent:validate -- --video <id> --step research|script|factcheck|render|qa-review
 * zod-validates the agent's output file, runs cross-checks, and saves it to the DB.
 * Invalid output exits 1 with the zod issues — the orchestrator treats that as a step failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { STEP_FILES, Research, type Step } from '../agents/schemas.js';
import { knownSourceIds, saveFactCheck, saveQaReview, saveRender, saveResearch, saveScript } from '../agents/persist.js';
import { PROJECT_ROOT } from '../db/index.js';
import { validateScript } from '../script/validate.js';
import { args, getVideo, logger, main, requireVideoId, runPath } from './_lib.js';

const a = args({ video: { type: 'string' }, step: { type: 'string' } });

await main((db) => {
  const videoId = requireVideoId(a.video);
  getVideo(db, videoId);
  const step = a.step as Step;
  if (!(step in STEP_FILES)) throw new Error(`--step must be one of ${Object.keys(STEP_FILES).join(', ')}`);
  const log = logger(videoId, `agent-validate-${step}`);

  const { file, schema } = STEP_FILES[step];
  const path = runPath(videoId, file);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (json && typeof json === 'object' && 'error' in json) throw new Error(`agent reported: ${String(json.error)}`);

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    log(`INVALID ${file}: ${z.prettifyError(parsed.error)}`);
    throw new Error(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
  }

  let saved: object;
  switch (step) {
    case 'research':
      saved = saveResearch(db, videoId, parsed.data as z.infer<typeof STEP_FILES.research.schema>);
      break;
    case 'script': {
      const script = parsed.data as z.infer<typeof STEP_FILES.script.schema>;
      const research = Research.parse(JSON.parse(readFileSync(runPath(videoId, 'research.json'), 'utf8')));
      const v = validateScript(script, knownSourceIds(db, videoId, research));
      saved = { ...saveScript(db, videoId, script, v), word_count: v.word_count, reading_grade: v.reading_grade };
      break;
    }
    case 'factcheck':
      saved = saveFactCheck(db, videoId, parsed.data as z.infer<typeof STEP_FILES.factcheck.schema>);
      break;
    case 'render': {
      const r = parsed.data as z.infer<typeof STEP_FILES.render.schema>;
      if (!existsSync(resolve(PROJECT_ROOT, r.final_path))) throw new Error(`final_path does not exist: ${r.final_path}`);
      saved = saveRender(db, videoId, r);
      break;
    }
    case 'qa-review':
      saved = saveQaReview(db, videoId, parsed.data as z.infer<(typeof STEP_FILES)['qa-review']['schema']>);
      break;
  }
  log(`valid ${file} → saved ${JSON.stringify(saved)}`);
  return { step, file, saved };
});
