/**
 * npm run export -- --video <id>      (or --all for every approved video)
 *   → exports/<id>-<slug>/  <slug>.mp4, title.txt, description.txt,
 *                           thumbnail-vertical.jpg (1080×1920), thumbnail-wide.jpg (1280×720)
 * Only approved (or later) videos: the approval gate holds for hand-posting too.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { PROJECT_ROOT } from '../db/index.js';
import { descriptionText, slugify } from '../export/package.js';
import { THUMB_VERTICAL, THUMB_WIDE, makeThumbnails } from '../export/thumbnail.js';
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
  makeThumbnails(db, { videoId: v.id, title, runDir: runPath(v.id, '.'), outDir: dir, variants: [THUMB_VERTICAL, THUMB_WIDE], override });
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
