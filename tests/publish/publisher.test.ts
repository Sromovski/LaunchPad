import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { accessTokenProvider, buildAuthUrl, parseClientSecret, pkce } from '../../src/publish/google-auth.js';
import { buildMetadata, publishNext } from '../../src/publish/publisher.js';
import { isOurChannel } from '../../src/publish/config.js';
import { CHANNELS, type Channel } from '../../src/channels.js';
import { holdVideo } from '../../src/publish/queue.js';
import { recordPost } from '../../src/publish/posts.js';
import { YouTube } from '../../src/publish/youtube-api.js';
import { fakeGoogle, type FakeOptions } from './fake-youtube.js';

const SECRET = { client_id: 'cid', client_secret: 'csecret', token_uri: 'https://oauth2.googleapis.com/token' };
let db: Database.Database;
let runsRoot: string;
let pendingDir: string;

function approved(title: string, approvedAt: string, channel = 'blast') {
  const id = Number(
    db
      .prepare("INSERT INTO videos (topic, status, title, description, hashtags, channel) VALUES ('t', 'approved', ?, ?, ?, ?)")
      .run(title, 'Credits: NASA/JPL-Caltech\nNarration voice is AI-generated.', JSON.stringify(['#Mars', '#Space', '#ScienceForKids']), channel).lastInsertRowid,
  );
  db.prepare("INSERT INTO reviews (video_id, decision, created_at) VALUES (?, 'approved', ?)").run(id, approvedAt);
  mkdirSync(join(runsRoot, String(id)), { recursive: true });
  writeFileSync(join(runsRoot, String(id), 'final.mp4'), Buffer.from('fake mp4 bytes'));
  return id;
}

function setup(o: FakeOptions = {}, channel: Channel = CHANNELS.blast) {
  const g = fakeGoogle({ channelId: channel.youtubeId, channelTitle: channel.title, ...o });
  const yt = new YouTube(g.fetchFn, accessTokenProvider(g.fetchFn, SECRET, 'REFRESH'));
  const logs: string[] = [];
  return { g, deps: { channel, db, yt, runsRoot, pendingDir, log: (m: string) => logs.push(m) }, logs };
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

describe('isOurChannel', () => {
  it('matches by ID, whatever the name looks like', () => {
    expect(isOurChannel({ id: 'UCHhHYjq4K0sERPPR2od5kRw', title: 'Blast Of Facts' }, CHANNELS.blast.youtubeId)).toBe(true);
    expect(isOurChannel({ id: 'UCother', title: 'Blast of Facts' }, CHANNELS.blast.youtubeId)).toBe(false);
  });
});

describe('buildMetadata', () => {
  it('made for kids, public, Education, hashtags as tags, no < or >', () => {
    const m = buildMetadata({ id: 1, channel: 'blast', title: 'Why <Mars> Red?', topic: 't', description: 'Hi\nNarration voice is AI-generated.', hashtags: '["#Mars","#Space"]', playlist: null, approved_at: null });
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
    expect(g.playlistItems).toEqual([{ playlistId: 'PL-Mars-Facts-for-Kids', videoId: 'VIDEO000001' }]);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(first)).toEqual({ status: 'published' });
    expect(db.prepare('SELECT method, visibility, playlist_id FROM posts').get()).toEqual({ method: 'api', visibility: 'public', playlist_id: 'PL-Mars-Facts-for-Kids' });
    const upload = g.calls.find((c) => c.url.includes('uploadType=resumable'))!;
    expect((upload.body as { status: { selfDeclaredMadeForKids: boolean } }).status.selfDeclaredMadeForKids).toBe(true);
    expect(readdirSync(pendingDir)).toEqual([]); // marker cleared
  });

  it('puts each video in its world’s playlist (created on first use), Mars videos in the default', async () => {
    const mars = approved('Mars one', '2026-09-27 10:00:00');
    const moon = approved('Moon one', '2026-09-27 11:00:00');
    db.prepare("UPDATE videos SET playlist = 'Moon Facts for Kids' WHERE id = ?").run(moon);
    const s = setup();
    await publishNext(s.deps);
    await publishNext(s.deps);
    expect(s.g.playlistItems.map((p) => p.playlistId)).toEqual(['PL-Mars-Facts-for-Kids', 'PL-Moon-Facts-for-Kids']);
    expect(db.prepare('SELECT video_id, playlist_id FROM posts ORDER BY video_id').all()).toEqual([
      { video_id: mars, playlist_id: 'PL-Mars-Facts-for-Kids' },
      { video_id: moon, playlist_id: 'PL-Moon-Facts-for-Kids' },
    ]);
  });

  it('never posts to the wrong channel (checked by permanent channel ID)', async () => {
    approved('A', '2026-09-27 10:00:00');
    const { g, deps } = setup({ channelTitle: 'Blast of Facts', channelId: 'UCsomeoneelse000000000' });
    await expect(publishNext(deps)).rejects.toThrow(/expected "Blast of Facts" \(UCHhHYjq4K0sERPPR2od5kRw\)/);
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
    expect(db.prepare('SELECT playlist_id FROM posts WHERE video_id = ?').get(a)).toEqual({ playlist_id: 'PL-Mars-Facts-for-Kids' });
  });

  it('re-checks visibility: an upload reported public but locked private later is updated', async () => {
    const a = approved('A', '2026-09-27 10:00:00');
    await publishNext(setup().deps); // posted as public
    const later = setup({ laterPrivacy: 'private' });
    expect(await publishNext(later.deps)).toMatchObject({ outcome: 'nothing_to_post' });
    expect(db.prepare('SELECT visibility FROM posts WHERE video_id = ?').get(a)).toEqual({ visibility: 'private' });
    expect(later.logs.join()).toMatch(/now private/);
  });

  it('refuses to re-upload after a crash between upload and record', async () => {
    const a = approved('A', '2026-09-27 10:00:00');
    writeFileSync(join(pendingDir, `pending-video-${a}.json`), '{}');
    const { g, deps } = setup();
    await expect(publishNext(deps)).rejects.toThrow(/unfinished upload/);
    expect(g.uploads()).toBe(0);
    expect(existsSync(join(pendingDir, `pending-video-${a}.json`))).toBe(true);
  });

  describe('thumbnails', () => {
    const thumb = () => new Uint8Array([0xff, 0xd8, 0xff]);
    const withThumbs = (o: FakeOptions = {}) => {
      const s = setup(o);
      return { ...s, deps: { ...s.deps, thumbnail: thumb } };
    };
    const thumbRow = (id: number) =>
      db.prepare("SELECT thumbnail, thumbnail_note FROM posts WHERE video_id = ? AND platform = 'youtube'").get(id) as { thumbnail: string | null; thumbnail_note: string | null };

    it('sets our title thumbnail right after the upload', async () => {
      const a = approved('A', '2026-09-27 10:00:00');
      const { g, deps } = withThumbs();
      const r = await publishNext(deps);
      expect(r).toMatchObject({ outcome: 'posted', thumbnail: 'set' });
      expect(g.thumbnails).toEqual(['VIDEO000001']);
      expect(thumbRow(a).thumbnail).toBe('set');
    });

    it('a refused thumbnail never fails the post, and is not retried for a week', async () => {
      const a = approved('A', '2026-09-27 10:00:00');
      const refused = withThumbs({ thumbnailRefused: true });
      expect(await publishNext(refused.deps)).toMatchObject({ outcome: 'posted', thumbnail: 'failed' });
      expect(thumbRow(a)).toMatchObject({ thumbnail: 'failed', thumbnail_note: expect.stringMatching(/thumbnails\.set failed: 403/) });

      const nextRun = withThumbs();
      expect(await publishNext(nextRun.deps)).toMatchObject({ outcome: 'nothing_to_post', thumbnails_backfilled: 0 });
      expect(nextRun.g.thumbnails).toEqual([]);

      db.prepare("UPDATE posts SET thumbnail_at = datetime('now', '-8 days')").run();
      const weekLater = withThumbs();
      expect(await publishNext(weekLater.deps)).toMatchObject({ outcome: 'nothing_to_post', thumbnails_backfilled: 1 });
      expect(thumbRow(a).thumbnail).toBe('set');
    });

    it('backfills videos posted before thumbnails existed (hand-posted too), stopping at the first refusal', async () => {
      const a = approved('A', '2026-09-27 10:00:00');
      const b = approved('B', '2026-09-27 11:00:00');
      await publishNext(setup().deps); // no thumbnail support yet
      recordPost(db, b, 'youtube', 'https://youtube.com/shorts/6qJq2lvEuV0', 'manual');
      expect(thumbRow(a).thumbnail).toBeNull();

      const refused = withThumbs({ thumbnailRefused: true });
      await publishNext(refused.deps);
      expect(refused.g.calls.filter((c) => c.url.includes('/thumbnails/set')).length).toBe(1); // stopped after one refusal

      db.prepare("UPDATE posts SET thumbnail_at = datetime('now', '-8 days')").run();
      const ok = withThumbs();
      expect(await publishNext(ok.deps)).toMatchObject({ thumbnails_backfilled: 2 });
      expect(ok.g.thumbnails.sort()).toEqual(['6qJq2lvEuV0', 'VIDEO000001']);
    });

    it('a thumbnail that fails to build is recorded, and the post still succeeds', async () => {
      const a = approved('A', '2026-09-27 10:00:00');
      const s = setup();
      const r = await publishNext({ ...s.deps, thumbnail: () => { throw new Error('asset missing'); } });
      expect(r).toMatchObject({ outcome: 'posted', thumbnail: 'failed' });
      expect(thumbRow(a).thumbnail_note).toBe('asset missing');
    });
  });

  describe('two channels', () => {
    it("each run posts only its own channel's videos, to its own default playlist", async () => {
      const blast = approved('Blast one', '2026-09-27 10:00:00');
      const wonder = approved('Wonder one', '2026-09-27 09:00:00', 'wonder'); // approved first, but not Blast's
      const b = setup();
      expect(await publishNext(b.deps)).toMatchObject({ outcome: 'posted', video_id: blast });
      expect(await publishNext(b.deps)).toMatchObject({ outcome: 'nothing_to_post' });
      expect(b.g.uploads()).toBe(1);

      const w = setup({ uploadOffset: 1 }, CHANNELS.wonder);
      expect(await publishNext(w.deps)).toMatchObject({ outcome: 'posted', video_id: wonder });
      expect(w.g.playlistItems).toEqual([{ playlistId: 'PL-Our-Wild-Planet', videoId: 'VIDEO000002' }]);
    });

    it('a Wonder run signed in to Blast of Facts refuses to post', async () => {
      approved('Wonder one', '2026-09-27 09:00:00', 'wonder');
      const w = setup({ channelId: CHANNELS.blast.youtubeId, channelTitle: 'Blast of Facts' }, CHANNELS.wonder);
      await expect(publishNext(w.deps)).rejects.toThrow(/expected "I Wonder Why" \(UCqNwPn4hm_lMSOhHdXcfMig\).*--channel wonder/);
      expect(w.g.uploads()).toBe(0);
    });

    it("playlist retries, visibility checks and thumbnails never touch the other channel's posts", async () => {
      const blast = approved('Blast one', '2026-09-27 10:00:00');
      await publishNext(setup({ failPlaylistAdd: true }).deps); // Blast post: playlist missing, no thumbnail yet
      const w = setup({ laterPrivacy: 'private' }, CHANNELS.wonder);
      const r = await publishNext({ ...w.deps, thumbnail: () => new Uint8Array([1]) });
      expect(r).toMatchObject({ outcome: 'nothing_to_post', playlist_retries: 0, thumbnails_backfilled: 0 });
      expect(w.g.calls.some((c) => c.url.includes('/videos?part=status') && c.url.includes('VIDEO000001'))).toBe(false);
      expect(db.prepare('SELECT visibility, playlist_id, thumbnail FROM posts WHERE video_id = ?').get(blast)).toEqual({
        visibility: 'public',
        playlist_id: null,
        thumbnail: null,
      });
    });
  });

  it('dry run touches nothing', async () => {
    const a = approved('A', '2026-09-27 10:00:00');
    const { g, deps } = setup();
    expect(await publishNext(deps, { dryRun: true })).toMatchObject({ outcome: 'dry_run', video_id: a });
    expect(g.calls).toEqual([]);
  });
});
