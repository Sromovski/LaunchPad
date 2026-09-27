/** Download one NASA library asset into a run dir and record it (with its credit check) in `assets`. */
import { createWriteStream, existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type Database from 'better-sqlite3';
import { creditCheckFor, detailsUrl, getAssetManifest, getItem, pickBestFile } from './api.js';
import type { Logger } from '../cli/_lib.js';

/** Originals above this are skipped for the next size down (~1080p is plenty). */
const MAX_BYTES = 600 * 1024 * 1024;

export const safeFileName = (nasaId: string) => nasaId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

async function contentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    const len = Number(res.headers.get('content-length'));
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(tmp));
  renameSync(tmp, dest);
}

export interface FetchResult {
  asset_id: number;
  nasa_id: string;
  media_type: string;
  title: string;
  local_path: string;
  source_url: string;
  download_url: string;
  credit: string | null;
  rights_status: string;
  rights_note: string;
  bytes: number;
  reused: boolean;
}

/**
 * If Thomas already cleared this exact asset (same nasa_id AND same credit)
 * while approving another video, reuse that decision. Never overrides `rejected`.
 */
export function priorClearance(
  db: Database.Database,
  nasaId: string,
  credit: string | null,
  videoId: number,
): { video_id: number; rights_note: string } | undefined {
  if (!credit) return undefined;
  return db
    .prepare(
      `SELECT video_id, rights_note FROM assets
       WHERE nasa_id = ? AND credit = ? AND video_id != ? AND rights_status = 'clear' AND rights_note LIKE '%cleared by Thomas%'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(nasaId, credit, videoId) as { video_id: number; rights_note: string } | undefined;
}

export async function fetchAsset(db: Database.Database, videoId: number, nasaId: string, dir: string, log: Logger): Promise<FetchResult> {
  const item = await getItem(nasaId);
  const hrefs = await getAssetManifest(nasaId);

  const sizes = new Map<string, number | null>();
  for (const h of hrefs.filter((h) => /~(orig|large)\./.test(h))) sizes.set(h, await contentLength(h));
  const url = pickBestFile(hrefs, item.media_type, (h) => (sizes.get(h) ?? 0) > MAX_BYTES);
  if (!url) throw new Error(`No usable file in manifest for ${nasaId}`);

  const ext = decodeURI(url).split('.').pop()!.toLowerCase();
  const localPath = resolve(dir, `${safeFileName(nasaId)}.${ext}`);
  const reused = existsSync(localPath);
  if (reused) {
    log(`already downloaded: ${localPath}`);
  } else {
    log(`downloading ${url}`);
    await download(url, localPath);
  }

  const rights = creditCheckFor(item);
  log(`credit: ${rights.credit ?? '(none)'} → ${rights.status} ${rights.note}`);
  if (rights.status === 'needs_review') {
    const prior = priorClearance(db, item.nasa_id, rights.credit, videoId);
    if (prior) {
      rights.status = 'clear';
      rights.note = `${rights.note}; previously ${prior.rights_note.match(/cleared by Thomas[^;]*/)?.[0] ?? 'cleared by Thomas'} (seen on video ${prior.video_id})`;
      log(`reusing Thomas's earlier clearance from video ${prior.video_id}`);
    }
  }

  // Sidecar with the full metadata, so rights can be audited later without the API.
  writeFileSync(`${localPath}.json`, JSON.stringify({ item, download_url: url, rights }, null, 2));

  // Upsert so re-running is idempotent. A human's manual rights decision is kept.
  db.prepare(
    `INSERT INTO assets (video_id, nasa_id, media_type, title, description, source_url, credit, date_created,
                         local_path, rights_status, rights_note)
     VALUES (@video_id, @nasa_id, @media_type, @title, @description, @source_url, @credit, @date_created,
             @local_path, @rights_status, @rights_note)
     ON CONFLICT (video_id, nasa_id) DO UPDATE SET
       title = excluded.title, description = excluded.description, source_url = excluded.source_url,
       credit = excluded.credit, date_created = excluded.date_created, local_path = excluded.local_path`,
  ).run({
    video_id: videoId,
    nasa_id: item.nasa_id,
    media_type: item.media_type,
    title: item.title,
    description: item.description ?? null,
    source_url: detailsUrl(item.nasa_id),
    credit: rights.credit,
    date_created: item.date_created ?? null,
    local_path: localPath,
    rights_status: rights.status,
    rights_note: rights.note,
  });
  const row = db
    .prepare('SELECT id, rights_status, rights_note FROM assets WHERE video_id = ? AND nasa_id = ?')
    .get(videoId, item.nasa_id) as { id: number; rights_status: string; rights_note: string };

  return {
    asset_id: row.id,
    nasa_id: item.nasa_id,
    media_type: item.media_type,
    title: item.title,
    local_path: localPath,
    source_url: detailsUrl(item.nasa_id),
    download_url: url,
    credit: rights.credit,
    rights_status: row.rights_status,
    rights_note: row.rights_note,
    bytes: statSync(localPath).size,
    reused,
  };
}
