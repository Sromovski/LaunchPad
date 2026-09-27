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
  return db;
}
