/**
 * Pocket Fables render steps, called by the /render-approved skill around its Everygen MCP calls:
 *   fables:render -- balance --remaining <n> [--max 200] [--period-end <ISO>]   save a balance check for the review site
 *   fables:render -- list                                                 script_approved videos + Everygen settings
 *   fables:render -- start  --video <id> --balance <credits now>        script_approved → rendering
 *   fables:render -- voiceovers --video <id>                            the exact texts to voice, in order (with pauses)
 *   fables:render -- log    --video <id> --step <name> --job <id> [--scene n] [--url https://…]
 *   fables:render -- plan   --video <id> --story "<s>:<end>,<end>,…" [--story …] [--intro <s>] [--outro <s>] [--min 4]
 *     (one --story per story voiceover section from `voiceovers`: its length and sentence ends.
 *      --total <s> --sentence-ends "…" still works for a one-section story.
 *      --intro/--outro: lengths of Pip's own voiceovers when the first/last scene has pip_on_camera)
 *   fables:render -- finish --video <id> --url <final https mp4> --balance <credits now>
 *   fables:render -- fail   --video <id> --error "…"
 * start refuses unless Thomas approved the newest script version in the review site, and for a
 * two-part episode unless every part of the pair is approved (they render back to back).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FABLES } from '../channels.js';
import { transitionVideo } from '../db/status.js';
import { assertPairApproved, finishRender, latestScript, recordBalance, logJob, plannedWindows, readRenderLog, startRender, voiceoverPieces, type StoryTiming } from '../fables/render.js';
import { SECONDS } from '../fables/script.js';
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
  story: { type: 'string', multiple: true },
  total: { type: 'string' },
  'sentence-ends': { type: 'string' },
  intro: { type: 'string' },
  outro: { type: 'string' },
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
const ends = (s: string) => s.split(',').filter(Boolean).map(Number);

/** "21.4:2.1,5.8,9.0" → one story section's timing. */
function storyTiming(s: string): StoryTiming {
  const [total, list = ''] = s.split(':');
  const t: StoryTiming = { total: num(total, 'story'), sentenceEnds: ends(list) };
  if (t.sentenceEnds.some((x) => !Number.isFinite(x))) throw new Error(`--story "${s}": sentence ends must be numbers`);
  return t;
}

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
      const pair = assertPairApproved(db, id);
      // A re-render reuses the earlier render's paid frames and clips, so it needs far fewer credits.
      const rerender = !!readRenderLog(RUNS_ROOT, id)?.jobs.some((j) => j.step === 'clip');
      const need = rerender ? FABLES.everygen.rerenderMinBalance : FABLES.everygen.minBalance;
      if (balance < need) throw new Error(`only ${balance} Everygen credits left (need ${need}${rerender ? ' for a re-render' : ''}); not starting a render that can't finish`);
      return { ...startRender(db, id, balance, RUNS_ROOT), ...(pair ? { pair } : {}) };
    }
    case 'voiceovers': {
      const { script } = latestScript(db, id);
      return { video_id: id, voice: FABLES.everygenVoice, pieces: voiceoverPieces(script) };
    }
    case 'log': {
      if (!a.step || !a.job) throw new Error('--step and --job are required');
      const log = logJob(RUNS_ROOT, id, { step: a.step, id: a.job, ...(a.scene ? { scene: Number(a.scene) } : {}), ...(a.url ? { url: a.url } : {}) });
      return { video_id: id, jobs: log.jobs.length };
    }
    case 'plan': {
      if (!readRenderLog(RUNS_ROOT, id)) throw new Error(`video ${id} has no render log; run start first`);
      const { script } = latestScript(db, id);
      const story = a.story?.length ? a.story.map(storyTiming) : [{ total: num(a.total, 'total'), sentenceEnds: ends(a['sentence-ends'] ?? '') }];
      const windows = plannedWindows(
        script.scenes,
        story,
        { intro: a.intro ? num(a.intro, 'intro') : undefined, outro: a.outro ? num(a.outro, 'outro') : undefined },
        a.min ? Number(a.min) : FABLES.everygen.minClipSeconds,
        { pauses: !!script.episode },
      );
      const total = windows[windows.length - 1]!.end;
      if (total < SECONDS.min || total > SECONDS.max) throw new Error(`the plan is ${total} s; a Short must be ${SECONDS.min}–${SECONDS.max} s`);
      const tooLong = windows.filter((w) => w.clip_seconds > FABLES.everygen.maxClipSeconds);
      if (tooLong.length) throw new Error(`scene(s) ${tooLong.map((w) => w.n).join(', ')} need more than ${FABLES.everygen.maxClipSeconds} s; split them in the script`);
      const plan = windows.map((w) => ({ ...w, visuals: script.scenes[w.n - 1]!.visuals, on_screen_text: script.scenes[w.n - 1]!.on_screen_text }));
      writeFileSync(resolve(runDir(id), 'scene-plan.json'), `${JSON.stringify({ visual_style: script.visual_style, scenes: plan }, null, 2)}\n`);
      return { video_id: id, total_s: total, clip_seconds: windows.reduce((n, w) => n + w.clip_seconds, 0), scenes: windows };
    }
    case 'finish':
      if (!a.url) throw new Error('--url is required');
      return { video_id: id, ...(await finishRender(db, id, { url: a.url, balanceAfter: num(a.balance, 'balance'), runsRoot: RUNS_ROOT })) };
    case 'fail':
      if (!a.error?.trim()) throw new Error('--error is required');
      return { video_id: id, ...transitionVideo(db, id, 'failed', { error: a.error.trim() }) };
    default:
      throw new Error(`unknown command "${command}" (balance|list|start|voiceovers|log|plan|finish|fail)`);
  }
});
