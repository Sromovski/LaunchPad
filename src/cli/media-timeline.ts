/**
 * npm run media:timeline -- --video <id> [--pauses '[{"after_segment":2,"seconds":3.5}]']
 * Final times of every script line after narration pauses (from --pauses, or edit.json's
 * "pauses"), so the producer can place clips before writing the rest of edit.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { EditPause, computeTimeline } from '../media/edit.js';
import { pauseWindows, shiftSegments } from '../media/timeline.js';
import type { VoiceMeta } from '../media/context.js';
import { args, main, requireVideoId, runPath } from './_lib.js';

const a = args({ video: { type: 'string' }, pauses: { type: 'string' } });

await main(() => {
  const videoId = requireVideoId(a.video);
  const voice = JSON.parse(readFileSync(runPath(videoId, 'voice.json'), 'utf8')) as VoiceMeta;
  let pauses: z.infer<typeof EditPause>[] = [];
  if (a.pauses) pauses = z.array(EditPause).parse(JSON.parse(a.pauses));
  else if (existsSync(runPath(videoId, 'edit.json'))) {
    const e = JSON.parse(readFileSync(runPath(videoId, 'edit.json'), 'utf8')) as { pauses?: unknown };
    pauses = z.array(EditPause).parse(e.pauses ?? []);
  }
  const windows = pauseWindows(voice.segments, pauses);
  const segments = shiftSegments(voice.segments, windows);
  const t = computeTimeline(segments);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    duration_s: r(t.duration_s),
    end_card_start_s: r(t.end_card_start_s),
    pauses: windows.map((w) => ({ start_s: r(w.start_s), end_s: r(w.end_s) })),
    segments: segments.map((s) => ({ index: s.index, start_s: r(s.start_s), end_s: r(s.end_s), text: s.text })),
  };
});
