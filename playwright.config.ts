import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 5199; // not 5173, so a running review site is never touched
const TMP = resolve(import.meta.dirname, 'tests/e2e/.tmp');

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1, // tests share one seeded DB and change it
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    // Seed a throwaway DB, then serve the site against it.
    command: 'npx tsx tests/e2e/seed.ts && npx vite --config review-site/vite.config.ts',
    url: `http://127.0.0.1:${PORT}/api/videos`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { REVIEW_PORT: String(PORT), LAUNCHPAD_DB: resolve(TMP, 'e2e.db'), LAUNCHPAD_RUNS: resolve(TMP, 'runs') },
  },
});
