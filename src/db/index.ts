import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_DB_PATH = resolve(PROJECT_ROOT, 'data/launchpad.db');

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Open (and create if needed) the SQLite DB. Pass ':memory:' in tests. */
export function openDb(path: string = process.env.LAUNCHPAD_DB ?? DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * Additive migrations for DBs created before a column existed. schema.sql
 * always has the latest shape; this only patches older files. Keep it additive.
 */
function migrate(db: Database.Database) {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  addColumn('sources', 'ref', 'TEXT');
  addColumn('videos', 'description', 'TEXT');
  addColumn('videos', 'hashtags', 'TEXT');
  addColumn('videos', 'do_not_post', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('videos', 'do_not_post_reason', 'TEXT');
  addColumn('videos', 'playlist', 'TEXT');
  // Second channel (2026-10-07): every older video was made for Blast of Facts.
  addColumn('videos', 'channel', "TEXT NOT NULL DEFAULT 'blast' CHECK (channel IN ('blast','wonder'))");
  addColumn('automation_runs', 'channel', "TEXT NOT NULL DEFAULT 'blast'");
  addColumn('posts', 'visibility', "TEXT NOT NULL DEFAULT 'public'");
  addColumn('posts', 'playlist_id', 'TEXT');
  // Custom thumbnail: 'set' or 'failed' (with a note); NULL = not tried yet.
  addColumn('posts', 'thumbnail', 'TEXT');
  addColumn('posts', 'thumbnail_note', 'TEXT');
  addColumn('posts', 'thumbnail_at', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_ref ON sources(video_id, ref)');
}
