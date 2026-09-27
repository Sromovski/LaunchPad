/**
 * npm run scheduled [-- --trigger scheduled|manual] [--topic "..."]
 *
 * One headless /make-video run, safely:
 *   lock → preflight → `claude -p "/make-video" --permission-mode dontAsk` (60 min cap)
 *   → outcome judged from the DB → automation_runs row → unlock.
 * Scheduled runs only ever fill the review queue (the pipeline ends at in_review).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT, openDb } from '../db/index.js';
import { LockedError, acquireLock } from '../automation/lock.js';
import { evaluatePreflight } from '../automation/preflight.js';
import { nextTopic } from '../automation/topics.js';
import { decideOutcome, parseClaudeJson } from '../automation/claude-result.js';
import { ffmpegPath, ffprobePath, whisperBinPath, whisperModelPath } from '../media/tools.js';
import { RUNS_ROOT, args } from './_lib.js';

const a = args({ trigger: { type: 'string', default: 'manual' }, topic: { type: 'string' }, 'timeout-min': { type: 'string', default: '60' } });
const trigger = a.trigger === 'scheduled' ? 'scheduled' : 'manual';
const TIMEOUT_MS = Number(a['timeout-min']) * 60_000;
const LOCK = resolve(PROJECT_ROOT, 'data/run.lock');
const LOG_DIR = resolve(RUNS_ROOT, '_scheduled');

function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const npmGlobal = resolve(process.env.APPDATA ?? '', 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
  if (existsSync(npmGlobal)) return npmGlobal;
  return 'claude';
}

/** Kill the whole process tree (claude spawns subagents / npm / ffmpeg). */
function killTree(pid: number) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGKILL');
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(LOG_DIR, { recursive: true });
const db = openDb();
const runId = Number(db.prepare("INSERT INTO automation_runs (trigger, outcome) VALUES (?, 'running')").run(trigger).lastInsertRowid);
const finish = (fields: Record<string, unknown>) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE automation_runs SET finished_at = datetime('now'), ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id: runId });
  const summary = { run_id: runId, trigger, ...fields };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
};

let release: (() => void) | undefined;
try {
  release = acquireLock(LOCK, { staleMs: TIMEOUT_MS + 30 * 60_000, note: `automation run ${runId}` });
} catch (e) {
  if (e instanceof LockedError) {
    finish({ outcome: 'locked', error: e.message });
    process.exit(0); // another run is going: not an error
  }
  throw e;
}

try {
  // ---- Preflight ------------------------------------------------------------------
  const topicsFile = resolve(PROJECT_ROOT, 'docs/TOPICS.md');
  const backlogTopic = existsSync(topicsFile) ? nextTopic(readFileSync(topicsFile, 'utf8')) : undefined;
  const topic = a.topic ?? backlogTopic?.topic ?? null;
  const inReview = (db.prepare("SELECT COUNT(*) n FROM videos WHERE status = 'in_review'").get() as { n: number }).n;
  let freeBytes: number | null = null;
  try {
    const s = statfsSync(PROJECT_ROOT);
    freeBytes = s.bavail * s.bsize;
  } catch {
    /* unsupported: skip the check */
  }
  // Thomas's "Request changes" notes come first: a waiting revision is handled before any new video.
  // (It doesn't add to the queue, so the queue cap doesn't apply.)
  const revision = a.topic
    ? undefined
    : (db.prepare("SELECT id, title FROM videos WHERE status = 'changes_requested' ORDER BY updated_at, id LIMIT 1").get() as { id: number; title: string | null } | undefined);
  const label = revision ? `revise video ${revision.id}: ${revision.title ?? ''}`.trim() : topic;

  const pre = evaluatePreflight({
    inReview: revision ? 0 : inReview,
    tools: [
      { name: 'ffmpeg', ok: !!ffmpegPath() },
      { name: 'ffprobe', ok: !!ffprobePath() },
      { name: 'whisper.cpp', ok: !!whisperBinPath() },
      { name: 'whisper model', ok: !!whisperModelPath() },
    ],
    freeBytes,
    nextTopic: revision ? label : topic,
  });
  if (!pre.go) {
    finish({ outcome: pre.outcome === 'skip' ? 'skip' : 'preflight_fail', topic: label, error: pre.reasons.join('; ') });
    process.exitCode = pre.outcome === 'skip' ? 0 : 1;
  } else {
    // ---- Headless run -----------------------------------------------------------------
    const prompt = revision ? `/revise-video ${revision.id}` : a.topic ? `/make-video ${a.topic}` : '/make-video';
    const outPath = resolve(LOG_DIR, `${stamp}-run${runId}.json`);
    const errPath = resolve(LOG_DIR, `${stamp}-run${runId}.err.log`);
    const startedAt = (db.prepare('SELECT started_at FROM automation_runs WHERE id = ?').get(runId) as { started_at: string }).started_at;
    db.prepare('UPDATE automation_runs SET topic = ?, log_path = ? WHERE id = ?').run(label, outPath, runId);

    const t0 = Date.now();
    const child = spawn(claudeBin(), ['-p', prompt, '--permission-mode', 'dontAsk', '--output-format', 'json'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, TIMEOUT_MS);
    const exitCode: number | null = await new Promise((res) => child.on('close', (code) => res(code)));
    clearTimeout(timer);
    writeFileSync(outPath, stdout);
    if (stderr.trim()) writeFileSync(errPath, stderr);

    // The video this run created (if any) — judged from the DB, not from the agent's summary.
    type V = { id: number; status: string; error: string | null } | undefined;
    const video = revision
      ? (db.prepare('SELECT id, status, error FROM videos WHERE id = ?').get(revision.id) as V)
      : (db.prepare('SELECT id, status, error FROM videos WHERE created_at >= ? ORDER BY id DESC LIMIT 1').get(startedAt) as V);
    const stats = parseClaudeJson(stdout);
    const outcome = decideOutcome({ timedOut, exitCode, stats, videoStatus: video?.status ?? null });
    finish({
      outcome,
      topic: label,
      video_id: video?.id ?? null,
      duration_s: Math.round((Date.now() - t0) / 1000),
      num_turns: stats?.num_turns ?? null,
      input_tokens: stats?.input_tokens ?? null,
      output_tokens: stats?.output_tokens ?? null,
      cost_usd_equiv: stats?.cost_usd_equiv ?? null,
      permission_denials: stats?.permission_denials ?? null,
      error: outcome === 'in_review' ? null : (video?.error ?? (timedOut ? `killed after ${a['timeout-min']} min` : stats?.result?.slice(0, 500) ?? stderr.slice(-500))),
    });
    process.exitCode = outcome === 'in_review' ? 0 : 1;
  }
} catch (e) {
  finish({ outcome: 'error', error: (e as Error).message });
  process.exitCode = 1;
} finally {
  release?.();
  db.close();
}
