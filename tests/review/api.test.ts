import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { createApp, parseRange } from '../../review-site/server/app.js';

let db: Database.Database;
let runsRoot: string;
let app: ReturnType<typeof createApp>;
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

function seedVideo(status = 'in_review', rights = 'needs_review'): number {
  const id = Number(db.prepare("INSERT INTO videos (topic, status, title) VALUES ('Why are sunsets on Mars blue?', ?, 'Blue Sunsets')").run(status).lastInsertRowid);
  db.prepare("INSERT INTO assets (video_id, nasa_id, media_type, source_url, credit, rights_status) VALUES (?, 'PIA19400', 'image', 'https://images.nasa.gov/details/PIA19400', 'NASA/JPL-Caltech/MSSS', ?)").run(id, rights);
  mkdirSync(join(runsRoot, String(id)), { recursive: true });
  writeFileSync(join(runsRoot, String(id), 'final.mp4'), BYTES);
  return id;
}

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  db = openDb(':memory:');
  runsRoot = mkdtempSync(join(tmpdir(), 'launchpad-runs-'));
  app = createApp({ db, runsRoot });
});

describe('lists', () => {
  it('queue shows in_review videos with rights warning counts', async () => {
    const a = seedVideo();
    seedVideo('rendered');
    const res = await app.request('/api/videos');
    const { videos } = await res.json();
    expect(videos.map((v: { id: number }) => v.id)).toEqual([a]);
    expect(videos[0].rights_warnings).toBe(1);
  });

  it('history lists decided videos and filters by text', async () => {
    const a = seedVideo('approved');
    seedVideo('rejected');
    const all = await (await app.request('/api/videos?status=history')).json();
    expect(all.videos).toHaveLength(2);
    const approved = await (await app.request('/api/videos?status=approved')).json();
    expect(approved.videos.map((v: { id: number }) => v.id)).toEqual([a]);
    const none = await (await app.request('/api/videos?status=history&q=jupiter')).json();
    expect(none.videos).toEqual([]);
  });

  it('rejects unknown statuses', async () => {
    expect((await app.request('/api/videos?status=bogus')).status).toBe(400);
  });
});

describe('detail', () => {
  it('returns the video with rights_needed', async () => {
    const id = seedVideo();
    const d = await (await app.request(`/api/videos/${id}`)).json();
    expect(d.video.id).toBe(id);
    expect(d.rights_needed).toEqual([{ nasa_id: 'PIA19400', credit: 'NASA/JPL-Caltech/MSSS' }]);
    expect(d.has_video).toBe(true);
  });

  it('404 for a missing video, 400 for a non-numeric id', async () => {
    expect((await app.request('/api/videos/999')).status).toBe(404);
    expect((await app.request('/api/videos/abc')).status).toBe(400);
  });
});

describe('review actions', () => {
  it('rights gate: approve without the tick is 400 and changes nothing', async () => {
    const id = seedVideo();
    const res = await post(`/api/videos/${id}/review`, { decision: 'approved' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/rights/);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'in_review' });
  });

  it('approve with the tick', async () => {
    const id = seedVideo();
    const res = await post(`/api/videos/${id}/review`, { decision: 'approved', rights_checked: true });
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'approved' });
  });

  it('changes without notes is 400; reviewing twice is 409', async () => {
    const id = seedVideo();
    expect((await post(`/api/videos/${id}/review`, { decision: 'changes_requested' })).status).toBe(400);
    expect((await post(`/api/videos/${id}/review`, { decision: 'rejected' })).status).toBe(200);
    expect((await post(`/api/videos/${id}/review`, { decision: 'rejected' })).status).toBe(409);
  });

  it('there is no route that can publish', async () => {
    const id = seedVideo('approved');
    expect((await post(`/api/videos/${id}/review`, { decision: 'published' })).status).toBe(400);
    expect((await post(`/api/videos/${id}/publish`, {})).status).toBe(404);
  });

  it('saves the edited draft', async () => {
    const id = seedVideo();
    const res = await app.request(`/api/videos/${id}/draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New', description: 'x\nNarration voice is AI-generated.', hashtags: ['#Mars', '#Space', '#Kids'] }),
    });
    expect(res.status).toBe(200);
    const d = await (await app.request(`/api/videos/${id}`)).json();
    expect(d.draft.title).toBe('New');
    expect(d.draft.hashtags).toEqual(['#Mars', '#Space', '#Kids']);
  });
});

describe('media', () => {
  it('serves the whole file with Accept-Ranges', async () => {
    const id = seedVideo();
    const res = await app.request(`/media/${id}/final.mp4`);
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('serves byte ranges (206) so scrubbing works', async () => {
    const id = seedVideo();
    const res = await app.request(`/media/${id}/final.mp4`, { headers: { Range: 'bytes=100-199' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES.subarray(100, 200));
  });

  it('416 for an unsatisfiable range', async () => {
    const id = seedVideo();
    expect((await app.request(`/media/${id}/final.mp4`, { headers: { Range: 'bytes=5000-' } })).status).toBe(416);
  });

  it('cannot escape the runs folder', async () => {
    for (const p of ['/media/..%2F..%2Fdata/final.mp4', '/media/1%2F..%2F..%2Fx/final.mp4', '/media/1/..%2F..%2Fpackage.json']) {
      expect([400, 404]).toContain((await app.request(p)).status);
    }
  });
});

describe('parseRange', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=900-', { start: 900, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=500-5000', { start: 500, end: 999 }],
  ])('%s', (h, r) => expect(parseRange(h, 1000)).toEqual(r));
  it.each(['bytes=1000-', 'bytes=5-2', 'items=0-1', 'bytes=-'])('%s is unsatisfiable', (h) => expect(parseRange(h, 1000)).toBeNull());
});

describe('automation health', () => {
  it('returns the latest automatic runs, newest first', async () => {
    db.prepare("INSERT INTO automation_runs (trigger, outcome, topic) VALUES ('scheduled', 'in_review', 'A')").run();
    db.prepare("INSERT INTO automation_runs (trigger, outcome, topic, error) VALUES ('scheduled', 'timeout', 'B', 'killed after 60 min')").run();
    const { runs } = await (await app.request('/api/automation')).json();
    expect(runs.map((r: { topic: string }) => r.topic)).toEqual(['B', 'A']);
    expect(runs[0].error).toBe('killed after 60 min');
  });
});

describe('posts on the detail page', () => {
  it('returns recorded posts', async () => {
    const id = seedVideo('published');
    db.prepare("INSERT INTO posts (video_id, platform, external_id, url, method) VALUES (?, 'youtube', '6qJq2lvEuV0', 'https://www.youtube.com/shorts/6qJq2lvEuV0', 'manual')").run(id);
    const d = await (await app.request(`/api/videos/${id}`)).json();
    expect(d.posts).toEqual([expect.objectContaining({ platform: 'youtube', url: 'https://www.youtube.com/shorts/6qJq2lvEuV0' })]);
  });
});

describe('publishing overview', () => {
  it('lists next-to-post (not held, not posted), posted and held videos', async () => {
    const a = seedVideo('approved');
    const b = seedVideo('approved');
    db.prepare("UPDATE videos SET do_not_post = 1, do_not_post_reason = 'superseded' WHERE id = ?").run(b);
    const { channels } = await (await app.request('/api/publishing')).json();
    const blast = channels.find((c: { key: string }) => c.key === 'blast');
    expect(blast.next.map((v: { id: number }) => v.id)).toEqual([a]);
    expect(blast.held).toEqual([{ id: b, title: 'Blue Sunsets', reason: 'superseded' }]);
    expect(blast.posted).toEqual([]);
    expect(blast.post_times).toEqual(['08:00', '16:00']);
  });

  it('splits by channel: each channel lists only its own videos', async () => {
    const a = seedVideo('approved');
    const w = seedVideo('approved');
    db.prepare("UPDATE videos SET channel = 'wonder' WHERE id = ?").run(w);
    const { channels } = await (await app.request('/api/publishing')).json();
    const byKey = Object.fromEntries(channels.map((c: { key: string; next: { id: number }[] }) => [c.key, c.next.map((v) => v.id)]));
    expect(byKey).toEqual({ blast: [a], wonder: [w] });
    expect(channels.map((c: { title: string }) => c.title)).toEqual(['Blast of Facts', 'I Wonder Why']);
  });
});

describe('channels in lists', () => {
  it('every video carries its channel; ?channel= filters', async () => {
    const a = seedVideo('in_review');
    const w = seedVideo('in_review');
    db.prepare("UPDATE videos SET channel = 'wonder' WHERE id = ?").run(w);
    const all = (await (await app.request('/api/videos?status=in_review')).json()).videos;
    expect(all.map((v: { id: number; channel: string; channel_title: string }) => [v.id, v.channel, v.channel_title]).sort()).toEqual([
      [a, 'blast', 'Blast of Facts'],
      [w, 'wonder', 'I Wonder Why'],
    ]);
    const wonder = (await (await app.request('/api/videos?status=in_review&channel=wonder')).json()).videos;
    expect(wonder.map((v: { id: number }) => v.id)).toEqual([w]);
    expect((await app.request('/api/videos?channel=nope')).status).toBe(400);
  });
});
