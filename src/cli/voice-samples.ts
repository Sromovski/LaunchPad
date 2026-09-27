/** npm run media:voices — renders one hook in several Kokoro voices into runs/_voices/ for Thomas to pick. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { synthesize } from '../media/tts.js';
import { encodeWav } from '../media/wav.js';
import { RUNS_ROOT, main } from './_lib.js';

const VOICES = ['af_heart', 'af_bella', 'af_sarah', 'am_michael', 'am_puck', 'bf_emma'];
const TEXT = [
  'Did you know sunsets on Mars are blue?',
  'The sky there is full of tiny dust. And that dust plays a trick with sunlight!',
];

await main(async () => {
  const dir = resolve(RUNS_ROOT, '_voices');
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const voice of VOICES) {
    const r = await synthesize(TEXT, { voice });
    const file = resolve(dir, `${voice}.wav`);
    writeFileSync(file, encodeWav(r.samples, r.sampleRate));
    files.push(file);
  }
  return { dir, files };
});
