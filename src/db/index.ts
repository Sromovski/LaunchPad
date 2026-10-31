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
  // (Its CHECK is widened by rebuildVideosIfChecksChanged below.)
  addColumn('videos', 'channel', "TEXT NOT NULL DEFAULT 'blast' CHECK (channel IN ('blast','wonder'))");
  addColumn('automation_runs', 'channel', "TEXT NOT NULL DEFAULT 'blast'");
  addColumn('posts', 'visibility', "TEXT NOT NULL DEFAULT 'public'");
  addColumn('posts', 'playlist_id', 'TEXT');
  // Custom thumbnail: 'set' or 'failed' (with a note); NULL = not tried yet.
  addColumn('posts', 'thumbnail', 'TEXT');
  addColumn('posts', 'thumbnail_note', 'TEXT');
  addColumn('posts', 'thumbnail_at', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_ref ON sources(video_id, ref)');
  // Pocket Fables (2026-10-31): scripts carry scenes, reviews say which gate.
  addColumn('scripts', 'scenes_json', 'TEXT CHECK (scenes_json IS NULL OR json_valid(scenes_json))');
  addColumn('scripts', 'lane', "TEXT CHECK (lane IS NULL OR lane IN ('folktale','bedtime','lesson'))");
  addColumn('scripts', 'origin', 'TEXT');
  addColumn('reviews', 'gate', "TEXT NOT NULL DEFAULT 'video' CHECK (gate IN ('script','video'))");
  rebuildVideosIfChecksChanged(db);
}

/** The `CREATE TABLE ... videos (...)` statement from schema.sql, the one source of truth for its shape. */
const VIDEOS_DDL = (() => {
  const m = /CREATE TABLE IF NOT EXISTS videos \([\s\S]*?\n\);/.exec(SCHEMA);
  if (!m) throw new Error('schema.sql: videos table not found');
  return m[0];
})();

/**
 * SQLite can't ALTER a CHECK constraint, so when schema.sql allows a status or channel
 * the file's `videos` table doesn't (first time: Pocket Fables), rebuild the table the
 * way SQLite documents (create new, copy, drop, rename) in one transaction.
 * Ids, the AUTOINCREMENT counter and every child row (reviews, assets, posts…) are kept.
 */
function rebuildVideosIfChecksChanged(db: Database.Database) {
  const literals = (sql: string) => new Set([...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  const current = () => (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'videos'").get() as { sql: string }).sql;
  const wanted = literals(VIDEOS_DDL);
  const isStale = () => {
    const have = literals(current());
    return [...wanted].some((w) => !have.has(w));
  };
  if (!isStale()) return;

  // Must be off outside the transaction, or dropping `videos` would cascade-delete every child row.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (!isStale()) return; // another process rebuilt it while we waited for the lock
      const seq = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'videos'").get() as { seq: number } | undefined)?.seq ?? 0;
      const oldCols = (db.prepare('PRAGMA table_info(videos)').all() as { name: string }[]).map((c) => c.name);
      db.exec(VIDEOS_DDL.replace('CREATE TABLE IF NOT EXISTS videos (', 'CREATE TABLE videos_new ('));
      const newCols = new Set((db.prepare('PRAGMA table_info(videos_new)').all() as { name: string }[]).map((c) => c.name));
      const cols = oldCols.filter((c) => newCols.has(c)).join(', ');
      db.exec(`INSERT INTO videos_new (${cols}) SELECT ${cols} FROM videos`);
      db.exec('DROP TABLE videos');
      db.exec('ALTER TABLE videos_new RENAME TO videos');
      db.exec('CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status)');
      // Keep the id counter: a deleted newest video's id (and its runs/<id>/ folder) must never be reused.
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'videos'").run();
      const maxId = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM videos').get() as { m: number }).m;
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('videos', ?)").run(Math.max(seq, maxId));
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length > 0) throw new Error(`videos rebuild broke ${broken.length} foreign key(s); rolled back`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
