/**
 * Pocket Fables render steps, called by the /render-approved skill around its Everygen MCP calls:
 *   fables:render -- balance --remaining <n> [--max 200] [--period-end <ISO>]   save a balance check for the review site
 *   fables:render -- list                                                 script_approved videos + Everygen settings
 *   fables:render -- start  --video <id> --balance <credits now>        script_approved → rendering
 *   fables:render -- log    --video <id> --step <name> --job <id> [--scene n] [--url https://…]
 *   fables:render -- plan   --video <id> --total <voiceover s> --sentence-ends "2.1,5.8,…" [--min 4]
 *   fables:render -- finish --video <id> --url <final https mp4> --balance <credits now>
 *   fables:render -- fail   --video <id> --error "…"
 * start refuses unless Thomas approved the newest script version in the review site.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FABLES } from '../channels.js';
import { transitionVideo } from '../db/status.js';
import { finishRender, latestScript, recordBalance, logJob, readRenderLog, sceneWindows, startRender } from '../fables/render.js';
import { RUNS_ROOT, args, main, requireVideoId, runDir } from './_lib.js';

const command = process.argv[2];
process.argv.splice(2, 1);
const a = args({
  video: { type: 'string' },
  balance: { type: 'string' },
  step: { type: 'string' },
  job: { type: 'string' },
  scene: { type: 'string' },
  url: { type: 'string' },
  total: { type: 'string' },
  'sentence-ends': { type: 'string' },
  min: { type: 'string' },
  error: { type: 'string' },
  remaining: { type: 'string' },
  max: { type: 'string' },
  'period-end': { type: 'string' },
});

const num = (v: string | undefined, name: string) => {
  const n = Number(v);
  if (v === undefined || !Number.isFinite(n) || n < 0) throw new Error(`--${name} <number> is required`);
  return n;
};

await main(async (db) => {
  if (command === 'balance') {
    recordBalance(db, { remaining: num(a.remaining, 'remaining'), plan_max: a.max ? num(a.max, 'max') : null, period_end: a['period-end'] ?? null });
    return { recorded: true };
  }
  if (command === 'list') {
    const videos = db.prepare("SELECT id, topic, updated_at FROM videos WHERE channel = 'fables' AND status = 'script_approved' ORDER BY updated_at, id").all();
    return { videos, everygen: FABLES.everygen, voice: FABLES.everygenVoice };
  }
  const id = requireVideoId(a.video);
  switch (command) {
    case 'start': {
      const balance = num(a.balance, 'balance');
      if (balance < FABLES.everygen.minBalance) throw new Error(`only ${balance} Everygen credits left (need ${FABLES.everygen.minBalance}); not starting a render that can't finish`);
      return startRender(db, id, balance, RUNS_ROOT);
    }
    case 'log': {
      if (!a.step || !a.job) throw new Error('--step and --job are required');
      const log = logJob(RUNS_ROOT, id, { step: a.step, id: a.job, ...(a.scene ? { scene: Number(a.scene) } : {}), ...(a.url ? { url: a.url } : {}) });
      return { video_id: id, jobs: log.jobs.length };
    }
    case 'plan': {
      if (!readRenderLog(RUNS_ROOT, id)) throw new Error(`video ${id} has no render log; run start first`);
      const { script } = latestScript(db, id);
      const ends = (a['sentence-ends'] ?? '').split(',').filter(Boolean).map(Number);
      const windows = sceneWindows(script.scenes.map((s) => s.narration), ends, num(a.total, 'total'), a.min ? Number(a.min) : FABLES.everygen.minClipSeconds);
      const tooLong = windows.filter((w) => w.clip_seconds > FABLES.everygen.maxClipSeconds);
      if (tooLong.length) throw new Error(`scene(s) ${tooLong.map((w) => w.n).join(', ')} need more than ${FABLES.everygen.maxClipSeconds} s; split them in the script`);
      const plan = windows.map((w, i) => ({ ...w, visuals: script.scenes[i]!.visuals, on_screen_text: script.scenes[i]!.on_screen_text }));
      writeFileSync(resolve(runDir(id), 'scene-plan.json'), `${JSON.stringify({ visual_style: script.visual_style, scenes: plan }, null, 2)}\n`);
      return { video_id: id, total_s: windows[windows.length - 1]!.end, clip_seconds: windows.reduce((n, w) => n + w.clip_seconds, 0), scenes: windows };
    }
    case 'finish':
      if (!a.url) throw new Error('--url is required');
      return { video_id: id, ...(await finishRender(db, id, { url: a.url, balanceAfter: num(a.balance, 'balance'), runsRoot: RUNS_ROOT })) };
    case 'fail':
      if (!a.error?.trim()) throw new Error('--error is required');
      return { video_id: id, ...transitionVideo(db, id, 'failed', { error: a.error.trim() }) };
    default:
      throw new Error(`unknown command "${command}" (balance|list|start|log|plan|finish|fail)`);
  }
});
