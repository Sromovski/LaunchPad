import { resolve } from 'node:path';
import devServer from '@hono/vite-dev-server';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname);
// Browsers resolve any *.localhost name to this PC, so http://launchpad.localhost needs no hosts-file edit.
// Port 80 hides the port in the URL; tests pass REVIEW_PORT to use another one.
const port = Number(process.env.REVIEW_PORT ?? 80);
export const REVIEW_URL = `http://launchpad.localhost${port === 80 ? '' : `:${port}`}/`;

export default defineConfig({
  root,
  plugins: [
    react(),
    tailwindcss(),
    // Hono API runs inside the Vite dev server: one command, one port. Only /api and /media reach it.
    devServer({ entry: resolve(root, 'server/index.ts'), exclude: [/^\/(?!api\/|media\/).*/], injectClientScript: false }),
  ],
  server: {
    host: '127.0.0.1', // local only (§9: no auth)
    port,
    strictPort: true,
    allowedHosts: ['launchpad.localhost', 'localhost', '127.0.0.1'],
    open: process.env.REVIEW_PORT ? false : REVIEW_URL,
    fs: { allow: [resolve(root, '..')] }, // fonts live in ../assets/fonts
  },
});
