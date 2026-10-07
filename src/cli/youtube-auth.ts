/**
 * npm run youtube:auth [-- --channel blast|wonder] — one-time sign-in per channel (Thomas only; denied to agents).
 * Opens Google's consent page; pick that channel. Saves a refresh token to the channel's
 * token file in data/google/ (gitignored) only if the chosen channel is right.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import { channelByKey } from '../channels.js';
import { CLIENT_SECRET_PATH, GOOGLE_DIR, SCOPES, isOurChannel } from '../publish/config.js';
import { accessTokenProvider, buildAuthUrl, exchangeCode, parseClientSecret, pkce, type StoredToken } from '../publish/google-auth.js';
import { YouTube } from '../publish/youtube-api.js';

const target = channelByKey(parseArgs({ options: { channel: { type: 'string' } } }).values.channel);
const CHANNEL_TITLE = target.title;
const CHANNEL_ID = target.youtubeId;
const TOKEN_PATH = target.tokenFile;
const AUTH_CMD = `npm run youtube:auth${target.key === 'blast' ? '' : ` -- --channel ${target.key}`}`;

if (!existsSync(CLIENT_SECRET_PATH)) {
  console.error(`Missing ${CLIENT_SECRET_PATH}. Download the Desktop app OAuth client JSON from Google Cloud and save it there.`);
  process.exit(1);
}
const secret = parseClientSecret(JSON.parse(readFileSync(CLIENT_SECRET_PATH, 'utf8')));
const { verifier, challenge } = pkce();
const state = randomBytes(16).toString('hex');

const server = createServer();
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const url = buildAuthUrl({ clientId: secret.client_id, redirectUri, scopes: SCOPES, challenge, state });

const code = await new Promise<string>((resolveCode, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out after 5 minutes waiting for Google sign-in')), 5 * 60_000);
  server.on('request', (req, res) => {
    const u = new URL(req.url ?? '/', redirectUri);
    const c = u.searchParams.get('code');
    const err = u.searchParams.get('error');
    if (!c && !err) {
      res.writeHead(404).end();
      return;
    }
    const ok = !!c && u.searchParams.get('state') === state;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      `<h2 style="font-family:sans-serif">${ok ? 'Signed in. You can close this tab and go back to the terminal.' : `Sign-in failed: ${err ?? 'state mismatch'}`}</h2>`,
    );
    clearTimeout(timer);
    if (ok) resolveCode(c!);
    else reject(new Error(`Google sign-in failed: ${err ?? 'state mismatch'}`));
  });
  console.log(`\nOpening Google sign-in. Pick the "${CHANNEL_TITLE}" channel when asked.\nIf no browser opens, paste this URL:\n\n${url}\n`);
  // rundll32 opens the default browser and copes with & in URLs (cmd's "start" does not).
  if (process.platform === 'win32') spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
});
server.close();

const tokens = await exchangeCode(fetch, secret, code, verifier, redirectUri);
const yt = new YouTube(fetch, accessTokenProvider(fetch, secret, tokens.refresh_token));
let channel: { id: string; title: string };
try {
  channel = await yt.channel();
} catch (e) {
  // Common mistake: picking a Google *account* named like the channel instead of the Brand Account channel itself.
  console.error(`\n${(e as Error).message}. Nothing was saved.\nPick the Google account that OWNS the channel (sromovski@gmail.com), then pick "${CHANNEL_TITLE}" from the brand accounts / channels list, and run ${AUTH_CMD} again.`);
  process.exit(1);
}
if (!isOurChannel(channel, CHANNEL_ID)) {
  console.error(`\nYou picked the channel "${channel.title}" (${channel.id}). Nothing was saved. Run ${AUTH_CMD} again and pick "${CHANNEL_TITLE}" (${CHANNEL_ID}).`);
  process.exit(1);
}
mkdirSync(GOOGLE_DIR, { recursive: true });
const stored: StoredToken = { refresh_token: tokens.refresh_token, scope: tokens.scope, channel_id: channel.id, channel_title: channel.title, created_at: new Date().toISOString() };
writeFileSync(TOKEN_PATH, JSON.stringify(stored, null, 2));
console.log(JSON.stringify({ ok: true, channel: channel.title, channel_id: channel.id, saved: TOKEN_PATH }, null, 2));
