/** Entry for @hono/vite-dev-server: the real DB and runs/ (overridable via LAUNCHPAD_DB / LAUNCHPAD_RUNS). */
import { openDb } from '../../src/db/index.js';
import { RUNS_ROOT } from '../../src/cli/_lib.js';
import { createApp } from './app.js';

export default createApp({ db: openDb(), runsRoot: RUNS_ROOT });
