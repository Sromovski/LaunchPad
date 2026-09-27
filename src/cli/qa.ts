/**
 *   npm run qa:check  -- --video <id>  → runs/<id>/qa.json (exit 1 on fail)
 *   npm run qa:frames -- --video <id>  → runs/<id>/frames/frame-1..6.png
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { latestScriptId } from '../agents/persist.js';
import { coveredWordCount } from '../media/captions.js';
import { loadWords } from '../media/context.js';
import { ffmpegBin, probe, run } from '../media/probe.js';
import { evaluate, frameTimes, type QaFacts } from '../qa/checks.js';
import { args, logger, main, requireVideoId, runPath, sha256 } from './_lib.js';

const command = process.argv[2];
process.argv.splice(2, 1);
const a = args({ video: { type: 'string' } });

interface RenderConfig {
  duration_s: number;
  end_card_start_s: number;
  clips: { nasa_id: string; start_s: number; end_s: number }[];
  credits: { text: string }[];
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

function measureAudio(path: string): { lufs: number | null; peak: number | null } {
  const { stderr } = run(ffmpegBin(), ['-hide_banner', '-nostats', '-i', path, '-filter_complex', 'ebur128=peak=true,volumedetect', '-f', 'null', '-']);
  const lufs = stderr.match(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/);
  const peak = stderr.match(/max_volume:\s+(-?[\d.]+) dB/);
  return { lufs: lufs ? Number(lufs[1]) : null, peak: peak ? Number(peak[1]) : null };
}

await main((db) => {
  const videoId = requireVideoId(a.video);
  const finalPath = runPath(videoId, 'final.mp4');
  if (!existsSync(finalPath)) throw new Error('no final.mp4 — run media:render first');
  const cfg = readJson<RenderConfig>(runPath(videoId, 'render-config.json'));
  if (!cfg) throw new Error('no render-config.json — run media:render first');

  if (command === 'frames') {
    const dir = runPath(videoId, 'frames');
    mkdirSync(dir, { recursive: true });
    // Start clean: leftovers from an earlier render must not be mistaken for this one.
    for (const old of readdirSync(dir).filter((n) => /^frame-\d+\.png$/.test(n))) rmSync(`${dir}/${old}`);
    const frames = frameTimes(cfg.duration_s, cfg.end_card_start_s, cfg.clips).map((t, i) => {
      const file = `frame-${i + 1}.png`;
      run(ffmpegBin(), ['-y', '-loglevel', 'error', '-ss', String(t), '-i', finalPath, '-frames:v', '1', `${dir}/${file}`]);
      return { file: `frames/${file}`, t };
    });
    return { frames };
  }
  if (command !== 'check') throw new Error('usage: qa.ts check|frames --video <id>');

  const log = logger(videoId, 'qa-check');
  const p = probe(finalPath);
  const audio = measureAudio(finalPath);

  // Script: validated, unchanged since, and the same version the DB fact-checked.
  const raw = existsSync(runPath(videoId, 'script.json')) ? readFileSync(runPath(videoId, 'script.json'), 'utf8') : '';
  const validation = readJson<{ ok: boolean; script_sha256: string }>(runPath(videoId, 'script-validation.json'));
  const scriptId = latestScriptId(db, videoId);
  const dbBody = (db.prepare('SELECT body_json FROM scripts WHERE id = ?').get(scriptId) as { body_json: string }).body_json;
  const sameAsDb = raw !== '' && JSON.stringify(JSON.parse(raw)) === JSON.stringify(JSON.parse(dbBody));
  let scriptNote = 'validated, unchanged, matches saved version';
  if (!validation?.ok) scriptNote = 'script:validate has not passed';
  else if (validation.script_sha256 !== sha256(raw)) scriptNote = 'script.json changed after validation';
  else if (!sameAsDb) scriptNote = 'script.json differs from the fact-checked version in the DB';

  const { words } = loadWords(videoId);
  const voice = readJson<{ segments: { start_s: number }[] }>(runPath(videoId, 'voice.json'));
  const used = [...new Set(cfg.clips.map((c) => c.nasa_id))];
  const assets = db
    .prepare(`SELECT nasa_id, credit, rights_status FROM assets WHERE video_id = ? AND nasa_id IN (${used.map(() => '?').join(',')})`)
    .all(videoId, ...used) as QaFacts['usedAssets'];

  const facts: QaFacts = {
    duration: p.duration,
    video: p.streams.find((s) => s.codec_type === 'video'),
    audio: p.streams.find((s) => s.codec_type === 'audio'),
    integratedLufs: audio.lufs,
    maxVolumeDb: audio.peak,
    captionsExist: existsSync(runPath(videoId, 'captions.ass')),
    captionCoverage: words.length
      ? coveredWordCount({ words, endQuestionSegment: (voice?.segments.length ?? 1) - 1, endQuestion: '', endCardStart: 0, duration: 0, credits: [] }) /
        words.length
      : 0,
    hookStart: voice?.segments[0]?.start_s ?? null,
    renderedCredits: cfg.credits.map((c) => c.text),
    usedAssets: assets,
    scriptValidated: scriptNote.startsWith('validated'),
    scriptValidationNote: scriptNote,
    factChecks: db.prepare('SELECT verdict, source_id FROM fact_checks WHERE script_id = ?').all(scriptId) as QaFacts['factChecks'],
  };

  const result = evaluate(facts);
  const rightsWarnings = assets.filter((x) => x.rights_status === 'needs_review').map((x) => `${x.nasa_id}: ${x.credit}`);
  writeFileSync(runPath(videoId, 'qa.json'), JSON.stringify({ ...result, rights_warnings: rightsWarnings, checked_at: new Date().toISOString() }, null, 2));
  for (const c of result.checks) log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
  if (!result.pass) process.exitCode = 1;
  return { ok: result.pass, pass: result.pass, failed: result.checks.filter((c) => !c.ok), rights_warnings: rightsWarnings, file: 'qa.json' };
});
