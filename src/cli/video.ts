/**
 * Orchestration commands used by /make-video (so agents never touch the DB directly):
 *   video:new    -- --topic "..."
 *   video:status -- --video <id> --to <status> [--error "..."]
 *   video:show   -- --video <id>
 *   run:start    -- --video <id> --step <step> [--agent <name>]
 *   run:finish   -- --video <id> --step <step> --ok true|false
 *   video:reset  -- --video <id> --reason "..." (Thomas only; denied to agents in .claude/settings.json)
 *   video:mark-posted -- --video <id> --url <youtube link>   (Thomas hand-posted it; denied to agents)
 *   video:hold   -- --video <id> --reason "..."   (keep an approved video off the channel; denied to agents)
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { playlistForTopic } from '../automation/topics.js';
import { PROJECT_ROOT } from '../db/index.js';
import { STATUSES, manualReset, transitionVideo, type Status, type VideoState } from '../db/status.js';
import { args, getVideo, logger, main, requireVideoId, runDir } from './_lib.js';
import { recordPost } from '../publish/posts.js';
import { holdVideo } from '../publish/queue.js';

const command = process.argv[2];
process.argv.splice(2, 1);
const a = args({
  topic: { type: 'string' },
  video: { type: 'string' },
  to: { type: 'string' },
  error: { type: 'string' },
  step: { type: 'string' },
  agent: { type: 'string' },
  ok: { type: 'string' },
  reason: { type: 'string' },
  url: { type: 'string' },
});

await main((db) => {
  switch (command) {
    case 'new': {
      if (!a.topic?.trim()) throw new Error('--topic is required');
      // The topic's world section in docs/TOPICS.md decides its YouTube playlist.
      const topicsFile = resolve(PROJECT_ROOT, 'docs/TOPICS.md');
      const playlist = existsSync(topicsFile) ? playlistForTopic(readFileSync(topicsFile, 'utf8'), a.topic) : null;
      const id = Number(db.prepare('INSERT INTO videos (topic, playlist) VALUES (?, ?)').run(a.topic.trim(), playlist).lastInsertRowid);
      const dir = relative(PROJECT_ROOT, runDir(id)).replace(/\\/g, '/');
      db.prepare('UPDATE videos SET run_dir = ? WHERE id = ?').run(dir, id);
      return { video_id: id, run_dir: dir, status: 'idea', playlist };
    }
    case 'status': {
      const id = requireVideoId(a.video);
      if (!a.to || !(STATUSES as readonly string[]).includes(a.to)) throw new Error(`--to must be one of ${STATUSES.join(', ')}`);
      const before = getVideo(db, id).status;
      const after = transitionVideo(db, id, a.to as Status, { error: a.error });
      return { video_id: id, from: before, ...after };
    }
    case 'show': {
      const id = requireVideoId(a.video);
      const assets = db.prepare('SELECT id, nasa_id, media_type, credit, rights_status FROM assets WHERE video_id = ?').all(id);
      const reviews = db.prepare('SELECT decision, notes, created_at FROM reviews WHERE video_id = ? ORDER BY id DESC').all(id);
      return { video: getVideo(db, id), assets, reviews };
    }
    case 'run-start': {
      const id = requireVideoId(a.video);
      if (!a.step) throw new Error('--step is required');
      const logPath = `${runDir(id)}/logs/${a.step}.log`;
      const runId = db
        .prepare('INSERT INTO runs (video_id, step, agent, log_path) VALUES (?, ?, ?, ?)')
        .run(id, a.step, a.agent ?? null, logPath).lastInsertRowid;
      return { run_id: Number(runId) };
    }
    case 'run-finish': {
      const id = requireVideoId(a.video);
      if (!a.step || !['true', 'false'].includes(a.ok ?? '')) throw new Error('--step and --ok true|false are required');
      const open = db
        .prepare('SELECT id FROM runs WHERE video_id = ? AND step = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1')
        .get(id, a.step) as { id: number } | undefined;
      if (!open) throw new Error(`No open run for step ${a.step}`);
      db.prepare("UPDATE runs SET finished_at = datetime('now'), ok = ? WHERE id = ?").run(a.ok === 'true' ? 1 : 0, open.id);
      return { run_id: open.id };
    }
    case 'reset': {
      const id = requireVideoId(a.video);
      if (!a.reason?.trim()) throw new Error('--reason is required (why this failure should not count)');
      const before = db.prepare('SELECT status, revision_count, retry_count, failed_from_status, error FROM videos WHERE id = ?').get(id) as (VideoState & { error: string | null }) | undefined;
      if (!before) throw new Error(`Video ${id} not found`);
      const after = manualReset(before);
      db.transaction(() => {
        db.prepare("UPDATE videos SET status = ?, failed_from_status = NULL, error = NULL, updated_at = datetime('now') WHERE id = ?").run(after.status, id);
        db.prepare("INSERT INTO runs (video_id, step, agent, finished_at, ok, log_path) VALUES (?, 'manual-reset', 'Thomas', datetime('now'), 1, ?)").run(id, `logs/manual-reset.log`);
      })();
      logger(id, 'manual-reset')(`reset ${before.status} -> ${after.status}. Previous error: ${before.error ?? '(none)'}. Reason: ${a.reason.trim()}`);
      return { video_id: id, from: 'failed', to: after.status, reason: a.reason.trim() };
    }
    case 'mark-posted': {
      const id = requireVideoId(a.video);
      if (!a.url) throw new Error('--url <youtube link> is required');
      return { post: recordPost(db, id, 'youtube', a.url, 'manual'), status: getVideo(db, id).status };
    }
    case 'hold': {
      const id = requireVideoId(a.video);
      holdVideo(db, id, a.reason ?? '');
      return { video_id: id, held: true, reason: a.reason };
    }
    default:
      throw new Error(`unknown command "${command}" (new|status|show|run-start|run-finish|reset|mark-posted|hold)`);
  }
});
