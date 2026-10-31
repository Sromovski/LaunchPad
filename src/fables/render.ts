/**
 * Pocket Fables render bookkeeping (channels/fables/CLAUDE.md §4). Everygen itself is driven
 * by Claude through its MCP tools (the /render-approved skill); this module owns everything
 * deterministic around it: the approval check, status moves, scene timing, the credit ledger,
 * downloading the MP4 and the QA checks.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { FABLES } from '../channels.js';
import { transitionVideo } from '../db/status.js';
import { ffmpegBin, probe, run, type Probe } from '../media/probe.js';
import { FableScript, SECONDS, countWords } from './script.js';

const runFile = (runsRoot: string, id: number, name: string) => resolve(runsRoot, String(id), name);

function fableRow(db: Database.Database, id: number) {
  const v = db.prepare('SELECT id, channel, status FROM videos WHERE id = ?').get(id) as { id: number; channel: string; status: string } | undefined;
  if (!v || v.channel !== FABLES.key) throw new Error(`Pocket Fables video ${id} not found`);
  return v;
}

export function latestScript(db: Database.Database, id: number): { version: number; script: FableScript } {
  const row = db.prepare('SELECT version, body_json FROM scripts WHERE video_id = ? ORDER BY version DESC LIMIT 1').get(id) as
    | { version: number; body_json: string }
    | undefined;
  if (!row) throw new Error(`video ${id} has no script`);
  return { version: row.version, script: FableScript.parse(JSON.parse(row.body_json)) };
}

/**
 * The hard rule, checked again right before credits are spent: status is script_approved AND
 * the newest review is Thomas's script-gate approval of the newest script version.
 */
export function assertScriptApproved(db: Database.Database, id: number): number {
  const v = fableRow(db, id);
  if (v.status !== 'script_approved') throw new Error(`video ${id} is ${v.status}, not script_approved: nothing to render`);
  const { version } = latestScript(db, id);
  const review = db.prepare('SELECT gate, decision, notes FROM reviews WHERE video_id = ? ORDER BY id DESC LIMIT 1').get(id) as
    | { gate: string; decision: string; notes: string | null }
    | undefined;
  if (!review || review.gate !== 'script' || review.decision !== 'approved' || !(review.notes ?? '').startsWith(`[script v${version}]`)) {
    throw new Error(`video ${id}: no review-site approval of script version ${version} on record; refusing to spend credits`);
  }
  return version;
}

// ---- Everygen balance (the review site's credits panel) ------------------------------

export function recordBalance(db: Database.Database, b: { remaining: number; plan_max?: number | null; period_end?: string | null }): void {
  // Plan size and renewal date rarely change: carry them over when this check didn't include them.
  const last = db.prepare('SELECT plan_max, period_end FROM everygen_balance ORDER BY id DESC LIMIT 1').get() as
    | { plan_max: number | null; period_end: string | null }
    | undefined;
  db.prepare('INSERT INTO everygen_balance (remaining, plan_max, period_end) VALUES (?, ?, ?)').run(
    b.remaining,
    b.plan_max ?? last?.plan_max ?? null,
    b.period_end ?? last?.period_end ?? null,
  );
}

export interface CreditsSummary {
  remaining: number | null;
  plan_max: number | null;
  period_end: string | null;
  checked_at: string | null;
  used_this_month: number;
  renders_this_month: number;
}

export function creditsSummary(db: Database.Database, now = new Date()): CreditsSummary {
  const last = db.prepare('SELECT remaining, plan_max, period_end, checked_at FROM everygen_balance ORDER BY id DESC LIMIT 1').get() as
    | { remaining: number; plan_max: number | null; period_end: string | null; checked_at: string }
    | undefined;
  const month = now.toISOString().slice(0, 7);
  const used = db.prepare("SELECT COALESCE(SUM(credits_used), 0) AS used, COUNT(*) AS n FROM credits WHERE strftime('%Y-%m', created_at) = ?").get(month) as {
    used: number;
    n: number;
  };
  return {
    remaining: last?.remaining ?? null,
    plan_max: last?.plan_max ?? null,
    period_end: last?.period_end ?? null,
    checked_at: last?.checked_at ?? null,
    used_this_month: used.used,
    renders_this_month: used.n,
  };
}

export interface RenderLog {
  video_id: number;
  script_version: number;
  started_at: string;
  balance_before: number;
  /** Every Everygen job, logged as soon as it starts, so a crash never pays twice. */
  jobs: { step: string; scene?: number; id: string; url?: string; at: string }[];
  final_url?: string;
}

export function readRenderLog(runsRoot: string, id: number): RenderLog | null {
  const p = runFile(runsRoot, id, 'everygen.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as RenderLog) : null;
}
const writeRenderLog = (runsRoot: string, log: RenderLog) => {
  mkdirSync(resolve(runsRoot, String(log.video_id)), { recursive: true });
  writeFileSync(runFile(runsRoot, log.video_id, 'everygen.json'), `${JSON.stringify(log, null, 2)}\n`);
};

/** script_approved → rendering. One render per approved script: refuses if a render log already exists. */
export function startRender(db: Database.Database, id: number, balanceBefore: number, runsRoot: string, now = new Date()): RenderLog {
  const version = assertScriptApproved(db, id);
  const existing = readRenderLog(runsRoot, id);
  if (existing && existing.script_version === version) {
    throw new Error(`video ${id} already has an Everygen render log for script v${version} (runs/${id}/everygen.json); check it before rendering again`);
  }
  // A re-render after video changes: keep the earlier version's log next to the new one.
  if (existing) renameSync(runFile(runsRoot, id, 'everygen.json'), runFile(runsRoot, id, `everygen.v${existing.script_version}.json`));
  transitionVideo(db, id, 'rendering');
  recordBalance(db, { remaining: balanceBefore });
  const log: RenderLog = { video_id: id, script_version: version, started_at: now.toISOString(), balance_before: balanceBefore, jobs: [] };
  writeRenderLog(runsRoot, log);
  return log;
}

export function logJob(runsRoot: string, id: number, job: Omit<RenderLog['jobs'][number], 'at'>, now = new Date()): RenderLog {
  const log = readRenderLog(runsRoot, id);
  if (!log) throw new Error(`video ${id} has no render log; run fables:render start first`);
  log.jobs.push({ ...job, at: now.toISOString() });
  writeRenderLog(runsRoot, log);
  return log;
}

/** Sentences as a TTS counts them: text ending in . ! or ?, optionally inside a closing quote. */
export const countSentences = (s: string) => (s.match(/[.!?]+["”’]?(?=\s|$)/g) ?? []).length;

export interface SceneWindow {
  n: number;
  start: number;
  end: number;
  /** Seconds this scene's clip must be generated at: its window rounded up, at least the model's minimum. */
  clip_seconds: number;
}

/**
 * Splits the real voiceover into one window per scene. Boundaries start at each scene's share of
 * the spoken words and snap to the nearest sentence end within 1.5 s (cuts land on full stops),
 * then to whole seconds. The last scene ends at the end of the voiceover, so the picture never stops early.
 */
export function sceneWindows(narrations: string[], sentenceEnds: number[], totalSeconds: number, minClip = 4): SceneWindow[] {
  const words = narrations.map(countWords);
  const all = words.reduce((a, b) => a + b, 0);
  const sentences = narrations.map(countSentences);
  // Best case: the voiceover reports exactly one end per sentence we wrote, so each cut is the
  // real end of that scene's last sentence (short lines like "A paintbrush!" make nearest-end snapping guess wrong).
  const exact = sentences.reduce((a, b) => a + b, 0) === sentenceEnds.length;
  const cuts: number[] = [];
  let acc = 0;
  let sAcc = 0;
  for (let i = 0; i < narrations.length - 1; i++) {
    acc += words[i]!;
    sAcc += sentences[i]!;
    const guess = (acc / all) * totalSeconds;
    const near = exact
      ? sentenceEnds[sAcc - 1]!
      : sentenceEnds.reduce<number | null>((best, s) => (Math.abs(s - guess) <= 1.5 && (best === null || Math.abs(s - guess) < Math.abs(best - guess)) ? s : best), null);
    const prev = cuts[cuts.length - 1] ?? 0;
    cuts.push(Math.max(prev + 1, Math.round(near ?? guess)));
  }
  const bounds = [0, ...cuts, Math.ceil(totalSeconds)];
  return narrations.map((_, i) => {
    const start = bounds[i]!;
    const end = bounds[i + 1]!;
    return { n: i + 1, start, end, clip_seconds: Math.max(minClip, Math.ceil(end - start)) };
  });
}

export interface PlannedWindow extends SceneWindow {
  /** Which voiceover plays under this scene: Pip's own intro/outro line, or the story narration. */
  audio: 'intro' | 'story' | 'outro';
}

/**
 * Scene windows when Pip talks to camera in the first and/or last scene. Those scenes get
 * their own short voiceover (it drives the clip's mouth movement and plays over it), and the
 * story voiceover covers the scenes in between. A small breath after Pip's line, then the cut.
 */
export function plannedWindows(
  scenes: { narration: string; pip_on_camera?: boolean }[],
  story: { total: number; sentenceEnds: number[] },
  pip: { intro?: number; outro?: number },
  minClip = 4,
): PlannedWindow[] {
  const hasIntro = !!scenes[0]?.pip_on_camera;
  const hasOutro = scenes.length > 1 && !!scenes[scenes.length - 1]?.pip_on_camera;
  if (hasIntro && !pip.intro) throw new Error("scene 1 has Pip talking to camera: pass Pip's intro voiceover length (--intro)");
  if (hasOutro && !pip.outro) throw new Error("the last scene has Pip talking to camera: pass Pip's outro voiceover length (--outro)");
  const pipWindow = (secs: number) => Math.max(minClip, Math.ceil(secs + 0.3));

  const out: PlannedWindow[] = [];
  let offset = 0;
  if (hasIntro) {
    const len = pipWindow(pip.intro!);
    out.push({ n: 1, start: 0, end: len, clip_seconds: len, audio: 'intro' });
    offset = len;
  }
  const middle = scenes.slice(hasIntro ? 1 : 0, hasOutro ? -1 : undefined);
  if (middle.length === 0) throw new Error('no story scenes between Pip’s intro and outro');
  for (const w of sceneWindows(
    middle.map((s) => s.narration),
    story.sentenceEnds,
    story.total,
    minClip,
  )) {
    out.push({ ...w, n: out.length + 1, start: w.start + offset, end: w.end + offset, audio: 'story' });
  }
  if (hasOutro) {
    const start = out[out.length - 1]!.end;
    const len = pipWindow(pip.outro!);
    out.push({ n: out.length + 1, start, end: start + len, clip_seconds: len, audio: 'outro' });
  }
  return out;
}

// ---- QA (§4: 9:16, 50–65 s, has audio, file plays) ---------------------------------

export interface FablesQa {
  pass: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export function fablesQa(p: Probe, decodeError: string | null): FablesQa {
  const v = p.streams.find((s) => s.codec_type === 'video');
  const ratio = v?.width && v.height ? v.width / v.height : 0;
  const checks = [
    { name: '9:16 portrait', ok: Math.abs(ratio - 9 / 16) < 0.01, detail: v ? `${v.width}×${v.height}` : 'no video stream' },
    { name: `length ${SECONDS.min}–${SECONDS.max} s`, ok: p.duration >= SECONDS.min && p.duration <= SECONDS.max, detail: `${p.duration.toFixed(1)} s` },
    { name: 'has audio', ok: p.streams.some((s) => s.codec_type === 'audio'), detail: p.streams.filter((s) => s.codec_type === 'audio').map((s) => s.codec_name).join(', ') || 'none' },
    { name: 'file plays', ok: decodeError === null, detail: decodeError ?? 'decoded start to end without errors' },
  ];
  return { pass: checks.every((c) => c.ok), checks };
}

/** Decodes the whole file; returns the first errors, or null when it plays cleanly. */
function decodeCheck(path: string): string | null {
  try {
    const { stderr } = run(ffmpegBin(), ['-v', 'error', '-i', path, '-f', 'null', '-']);
    return stderr.trim() ? stderr.trim().split('\n').slice(0, 3).join(' / ') : null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * rendering → rendered → video_review (QA pass) or failed (QA fail). Downloads the final MP4,
 * records the credits it cost, writes runs/<id>/qa.json.
 */
export async function finishRender(
  db: Database.Database,
  id: number,
  opts: { url: string; balanceAfter: number; runsRoot: string; fetchImpl?: typeof fetch },
): Promise<{ status: string; credits_used: number; duration_s: number; qa: FablesQa }> {
  const v = fableRow(db, id);
  if (v.status !== 'rendering') throw new Error(`video ${id} is ${v.status}, not rendering`);
  const log = readRenderLog(opts.runsRoot, id);
  if (!log) throw new Error(`video ${id} has no render log`);
  if (!/^https:\/\//.test(opts.url)) throw new Error('--url must be the https URL Everygen returned');

  const res = await (opts.fetchImpl ?? fetch)(opts.url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const finalPath = runFile(opts.runsRoot, id, 'final.mp4');
  writeFileSync(finalPath, Buffer.from(await res.arrayBuffer()));

  const p = probe(finalPath);
  const qa = fablesQa(p, decodeCheck(finalPath));
  writeFileSync(runFile(opts.runsRoot, id, 'qa.json'), `${JSON.stringify(qa, null, 2)}\n`);
  const creditsUsed = Math.max(0, log.balance_before - opts.balanceAfter);
  log.final_url = opts.url;
  writeRenderLog(opts.runsRoot, log);

  db.transaction(() => {
    db.prepare('INSERT INTO credits (video_id, credits_used, balance_after) VALUES (?, ?, ?)').run(id, creditsUsed, opts.balanceAfter);
    recordBalance(db, { remaining: opts.balanceAfter });
    db.prepare('UPDATE videos SET final_path = ?, duration_s = ? WHERE id = ?').run(`runs/${id}/final.mp4`, p.duration, id);
    transitionVideo(db, id, 'rendered');
    if (qa.pass) transitionVideo(db, id, 'video_review');
    else transitionVideo(db, id, 'failed', { error: `QA failed: ${qa.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join('; ')}` });
  })();
  return { status: qa.pass ? 'video_review' : 'failed', credits_used: creditsUsed, duration_s: p.duration, qa };
}
