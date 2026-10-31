import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { FABLES } from '../../src/channels.js';
import { openDb } from '../../src/db/index.js';
import { fableMetadata, publishFable, type FablesYouTube } from '../../src/fables/publish.js';
import { FableScript, saveFableScript } from '../../src/fables/script.js';
import { createApp } from '../../review-site/server/app.js';

const SAMPLE = JSON.parse(readFileSync(new URL('../../channels/fables/samples/pf-001/script.json', import.meta.url), 'utf8'));

let db: Database.Database;
let runsRoot: string;
let pendingDir: string;
beforeEach(() => {
  db = openDb(':memory:');
  runsRoot = mkdtempSync(join(tmpdir(), 'launchpad-fables-pub-'));
  pendingDir = join(runsRoot, '_publish');
});

const approved = () => {
  const id = saveFableScript(db, SAMPLE, { createdBy: 'test', runsRoot }).video_id;
  db.prepare("UPDATE videos SET status = 'approved' WHERE id = ?").run(id);
  mkdirSync(join(runsRoot, String(id)), { recursive: true });
  writeFileSync(join(runsRoot, String(id), 'final.mp4'), 'fake mp4');
  return id;
};

function fakeYt(opts: { channelId?: string; privacy?: 'public' | 'private'; playlistFails?: boolean } = {}) {
  const calls: string[] = [];
  const yt: FablesYouTube = {
    channel: async () => ({ id: opts.channelId ?? FABLES.youtubeId, title: 'Pocket Fables' }),
    upload: async (_bytes, meta) => {
      calls.push(`upload:${meta.snippet.title}:${meta.status.selfDeclaredMadeForKids}`);
      return { id: 'abcdefghijk', privacyStatus: opts.privacy ?? 'public', uploadStatus: 'uploaded' };
    },
    findOrCreatePlaylist: async (title) => {
      if (opts.playlistFails) throw new Error('quota');
      calls.push(`playlist:${title}`);
      return 'PL1';
    },
    addToPlaylist: async (pl, vid) => {
      calls.push(`add:${pl}:${vid}`);
    },
  };
  return { yt, calls };
}

describe('fableMetadata', () => {
  it('uses the script’s YouTube title, description and tags; public; Made for Kids', () => {
    const m = fableMetadata(FableScript.parse(SAMPLE));
    expect(m.snippet.title).toBe(SAMPLE.youtube.title);
    expect(m.snippet.description).toContain('Narration voice is AI-generated.');
    expect(m.snippet.tags.every((t) => !t.startsWith('#'))).toBe(true);
    expect(m.status).toEqual({ privacyStatus: 'public', selfDeclaredMadeForKids: true, embeddable: true });
  });
});

describe('publishFable', () => {
  it('uploads, records the post, moves to uploaded and adds it to the playlist', async () => {
    const id = approved();
    const { yt, calls } = fakeYt();
    const r = await publishFable(db, id, yt, { runsRoot, pendingDir });
    expect(r).toEqual({ url: 'https://www.youtube.com/shorts/abcdefghijk', visibility: 'public', playlist: 'added' });
    expect(calls).toEqual([`upload:${SAMPLE.youtube.title}:true`, `playlist:${FABLES.playlist.title}`, 'add:PL1:abcdefghijk']);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'uploaded' });
    expect(db.prepare('SELECT method, visibility, playlist_id FROM posts WHERE video_id = ?').get(id)).toEqual({ method: 'api', visibility: 'public', playlist_id: 'PL1' });
    expect(existsSync(join(pendingDir, `pending-fables-${id}.json`))).toBe(false);
  });

  it('refuses the wrong signed-in channel before uploading anything', async () => {
    const id = approved();
    const { yt, calls } = fakeYt({ channelId: 'UCsomethingelse' });
    await expect(publishFable(db, id, yt, { runsRoot, pendingDir })).rejects.toThrow(/not Pocket Fables/);
    expect(calls).toEqual([]);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'approved' });
  });

  it('refuses videos that are not approved, and an unfinished earlier upload', async () => {
    const id = approved();
    db.prepare("UPDATE videos SET status = 'video_review' WHERE id = ?").run(id);
    await expect(publishFable(db, id, fakeYt().yt, { runsRoot, pendingDir })).rejects.toThrow(/not approved/);
    db.prepare("UPDATE videos SET status = 'approved' WHERE id = ?").run(id);
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(join(pendingDir, `pending-fables-${id}.json`), '{}');
    const { yt, calls } = fakeYt();
    await expect(publishFable(db, id, yt, { runsRoot, pendingDir })).rejects.toThrow(/unfinished upload/);
    expect(calls).toEqual([]);
  });

  it('a playlist failure or a private upload still counts as uploaded, with a note', async () => {
    const id = approved();
    const r = await publishFable(db, id, fakeYt({ privacy: 'private', playlistFails: true }).yt, { runsRoot, pendingDir });
    expect(r).toMatchObject({ visibility: 'private', playlist: 'failed', note: expect.stringMatching(/private/) });
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'uploaded' });
  });
});

describe('POST /api/fables/videos/:id/publish', () => {
  const post = (app: ReturnType<typeof createApp>, id: number) => app.request(`/api/fables/videos/${id}/publish`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });

  it('says how to connect when YouTube is not set up, and the detail reports it', async () => {
    const app = createApp({ db, runsRoot, fablesYoutube: () => null });
    const id = approved();
    const res = await post(app, id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/youtube:auth -- --channel fables/);
    expect((await (await app.request(`/api/fables/videos/${id}`)).json()).youtube_connected).toBe(false);
  });

  it('uploads through the route when connected', async () => {
    const { yt } = fakeYt();
    const app = createApp({ db, runsRoot, fablesYoutube: () => yt });
    const id = approved();
    const res = await post(app, id);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://www.youtube.com/shorts/abcdefghijk');
    const d = await (await app.request(`/api/fables/videos/${id}`)).json();
    expect(d).toMatchObject({ youtube_connected: true, post: { visibility: 'public' } });
  });
});
