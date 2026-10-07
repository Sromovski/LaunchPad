/**
 * Title thumbnails: a clean NASA frame (no captions/credit), cover-cropped, gently
 * darkened, with the title in big Fredoka and the last line in the channel's highlight colour.
 * Used by `npm run export` (hand-posting) and by the poster (thumbnails.set).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { assColor, channelOfVideo } from '../channels.js';
import { PROJECT_ROOT } from '../db/index.js';
import { assEscape } from '../media/captions.js';
import { FONTS_DIR, FONT_BOLD } from '../media/layout.js';
import { ffmpegBin, run } from '../media/probe.js';
import { thumbLines } from './package.js';

export interface ThumbVariant {
  name: string;
  w: number;
  h: number;
  /** Max characters per title line. */
  chars: number;
  size: number;
  /** Vertical centre of the title block. */
  y: number;
}

/** 9:16 for Shorts (YouTube: vertical, min 640 px tall). */
export const THUMB_VERTICAL: ThumbVariant = { name: 'thumbnail-vertical.jpg', w: 1080, h: 1920, chars: 11, size: 150, y: 560 };
/** 16:9 for non-Short uploads; title in the top third keeps the subject (e.g. the Sun) visible. */
export const THUMB_WIDE: ThumbVariant = { name: 'thumbnail-wide.jpg', w: 1280, h: 720, chars: 18, size: 100, y: 190 };

function thumbAss(w: number, h: number, lines: string[], size: number, y: number, accent: string): string {
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
    // Last line in the channel's highlight colour, like the highlighted caption word.
    `Dialogue: 0,0:00:00.00,0:00:05.00,T,,0,0,0,,{\\an5\\pos(${w / 2},${y})}${lines.map((l, i) => (i === lines.length - 1 ? `{\\1c${accent}&}${assEscape(l)}` : assEscape(l))).join('\\N')}`,
    '',
  ].join('\n');
}

/**
 * A clean frame from the video's main NASA asset — or from `override` when that frame
 * has NASA's own graphics or text in it. The producer's crop for that clip is applied,
 * so split screens and labels stay out.
 */
function sourceFrame(db: Database.Database, runDir: string, videoId: number, outPng: string, override?: { nasaId: string; at: number }) {
  const research = JSON.parse(readFileSync(resolve(runDir, 'research.json'), 'utf8')) as { primary_asset: { nasa_id: string } };
  const edit = JSON.parse(readFileSync(resolve(runDir, 'edit.json'), 'utf8')) as {
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

/**
 * Writes the thumbnails into `outDir` (plus source.png / thumb.ass working files).
 * `runDir` is the video's run folder (research.json, edit.json).
 */
export function makeThumbnails(
  db: Database.Database,
  o: { videoId: number; title: string; runDir: string; outDir: string; variants: ThumbVariant[]; override?: { nasaId: string; at: number } },
): string[] {
  sourceFrame(db, o.runDir, o.videoId, resolve(o.outDir, 'source.png'), o.override);
  const accent = assColor(channelOfVideo(db, o.videoId).brand.highlight);
  const fonts = relative(o.outDir, resolve(PROJECT_ROOT, FONTS_DIR)).replace(/\\/g, '/');
  return o.variants.map((t) => {
    writeFileSync(resolve(o.outDir, 'thumb.ass'), thumbAss(t.w, t.h, thumbLines(o.title, t.chars), t.size, t.y, accent));
    run(
      ffmpegBin(),
      [
        '-y', '-loglevel', 'error', '-i', 'source.png',
        '-vf', `scale=${t.w}:${t.h}:force_original_aspect_ratio=increase,crop=${t.w}:${t.h},eq=brightness=-0.08:saturation=1.15,subtitles=thumb.ass:fontsdir=${fonts}`,
        '-frames:v', '1', '-q:v', '3', t.name,
      ],
      { cwd: o.outDir },
    );
    return resolve(o.outDir, t.name);
  });
}
