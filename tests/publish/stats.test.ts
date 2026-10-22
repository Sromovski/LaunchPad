import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { snapshotStats, viewsReport } from '../../src/publish/stats.js';
import { YouTube } from '../../src/publish/youtube-api.js';

let db: Database.Database;

function post(channel: string, externalId: string, postedAt: string): number {
  const id = Number(db.prepare("INSERT INTO videos (topic, status, title, channel) VALUES ('t', 'published', ?, ?)").run(`Video ${externalId}`, channel).lastInsertRowid);
  db.prepare("INSERT INTO posts (video_id, platform, external_id, url, method, posted_at) VALUES (?, 'youtube', ?, ?, 'api', ?)").run(
    id,
    externalId,
    `https://www.youtube.com/shorts/${externalId}`,
    postedAt,
  );
  return id;
}

/** Fake client: channel totals + per-video views for one day. */
const fakeYt = (views: number, subscribers: number | null, perVideo: Record<string, number>) => {
  const asked: string[][] = [];
  return {
    asked,
    channelStats: async () => ({ views, subscribers, videos: Object.keys(perVideo).length }),
    videoStats: async (ids: string[]) => {
      asked.push(ids);
      return new Map(ids.filter((id) => id in perVideo).map((id) => [id, { views: perVideo[id]!, likes: 1 }]));
    },
  };
};

beforeEach(() => {
  db = openDb(':memory:');
});

describe('snapshotStats', () => {
  it("saves the channel totals and only that channel's videos; a second snapshot the same day overwrites", async () => {
    post('blast', 'AAA', '2026-10-01 12:00:00');
    post('wonder', 'WWW', '2026-10-01 12:00:00');
    const yt = fakeYt(40, 12, { AAA: 30 });
    await snapshotStats(db, 'blast', yt, '2026-10-20');
    expect(yt.asked).toEqual([['AAA']]);
    await snapshotStats(db, 'blast', fakeYt(42, 13, { AAA: 31 }), '2026-10-20');
    expect(db.prepare('SELECT channel, day, views, subscribers FROM channel_stats').all()).toEqual([{ channel: 'blast', day: '2026-10-20', views: 42, subscribers: 13 }]);
    expect(db.prepare('SELECT external_id, views FROM video_stats').all()).toEqual([{ external_id: 'AAA', views: 31 }]);
  });
});

describe('viewsReport', () => {
  it('series, 7-day gain from the newest snapshot at least a week old, per-video gain', async () => {
    post('blast', 'OLD', '2026-10-01 12:00:00');
    post('blast', 'NEW', '2026-10-18 12:00:00');
    await snapshotStats(db, 'blast', fakeYt(10, 5, { OLD: 10 }), '2026-10-10');
    await snapshotStats(db, 'blast', fakeYt(20, 6, { OLD: 15 }), '2026-10-13');
    await snapshotStats(db, 'blast', fakeYt(50, 9, { OLD: 30, NEW: 20 }), '2026-10-20');

    const blast = viewsReport(db).find((c) => c.key === 'blast')!;
    expect(blast.series.map((s) => s.views)).toEqual([10, 20, 50]);
    expect(blast.latest).toMatchObject({ day: '2026-10-20', views: 50, subscribers: 9 });
    expect(blast.gained).toEqual({ views: 30, subscribers: 3, since: '2026-10-13' });
    const byTitle = Object.fromEntries(blast.videos.map((v) => [v.title, v]));
    expect(byTitle['Video OLD']).toMatchObject({ views: 30, gained: 15 });
    expect(byTitle['Video NEW']).toMatchObject({ views: 20, gained: 20 }); // posted after the base day: all new
    expect(blast.videos[0]!.title).toBe('Video NEW'); // newest post first
  });

  it('a channel with one snapshot has totals but no gain yet; one with none has nothing', async () => {
    post('blast', 'AAA', '2026-10-01 12:00:00');
    await snapshotStats(db, 'blast', fakeYt(42, 12, { AAA: 42 }), '2026-10-22');
    const [blast, wonder] = viewsReport(db);
    expect(blast!.gained).toBeNull();
    expect(blast!.videos[0]).toMatchObject({ views: 42, gained: null });
    expect(wonder).toMatchObject({ key: 'wonder', latest: null, series: [], videos: [] });
  });
});

describe('YouTube stats calls', () => {
  it('parse statistics, hide hidden subscriber counts, and batch video IDs by 50', async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes('/channels?part=statistics')) return json({ items: [{ statistics: { viewCount: '42', subscriberCount: '0', hiddenSubscriberCount: true, videoCount: '31' } }] });
      const ids = new URL(url).searchParams.get('id')!.split(',');
      return json({ items: ids.map((id) => ({ id, statistics: { viewCount: '3' } })) });
    }) as typeof fetch;
    const yt = new YouTube(fetchFn, async () => 'A');
    expect(await yt.channelStats()).toEqual({ views: 42, subscribers: null, videos: 31 });
    const ids = Array.from({ length: 51 }, (_, i) => `V${i}`);
    const stats = await yt.videoStats(ids);
    expect(stats.size).toBe(51);
    expect(stats.get('V50')).toEqual({ views: 3, likes: null });
    expect(urls.filter((u) => u.includes('/videos?'))).toHaveLength(2);
  });
});
