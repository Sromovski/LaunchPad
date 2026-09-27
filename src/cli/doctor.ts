/**
 * `npm run doctor` — verifies every external tool the pipeline needs.
 * Ends with a real round trip: Kokoro speaks a sentence, ffmpeg resamples it,
 * whisper.cpp transcribes it with word timestamps.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT, openDb } from '../db/index.js';
import { ffmpegPath, ffprobePath, whisperBinPath, whisperModelPath } from '../media/tools.js';

type Result = { name: string; ok: boolean; detail: string; hint?: string };
const results: Result[] = [];
const outDir = resolve(PROJECT_ROOT, 'runs/_doctor');
mkdirSync(outDir, { recursive: true });

function record(name: string, fn: () => string, hint: string) {
  try {
    results.push({ name, ok: true, detail: fn() });
  } catch (e) {
    results.push({ name, ok: false, detail: (e as Error).message.split('\n')[0] ?? '', hint });
  }
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  return `${r.stdout}${r.stderr}`;
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`${what} not found`);
  return v;
}

// --- Node -------------------------------------------------------------------
record(
  'Node.js ≥ 20',
  () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 20) throw new Error(`found v${process.versions.node}`);
    return `v${process.versions.node}`;
  },
  'Install Node 20+ from https://nodejs.org',
);

// --- SQLite -----------------------------------------------------------------
record(
  'better-sqlite3',
  () => {
    const db = openDb(':memory:');
    return `SQLite ${(db.prepare('SELECT sqlite_version() v').get() as { v: string }).v}`;
  },
  'Run npm install (needs a prebuilt binary for your Node version)',
);

// --- ffmpeg / ffprobe -------------------------------------------------------
const ffHint = 'winget install Gyan.FFmpeg (or set FFMPEG_PATH / FFPROBE_PATH)';
record('ffmpeg', () => run(need(ffmpegPath(), 'ffmpeg'), ['-version']).split(' Copyright')[0]!, ffHint);
record('ffprobe', () => run(need(ffprobePath(), 'ffprobe'), ['-version']).split(' Copyright')[0]!, ffHint);
record(
  'ffmpeg has libx264 + libass',
  () => {
    const cfg = run(need(ffmpegPath(), 'ffmpeg'), ['-hide_banner', '-buildconf']);
    const missing = ['--enable-libx264', '--enable-libass'].filter((f) => !cfg.includes(f));
    if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
    return 'H.264 encoding + ASS subtitles available';
  },
  'Install a "full" ffmpeg build (Gyan.FFmpeg full_build includes both)',
);

// --- whisper.cpp ------------------------------------------------------------
const whisperHint = 'Download whisper-bin-x64.zip into tools/whisper/ (or set WHISPER_BIN / WHISPER_MODEL)';
record('whisper.cpp binary', () => need(whisperBinPath(), 'whisper-cli'), whisperHint);
record(
  'whisper model (base.en)',
  () => {
    const p = need(whisperModelPath(), 'model');
    return `${p} (${Math.round(statSync(p).size / 1e6)} MB)`;
  },
  whisperHint,
);

// --- Kokoro TTS + full round trip (async) -------------------------------------
const TEST_SENTENCE = 'Did you know that sunsets on Mars are blue?';

async function kokoroAndWhisper() {
  const wav = resolve(outDir, 'kokoro-test.wav');
  try {
    const { KokoroTTS } = await import('kokoro-js');
    const t0 = Date.now();
    // First run downloads the q8 model (~90 MB) from Hugging Face into the cache.
    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
    const audio = await tts.generate(TEST_SENTENCE, { voice: 'af_heart' });
    await audio.save(wav);
    const kb = Math.round(statSync(wav).size / 1024);
    results.push({ name: 'kokoro-js TTS', ok: true, detail: `${wav} (${kb} KB, ${Date.now() - t0} ms)` });
  } catch (e) {
    results.push({ name: 'kokoro-js TTS', ok: false, detail: (e as Error).message, hint: 'npm install kokoro-js; needs internet on first run' });
    return;
  }

  record(
    'whisper transcribes Kokoro audio',
    () => {
      const ffmpeg = need(ffmpegPath(), 'ffmpeg');
      const bin = need(whisperBinPath(), 'whisper-cli');
      const model = need(whisperModelPath(), 'model');
      const wav16 = resolve(outDir, 'kokoro-test-16k.wav');
      run(ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, '-ar', '16000', '-ac', '1', wav16]);
      const outBase = resolve(outDir, 'whisper-test');
      run(bin, ['-m', model, '-f', wav16, '-ojf', '-of', outBase, '-np']);
      const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as {
        transcription: { text: string; tokens: { offsets: { from: number } }[] }[];
      };
      const text = json.transcription.map((s) => s.text).join(' ').trim();
      const tokens = json.transcription.flatMap((s) => s.tokens).length;
      if (!/mars/i.test(text)) throw new Error(`unexpected transcript: "${text}"`);
      return `"${text}" (${tokens} timed tokens)`;
    },
    whisperHint,
  );
}

await kokoroAndWhisper();

// --- Report -----------------------------------------------------------------
console.log('\nLaunchpad doctor\n');
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(34)} ${r.detail}`);
  if (!r.ok && r.hint) console.log(`   ↳ fix: ${r.hint}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
