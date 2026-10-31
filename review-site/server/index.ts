/** Entry for @hono/vite-dev-server: the real DB and runs/ (overridable via LAUNCHPAD_DB / LAUNCHPAD_RUNS). */
import { openDb } from '../../src/db/index.js';
import { RUNS_ROOT } from '../../src/cli/_lib.js';
import { FABLES } from '../../src/channels.js';
import { youtubeFor } from '../../src/publish/client.js';
import { createApp } from './app.js';

// A test DB (Playwright sets LAUNCHPAD_DB) must never upload to the real Pocket Fables channel.
const fablesYoutube = process.env.LAUNCHPAD_DB ? undefined : () => youtubeFor(FABLES);

export default createApp({ db: openDb(), runsRoot: RUNS_ROOT, youtubeFor, fablesYoutube });
