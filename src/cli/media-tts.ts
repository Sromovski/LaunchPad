/**
 * npm run media:tts -- --video <id> [--voice af_heart] [--speed 0.95] [--force]
 * → runs/<id>/voice.wav + runs/<id>/voice.json (segment timings).
 * Only speaks a script that script:validate passed (hash must match).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadValidatedScript } from '../script/load.js';
import { synthesize, DEFAULT_GAP_MS, DEFAULT_LEAD_MS, DEFAULT_SPEED, DEFAULT_TAIL_MS, DEFAULT_VOICE, SPEECH_RULES_VERSION } from '../media/tts.js';
import { encodeWav } from '../media/wav.js';
import { args, logger, main, requireVideoId, runPath, sha256 } from './_lib.js';

const a = args({
  video: { type: 'string' },
  voice: { type: 'string' },
  speed: { type: 'string' },
  force: { type: 'boolean', default: false },
});

await main(async () => {
  const videoId = requireVideoId(a.video);
  const log = logger(videoId, 'media-tts');
  const { script, raw } = loadValidatedScript(videoId);

  const voice = a.voice ?? DEFAULT_VOICE;
  const speed = a.speed ? Number(a.speed) : DEFAULT_SPEED;
  const texts = [script.hook, ...script.lines.map((l) => l.text), script.end_question].map((t) => t.trim());
  const key = sha256(JSON.stringify({ raw, voice, speed, gap: DEFAULT_GAP_MS, lead: DEFAULT_LEAD_MS, tail: DEFAULT_TAIL_MS, speech: SPEECH_RULES_VERSION }));

  const wavPath = runPath(videoId, 'voice.wav');
  const metaPath = runPath(videoId, 'voice.json');
  if (!a.force && existsSync(wavPath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (meta.key === key) {
      log('voice.wav up to date, skipping');
      return { ...meta, reused: true };
    }
  }

  log(`synthesizing ${texts.length} segments voice=${voice} speed=${speed}`);
  const t0 = Date.now();
  const r = await synthesize(texts, { voice, speed });
  writeFileSync(wavPath, encodeWav(r.samples, r.sampleRate));
  const meta = {
    key,
    voice,
    speed,
    sample_rate: r.sampleRate,
    duration_s: r.samples.length / r.sampleRate,
    segments: r.segments, // index 0 = hook, last = end question
    wav: 'voice.wav',
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  log(`done in ${Date.now() - t0} ms, ${meta.duration_s.toFixed(1)} s of audio`);
  return { ...meta, reused: false };
});
