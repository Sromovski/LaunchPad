/** npm run media:captions -- --video <id> → runs/<id>/captions.ass */
import { writeFileSync } from 'node:fs';
import { buildAss, coveredWordCount, type CaptionInput } from '../media/captions.js';
import { loadEditContext, loadWords } from '../media/context.js';
import { args, logger, main, requireVideoId, runPath } from './_lib.js';

const a = args({ video: { type: 'string' } });

await main((db) => {
  const videoId = requireVideoId(a.video);
  const log = logger(videoId, 'media-captions');
  const ctx = loadEditContext(db, videoId);
  const { words } = loadWords(videoId);

  const input: CaptionInput = {
    words,
    endQuestionSegment: ctx.voice.segments.length - 1,
    endQuestion: ctx.script.end_question,
    endCardStart: ctx.end_card_start_s,
    duration: ctx.duration_s,
    credits: ctx.credits,
  };
  writeFileSync(runPath(videoId, 'captions.ass'), buildAss(input));
  const coverage = words.length ? coveredWordCount(input) / words.length : 0;
  log(`captions.ass written, coverage ${(coverage * 100).toFixed(1)}%`);
  return { file: 'captions.ass', words: words.length, coverage, credits: ctx.credits };
});
