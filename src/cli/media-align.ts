/**
 * npm run media:align -- --video <id>
 * voice.wav → (ffmpeg 16 kHz mono) → whisper.cpp word timings → aligned onto
 * the script's words → runs/<id>/words.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { alignWords, parseWhisperJson } from '../media/align.js';
import { ffmpegBin, run } from '../media/probe.js';
import { whisperBinPath, whisperModelPath } from '../media/tools.js';
import type { VoiceMeta } from '../media/context.js';
import { args, logger, main, requireVideoId, runPath } from './_lib.js';

const a = args({ video: { type: 'string' } });

/** Below this, captions would be mostly guessed timings — worth a human look. */
const MIN_MATCH_RATE = 0.8;

await main(() => {
  const videoId = requireVideoId(a.video);
  const log = logger(videoId, 'media-align');
  const bin = whisperBinPath();
  const model = whisperModelPath();
  if (!bin || !model) throw new Error('whisper.cpp not found (run npm run doctor)');

  const voice = JSON.parse(readFileSync(runPath(videoId, 'voice.json'), 'utf8')) as VoiceMeta;
  const wav16 = runPath(videoId, 'voice-16k.wav');
  run(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', runPath(videoId, 'voice.wav'), '-ar', '16000', '-ac', '1', wav16]);

  const outBase = runPath(videoId, 'whisper');
  log('running whisper.cpp');
  run(bin, ['-m', model, '-f', wav16, '-ojf', '-of', outBase, '-np', '-ml', '1', '-sow']);
  const heard = parseWhisperJson(JSON.parse(readFileSync(`${outBase}.json`, 'utf8')));

  const result = alignWords(voice.segments, heard);
  writeFileSync(runPath(videoId, 'words.json'), JSON.stringify(result, null, 2));
  log(`${result.words.length} words, match rate ${result.match_rate}`);

  const warnings = result.match_rate < MIN_MATCH_RATE ? [`only ${Math.round(result.match_rate * 100)}% of words matched whisper`] : [];
  return { words: result.words.length, heard: heard.length, match_rate: result.match_rate, warnings, file: 'words.json' };
});
