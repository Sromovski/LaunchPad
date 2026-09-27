/**
 * npm run media:render -- --video <id>
 * Reads edit.json + voice + captions.ass → runs/<id>/final.mp4.
 * Also writes render-config.json (what was rendered, incl. credit lines) for qa:check.
 */
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { loadEditContext } from '../media/context.js';
import { ffmpegBin, measureLoudness, probe, run } from '../media/probe.js';
import { buildRenderPlan } from '../media/render.js';
import { FONTS_DIR } from '../media/layout.js';
import { args, logger, main, requireVideoId, runDir, runPath } from './_lib.js';

const a = args({ video: { type: 'string' } });

await main((db) => {
  const videoId = requireVideoId(a.video);
  const log = logger(videoId, 'media-render');
  const dir = runDir(videoId);
  if (!existsSync(runPath(videoId, 'captions.ass'))) throw new Error('run media:captions first');

  const ctx = loadEditContext(db, videoId);
  const clips = ctx.clips.map((c) => {
    const asset = ctx.assets.get(c.nasa_id)!;
    return { ...c, local_path: asset.local_path, media_type: asset.media_type };
  });

  log('measuring voice loudness');
  const loudness = measureLoudness(runPath(videoId, 'voice.wav'));

  const plan = buildRenderPlan({
    clips,
    duration_s: ctx.duration_s,
    voicePath: 'voice.wav',
    loudness,
    captionsFile: 'captions.ass',
    fontsDir: relative(dir, `${PROJECT_ROOT}/${FONTS_DIR}`).replace(/\\/g, '/'),
    output: 'final.mp4',
  });
  writeFileSync(runPath(videoId, 'filter.txt'), plan.filter);
  writeFileSync(
    runPath(videoId, 'render-config.json'),
    JSON.stringify(
      {
        duration_s: ctx.duration_s,
        end_card_start_s: ctx.end_card_start_s,
        clips,
        credits: ctx.credits,
        loudness,
        ffmpeg_args: plan.args,
      },
      null,
      2,
    ),
  );

  log(`rendering ${clips.length} clips, ${ctx.duration_s} s`);
  const t0 = Date.now();
  const { stderr } = run(ffmpegBin(), plan.args, { cwd: dir });
  if (stderr.trim()) log(stderr.trim().split('\n').slice(-20).join('\n'));

  const finalPath = runPath(videoId, 'final.mp4');
  const out = probe(finalPath);
  const rel = relative(PROJECT_ROOT, finalPath).replace(/\\/g, '/');
  db.prepare("UPDATE videos SET final_path = ?, duration_s = ?, updated_at = datetime('now') WHERE id = ?").run(rel, out.duration, videoId);
  log(`done in ${Math.round((Date.now() - t0) / 1000)} s → ${rel}`);
  return {
    final_path: rel,
    duration_s: out.duration,
    mb: Math.round((statSync(finalPath).size / 1e6) * 10) / 10,
    warnings: ctx.warnings,
    clips: clips.map(({ nasa_id, start_s, end_s, mode }) => ({ nasa_id, start_s, end_s, mode })),
  };
});
