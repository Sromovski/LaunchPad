/**
 * npm run publish [-- --dry-run]
 * Posts at most one approved video to Blast of Facts (see src/publish/publisher.ts).
 * Scheduled daily at 16:00 by `npm run schedule:install`. Thomas only; denied to agents.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { LockedError, acquireLock } from '../automation/lock.js';
import { CLIENT_SECRET_PATH, TOKEN_PATH } from '../publish/config.js';
import { accessTokenProvider, parseClientSecret, type StoredToken } from '../publish/google-auth.js';
import { publishNext } from '../publish/publisher.js';
import { YouTube } from '../publish/youtube-api.js';
import { RUNS_ROOT, args, main } from './_lib.js';

const a = args({ 'dry-run': { type: 'boolean', default: false }, trigger: { type: 'string', default: 'manual' } });
const LOG_DIR = resolve(RUNS_ROOT, '_publish');
mkdirSync(LOG_DIR, { recursive: true });
const logFile = resolve(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
const log = (m: string) => {
  const line = `[${new Date().toISOString()}] (${a.trigger}) ${m}`;
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
      const r = await publishNext({ db, yt: null as never, runsRoot: RUNS_ROOT, pendingDir: LOG_DIR, log }, { dryRun: true });
      return r;
    }
    if (!existsSync(CLIENT_SECRET_PATH) || !existsSync(TOKEN_PATH)) {
      // Scheduled before Google setup is done: skip quietly instead of failing every day.
      log('not connected yet: save data/google/client_secret.json, then run npm run youtube:auth');
      return { outcome: 'not_connected' };
    }
    const secret = parseClientSecret(JSON.parse(readFileSync(CLIENT_SECRET_PATH, 'utf8')));
    const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8')) as StoredToken;
    const yt = new YouTube(fetch, accessTokenProvider(fetch, secret, token.refresh_token));
    const r = await publishNext({ db, yt, runsRoot: RUNS_ROOT, pendingDir: LOG_DIR, log }, { expectedChannelId: token.channel_id });
    log(`result: ${JSON.stringify(r)}`);
    return r;
  } catch (e) {
    log(`FAILED: ${(e as Error).message}`);
    throw e;
  } finally {
    release?.();
  }
});
