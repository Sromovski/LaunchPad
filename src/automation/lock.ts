/**
 * Single-run lockfile (CLAUDE.md §10: two runs must never overlap).
 * Created atomically with the 'wx' flag. A lock is taken over only if its
 * process is gone or it is older than `staleMs` (a hung run that was killed).
 */
import { mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

export class LockedError extends Error {
  constructor(public holder: LockInfo) {
    super(`another run holds the lock (pid ${holder.pid}, since ${holder.started})`);
    this.name = 'LockedError';
  }
}

export interface LockInfo {
  pid: number;
  started: string;
  note?: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // exists but not ours
  }
}

export function acquireLock(
  path: string,
  opts: { staleMs: number; note?: string; now?: () => Date; isAlive?: (pid: number) => boolean } = { staleMs: 2 * 3600_000 },
): () => void {
  const now = opts.now ?? (() => new Date());
  const isAlive = opts.isAlive ?? alive;
  mkdirSync(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      const info: LockInfo = { pid: process.pid, started: now().toISOString(), note: opts.note };
      writeSync(fd, JSON.stringify(info));
      closeSync(fd);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        rmSync(path, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let holder: LockInfo;
      try {
        holder = JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
      } catch {
        holder = { pid: -1, started: new Date(0).toISOString() }; // unreadable → treat as stale
      }
      const age = now().getTime() - new Date(holder.started).getTime();
      if (attempt === 0 && (!isAlive(holder.pid) || age > opts.staleMs)) {
        rmSync(path, { force: true });
        continue;
      }
      throw new LockedError(holder);
    }
  }
  throw new Error('could not acquire lock');
}
