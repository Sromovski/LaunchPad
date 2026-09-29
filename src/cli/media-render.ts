/**
 * npm run media:render -- --video <id>
 * Reads edit.json + voice + captions.ass → runs/<id>/final.mp4.
 * If media:bonus chose a bonus space picture (bonus.json), the main video is
 * rendered to final-main.mp4, the outro to bonus.mp4, and the two are joined.
 * Also writes render-config.json (what was rendered, incl. credit lines) for qa:check.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { loadEditContext } from '../media/context.js';
import { ffmpegBin, measureLoudness, probe, run } from '../media/probe.js';
import { buildRenderPlan } from '../media/render.js';
import { clipGainDb } from '../media/audio-mix.js';
import { FONTS_DIR } from '../media/layout.js';
import { bonusCreditLine } from '../bonus/outro.js';
import { parseBonus } from '../bonus/meta.js';
import { LIMITS } from '../qa/checks.js';
import { args, logger, main, requireVideoId, runDir, runPath } from './_lib.js';

const a = args({ video: { type: 'string' } });

await main((db) => {
  const videoId = requireVideoId(a.video);
  const log = logger(videoId, 'media-render');
  const dir = runDir(videoId);
  if (!existsSync(runPath(videoId, 'captions.ass'))) throw new Error('run media:captions first');

  const ctx = loadEditContext(db, videoId);
  // Clip sound: one fixed gain per recording, from its whole-file loudness (keeps NASA's own loud/quiet contrasts).
  const gains = new Map<string, number>();
  for (const c of ctx.clips) {
    if (c.audio !== 'full' || gains.has(c.nasa_id)) continue;
    const lufs = Number(measureLoudness(ctx.assets.get(c.nasa_id)!.local_path).input_i);
    gains.set(c.nasa_id, clipGainDb(lufs));
    log(`clip sound ${c.nasa_id}: ${lufs} LUFS -> gain ${gains.get(c.nasa_id)} dB`);
  }
  const clips = ctx.clips.map((c) => {
    const asset = ctx.assets.get(c.nasa_id)!;
    return { ...c, local_path: asset.local_path, media_type: asset.media_type, width: asset.width, height: asset.height, audio_gain_db: gains.get(c.nasa_id) };
  });

  log('measuring voice loudness');
  const loudness = measureLoudness(runPath(videoId, ctx.voiceFile));

  const bonusPath = runPath(videoId, 'bonus.json');
  const chosen = parseBonus(existsSync(bonusPath) ? JSON.parse(readFileSync(bonusPath, 'utf8')) : null);
  // The bonus is extra: if it would push the video past the limit, leave it off (the lesson matters more).
  const bonusSkipped =
    chosen && ctx.duration_s + chosen.duration_s > LIMITS.maxDuration
      ? `main video ${ctx.duration_s.toFixed(1)} s + bonus ${chosen.duration_s.toFixed(1)} s > ${LIMITS.maxDuration} s`
      : null;
  const bonus = bonusSkipped ? null : chosen;
  if (bonusSkipped) log(`bonus picture left off: ${bonusSkipped}`);
  const fontsDir = relative(dir, `${PROJECT_ROOT}/${FONTS_DIR}`).replace(/\\/g, '/');

  const plan = buildRenderPlan({
    clips,
    duration_s: ctx.duration_s,
    voicePath: ctx.voiceFile,
    loudness,
    windows: ctx.windows,
    captionsFile: 'captions.ass',
    fontsDir,
    output: bonus ? 'final-main.mp4' : 'final.mp4',
  });
  // Bonus outro: the picture over a blurred copy of itself, slow zoom, its own voice + text.
  const bonusPlan = bonus
    ? (() => {
        const s = probe(runPath(videoId, bonus.image)).streams.find((x) => x.codec_type === 'video')!;
        return buildRenderPlan({
          clips: [
            { nasa_id: bonus.asset_id, start_s: 0, end_s: bonus.duration_s, mode: 'blur_bg', direction: 'in', audio: 'mute', source_in_s: 0, why: 'bonus space picture', local_path: runPath(videoId, bonus.image), media_type: 'image', width: s.width, height: s.height },
          ],
          duration_s: bonus.duration_s,
          voicePath: bonus.voice,
          loudness: measureLoudness(runPath(videoId, bonus.voice)),
          captionsFile: 'bonus.ass',
          fontsDir,
          output: 'bonus.mp4',
          filterFile: 'bonus-filter.txt',
        });
      })()
    : null;
  const credits = bonus
    ? [...ctx.credits, { text: bonusCreditLine(bonus.credit), start: ctx.duration_s, end: ctx.duration_s + bonus.duration_s }]
    : ctx.credits;
  writeFileSync(runPath(videoId, 'filter.txt'), plan.filter);
  writeFileSync(
    runPath(videoId, 'render-config.json'),
    JSON.stringify(
      {
        duration_s: ctx.duration_s,
        end_card_start_s: ctx.end_card_start_s,
        pauses: ctx.windows,
        clips,
        credits,
        loudness,
        bonus_skipped: bonusSkipped,
        bonus: bonus && { ...bonus, start_s: ctx.duration_s, end_s: ctx.duration_s + bonus.duration_s },
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
  if (bonusPlan) {
    log(`rendering bonus outro "${bonus!.title}", ${bonus!.duration_s} s`);
    writeFileSync(runPath(videoId, 'bonus-filter.txt'), bonusPlan.filter);
    run(ffmpegBin(), bonusPlan.args, { cwd: dir });
    // Same encode settings as buildRenderPlan so the joined file still meets the §6 spec.
    // (Re-encode rather than stream-copy: concat of two separately encoded files is only safe this way.)
    run(
      ffmpegBin(),
      [
        '-y', '-loglevel', 'error', '-i', 'final-main.mp4', '-i', 'bonus.mp4',
        '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]', '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', '30',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', 'final.mp4',
      ],
      { cwd: dir },
    );
  }

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
    bonus_skipped: bonusSkipped,
    bonus: bonus ? { title: bonus.title, credit: bonus.credit, rights: bonus.rights_status, duration_s: bonus.duration_s } : null,
    clips: clips.map(({ nasa_id, start_s, end_s, mode }) => ({ nasa_id, start_s, end_s, mode })),
  };
});
