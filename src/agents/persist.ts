/**
 * Writes validated agent outputs into SQLite. Each function assumes its input
 * already passed the zod schema; these add the cross-checks a schema can't
 * do (does the asset exist? is it rejected? does the source id exist?).
 */
import type Database from 'better-sqlite3';
import type { FactCheck, QaReview, Render, Research, Script } from './schemas.js';
import type { ScriptValidation } from '../script/validate.js';

interface AssetRow {
  nasa_id: string;
  rights_status: string;
}

export function saveResearch(db: Database.Database, videoId: number, r: Research): { sources: number } {
  const assets = db.prepare('SELECT nasa_id, rights_status FROM assets WHERE video_id = ?').all(videoId) as AssetRow[];
  const byId = new Map(assets.map((a) => [a.nasa_id, a]));
  for (const pick of [r.primary_asset, ...r.supporting_assets]) {
    const a = byId.get(pick.nasa_id);
    if (!a) throw new Error(`asset ${pick.nasa_id} was not fetched (run nasa:fetch first)`);
    if (a.rights_status === 'rejected') throw new Error(`asset ${pick.nasa_id} has rejected rights`);
  }

  const upsert = db.prepare(
    `INSERT INTO sources (video_id, ref, url, title, excerpt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (video_id, ref) DO UPDATE SET url = excluded.url, title = excluded.title, excerpt = excluded.excerpt`,
  );
  db.transaction(() => {
    for (const s of r.sources) upsert.run(videoId, s.id, s.url, s.title, s.excerpt);
  })();
  return { sources: r.sources.length };
}

export function saveScript(
  db: Database.Database,
  videoId: number,
  s: Script,
  v: ScriptValidation,
  createdBy = 'scriptwriter',
): { script_id: number; version: number } {
  if (!v.ok) throw new Error(`script failed validation: ${v.errors.join('; ')}`);
  const { next } = db
    .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM scripts WHERE video_id = ?')
    .get(videoId) as { next: number };
  const id = db
    .prepare(
      `INSERT INTO scripts (video_id, version, hook, body_json, word_count, reading_grade, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(videoId, next, s.hook, JSON.stringify(s), v.word_count, v.reading_grade, createdBy).lastInsertRowid;
  db.prepare("UPDATE videos SET title = ?, updated_at = datetime('now') WHERE id = ?").run(s.title, videoId);
  return { script_id: Number(id), version: next };
}

export function latestScriptId(db: Database.Database, videoId: number): number {
  const row = db.prepare('SELECT id FROM scripts WHERE video_id = ? ORDER BY version DESC LIMIT 1').get(videoId) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`video ${videoId} has no saved script`);
  return row.id;
}

/** Replaces the fact checks for the latest script version. */
export function saveFactCheck(db: Database.Database, videoId: number, f: FactCheck): { script_id: number; claims: number; pass: boolean } {
  const scriptId = latestScriptId(db, videoId);
  // Extra pages the fact-checker relied on become stored sources first (§2.5).
  const upsertSource = db.prepare(
    `INSERT INTO sources (video_id, ref, url, title, excerpt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (video_id, ref) DO UPDATE SET url = excluded.url, title = excluded.title, excerpt = excluded.excerpt`,
  );
  for (const s of f.extra_sources) upsertSource.run(videoId, s.id, s.url, s.title, s.excerpt);
  const refs = new Map(
    (db.prepare('SELECT id, ref FROM sources WHERE video_id = ?').all(videoId) as { id: number; ref: string }[]).map((r) => [r.ref, r.id]),
  );
  const insert = db.prepare('INSERT INTO fact_checks (script_id, claim, source_id, verdict, note) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM fact_checks WHERE script_id = ?').run(scriptId);
    for (const c of f.claims) {
      let sourceId: number | null = null;
      if (c.source_id) {
        sourceId = refs.get(c.source_id) ?? null;
        if (sourceId === null) throw new Error(`claim cites unknown source "${c.source_id}"`);
      }
      insert.run(scriptId, c.claim, sourceId, c.verdict, c.note);
    }
  })();
  return { script_id: scriptId, claims: f.claims.length, pass: f.pass };
}

export function saveRender(db: Database.Database, videoId: number, r: Render) {
  db.prepare("UPDATE videos SET final_path = ?, duration_s = ?, updated_at = datetime('now') WHERE id = ?").run(
    r.final_path,
    r.duration_s,
    videoId,
  );
  return { final_path: r.final_path, duration_s: r.duration_s };
}

export function saveQaReview(db: Database.Database, videoId: number, q: QaReview) {
  // The review site edits these; Phase 4 publishes them.
  db.prepare("UPDATE videos SET title = ?, description = ?, hashtags = ?, updated_at = datetime('now') WHERE id = ?").run(
    q.title,
    q.description,
    JSON.stringify(q.hashtags),
    videoId,
  );
  return { pass: q.pass, title: q.title };
}
