import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LockedError, acquireLock } from '../../src/automation/lock.js';

let path: string;
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'lp-lock-')), 'run.lock');
});

const HOUR = 3600_000;

describe('acquireLock', () => {
  it('creates the lock with our pid and releases it', () => {
    const release = acquireLock(path, { staleMs: 2 * HOUR });
    expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid);
    release();
    expect(existsSync(path)).toBe(false);
    release(); // idempotent
  });

  it('a second run is refused while the first is alive', () => {
    const release = acquireLock(path, { staleMs: 2 * HOUR });
    expect(() => acquireLock(path, { staleMs: 2 * HOUR })).toThrow(LockedError);
    release();
    expect(() => acquireLock(path, { staleMs: 2 * HOUR })()).not.toThrow();
  });

  it('takes over a lock whose process is gone', () => {
    writeFileSync(path, JSON.stringify({ pid: 999999, started: new Date().toISOString() }));
    const release = acquireLock(path, { staleMs: 2 * HOUR, isAlive: () => false });
    expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid);
    release();
  });

  it('takes over a stale lock even if the pid looks alive (hung run)', () => {
    writeFileSync(path, JSON.stringify({ pid: 1234, started: '2026-09-27T00:00:00Z' }));
    const now = () => new Date('2026-09-27T03:00:00Z');
    expect(() => acquireLock(path, { staleMs: 2 * HOUR, now, isAlive: () => true })).not.toThrow();
  });

  it('keeps a fresh lock held by a live process', () => {
    writeFileSync(path, JSON.stringify({ pid: 1234, started: '2026-09-27T02:00:00Z' }));
    const now = () => new Date('2026-09-27T03:00:00Z');
    expect(() => acquireLock(path, { staleMs: 2 * HOUR, now, isAlive: () => true })).toThrow(/pid 1234/);
  });

  it('treats an unreadable lock file as stale', () => {
    writeFileSync(path, 'garbage');
    expect(() => acquireLock(path, { staleMs: 2 * HOUR })).not.toThrow();
  });
});
