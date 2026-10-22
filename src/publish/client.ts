/** A signed-in YouTube client for one channel, or null before `npm run youtube:auth` was done for it. */
import { existsSync, readFileSync } from 'node:fs';
import type { Channel } from '../channels.js';
import { CLIENT_SECRET_PATH } from './config.js';
import { accessTokenProvider, parseClientSecret, type StoredToken } from './google-auth.js';
import { YouTube } from './youtube-api.js';

export function youtubeFor(channel: Channel): YouTube | null {
  if (!existsSync(CLIENT_SECRET_PATH) || !existsSync(channel.tokenFile)) return null;
  const secret = parseClientSecret(JSON.parse(readFileSync(CLIENT_SECRET_PATH, 'utf8')));
  const token = JSON.parse(readFileSync(channel.tokenFile, 'utf8')) as StoredToken;
  return new YouTube(fetch, accessTokenProvider(fetch, secret, token.refresh_token));
}
