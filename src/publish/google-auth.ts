/**
 * Google OAuth for an installed (desktop) app: loopback redirect + PKCE, offline
 * access so a refresh token lets scheduled runs post without anyone signing in.
 * Plain fetch, no Google SDK.
 */
import { createHash, randomBytes } from 'node:crypto';

export type FetchFn = typeof fetch;

export interface ClientSecret {
  client_id: string;
  client_secret: string;
  token_uri: string;
}

export interface StoredToken {
  refresh_token: string;
  scope: string;
  channel_id: string;
  channel_title: string;
  created_at: string;
}

const AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** The JSON Google gives you for a *Desktop app* OAuth client ({ "installed": {...} }). */
export function parseClientSecret(json: unknown): ClientSecret {
  const j = json as { installed?: Partial<ClientSecret>; web?: unknown };
  if (j.web) throw new Error('this is a "Web application" client; create a "Desktop app" OAuth client instead');
  const i = j.installed;
  if (!i?.client_id || !i.client_secret) throw new Error('client_secret.json is missing installed.client_id / client_secret');
  return { client_id: i.client_id, client_secret: i.client_secret, token_uri: i.token_uri ?? TOKEN_URI };
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; scopes: string[]; challenge: string; state: string }): string {
  const u = new URL(AUTH_URI);
  u.searchParams.set('client_id', o.clientId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', o.scopes.join(' '));
  u.searchParams.set('access_type', 'offline'); // → refresh token
  u.searchParams.set('prompt', 'consent select_account'); // always re-show the channel picker
  u.searchParams.set('code_challenge', o.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', o.state);
  return u.toString();
}

async function tokenCall(fetchFn: FetchFn, uri: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetchFn(uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${String(body.error_description ?? body.error ?? 'unknown')}`);
  return body;
}

export async function exchangeCode(fetchFn: FetchFn, secret: ClientSecret, code: string, verifier: string, redirectUri: string) {
  const b = await tokenCall(fetchFn, secret.token_uri, {
    code,
    client_id: secret.client_id,
    client_secret: secret.client_secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (typeof b.refresh_token !== 'string') throw new Error('Google returned no refresh token (sign in again; offline access is required)');
  return { access_token: String(b.access_token), refresh_token: b.refresh_token, scope: String(b.scope ?? '') };
}

/** Access tokens last ~1 h; this refreshes on demand and caches until shortly before expiry. */
export function accessTokenProvider(fetchFn: FetchFn, secret: ClientSecret, refreshToken: string, now = () => Date.now()) {
  let cached: { token: string; expires: number } | null = null;
  return async (): Promise<string> => {
    if (cached && now() < cached.expires - 60_000) return cached.token;
    const b = await tokenCall(fetchFn, secret.token_uri, {
      client_id: secret.client_id,
      client_secret: secret.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    cached = { token: String(b.access_token), expires: now() + Number(b.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}
