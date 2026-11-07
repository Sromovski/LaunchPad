/**
 * Curious Clips tab API (channels/clips/CLAUDE.md). The same two gates as Pocket Fables,
 * with no credits, scenes or Everygen. Approving a video schedules it for the next open day.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { z } from 'zod';
import { CLIPS } from '../../src/channels.js';
import { ClipPublishError, clipDraft, clipMetadata, nextOpenSlot, publishClip, type ClipsYouTube } from '../../src/clips/publish.js';
import { FABLES_STATUSES } from '../../src/db/status.js';
import { ReviewError } from '../../src/review/decide.js';
import { decideScript, decideVideo, markUploaded } from '../../src/review/fables.js';

const QUEUES = ['script_review', 'video_review', 'approved'] as const;

const DraftInput = z.object({
  title: z.string().trim().min(1, 'a title is required').max(100),
  description: z.string().trim().min(1, 'a description is required').max(4000),
  hashtags: z.array(z.string().trim().min(1)).max(15),
});

export function clipsRoutes(app: Hono, db: Database.Database, runsRoot: string, videoId: (raw: string) => number, clipsYoutube?: () => ClipsYouTube | null) {
  const owned = (id: number) => {
    const v = db
      .prepare('SELECT id, channel, topic, title, status, revision_count, duration_s, created_at, updated_at FROM videos WHERE id = ?')
      .get(id) as { channel: string; status: string } | undefined;
    if (!v || v.channel !== CLIPS.key) throw new ReviewError(`Curious Clips video ${id} not found`, 404);
    return v;
  };

  /** Oldest first: approving from the top posts them in the order they came in. */
  app.get('/api/clips/videos', (c) => {
    const status = c.req.query('status') ?? 'video_review';
    if (!(FABLES_STATUSES as readonly string[]).includes(status)) throw new ReviewError('unknown status', 400);
    const videos = db
      .prepare(
        `SELECT v.id, v.topic, v.title, v.status, v.duration_s, v.playlist,
                (SELECT MAX(version) FROM scripts s WHERE s.video_id = v.id) AS version,
                p.url AS youtube_url, p.publish_at
         FROM videos v LEFT JOIN posts p ON p.video_id = v.id AND p.platform = 'youtube'
         WHERE v.channel = ? AND v.status = ?
         ORDER BY v.id`,
      )
      .all(CLIPS.key, status);
    return c.json({ videos });
  });

  app.get('/api/clips/counts', (c) => {
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM videos WHERE channel = ? GROUP BY status').all(CLIPS.key) as { status: string; n: number }[];
    return c.json({ counts: Object.fromEntries(QUEUES.map((q) => [q, rows.find((r) => r.status === q)?.n ?? 0])) });
  });

  app.get('/api/clips/videos/:id', (c) => {
    const id = videoId(c.req.param('id'));
    const video = owned(id);
    const row = db.prepare('SELECT version, body_json FROM scripts WHERE video_id = ? ORDER BY version DESC LIMIT 1').get(id) as { version: number; body_json: string } | undefined;
    const draft = clipDraft(db, id);
    const meta = clipMetadata(draft);
    return c.json({
      video,
      script: row ? (JSON.parse(row.body_json) as { kind: string; lines: { speaker?: string; text: string }[] }) : null,
      script_version: row?.version ?? null,
      draft,
      /** What YouTube would get: the description with its added lines. */
      youtube: { title: meta.snippet.title, description: meta.snippet.description, tags: meta.snippet.tags, made_for_kids: meta.status.selfDeclaredMadeForKids },
      reviews: db.prepare('SELECT id, gate, decision, notes, created_at FROM reviews WHERE video_id = ? ORDER BY id DESC').all(id),
      has_video: existsSync(resolve(runsRoot, String(id), 'final.mp4')),
      post: db.prepare("SELECT url, visibility, posted_at, publish_at FROM posts WHERE video_id = ? AND platform = 'youtube'").get(id) ?? null,
      youtube_connected: !!CLIPS.youtubeId && !!clipsYoutube?.(),
      next_slot: nextOpenSlot(db).toISOString(),
    });
  });

  /** Thomas edits the YouTube text. Once it's on YouTube, Studio is the place to change it. */
  app.put('/api/clips/videos/:id/draft', async (c) => {
    const id = videoId(c.req.param('id'));
    const video = owned(id);
    if (video.status === 'uploaded') throw new ReviewError('this video is on YouTube already; edit it in YouTube Studio', 409);
    const d = DraftInput.parse(await c.req.json());
    db.prepare("UPDATE videos SET title = ?, description = ?, hashtags = ?, updated_at = datetime('now') WHERE id = ?").run(d.title, d.description, JSON.stringify(d.hashtags), id);
    return c.json({ ok: true });
  });

  app.post('/api/clips/videos/:id/script-review', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json(decideScript(db, id, await c.req.json(), CLIPS));
  });

  app.post('/api/clips/videos/:id/video-review', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json(decideVideo(db, id, await c.req.json(), CLIPS));
  });

  /** Thomas uploaded it in YouTube Studio and pastes the link. */
  app.post('/api/clips/videos/:id/uploaded', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json(markUploaded(db, id, await c.req.json(), CLIPS));
  });

  /** Thomas approved it (or clicked Upload): upload it now, public on the next open day. */
  app.post('/api/clips/videos/:id/publish', async (c) => {
    const id = videoId(c.req.param('id'));
    const yt = clipsYoutube?.();
    if (!yt) throw new ReviewError('Curious Clips is not connected to YouTube yet: run npm run youtube:auth -- --channel clips, then try again', 409);
    try {
      return c.json(await publishClip(db, id, yt, { runsRoot, pendingDir: resolve(runsRoot, '_publish'), log: (m) => console.log(`[clips publish] ${m}`) }));
    } catch (e) {
      if (e instanceof ClipPublishError) throw new ReviewError(e.message, e.status);
      // A YouTube refusal (quota, auth) is shown as is; the video stays in Ready to upload.
      throw new ReviewError(`YouTube upload failed: ${(e as Error).message}`, 502);
    }
  });
}
