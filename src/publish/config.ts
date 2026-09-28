/** Phase 4 posting settings (Thomas, 2026-09-27). */
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';

export const CHANNEL_TITLE = 'Blast of Facts';
/** The channel's permanent ID (names can change or differ in capitals; IDs never do). */
export const CHANNEL_ID = 'UCHhHYjq4K0sERPPR2od5kRw';

/** Is this the Blast of Facts channel? Checked by ID only: names can differ in capitals or be renamed. */
export function isOurChannel(c: { id: string; title: string }, expectedId = CHANNEL_ID): boolean {
  return c.id === expectedId;
}
export const PLAYLIST_TITLE = 'Mars Facts for Kids';
export const PLAYLIST_DESCRIPTION = 'Short, true answers to big Mars questions, made with real NASA pictures and sounds. Narration voice is AI-generated.';
/** YouTube category 27 = Education. */
export const CATEGORY_ID = '27';
/** Upload + playlists. youtube.upload alone can't add to playlists (Thomas chose full automation). */
export const SCOPES = ['https://www.googleapis.com/auth/youtube'];
export const POST_TIME = '16:00';

export const GOOGLE_DIR = resolve(PROJECT_ROOT, 'data/google'); // gitignored; agents can't write data/
export const CLIENT_SECRET_PATH = resolve(GOOGLE_DIR, 'client_secret.json');
export const TOKEN_PATH = resolve(GOOGLE_DIR, 'token.json');
