/**
 * Orchestration commands used by /make-video (so agents never touch the DB directly):
 *   video:new    -- --topic "..."
 *   video:status -- --video <id> --to <status> [--error "..."]
 *   video:show   -- --video <id>
 *   run:start    -- --video <id> --step <step> [--agent <name>]
 *   run:finish   -- --video <id> --step <step> --ok true|false
 */
import { relative } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { STATUSES, transitionVideo, type Status } from '../db/status.js';
import { args, getVideo, main, requireVideoId, runDir } from './_lib.js';

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
});

await main((db) => {
  switch (command) {
    case 'new': {
      if (!a.topic?.trim()) throw new Error('--topic is required');
      const id = Number(db.prepare('INSERT INTO videos (topic) VALUES (?)').run(a.topic.trim()).lastInsertRowid);
      const dir = relative(PROJECT_ROOT, runDir(id)).replace(/\\/g, '/');
      db.prepare('UPDATE videos SET run_dir = ? WHERE id = ?').run(dir, id);
      return { video_id: id, run_dir: dir, status: 'idea' };
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
      return { video: getVideo(db, id), assets };
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
    default:
      throw new Error(`unknown command "${command}" (new|status|show|run-start|run-finish)`);
  }
});
