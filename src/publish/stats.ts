/**
 * View tracking for the review site's Views page. snapshotStats() saves today's
 * YouTube numbers for one channel (a few quota units); viewsReport() turns the
 * saved snapshots into totals, a daily series and a per-video table.
 * History only exists from the first snapshot on: YouTube's Data API has no past counts.
 */
import type Database from 'better-sqlite3';
import { CHANNELS, type ChannelKey } from '../channels.js';
import type { YouTube } from './youtube-api.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function snapshotStats(
  db: Database.Database,
  channel: ChannelKey,
  yt: Pick<YouTube, 'channelStats' | 'videoStats'>,
  day = today(),
): Promise<{ channel: ChannelKey; day: string; views: number; subscribers: number | null; videos_tracked: number }> {
  const totals = await yt.channelStats();
  const ids = (
    db
      .prepare("SELECT p.external_id FROM posts p JOIN videos v ON v.id = p.video_id WHERE p.platform = 'youtube' AND v.channel = ?")
      .all(channel) as { external_id: string }[]
  ).map((r) => r.external_id);
  const perVideo = await yt.videoStats(ids);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO channel_stats (channel, day, views, subscribers, videos) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (channel, day) DO UPDATE SET views = excluded.views, subscribers = excluded.subscribers, videos = excluded.videos, taken_at = datetime('now')`,
    ).run(channel, day, totals.views, totals.subscribers, totals.videos);
    const put = db.prepare(
      `INSERT INTO video_stats (external_id, day, views, likes) VALUES (?, ?, ?, ?)
       ON CONFLICT (external_id, day) DO UPDATE SET views = excluded.views, likes = excluded.likes, taken_at = datetime('now')`,
    );
    for (const [id, s] of perVideo) put.run(id, day, s.views, s.likes);
  })();
  return { channel, day, views: totals.views, subscribers: totals.subscribers, videos_tracked: perVideo.size };
}

export interface ChannelViews {
  key: ChannelKey;
  title: string;
  latest: { day: string; taken_at: string; views: number; subscribers: number | null; videos: number } | null;
  /** Views gained over the last 7 days, compared with the newest snapshot at least 7 days old (or the oldest one). */
  gained: { views: number; subscribers: number | null; since: string } | null;
  series: { day: string; views: number; subscribers: number | null }[];
  videos: { video_id: number; title: string; url: string; posted_at: string; views: number | null; likes: number | null; gained: number | null }[];
}

const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export function viewsReport(db: Database.Database): ChannelViews[] {
  return Object.values(CHANNELS).map((ch) => {
    const series = db.prepare('SELECT day, views, subscribers FROM channel_stats WHERE channel = ? ORDER BY day').all(ch.key) as ChannelViews['series'];
    const latest =
      (db.prepare('SELECT day, taken_at, views, subscribers, videos FROM channel_stats WHERE channel = ? ORDER BY day DESC LIMIT 1').get(ch.key) as ChannelViews['latest']) ??
      null;
    let gained: ChannelViews['gained'] = null;
    let baseDay: string | null = null;
    if (latest && series.length > 1) {
      const weekAgo = daysBefore(latest.day, 7);
      const base = [...series].reverse().find((s) => s.day <= weekAgo) ?? series[0]!;
      baseDay = base.day;
      gained = {
        views: latest.views - base.views,
        subscribers: latest.subscribers != null && base.subscribers != null ? latest.subscribers - base.subscribers : null,
        since: base.day,
      };
    }
    const videos = db
      .prepare(
        `SELECT p.video_id, COALESCE(v.title, v.topic) AS title, p.url, p.posted_at,
                cur.views, cur.likes,
                -- posted after the base day: every view is new
                cur.views - COALESCE(
                  (SELECT b.views FROM video_stats b WHERE b.external_id = p.external_id AND b.day <= ? ORDER BY b.day DESC LIMIT 1),
                  CASE WHEN date(p.posted_at) > ? THEN 0 END) AS gained
         FROM posts p JOIN videos v ON v.id = p.video_id
         LEFT JOIN video_stats cur ON cur.external_id = p.external_id AND cur.day = (SELECT MAX(day) FROM video_stats WHERE external_id = p.external_id)
         WHERE p.platform = 'youtube' AND v.channel = ?
         ORDER BY p.posted_at DESC`,
      )
      .all(baseDay, baseDay, ch.key) as ChannelViews['videos'];
    return { key: ch.key, title: ch.title, latest, gained, series, videos };
  });
}
