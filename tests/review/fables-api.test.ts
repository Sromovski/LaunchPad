import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { CHANNEL_KEYS, channelByKey, channelTitle } from '../../src/channels.js';
import { openDb } from '../../src/db/index.js';
import { saveFableScript } from '../../src/fables/script.js';
import { postingQueue } from '../../src/publish/queue.js';
import { createApp } from '../../review-site/server/app.js';

const SAMPLE = JSON.parse(readFileSync(new URL('../../channels/fables/samples/pf-001/script.json', import.meta.url), 'utf8'));

let db: Database.Database;
let app: ReturnType<typeof createApp>;
let runsRoot: string;
beforeEach(() => {
  db = openDb(':memory:');
  runsRoot = mkdtempSync(join(tmpdir(), 'launchpad-fables-api-'));
  app = createApp({ db, runsRoot });
});
const seed = () => saveFableScript(db, SAMPLE, { createdBy: 'test', runsRoot }).video_id;
const post = (path: string, body: unknown) => app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

describe('Pocket Fables registration', () => {
  it('is not a NASA channel: the scheduler, posting and --channel commands never see it', () => {
    expect(CHANNEL_KEYS).not.toContain('fables');
    expect(() => channelByKey('fables')).toThrow(/unknown channel/);
    expect(channelTitle('fables')).toBe('Pocket Fables');
  });
});

describe('Scripts to review API', () => {
  it('lists fables videos in script_review with header fields', async () => {
    const id = seed();
    const { videos } = await (await app.request('/api/fables/videos?status=script_review')).json();
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ id, topic: 'The Magic Paintbrush', lane: 'folktale', version: 1, scene_count: 10, est_seconds: 60 });
    expect(videos[0].lesson).toMatch(/Gifts/);
    expect((await (await app.request('/api/fables/counts')).json()).counts).toEqual({ script_review: 1 });
  });

  it('detail has the script, warnings and reviews; 404 for NASA ids', async () => {
    const id = seed();
    const d = await (await app.request(`/api/fables/videos/${id}`)).json();
    expect(d.script.title).toBe('The Magic Paintbrush');
    expect(d.script.scenes[0]).toMatchObject({ n: 1, seconds: 5 });
    expect(d.script_version).toBe(1);
    expect(Array.isArray(d.warnings)).toBe(true);
    const nasa = Number(db.prepare("INSERT INTO videos (topic) VALUES ('Blue sunsets')").run().lastInsertRowid);
    expect((await app.request(`/api/fables/videos/${nasa}`)).status).toBe(404);
  });

  it('approve moves to script_approved and leaves the queue', async () => {
    const id = seed();
    const res = await post(`/api/fables/videos/${id}/script-review`, { decision: 'approved', version: 1 });
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'script_approved' });
    expect((await (await app.request('/api/fables/videos?status=script_review')).json()).videos).toEqual([]);
  });

  it('request changes without notes is 400; deciding twice is 409', async () => {
    const id = seed();
    expect((await post(`/api/fables/videos/${id}/script-review`, { decision: 'changes_requested', notes: '' })).status).toBe(400);
    expect((await post(`/api/fables/videos/${id}/script-review`, { decision: 'changes_requested', notes: 'Shorter scene 5' })).status).toBe(200);
    expect((await post(`/api/fables/videos/${id}/script-review`, { decision: 'approved' })).status).toBe(409);
  });

  it('the NASA review route cannot approve a fables script', async () => {
    const id = seed();
    expect((await post(`/api/videos/${id}/review`, { decision: 'approved' })).status).toBe(409);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'script_review' });
  });
});

describe('fables videos stay out of the NASA views', () => {
  it('not in the NASA queue, history or posting queue, even when approved', async () => {
    const id = seed();
    db.prepare("UPDATE videos SET status = 'approved' WHERE id = ?").run(id);
    expect((await (await app.request('/api/videos?status=history')).json()).videos).toEqual([]);
    expect((await (await app.request('/api/videos?status=approved')).json()).videos).toEqual([]);
    expect(postingQueue(db)).toEqual([]);
    expect((await app.request('/api/videos?channel=fables')).status).toBe(400);
  });
});
