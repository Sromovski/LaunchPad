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
import { FableScript, NOT_APPROVED_YET, SECONDS, countWords, pairVideos, type PairPart } from './script.js';

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

/**
 * Two-part episodes are reviewed together and rendered back to back (Part 2 reuses Part 1's
 * characters and places), so a part only starts when every part of its pair has been approved.
 * Returns the pair, or null for a single-part script.
 */
export function assertPairApproved(db: Database.Database, id: number): { pair_id: string; parts: PairPart[] } | null {
  const { episode } = latestScript(db, id).script;
  if (!episode) return null;
  const parts = pairVideos(db, episode.pair_id);
  for (let p = 1; p <= episode.of; p++) {
    const v = parts.find((x) => x.part === p);
    if (!v) throw new Error(`${episode.pair_id} has no Part ${p} yet; both parts are approved and rendered together`);
    if (NOT_APPROVED_YET.includes(v.status)) {
      throw new Error(`${episode.pair_id} Part ${p} (video ${v.video_id}) is ${v.status}; approve both parts in the review site before rendering either`);
    }
  }
  return { pair_id: episode.pair_id, parts };
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
  /** Story scenes: which story voiceover section (1, 2…) plays under it. */
  section?: number;
  /** Quiet seconds held at the end of this scene so kids can answer its viewer question. */
  pause_after?: number;
}

type PlanScene = { narration: string; pip_on_camera?: boolean };
export interface StoryTiming {
  total: number;
  sentenceEnds: number[];
}

/** A two-choice viewer question ("By the big tree, or by the little pond?"), as episodeWarnings finds it. */
export const isViewerQuestion = (narration: string) => /\bor\b[^.!]*\?/i.test(narration);

/**
 * The story scenes (between Pip's intro and outro) split into voiceover sections. In a two-part
 * adventure each viewer question ends a section, so the render can hold a quiet pause after it
 * (TTS never pauses on its own). Other scripts have one section.
 */
export function storySections(scenes: PlanScene[], pauses: boolean): number[][] {
  const hasIntro = !!scenes[0]?.pip_on_camera;
  const hasOutro = scenes.length > 1 && !!scenes[scenes.length - 1]?.pip_on_camera;
  const first = hasIntro ? 1 : 0;
  const last = hasOutro ? scenes.length - 2 : scenes.length - 1;
  const sections: number[][] = [[]];
  for (let i = first; i <= last; i++) {
    sections[sections.length - 1]!.push(i + 1);
    if (pauses && i < last && isViewerQuestion(scenes[i]!.narration)) sections.push([]);
  }
  return sections;
}

export interface VoiceoverPiece {
  /** Render-log step: voiceover-intro, voiceover (one story section) or voiceover-s<k>, voiceover-outro. */
  step: string;
  scenes: number[];
  text: string;
  /** Quiet seconds the plan holds after this piece (a viewer question). */
  pause_after: number;
}

/** Exactly what to voice, in order, so the skill never joins narration by hand. */
export function voiceoverPieces(script: Pick<FableScript, 'scenes' | 'episode'>, pauseSeconds = FABLES.everygen.questionPauseSeconds): VoiceoverPiece[] {
  const { scenes } = script;
  const sections = storySections(scenes, !!script.episode);
  const text = (ns: number[]) => ns.map((n) => scenes[n - 1]!.narration).join(' ');
  const pieces: VoiceoverPiece[] = [];
  if (scenes[0]?.pip_on_camera) pieces.push({ step: 'voiceover-intro', scenes: [1], text: scenes[0].narration, pause_after: 0 });
  sections.forEach((ns, k) => {
    const endsOnQuestion = !!script.episode && isViewerQuestion(scenes[ns[ns.length - 1]! - 1]!.narration);
    pieces.push({ step: sections.length === 1 ? 'voiceover' : `voiceover-s${k + 1}`, scenes: ns, text: text(ns), pause_after: endsOnQuestion ? pauseSeconds : 0 });
  });
  const lastScene = scenes[scenes.length - 1]!;
  if (scenes.length > 1 && lastScene.pip_on_camera) pieces.push({ step: 'voiceover-outro', scenes: [scenes.length], text: lastScene.narration, pause_after: 0 });
  return pieces;
}

/**
 * Scene windows when Pip talks to camera in the first and/or last scene. Those scenes get
 * their own short voiceover (it drives the clip's mouth movement and plays over it), and the
 * story voiceover covers the scenes in between. A small breath after Pip's line, then the cut.
 * `story` is one timing per story section (voiceoverPieces); a section that ends on a viewer
 * question is held `pauseSeconds` longer, silent, before the next one starts.
 */
export function plannedWindows(
  scenes: PlanScene[],
  story: StoryTiming | StoryTiming[],
  pip: { intro?: number; outro?: number },
  minClip = 4,
  opts: { pauses?: boolean; pauseSeconds?: number } = {},
): PlannedWindow[] {
  const hasIntro = !!scenes[0]?.pip_on_camera;
  const hasOutro = scenes.length > 1 && !!scenes[scenes.length - 1]?.pip_on_camera;
  if (hasIntro && !pip.intro) throw new Error("scene 1 has Pip talking to camera: pass Pip's intro voiceover length (--intro)");
  if (hasOutro && !pip.outro) throw new Error("the last scene has Pip talking to camera: pass Pip's outro voiceover length (--outro)");
  const pipWindow = (secs: number) => Math.max(minClip, Math.ceil(secs + 0.3));
  const pauseSeconds = opts.pauseSeconds ?? FABLES.everygen.questionPauseSeconds;

  const out: PlannedWindow[] = [];
  let offset = 0;
  if (hasIntro) {
    const len = pipWindow(pip.intro!);
    out.push({ n: 1, start: 0, end: len, clip_seconds: len, audio: 'intro' });
    offset = len;
  }
  const sections = storySections(scenes, !!opts.pauses);
  if (sections[0]!.length === 0) throw new Error('no story scenes between Pip’s intro and outro');
  const timings = Array.isArray(story) ? story : [story];
  if (timings.length !== sections.length) {
    throw new Error(`the story is voiced in ${sections.length} section(s) (scenes ${sections.map((s) => s.join(',')).join(' | ')}); pass one --story timing for each`);
  }
  sections.forEach((ns, k) => {
    const windows = sceneWindows(
      ns.map((n) => scenes[n - 1]!.narration),
      timings[k]!.sentenceEnds,
      timings[k]!.total,
      minClip,
    );
    windows.forEach((w, i) => {
      const n = ns[i]!;
      const pause = opts.pauses && i === windows.length - 1 && isViewerQuestion(scenes[n - 1]!.narration) ? pauseSeconds : 0;
      const end = w.end + pause;
      out.push({
        n,
        start: w.start + offset,
        end: end + offset,
        clip_seconds: Math.max(minClip, Math.ceil(end - w.start)),
        audio: 'story',
        section: k + 1,
        ...(pause ? { pause_after: pause } : {}),
      });
    });
    offset += windows[windows.length - 1]!.end + (opts.pauses && isViewerQuestion(scenes[ns[ns.length - 1]! - 1]!.narration) ? pauseSeconds : 0);
  });
  if (hasOutro) {
    const start = out[out.length - 1]!.end;
    const len = pipWindow(pip.outro!);
    out.push({ n: out.length + 1, start, end: start + len, clip_seconds: len, audio: 'outro' });
  }
  return out;
}

// ---- QA (§4: 9:16, 45–65 s, has audio, file plays) ---------------------------------

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
