/**
 * npm run export -- --video <id>      (or --all for every approved video)
 *   → exports/<id>-<slug>/  <slug>.mp4, title.txt, description.txt,
 *                           thumbnail-vertical.jpg (1080×1920), thumbnail-wide.jpg (1280×720)
 * Only approved (or later) videos: the approval gate holds for hand-posting too.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { PROJECT_ROOT } from '../db/index.js';
import { descriptionText, slugify, thumbLines } from '../export/package.js';
import { assEscape } from '../media/captions.js';
import { FONTS_DIR, FONT_BOLD } from '../media/layout.js';
import { ffmpegBin, run } from '../media/probe.js';
import { args, main, runPath } from './_lib.js';

const a = args({ video: { type: 'string' }, all: { type: 'boolean', default: false }, source: { type: 'string' }, at: { type: 'string' } });
const POSTABLE = ['approved', 'scheduled', 'published'];
const EXPORTS = resolve(PROJECT_ROOT, 'exports');

interface Row {
  id: number;
  status: string;
  title: string | null;
  topic: string;
  description: string | null;
  hashtags: string | null;
}

function thumbAss(w: number, h: number, lines: string[], size: number, y: number): string {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: T,${FONT_BOLD},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,1,0,1,${Math.round(size / 9)},${Math.round(size / 18)},5,40,40,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    // Last line in the brand yellow (#FFD23F), like the highlighted caption word.
    `Dialogue: 0,0:00:00.00,0:00:05.00,T,,0,0,0,,{\\an5\\pos(${w / 2},${y})}${lines.map((l, i) => (i === lines.length - 1 ? `{\\1c&H003FD2FF&}${assEscape(l)}` : assEscape(l))).join('\\N')}`,
    '',
  ].join('\n');
}

/** A clean frame (no captions/credit) from the video's main NASA asset. */
/**
 * A clean frame (no captions/credit) from the video's main NASA asset — or from
 * --source/--at when that frame has NASA's own graphics or text in it. The
 * producer's crop for that clip is applied, so split screens and labels stay out.
 */
function sourceFrame(db: Database.Database, videoId: number, outPng: string, override?: { nasaId: string; at: number }) {
  const research = JSON.parse(readFileSync(runPath(videoId, 'research.json'), 'utf8')) as { primary_asset: { nasa_id: string } };
  const edit = JSON.parse(readFileSync(runPath(videoId, 'edit.json'), 'utf8')) as {
    clips: { nasa_id: string; start_s: number; end_s: number; source_in_s?: number; crop?: { x: number; y: number; w: number; h: number } }[];
  };
  const nasaId = override?.nasaId ?? research.primary_asset.nasa_id;
  const asset = db.prepare('SELECT local_path, media_type FROM assets WHERE video_id = ? AND nasa_id = ?').get(videoId, nasaId) as
    | { local_path: string; media_type: string }
    | undefined;
  if (!asset) throw new Error(`asset ${nasaId} not found for video ${videoId}`);
  const clip = edit.clips.find((c) => c.nasa_id === nasaId);
  const t = override?.at ?? (clip?.source_in_s ?? 0) + Math.min(2, clip ? (clip.end_s - clip.start_s) / 2 : 2);
  const seek = asset.media_type === 'video' ? ['-ss', String(t)] : [];
  const crop = clip?.crop ? ['-vf', `crop=iw*${clip.crop.w}:ih*${clip.crop.h}:iw*${clip.crop.x}:ih*${clip.crop.y}`] : [];
  run(ffmpegBin(), ['-y', '-loglevel', 'error', ...seek, '-i', asset.local_path, ...crop, '-frames:v', '1', outPng]);
}

function exportOne(db: Database.Database, v: Row, override?: { nasaId: string; at: number }) {
  if (!POSTABLE.includes(v.status)) throw new Error(`video ${v.id} is ${v.status}; only approved videos can be exported`);
  const title = v.title ?? v.topic;
  const slug = slugify(title);
  const dir = resolve(EXPORTS, `${v.id}-${slug}`);
  mkdirSync(dir, { recursive: true });

  copyFileSync(runPath(v.id, 'final.mp4'), resolve(dir, `${slug}.mp4`));
  writeFileSync(resolve(dir, 'title.txt'), `${title}\n`);
  writeFileSync(resolve(dir, 'description.txt'), descriptionText(v.description ?? '', v.hashtags ? (JSON.parse(v.hashtags) as string[]) : []));

  // Thumbnails: clean NASA frame, cover-cropped, gently darkened, big Fredoka title.
  sourceFrame(db, v.id, resolve(dir, 'source.png'), override);
  const fonts = relative(dir, resolve(PROJECT_ROOT, FONTS_DIR)).replace(/\\/g, '/');
  const variants = [
    { name: 'thumbnail-vertical.jpg', w: 1080, h: 1920, chars: 11, size: 150, y: 560 },
    { name: 'thumbnail-wide.jpg', w: 1280, h: 720, chars: 18, size: 100, y: 190 }, // top third: keep the subject (e.g. the Sun) visible
  ];
  for (const t of variants) {
    writeFileSync(resolve(dir, 'thumb.ass'), thumbAss(t.w, t.h, thumbLines(title, t.chars), t.size, t.y));
    run(
      ffmpegBin(),
      [
        '-y', '-loglevel', 'error', '-i', 'source.png',
        '-vf', `scale=${t.w}:${t.h}:force_original_aspect_ratio=increase,crop=${t.w}:${t.h},eq=brightness=-0.08:saturation=1.15,subtitles=thumb.ass:fontsdir=${fonts}`,
        '-frames:v', '1', '-q:v', '3', t.name,
      ],
      { cwd: dir },
    );
  }
  return { video_id: v.id, folder: relative(PROJECT_ROOT, dir).replace(/\\/g, '/'), files: [`${slug}.mp4`, 'title.txt', 'description.txt', 'thumbnail-vertical.jpg', 'thumbnail-wide.jpg'] };
}

await main((db) => {
  const rows = (
    a.all
      ? db.prepare(`SELECT id, status, title, topic, description, hashtags FROM videos WHERE status IN (${POSTABLE.map(() => '?').join(',')}) ORDER BY id`).all(...POSTABLE)
      : db.prepare('SELECT id, status, title, topic, description, hashtags FROM videos WHERE id = ?').all(Number(a.video))
  ) as Row[];
  if (rows.length === 0) throw new Error(a.all ? 'no approved videos' : '--video <id> (approved) or --all is required');
  const override = a.source ? { nasaId: a.source, at: Number(a.at ?? 0) } : undefined;
  return { exports: rows.map((v) => exportOne(db, v, override)) };
});
