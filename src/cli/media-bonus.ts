/**
 * npm run media:bonus -- --video <id> [--refresh]
 * Picks the bonus space picture (newest NASA Image of the Day that isn't
 * rights-rejected or used before), records it as an asset + source, voices the
 * outro, writes runs/<id>/bonus.json + bonus.ass. media:render appends it.
 * Idempotent: keeps the same picture on re-renders unless --refresh.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUTRO_LINES, OUTRO_PAUSE_MS, IOTD_FEED, chooseBonus, parseIotdFeed, parsePageCredit } from '../bonus/iotd.js';
import { bonusAss } from '../bonus/outro.js';
import { BonusMeta } from '../bonus/meta.js';
import { loadEditContext } from '../media/context.js';
import { LIMITS } from '../qa/checks.js';
import { synthesize } from '../media/tts.js';
import { encodeWav } from '../media/wav.js';
import { ffmpegBin, run } from '../media/probe.js';
import { slugify } from '../export/package.js';
import { args, getVideo, logger, main, requireVideoId, runPath } from './_lib.js';

const a = args({ video: { type: 'string' }, refresh: { type: 'boolean', default: false } });


await main(async (db) => {
  const videoId = requireVideoId(a.video);
  getVideo(db, videoId);
  const log = logger(videoId, 'media-bonus');
  const metaPath = runPath(videoId, 'bonus.json');
  if (existsSync(metaPath) && !a.refresh) {
    log('bonus.json exists, keeping the same picture');
    return { reused: true, bonus: JSON.parse(readFileSync(metaPath, 'utf8')) };
  }

  // A bonus that won't fit must not be recorded at all (it would count as "used" and trip the rights gate).
  const clearRows = () => {
    db.prepare("DELETE FROM assets WHERE video_id = ? AND nasa_id LIKE 'iotd:%'").run(videoId);
    db.prepare("DELETE FROM sources WHERE video_id = ? AND ref = 'bonus'").run(videoId);
  };
  const feed = parseIotdFeed(await (await fetch(IOTD_FEED, { signal: AbortSignal.timeout(30_000) })).text());
  const used = new Set(
    (db.prepare("SELECT nasa_id FROM assets WHERE nasa_id LIKE 'iotd:%' AND video_id != ?").all(videoId) as { nasa_id: string }[]).map((r) => r.nasa_id),
  );
  const { choice, skipped } = await chooseBonus(feed, used, async (item) =>
    parsePageCredit(await (await fetch(item.link, { signal: AbortSignal.timeout(30_000) })).text()),
  );
  for (const s of skipped) log(`skipped "${s.title}": ${s.why}`);
  if (!choice) {
    // No usable picture: the video simply has no bonus outro.
    clearRows();
    writeFileSync(metaPath, JSON.stringify({ none: true, skipped }, null, 2));
    log('no usable Image of the Day; no bonus picture');
    return { bonus: false, skipped };
  }
  const { item, credit, rights, asset_id } = choice;
  log(`bonus: "${item.title}" credit=${credit} → ${rights.status} ${rights.note}`);

  // Picture (NASA originals can be 8000+ px wide: scale to 2160 wide).
  const dir = runPath(videoId, 'assets');
  mkdirSync(dir, { recursive: true });
  const slug = slugify(item.title);
  const orig = resolve(dir, `iotd-${slug}-orig${item.image.match(/\.\w+$/)?.[0] ?? '.jpg'}`);
  writeFileSync(orig, Buffer.from(await (await fetch(item.image, { signal: AbortSignal.timeout(120_000) })).arrayBuffer()));
  const image = resolve(dir, `iotd-${slug}.jpg`);
  run(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', orig, '-vf', "scale='min(2160,iw)':-2", '-q:v', '2', image]);

  // Voice: "And now… for your space picture of the day!" + NASA's own title (sourced by the page).
  const tts = await synthesize([...OUTRO_LINES, `${item.title}.`], { gapMs: OUTRO_PAUSE_MS, leadMs: 250, tailMs: 1200 });
  const headStart = tts.segments[1]!.start_s;
  const titleStart = tts.segments[2]!.start_s;
  writeFileSync(runPath(videoId, 'bonus-voice.wav'), encodeWav(tts.samples, tts.sampleRate));
  const duration = Math.ceil((tts.samples.length / tts.sampleRate) * 30) / 30;
  const dateText = new Date(item.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  // The bonus is extra: if the main video leaves no room within the limit, record nothing.
  const mainS = loadEditContext(db, videoId).duration_s;
  if (mainS + duration > LIMITS.maxDuration) {
    clearRows();
    const why = `main video ${mainS.toFixed(1)} s + bonus ${duration.toFixed(1)} s > ${LIMITS.maxDuration} s`;
    writeFileSync(metaPath, JSON.stringify({ none: true, skipped: [{ title: item.title, why }] }, null, 2));
    log(`no bonus: ${why}`);
    return { bonus: false, why };
  }

  // Rights first: the picture is an asset (rights gate + credits) and its page is a source.
  db.transaction(() => {
    db.prepare("DELETE FROM assets WHERE video_id = ? AND nasa_id LIKE 'iotd:%' AND nasa_id != ?").run(videoId, asset_id);
    db.prepare(
      `INSERT INTO assets (video_id, nasa_id, media_type, title, description, source_url, credit, date_created, local_path, rights_status, rights_note)
       VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (video_id, nasa_id) DO UPDATE SET local_path = excluded.local_path`,
    ).run(videoId, asset_id, item.title, item.description, item.link, credit, item.date, image, rights.status, `bonus picture (NASA Image of the Day); ${rights.note}`);
    db.prepare(
      `INSERT INTO sources (video_id, ref, url, title, excerpt) VALUES (?, 'bonus', ?, ?, ?)
       ON CONFLICT (video_id, ref) DO UPDATE SET url = excluded.url, title = excluded.title, excerpt = excluded.excerpt`,
    ).run(videoId, item.link, `NASA Image of the Day: ${item.title}`, item.description.slice(0, 600));
  })();

  writeFileSync(runPath(videoId, 'bonus.ass'), bonusAss({ title: item.title, credit, dateText, headStart, titleStart, duration }));

  const meta = BonusMeta.parse({
    asset_id,
    title: item.title,
    date: item.date,
    date_text: dateText,
    credit,
    rights_status: rights.status,
    page: item.link,
    image: `assets/iotd-${slug}.jpg`,
    voice: 'bonus-voice.wav',
    duration_s: duration,
    title_start_s: titleStart,
  });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  log(`bonus outro ${duration.toFixed(1)} s`);
  return { bonus: true, ...meta };
});
