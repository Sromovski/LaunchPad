import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { CHANNEL_KEYS, CLIPS, FABLES } from '../../src/channels.js';
import { ClipImportError, importScript, importVideo } from '../../src/clips/import.js';
import { clipMetadata, nextOpenSlot, publishClip, type ClipsYouTube } from '../../src/clips/publish.js';
import { openDb } from '../../src/db/index.js';
import { IllegalTransitionError, transitionVideo } from '../../src/db/status.js';
import { postingQueue } from '../../src/publish/queue.js';
import { createApp } from '../../review-site/server/app.js';

const manifest = (source = 'be005') => ({
  source,
  kind: 'reel' as const,
  title: 'Who is eating the glue?',
  description: 'Five polite insults and one butter eye.',
  hashtags: ['shorts', 'comedy'],
  lines: [{ text: 'Wait?' }, { text: 'If you are here??' }],
});

let db: Database.Database;
let runsRoot: string;
let mp4: string;
const realId = CLIPS.youtubeId;
const CHANNEL_ID = 'UCclipsTestChannel';
const setId = (id: string) => ((CLIPS as { youtubeId: string }).youtubeId = id);

beforeEach(() => {
  db = openDb(':memory:');
  runsRoot = mkdtempSync(join(tmpdir(), 'launchpad-clips-'));
  mp4 = join(runsRoot, 'in.mp4');
  writeFileSync(mp4, 'fake mp4');
  setId(CHANNEL_ID);
});
afterEach(() => setId(realId));

const atVideoReview = (source = 'be005') => importVideo(db, manifest(source), { file: mp4, durationS: 25, runsRoot }).video_id;
const approve = (id: number) => transitionVideo(db, id, 'approved', { via: 'review' });
const status = (id: number) => (db.prepare('SELECT status FROM videos WHERE id = ?').get(id) as { status: string }).status;

function fakeYt(opts: { channelId?: string } = {}) {
  const uploads: { title: string; kids: boolean; privacy: string; publishAt?: string }[] = [];
  let n = 0;
  const yt: ClipsYouTube = {
    channel: async () => ({ id: opts.channelId ?? CHANNEL_ID, title: 'Some channel' }),
    upload: async (_b, m) => {
      uploads.push({ title: m.snippet.title, kids: m.status.selfDeclaredMadeForKids, privacy: m.status.privacyStatus, publishAt: m.status.publishAt });
      return { id: `abcdefghij${n++}`, privacyStatus: 'private', uploadStatus: 'uploaded' };
    },
    findOrCreatePlaylist: async () => 'PL1',
    addToPlaylist: async () => {},
  };
  return { yt, uploads };
}
const publish = (id: number, yt: ClipsYouTube, now = new Date(2026, 10, 7, 10, 0)) =>
  publishClip(db, id, yt, { runsRoot, pendingDir: join(runsRoot, '_publish'), readFile: () => new Uint8Array(1), now });

describe('Curious Clips metadata', () => {
  it('is never marked made for kids, and adds the AI voice line', () => {
    const m = clipMetadata({ ...manifest(), kind: 'reel' });
    expect(m.status.selfDeclaredMadeForKids).toBe(false);
    expect(m.snippet.categoryId).toBe('23');
    expect(m.snippet.description).toMatch(/AI-generated/);
    expect(m.snippet.description).toMatch(/#shorts #comedy/);
    expect(m.snippet.description).not.toMatch(/affiliated/);
  });

  it('adds the parody line to the AI show, and repeats no hashtag', () => {
    const m = clipMetadata({ title: 't', description: 'About AI. #ai', hashtags: ['ai', 'claude'], kind: 'show' });
    expect(m.snippet.description).toMatch(/not affiliated/i);
    expect(m.snippet.description.match(/#ai\b/g)).toHaveLength(1);
    expect(m.snippet.description).toMatch(/#claude/);
  });
});

describe('Curious Clips gates', () => {
  it('an already approved script arrives at video review, and goes no further by itself', () => {
    const id = atVideoReview();
    expect(status(id)).toBe('video_review');
    expect(existsSync(join(runsRoot, String(id), 'final.mp4'))).toBe(true);
    expect(() => transitionVideo(db, id, 'approved')).toThrow(IllegalTransitionError);
  });

  it('a new id must pass script review first', () => {
    expect(() => importVideo(db, manifest('ep003'), { file: mp4, durationS: 1, runsRoot })).toThrow(ClipImportError);
    const { video_id: id } = importScript(db, manifest('ep003'));
    expect(status(id)).toBe('script_review');
    expect(() => importVideo(db, manifest('ep003'), { file: mp4, durationS: 1, runsRoot })).toThrow(ClipImportError);
    expect(() => transitionVideo(db, id, 'script_approved')).toThrow(IllegalTransitionError);
    transitionVideo(db, id, 'script_approved', { via: 'review' });
    expect(importVideo(db, manifest('ep003'), { file: mp4, durationS: 1, runsRoot }).status).toBe('video_review');
  });

  it('refuses a video whose lines differ from the approved script', () => {
    const { video_id: id } = importScript(db, manifest('ep003'));
    transitionVideo(db, id, 'script_approved', { via: 'review' });
    const changed = { ...manifest('ep003'), lines: [{ text: 'Something Thomas never saw' }] };
    expect(() => importVideo(db, changed, { file: mp4, durationS: 1, runsRoot })).toThrow(/differ/);
  });

  it('a revision comes back to script review as a new version', () => {
    const id = atVideoReview();
    transitionVideo(db, id, 'video_changes', { via: 'review' });
    importScript(db, manifest());
    expect(status(id)).toBe('script_review');
    expect((db.prepare('SELECT COUNT(*) AS n FROM scripts WHERE video_id = ?').get(id) as { n: number }).n).toBe(2);
  });

  it('stays out of the NASA posting queue and channel list', () => {
    const id = atVideoReview();
    approve(id);
    expect(postingQueue(db).map((v) => v.id)).not.toContain(id);
    expect((CHANNEL_KEYS as readonly string[]).includes(CLIPS.key)).toBe(false);
  });
});

describe('Curious Clips posting', () => {
  it('schedules one video a day at the post hour, in approval order, starting today', async () => {
    const [a, b, c] = ['be005', 'be003', 'be006'].map((s) => atVideoReview(s));
    const { yt, uploads } = fakeYt();
    for (const id of [a!, b!, c!]) {
      approve(id);
      await publish(id, yt);
    }
    expect(uploads.every((u) => u.privacy === 'private' && !u.kids)).toBe(true);
    const days = uploads.map((u) => new Date(u.publishAt!));
    expect(days.map((d) => d.getHours())).toEqual([16, 16, 16]);
    expect(days.map((d) => d.getDate())).toEqual([7, 8, 9]);
    expect(status(a!)).toBe('uploaded');
  });

  it('starts tomorrow once today’s slot has passed', () => {
    const slot = nextOpenSlot(db, new Date(2026, 10, 7, 15, 50));
    expect(slot.getDate()).toBe(8);
  });

  it('only uploads approved videos', async () => {
    const id = atVideoReview();
    const { yt, uploads } = fakeYt();
    await expect(publish(id, yt)).rejects.toThrow(/not approved/);
    expect(uploads).toEqual([]);
  });

  it('refuses the wrong channel, so a kids’ channel can never get these', async () => {
    const id = atVideoReview();
    approve(id);
    const { yt, uploads } = fakeYt({ channelId: FABLES.youtubeId });
    await expect(publish(id, yt)).rejects.toThrow(/not Curious Clips/);
    expect(uploads).toEqual([]);
    expect(status(id)).toBe('approved');
  });

  it('refuses to upload until the channel ID is set', async () => {
    const id = atVideoReview();
    approve(id);
    setId('');
    const { yt, uploads } = fakeYt({ channelId: '' });
    await expect(publish(id, yt)).rejects.toThrow(/no channel ID/);
    expect(uploads).toEqual([]);
  });

  it('a crash mid-upload can’t upload twice', async () => {
    const id = atVideoReview();
    approve(id);
    const dir = join(runsRoot, '_publish');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `pending-clips-${id}.json`), '{}');
    const { yt, uploads } = fakeYt();
    await expect(publish(id, yt)).rejects.toThrow(/unfinished upload/);
    expect(uploads).toEqual([]);
  });
});

describe('Curious Clips review API', () => {
  const app = (yt?: ClipsYouTube) => createApp({ db, runsRoot, youtubeFor: () => null, clipsYoutube: yt ? () => yt : undefined });
  const post = (a: ReturnType<typeof app>, path: string, body: unknown = {}) =>
    a.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('lists oldest first and shows what YouTube will get', async () => {
    const [a, b] = [atVideoReview('be005'), atVideoReview('be003')];
    const res = (await (await app().request('/api/clips/videos?status=video_review')).json()) as { videos: { id: number }[] };
    expect(res.videos.map((v) => v.id)).toEqual([a, b]);
    const d = (await (await app().request(`/api/clips/videos/${a}`)).json()) as { youtube: { made_for_kids: boolean }; youtube_connected: boolean };
    expect(d.youtube.made_for_kids).toBe(false);
    expect(d.youtube_connected).toBe(false);
  });

  it('approving then publishing schedules it; without a login nothing posts', async () => {
    const id = atVideoReview();
    const offline = app();
    expect((await post(offline, `/api/clips/videos/${id}/video-review`, { decision: 'approved' })).status).toBe(200);
    expect(status(id)).toBe('approved');
    expect((await post(offline, `/api/clips/videos/${id}/publish`)).status).toBe(409);
    const { yt, uploads } = fakeYt();
    const r = (await (await post(app(yt), `/api/clips/videos/${id}/publish`)).json()) as { scheduled_for: string };
    expect(r.scheduled_for).toBe(uploads[0]!.publishAt);
    expect(status(id)).toBe('uploaded');
  });

  it('a Pocket Fables id can’t be decided through the Curious Clips routes', async () => {
    const id = Number(db.prepare("INSERT INTO videos (topic, channel, status) VALUES ('t', 'fables', 'video_review')").run().lastInsertRowid);
    expect((await post(app(), `/api/clips/videos/${id}/video-review`, { decision: 'approved' })).status).toBe(404);
    expect(status(id)).toBe('video_review');
  });

  it('the YouTube text can be edited until it’s on YouTube', async () => {
    const id = atVideoReview();
    const put = (a: ReturnType<typeof app>) =>
      a.request(`/api/clips/videos/${id}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New', description: 'Desc', hashtags: ['x'] }) });
    expect((await put(app())).status).toBe(200);
    expect((db.prepare('SELECT title FROM videos WHERE id = ?').get(id) as { title: string }).title).toBe('New');
    db.prepare("UPDATE videos SET status = 'uploaded' WHERE id = ?").run(id);
    expect((await put(app())).status).toBe(409);
  });
});
