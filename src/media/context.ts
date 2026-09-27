/**
 * Everything captions/render/QA need about one video, loaded and cross-checked
 * in one place: validated script, voice timings, timeline, normalized edit,
 * assets and the per-clip credit lines.
 */
import { existsSync, readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { runPath } from '../cli/_lib.js';
import { loadValidatedScript } from '../script/load.js';
import type { Script } from '../agents/schemas.js';
import { Edit, computeTimeline, normalizeEdit, type AssetInfo, type EditClip } from './edit.js';
import type { AlignedWord, SegmentTiming } from './align.js';
import type { CreditSpan } from './captions.js';
import { probe } from './probe.js';

export interface VoiceMeta {
  duration_s: number;
  segments: SegmentTiming[];
}

export interface AssetRow extends AssetInfo {
  id: number;
  local_path: string;
  title: string | null;
}

export interface EditContext {
  videoId: number;
  script: Script;
  voice: VoiceMeta;
  duration_s: number;
  end_card_start_s: number;
  clips: EditClip[];
  assets: Map<string, AssetRow>;
  credits: CreditSpan[];
  warnings: string[];
}

const readJson = (path: string) => {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
};

export function creditLine(a: AssetRow): string {
  const label = a.media_type === 'video' ? 'Footage' : 'Image';
  return `${label}: ${a.credit ?? `NASA (credit unknown, ${a.nasa_id})`}`;
}

export function loadEditContext(db: Database.Database, videoId: number): EditContext {
  const { script } = loadValidatedScript(videoId);
  const voice = readJson(runPath(videoId, 'voice.json')) as VoiceMeta;
  const edit = Edit.parse(readJson(runPath(videoId, 'edit.json')));

  const rows = db
    .prepare('SELECT id, nasa_id, media_type, rights_status, credit, local_path, title FROM assets WHERE video_id = ?')
    .all(videoId) as AssetRow[];
  const used = new Set(edit.clips.map((c) => c.nasa_id));
  for (const a of rows) {
    if (!used.has(a.nasa_id)) continue;
    const p = probe(a.local_path);
    const v = p.streams.find((s) => s.codec_type === 'video');
    a.width = v?.width;
    a.height = v?.height;
    if (a.media_type === 'video') a.duration_s = p.duration;
  }

  const { duration_s, end_card_start_s } = computeTimeline(voice.segments);
  const { clips, errors, warnings } = normalizeEdit(edit, duration_s, rows);
  if (errors.length) throw new Error(`edit.json problems:\n- ${errors.join('\n- ')}`);

  const assets = new Map(rows.map((r) => [r.nasa_id, r]));
  const credits = clips.map((c) => ({ text: creditLine(assets.get(c.nasa_id)!), start: c.start_s, end: c.end_s }));
  return { videoId, script, voice, duration_s, end_card_start_s, clips, assets, credits, warnings };
}

export const WordsFile = z.object({
  match_rate: z.number(),
  words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number(), segment: z.number(), matched: z.boolean() })),
});

export function loadWords(videoId: number): { words: AlignedWord[]; match_rate: number } {
  return WordsFile.parse(readJson(runPath(videoId, 'words.json')));
}
