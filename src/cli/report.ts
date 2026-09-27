/** npm run report → docs/RUN_LOG.md */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { buildRunLog, scheduledStreak, type RunRow, type StepRow } from '../automation/report.js';
import { main } from './_lib.js';

await main((db) => {
  const rows = db
    .prepare(
      `SELECT a.*, v.status AS video_status,
              (SELECT r.decision FROM reviews r WHERE r.video_id = a.video_id ORDER BY r.id ASC LIMIT 1) AS first_decision
       FROM automation_runs a LEFT JOIN videos v ON v.id = a.video_id ORDER BY a.id`,
    )
    .all() as RunRow[];
  const steps = db
    .prepare(
      `SELECT step, COUNT(*) AS runs, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
              AVG(CASE WHEN finished_at IS NOT NULL THEN (julianday(finished_at) - julianday(started_at)) * 86400 END) AS avg_s
       FROM runs GROUP BY step ORDER BY MIN(id)`,
    )
    .all() as StepRow[];
  const file = resolve(PROJECT_ROOT, 'docs/RUN_LOG.md');
  writeFileSync(file, buildRunLog(rows, steps));
  return { file: 'docs/RUN_LOG.md', runs: rows.length, scheduled_streak: scheduledStreak(rows) };
});
