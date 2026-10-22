/**
 * npm run publish [-- --channel blast|wonder] [--dry-run]
 * Posts at most one approved video to one channel (no --channel = Blast of Facts; see src/publish/publisher.ts).
 * Scheduled at each channel's postTimes by `npm run schedule:install`. Thomas only; denied to agents.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { channelByKey } from '../channels.js';
import { PROJECT_ROOT } from '../db/index.js';
import { LockedError, acquireLock } from '../automation/lock.js';
import { youtubeFor } from '../publish/client.js';
import { publishNext } from '../publish/publisher.js';
import { snapshotStats } from '../publish/stats.js';
import { THUMB_VERTICAL, makeThumbnails } from '../export/thumbnail.js';
import { RUNS_ROOT, args, main, runDir } from './_lib.js';

const a = args({ channel: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, trigger: { type: 'string', default: 'manual' } });
const channel = channelByKey(a.channel);
const LOG_DIR = resolve(RUNS_ROOT, '_publish');
mkdirSync(LOG_DIR, { recursive: true });
const logFile = resolve(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
const log = (m: string) => {
  const line = `[${new Date().toISOString()}] (${a.trigger}, ${channel.key}) ${m}`;
  appendFileSync(logFile, line + '\n');
  process.stderr.write(line + '\n');
};

await main(async (db) => {
  let release: (() => void) | undefined;
  try {
    release = acquireLock(resolve(PROJECT_ROOT, 'data/publish.lock'), { staleMs: 60 * 60_000, note: 'publish' });
  } catch (e) {
    if (e instanceof LockedError) return { outcome: 'locked', note: e.message };
    throw e;
  }
  try {
    if (a['dry-run']) {
      // Dry run needs no Google login: it only shows what would be posted next.
      const r = await publishNext({ channel, db, yt: null as never, runsRoot: RUNS_ROOT, pendingDir: LOG_DIR, log }, { dryRun: true });
      return r;
    }
    const yt = youtubeFor(channel);
    if (!yt) {
      // Scheduled before Google setup is done: skip quietly instead of failing every day.
      const auth = `npm run youtube:auth${channel.key === 'blast' ? '' : ` -- --channel ${channel.key}`}`;
      log(`${channel.title} not connected yet (no ${relative(PROJECT_ROOT, channel.tokenFile)}): save data/google/client_secret.json, then run ${auth}`);
      return { outcome: 'not_connected', channel: channel.key };
    }
    // The same 9:16 title thumbnail as the hand-posting export, kept in runs/<id>/thumbnail/.
    const thumbnail = (videoId: number, title: string) => {
      const outDir = resolve(runDir(videoId), 'thumbnail');
      mkdirSync(outDir, { recursive: true });
      const [file] = makeThumbnails(db, { videoId, title, runDir: runDir(videoId), outDir, variants: [THUMB_VERTICAL] });
      return readFileSync(file!);
    };
    const r = await publishNext({ channel, db, yt, runsRoot: RUNS_ROOT, pendingDir: LOG_DIR, log, thumbnail });
    log(`result: ${JSON.stringify(r)}`);
    // Views page: today's counts ride along with every posting run. Never fails the post.
    try {
      const s = await snapshotStats(db, channel.key, yt);
      log(`stats: ${s.views} views, ${s.subscribers ?? 'hidden'} subscribers, ${s.videos_tracked} videos`);
    } catch (e) {
      log(`stats snapshot failed (views page keeps the last one): ${(e as Error).message}`);
    }
    return r;
  } catch (e) {
    log(`FAILED: ${(e as Error).message}`);
    throw e;
  } finally {
    release?.();
  }
});
