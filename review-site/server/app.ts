/**
 * Review site API (CLAUDE.md §9). Local only, no auth. Every status change
 * goes through src/review/decide.ts → the state machine.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { ReviewError, assetsNeedingReview, decide, saveDraft } from '../../src/review/decide.js';
import { STATUSES } from '../../src/db/status.js';
import { postingQueue } from '../../src/publish/queue.js';

export interface AppDeps {
  db: Database.Database;
  runsRoot: string;
}

const HISTORY = ['approved', 'rejected', 'changes_requested', 'scheduled', 'published', 'failed'];

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

/** Parse "bytes=start-end" (single range). Returns null if unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // suffix range: last N bytes
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

export function createApp({ db, runsRoot }: AppDeps) {
  const app = new Hono();
  const runFile = (id: number, name: string) => resolve(runsRoot, String(id), name);

  app.onError((err, c) => {
    if (err instanceof ReviewError) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => i.message).join('; ') }, 400);
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  const videoId = (raw: string) => {
    if (!/^\d+$/.test(raw)) throw new ReviewError('bad video id', 400);
    return Number(raw);
  };

  // ---- Lists ------------------------------------------------------------------
  app.get('/api/videos', (c) => {
    const wanted = (c.req.query('status') ?? 'in_review').split(',').filter(Boolean);
    const statuses = wanted.includes('history') ? HISTORY : wanted;
    if (statuses.some((s) => !(STATUSES as readonly string[]).includes(s))) throw new ReviewError('unknown status', 400);
    const q = `%${(c.req.query('q') ?? '').trim()}%`;
    const rows = db
      .prepare(
        `SELECT v.id, v.topic, v.status, v.title, v.duration_s, v.created_at, v.updated_at, v.revision_count,
                (SELECT COUNT(*) FROM assets a WHERE a.video_id = v.id AND a.rights_status = 'needs_review') AS rights_warnings,
                (SELECT decision || '|' || created_at FROM reviews r WHERE r.video_id = v.id ORDER BY r.id DESC LIMIT 1) AS last_review
         FROM videos v
         WHERE v.status IN (${statuses.map(() => '?').join(',')}) AND (v.title LIKE ? OR v.topic LIKE ?)
         ORDER BY v.updated_at DESC, v.id DESC`,
      )
      .all(...statuses, q, q);
    return c.json({ videos: rows });
  });

  // ---- Automation health (Phase 3) ---------------------------------------------------
  app.get('/api/automation', (c) => {
    const runs = db
      .prepare('SELECT id, trigger, started_at, finished_at, topic, video_id, outcome, duration_s, error FROM automation_runs ORDER BY id DESC LIMIT 5')
      .all();
    return c.json({ runs });
  });

  // ---- Posting (Phase 4) -------------------------------------------------------------
  app.get('/api/publishing', (c) => {
    const next = postingQueue(db).map(({ id, title, topic, approved_at }) => ({ id, title: title ?? topic, approved_at }));
    const posted = db
      .prepare(
        `SELECT p.video_id, v.title, p.url, p.visibility, p.playlist_id IS NOT NULL AS in_playlist, p.method, p.posted_at
         FROM posts p JOIN videos v ON v.id = p.video_id ORDER BY p.id DESC LIMIT 10`,
      )
      .all();
    const held = db.prepare('SELECT id, title, do_not_post_reason AS reason FROM videos WHERE do_not_post = 1 ORDER BY id').all();
    return c.json({ next, posted, held });
  });

  // ---- Detail ---------------------------------------------------------------------
  app.get('/api/videos/:id', (c) => {
    const id = videoId(c.req.param('id'));
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!video) throw new ReviewError(`video ${id} not found`, 404);

    const scriptRow = db.prepare('SELECT id, version, body_json, word_count, reading_grade FROM scripts WHERE video_id = ? ORDER BY version DESC LIMIT 1').get(id) as
      | { id: number; version: number; body_json: string; word_count: number; reading_grade: number }
      | undefined;
    const sources = db.prepare('SELECT id, ref, url, title, excerpt FROM sources WHERE video_id = ? ORDER BY ref').all(id);
    const factChecks = scriptRow
      ? db
          .prepare(
            `SELECT f.claim, f.verdict, f.note, s.ref AS source_ref, s.url AS source_url
             FROM fact_checks f LEFT JOIN sources s ON s.id = f.source_id WHERE f.script_id = ? ORDER BY f.id`,
          )
          .all(scriptRow.id)
      : [];
    const assets = db
      .prepare('SELECT nasa_id, media_type, title, source_url, credit, rights_status, rights_note FROM assets WHERE video_id = ? ORDER BY id')
      .all(id);
    const qaReview = readJson(runFile(id, 'qa-review.json')) as { title?: string; description?: string; hashtags?: string[] } | null;

    return c.json({
      video: { ...video, hashtags: video.hashtags ? JSON.parse(String(video.hashtags)) : null },
      script: scriptRow ? { ...JSON.parse(scriptRow.body_json), version: scriptRow.version, word_count: scriptRow.word_count, reading_grade: scriptRow.reading_grade } : null,
      sources,
      fact_checks: factChecks,
      assets,
      rights_needed: assetsNeedingReview(db, id),
      qa: readJson(runFile(id, 'qa.json')),
      qa_review: qaReview,
      // What the editor shows: Thomas's saved edits win over the agent's draft.
      draft: {
        title: (video.title as string | null) ?? qaReview?.title ?? '',
        description: (video.description as string | null) ?? qaReview?.description ?? '',
        hashtags: video.hashtags ? JSON.parse(String(video.hashtags)) : (qaReview?.hashtags ?? []),
      },
      reviews: db.prepare('SELECT id, decision, notes, created_at FROM reviews WHERE video_id = ? ORDER BY id DESC').all(id),
      posts: db.prepare('SELECT platform, url, method, posted_at FROM posts WHERE video_id = ? ORDER BY id').all(id),
      // TTS segment timings: 0 = hook, 1..n = lines, last = end question. Lets the transcript follow the player.
      segments: ((readJson(runFile(id, 'voice.json')) as { segments?: unknown[] } | null)?.segments ?? []) as unknown[],
      has_video: existsSync(runFile(id, 'final.mp4')),
      // Bonus space picture actually rendered after the end card (media:render → render-config.json).
      bonus: (() => {
        const cfg = readJson(runFile(id, 'render-config.json')) as { bonus?: Record<string, unknown> | null; bonus_skipped?: string | null } | null;
        const b = cfg?.bonus;
        if (b) return { title: b.title, credit: b.credit, date_text: b.date_text, page: b.page, asset_id: b.asset_id, start_s: b.start_s, skipped: null };
        return cfg?.bonus_skipped ? { skipped: cfg.bonus_skipped } : null;
      })(),
    });
  });

  // ---- Actions ------------------------------------------------------------------------
  app.patch('/api/videos/:id/draft', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json({ draft: saveDraft(db, id, await c.req.json()) });
  });

  app.post('/api/videos/:id/review', async (c) => {
    const id = videoId(c.req.param('id'));
    return c.json(decide(db, id, await c.req.json()));
  });

  // ---- Media --------------------------------------------------------------------------
  // Fixed file names only; the id is digits-only, so no path can escape runs/.
  app.get('/media/:id/final.mp4', (c) => {
    const path = runFile(videoId(c.req.param('id')), 'final.mp4');
    if (!existsSync(path)) return c.json({ error: 'no video' }, 404);
    const size = statSync(path).size;
    const range = c.req.header('range');
    const common = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };

    if (!range) {
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
        status: 200,
        headers: { ...common, 'Content-Length': String(size) },
      });
    }
    const r = parseRange(range, size);
    if (!r) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(path, { start: r.start, end: r.end })) as ReadableStream, {
      status: 206,
      headers: { ...common, 'Content-Length': String(r.end - r.start + 1), 'Content-Range': `bytes ${r.start}-${r.end}/${size}` },
    });
  });

  app.get('/media/:id/thumb.png', (c) => {
    const path = runFile(videoId(c.req.param('id')), 'frames/frame-1.png');
    if (!existsSync(path)) return c.json({ error: 'no thumbnail' }, 404);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
    });
  });

  return app;
}
