/**
 * Shared plumbing for pipeline CLI scripts: argument parsing, the run dir,
 * per-step log files, and the "JSON summary on stdout" convention (§6).
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import type Database from 'better-sqlite3';
import { PROJECT_ROOT, openDb } from '../db/index.js';

/** Overridable so tests (e.g. Playwright) can point at a throwaway folder. */
export const RUNS_ROOT = process.env.LAUNCHPAD_RUNS ? resolve(process.env.LAUNCHPAD_RUNS) : resolve(PROJECT_ROOT, 'runs');

export function runDir(videoId: number): string {
  const dir = resolve(RUNS_ROOT, String(videoId));
  mkdirSync(resolve(dir, 'logs'), { recursive: true });
  return dir;
}

export function runPath(videoId: number, ...parts: string[]): string {
  return resolve(runDir(videoId), ...parts);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type Logger = (msg: string) => void;

/** Appends timestamped lines to runs/<id>/logs/<step>.log (and stderr, so stdout stays pure JSON). */
export function logger(videoId: number | null, step: string): Logger {
  const file = videoId === null ? null : resolve(runDir(videoId), 'logs', `${step}.log`);
  return (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    if (file) appendFileSync(file, line + '\n');
    process.stderr.write(line + '\n');
  };
}

export function args<T extends NonNullable<ParseArgsConfig['options']>>(options: T) {
  return parseArgs({ options, strict: true, allowPositionals: false }).values;
}

export function requireVideoId(v: string | boolean | undefined): number {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new Error('--video <id> is required');
  return id;
}

export interface VideoRow {
  id: number;
  topic: string;
  status: string;
  title: string | null;
  run_dir: string | null;
  final_path: string | null;
  duration_s: number | null;
}

export function getVideo(db: Database.Database, id: number): VideoRow {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined;
  if (!row) throw new Error(`Video ${id} not found`);
  return row;
}

/**
 * Wraps a CLI entry point: opens the DB, prints the returned summary as JSON,
 * and turns any thrown error into `{ ok: false, error }` + exit code 1.
 */
export async function main(fn: (db: Database.Database) => Promise<object> | object): Promise<void> {
  const db = openDb();
  try {
    const summary = await fn(db);
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
