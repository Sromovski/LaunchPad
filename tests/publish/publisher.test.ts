import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { accessTokenProvider, buildAuthUrl, parseClientSecret, pkce } from '../../src/publish/google-auth.js';
import { buildMetadata, publishNext } from '../../src/publish/publisher.js';
import { holdVideo } from '../../src/publish/queue.js';
import { YouTube } from '../../src/publish/youtube-api.js';
import { fakeGoogle, type FakeOptions } from './fake-youtube.js';

const SECRET = { client_id: 'cid', client_secret: 'csecret', token_uri: 'https://oauth2.googleapis.com/token' };
let db: Database.Database;
let runsRoot: string;
let pendingDir: string;

function approved(title: string, approvedAt: string) {
  const id = Number(
    db
      .prepare("INSERT INTO videos (topic, status, title, description, hashtags) VALUES ('t', 'approved', ?, ?, ?)")
      .run(title, 'Credits: NASA/JPL-Caltech\nNarration voice is AI-generated.', JSON.stringify(['#Mars', '#Space', '#ScienceForKids'])).lastInsertRowid,
  );
  db.prepare("INSERT INTO reviews (video_id, decision, created_at) VALUES (?, 'approved', ?)").run(id, approvedAt);
  mkdirSync(join(runsRoot, String(id)), { recursive: true });
  writeFileSync(join(runsRoot, String(id), 'final.mp4'), Buffer.from('fake mp4 bytes'));
  return id;
}

function setup(o: FakeOptions = {}) {
  const g = fakeGoogle(o);
  const yt = new YouTube(g.fetchFn, accessTokenProvider(g.fetchFn, SECRET, 'REFRESH'));
  const logs: string[] = [];
  return { g, deps: { db, yt, runsRoot, pendingDir, log: (m: string) => logs.push(m) }, logs };
}

beforeEach(() => {
  db = openDb(':memory:');
  runsRoot = mkdtempSync(join(tmpdir(), 'lp-pub-runs-'));
  pendingDir = mkdtempSync(join(tmpdir(), 'lp-pub-pending-'));
});

describe('auth helpers', () => {
  it('accepts only a Desktop app client secret', () => {
    expect(parseClientSecret({ installed: { client_id: 'a', client_secret: 'b' } })).toMatchObject({ client_id: 'a' });
    expect(() => parseClientSecret({ web: { client_id: 'a' } })).toThrow(/Desktop app/);
    expect(() => parseClientSecret({})).toThrow();
  });

  it('auth URL asks for offline access, PKCE and the channel picker', () => {
    const { challenge } = pkce();
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', scopes: ['https://www.googleapis.com/auth/youtube'], challenge, state: 's' }));
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('prompt')).toContain('select_account');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube');
  });

  it('refreshes once and caches the access token', async () => {
    const g = fakeGoogle();
    const get = accessTokenProvider(g.fetchFn, SECRET, 'REFRESH');
    expect(await get()).toBe('ACCESS');
    await get();
    expect(g.calls.filter((c) => c.url.includes('oauth2')).length).toBe(1);
  });
});

describe('buildMetadata', () => {
  it('made for kids, public, Education, hashtags as tags, no < or >', () => {
    const m = buildMetadata({ id: 1, title: 'Why <Mars> Red?', topic: 't', description: 'Hi\nNarration voice is AI-generated.', hashtags: '["#Mars","#Space"]', approved_at: null });
    expect(m.status).toEqual({ privacyStatus: 'public', selfDeclaredMadeForKids: true, embeddable: true });
    expect(m.snippet).toMatchObject({ title: 'Why Mars Red?', categoryId: '27', tags: ['Mars', 'Space'] });
    expect(m.snippet.description).toBe('Hi\nNarration voice is AI-generated.\n\n#Mars #Space\n');
  });
});

describe('publishNext', () => {
  it('uploads the oldest approved video, records it, and adds it to the playlist', async () => {
    const first = approved('Why Are Sunsets on Mars Blue?', '2026-09-27 10:00:00');
    approved('Later', '2026-09-27 11:00:00');
    const { g, deps } = setup();
    const r = await publishNext(deps);
    expect(r).toMatchObject({ outcome: 'posted', video_id: first, visibility: 'public', playlist: 'added' });
    expect(g.uploads()).toBe(1); // one video per run, never more
    expect(g.playlistItems).toEqual([{ playlistId: 'PLmars', videoId: 'VIDEO000001' }]);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(first)).toEqual({ status: 'published' });
    expect(db.prepare('SELECT method, visibility, playlist_id FROM posts').get()).toEqual({ method: 'api', visibility: 'public', playlist_id: 'PLmars' });
    const upload = g.calls.find((c) => c.url.includes('uploadType=resumable'))!;
    expect((upload.body as { status: { selfDeclaredMadeForKids: boolean } }).status.selfDeclaredMadeForKids).toBe(true);
    expect(readdirSync(pendingDir)).toEqual([]); // marker cleared
  });

  it('never posts to the wrong channel', async () => {
    approved('A', '2026-09-27 10:00:00');
    const { g, deps } = setup({ channelTitle: "Thomas's main channel" });
    await expect(publishNext(deps)).rejects.toThrow(/expected "Blast of Facts"/);
    expect(g.uploads()).toBe(0);
  });

  it('skips held videos and posts nothing when the queue is empty', async () => {
    const a = approved('A', '2026-09-27 10:00:00');
    holdVideo(db, a, 'superseded');
    const { g, deps } = setup();
    expect(await publishNext(deps)).toMatchObject({ outcome: 'nothing_to_post' });
    expect(g.uploads()).toBe(0);
  });

  it('records "private" when YouTube locks an unaudited upload, with a note', async () => {
    approved('A', '2026-09-27 10:00:00');
    const { deps } = setup({ privacyAfterUpload: 'private' });
    const r = await publishNext(deps);
    expect(r).toMatchObject({ outcome: 'posted', visibility: 'private' });
    expect((r as { note?: string }).note).toMatch(/audit/);
  });

  it('a failed playlist add is kept and retried on the next run', async () => {
    const a = approved('A', '2026-09-27 10:00:00');
    const first = setup({ failPlaylistAdd: true });
    expect(await publishNext(first.deps)).toMatchObject({ outcome: 'posted', playlist: 'failed' });
    const second = setup({ existingPlaylist: true });
    expect(await publishNext(second.deps)).toMatchObject({ outcome: 'nothing_to_post', playlist_retries: 1 });
    expect(second.g.uploads()).toBe(0);
    expect(db.prepare('SELECT playlist_id FROM posts WHERE video_id = ?').get(a)).toEqual({ playlist_id: 'PLmars' });
  });

  it('refuses to re-upload after a crash between upload and record', async () => {
    const a = approved('A', '2026-09-27 10:00:00');
    writeFileSync(join(pendingDir, `pending-video-${a}.json`), '{}');
    const { g, deps } = setup();
    await expect(publishNext(deps)).rejects.toThrow(/unfinished upload/);
    expect(g.uploads()).toBe(0);
    expect(existsSync(join(pendingDir, `pending-video-${a}.json`))).toBe(true);
  });

  it('dry run touches nothing', async () => {
    const a = approved('A', '2026-09-27 10:00:00');
    const { g, deps } = setup();
    expect(await publishNext(deps, { dryRun: true })).toMatchObject({ outcome: 'dry_run', video_id: a });
    expect(g.calls).toEqual([]);
  });
});
