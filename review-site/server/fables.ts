/**
 * Pocket Fables tab API (channels/fables/CLAUDE.md §3). Separate from the NASA routes:
 * its own statuses, two gates, no NASA assets or fact checks.
 * Scripts to review, Videos to review, Ready to upload (Mark uploaded) and the credits panel.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { FABLES } from '../../src/channels.js';
import { FABLES_STATUSES } from '../../src/db/status.js';
import { FableScript, scriptWarnings, sceneSeconds } from '../../src/fables/script.js';
import { ReviewError } from '../../src/review/decide.js';
import { creditsSummary } from '../../src/fables/render.js';
import { decideScript, decideVideo, markUploaded } from '../../src/review/fables.js';

/** Queues the tab shows, by the status each holds. */
const QUEUES = ['script_review', 'video_review', 'approved'] as const;

export function fablesRoutes(app: Hono, db: Database.Database, runsRoot: string, videoId: (raw: string) => number) {
  const readJson = (id: number, name: string): unknown => {
    const p = resolve(runsRoot, String(id), name);
    try {
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    } catch {
      return null;
    }
  };
  app.get('/api/fables/videos', (c) => {
    const status = c.req.query('status') ?? 'script_review';
    if (!(FABLES_STATUSES as readonly string[]).includes(status)) throw new ReviewError('unknown status', 400);
    const rows = db
      .prepare(
        `SELECT v.id, v.topic, v.title, v.status, v.revision_count, v.created_at, v.updated_at,
                s.version, s.lane, s.origin, s.word_count, s.body_json,
                (SELECT decision || '|' || created_at FROM reviews r WHERE r.video_id = v.id ORDER BY r.id DESC LIMIT 1) AS last_review,
                (SELECT url FROM posts p WHERE p.video_id = v.id AND p.platform = 'youtube') AS youtube_url
         FROM videos v
         LEFT JOIN scripts s ON s.video_id = v.id AND s.version = (SELECT MAX(version) FROM scripts WHERE video_id = v.id)
         WHERE v.channel = ? AND v.status = ?
         ORDER BY v.updated_at DESC, v.id DESC`,
      )
      .all(FABLES.key, status) as ({ body_json: string | null } & Record<string, unknown>)[];
    const videos = rows.map(({ body_json, ...r }) => {
      const s = body_json ? FableScript.safeParse(JSON.parse(body_json)) : null;
      return {
        ...r,
        lesson: s?.success ? s.data.lesson : null,
        est_seconds: s?.success ? sceneSeconds(s.data) : null,
        scene_count: s?.success ? s.data.scenes.length : null,
      };
    });
    return c.json({ videos });
  });

  /** Credits panel: the last balance Claude saw, and what renders cost this month. */
  app.get('/api/fables/credits', (c) => c.json(creditsSummary(db)));

  /** Counts for the tab badge and the queue switcher. */
  app.get('/api/fables/counts', (c) => {
    const rows = db.prepare("SELECT status, COUNT(*) AS n FROM videos WHERE channel = ? GROUP BY status").all(FABLES.key) as { status: string; n: number }[];
    const counts = Object.fromEntries(QUEUES.map((q) => [q, rows.find((r) => r.status === q)?.n ?? 0]));
    return c.json({ counts });
  });

  app.get('/api/fables/videos/:id', (c) => {
    const id = videoId(c.req.param('id'));
    const video = db
      .prepare('SELECT id, channel, topic, title, status, revision_count, duration_s, error, created_at, updated_at FROM videos WHERE id = ?')
      .get(id) as { channel: string } | undefined;
    if (!video || video.channel !== FABLES.key) throw new ReviewError(`Pocket Fables video ${id} not found`, 404);

    const row = db
      .prepare('SELECT version, body_json, created_by FROM scripts WHERE video_id = ? ORDER BY version DESC LIMIT 1')
      .get(id) as { version: number; body_json: string; created_by: string | null } | undefined;
    let script: FableScript | null = null;
    let problem: string | null = null;
    if (row) {
      const parsed = FableScript.safeParse(JSON.parse(row.body_json));
      if (parsed.success) script = parsed.data;
      else problem = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }
    const versions = (db.prepare('SELECT COUNT(*) AS n FROM scripts WHERE video_id = ?').get(id) as { n: number }).n;
    return c.json({
      video,
      script,
      script_version: row?.version ?? null,
      script_versions: versions,
      script_by: row?.created_by ?? null,
      script_problem: problem,
      warnings: script ? scriptWarnings(script) : [],
      est_seconds: script ? sceneSeconds(script) : null,
      reviews: db.prepare('SELECT id, gate, decision, notes, created_at FROM reviews WHERE video_id = ? ORDER BY id DESC').all(id),
      has_video: existsSync(resolve(runsRoot, String(id), 'final.mp4')),
      qa: readJson(id, 'qa.json'),
      credits: db.prepare('SELECT credits_used, balance_after, created_at FROM credits WHERE video_id = ? ORDER BY id').all(id),
      post: db.prepare("SELECT url, posted_at FROM posts WHERE video_id = ? AND platform = 'youtube'").get(id) ?? null,
    });
  });

  /** Gate 1. Approve here is the only way a script reaches Everygen. */
  app.post('/api/fables/videos/:id/script-review', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json(decideScript(db, id, await c.req.json()));
  });

  /** Gate 2: the rendered video. */
  app.post('/api/fables/videos/:id/video-review', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json(decideVideo(db, id, await c.req.json()));
  });

  /** Step 4: Thomas uploaded it in YouTube Studio and pastes the link. */
  app.post('/api/fables/videos/:id/uploaded', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json(markUploaded(db, id, await c.req.json()));
  });
}
