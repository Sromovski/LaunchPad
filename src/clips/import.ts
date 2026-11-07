/**
 * Brings Curious Clips work in from the stick-ai-shorts project (channels/clips/CLAUDE.md).
 * A script lands at gate 1; a finished video lands at gate 2. Nothing here can get past a
 * gate: only the review site's decisions can do that, and the state machine enforces it.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { CLIPS } from '../channels.js';
import { transitionVideo } from '../db/status.js';

export const ClipManifest = z.object({
  /** The stick-ai-shorts id, e.g. "be005" or "ep001". */
  source: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(['reel', 'show']),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(4000),
  hashtags: z.array(z.string().trim().min(1)).max(15),
  lines: z.array(z.object({ speaker: z.string().optional(), text: z.string().trim().min(1) })).min(1),
});
export type ClipManifest = z.infer<typeof ClipManifest>;

/**
 * Videos whose scripts Thomas approved in chat before this tab existed (2026-11-06). Only these
 * may arrive at gate 2 without passing gate 1 here. Every new id starts at script review.
 */
export const APPROVED_BEFORE_TAB: readonly string[] = ['ep001', 'ep002', 'be002-fenrir', 'be003', 'be004', 'be005', 'be006', 'be007', 'be008', 'be009'];

export class ClipImportError extends Error {}

const latestLines = (db: Database.Database, id: number): string | null => {
  const row = db.prepare('SELECT body_json FROM scripts WHERE video_id = ? ORDER BY version DESC LIMIT 1').get(id) as { body_json: string } | undefined;
  return row ? JSON.stringify((JSON.parse(row.body_json) as { lines: unknown }).lines) : null;
};

function saveScript(db: Database.Database, id: number, m: ClipManifest) {
  const { v } = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM scripts WHERE video_id = ?').get(id) as { v: number };
  const words = m.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  db.prepare("INSERT INTO scripts (video_id, version, hook, body_json, word_count, created_by) VALUES (?, ?, ?, ?, ?, 'stick-ai-shorts')").run(
    id,
    v + 1,
    m.lines[0]!.text,
    JSON.stringify({ kind: m.kind, lines: m.lines }),
    words,
  );
  db.prepare("UPDATE videos SET title = ?, description = ?, hashtags = ?, playlist = ?, updated_at = datetime('now') WHERE id = ?").run(
    m.title,
    m.description,
    JSON.stringify(m.hashtags),
    CLIPS.playlists[m.kind].title,
    id,
  );
}

const newest = (db: Database.Database, source: string) =>
  db.prepare("SELECT id, status FROM videos WHERE channel = ? AND topic = ? AND status != 'rejected' ORDER BY id DESC LIMIT 1").get(CLIPS.key, source) as
    | { id: number; status: string }
    | undefined;

/** Gate 1: a new script, or a revision after Thomas asked for changes. */
export function importScript(db: Database.Database, raw: unknown): { video_id: number; status: string } {
  const m = ClipManifest.parse(raw);
  return db.transaction(() => {
    const row = newest(db, m.source);
    if (!row) {
      const id = Number(db.prepare('INSERT INTO videos (topic, channel) VALUES (?, ?)').run(m.source, CLIPS.key).lastInsertRowid);
      saveScript(db, id, m);
      transitionVideo(db, id, 'scripted');
      transitionVideo(db, id, 'script_review');
      return { video_id: id, status: 'script_review' };
    }
    if (row.status === 'script_changes') {
      saveScript(db, row.id, m);
      transitionVideo(db, row.id, 'scripted');
      transitionVideo(db, row.id, 'script_review');
    } else if (row.status === 'video_changes') {
      saveScript(db, row.id, m);
      transitionVideo(db, row.id, 'script_review');
    } else {
      throw new ClipImportError(`${m.source} is already video ${row.id} (${row.status}), and nobody asked for changes`);
    }
    return { video_id: row.id, status: 'script_review' };
  })();
}

/** Gate 2: the finished MP4, for a script Thomas already approved. */
export function importVideo(
  db: Database.Database,
  raw: unknown,
  opts: { file: string; durationS: number | null; runsRoot: string },
): { video_id: number; status: string } {
  const m = ClipManifest.parse(raw);
  if (!existsSync(opts.file)) throw new ClipImportError(`no video at ${opts.file}`);
  return db.transaction(() => {
    const row = newest(db, m.source);
    let id: number;
    if (!row) {
      if (!APPROVED_BEFORE_TAB.includes(m.source)) throw new ClipImportError(`${m.source} needs its script approved in the review site first (import it with --stage script)`);
      // Its gate 1 happened in chat, so it starts where a render ends. The next step is still Thomas's gate 2.
      id = Number(db.prepare("INSERT INTO videos (topic, channel, status) VALUES (?, ?, 'rendered')").run(m.source, CLIPS.key).lastInsertRowid);
      saveScript(db, id, m);
      db.prepare("INSERT INTO reviews (video_id, decision, notes, gate) VALUES (?, 'approved', 'Script approved in chat before the Curious Clips tab existed.', 'script')").run(id);
    } else if (row.status === 'script_approved') {
      id = row.id;
      if (latestLines(db, id) !== JSON.stringify(m.lines)) throw new ClipImportError(`${m.source}'s lines differ from the script Thomas approved; import the new script for review instead`);
      transitionVideo(db, id, 'rendering');
      transitionVideo(db, id, 'rendered');
    } else {
      throw new ClipImportError(`${m.source} is video ${row.id} (${row.status}); a video can only come in after its script is approved`);
    }
    const dir = resolve(opts.runsRoot, String(id));
    mkdirSync(dir, { recursive: true });
    const finalPath = resolve(dir, 'final.mp4');
    copyFileSync(opts.file, finalPath);
    db.prepare('UPDATE videos SET run_dir = ?, final_path = ?, duration_s = ? WHERE id = ?').run(dir, finalPath, opts.durationS, id);
    transitionVideo(db, id, 'video_review');
    return { video_id: id, status: 'video_review' };
  })();
}
