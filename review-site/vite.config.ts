import { resolve } from 'node:path';
import devServer from '@hono/vite-dev-server';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname);

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
    port: Number(process.env.REVIEW_PORT ?? 5173),
    strictPort: true,
    fs: { allow: [resolve(root, '..')] }, // fonts live in ../assets/fonts
  },
});
