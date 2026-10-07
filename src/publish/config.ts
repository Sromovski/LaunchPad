/**
 * Phase 4 posting settings shared by every channel (Thomas, 2026-09-27).
 * Per-channel settings (channel ID, login file, playlists, times) are in src/channels.ts.
 */
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';

/** Is this the expected channel? Checked by ID only: names can differ in capitals or be renamed. */
export function isOurChannel(c: { id: string; title: string }, expectedId: string): boolean {
  return c.id === expectedId;
}
/** YouTube category 27 = Education. */
export const CATEGORY_ID = '27';
/** Upload + playlists. youtube.upload alone can't add to playlists (Thomas chose full automation). */
export const SCOPES = ['https://www.googleapis.com/auth/youtube'];

/** One Google Cloud project and OAuth client posts to every channel; each channel has its own token file. */
export const GOOGLE_DIR = resolve(PROJECT_ROOT, 'data/google'); // gitignored; agents can't write data/
export const CLIENT_SECRET_PATH = resolve(GOOGLE_DIR, 'client_secret.json');
