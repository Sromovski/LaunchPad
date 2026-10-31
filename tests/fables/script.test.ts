import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { FableScript, countWords, narrationWords, saveFableScript, scriptWarnings } from '../../src/fables/script.js';
import { decideScript } from '../../src/review/fables.js';

const SAMPLE = JSON.parse(readFileSync(new URL('../../channels/fables/samples/pf-001/script.json', import.meta.url), 'utf8'));

let db: Database.Database;
let runsRoot: string;
beforeEach(() => {
  db = openDb(':memory:');
  runsRoot = mkdtempSync(join(tmpdir(), 'launchpad-fables-'));
});
const save = (raw: unknown = SAMPLE, videoId?: number) => saveFableScript(db, raw, { videoId, createdBy: 'test', runsRoot });

describe('FableScript schema', () => {
  it('accepts the hand-written sample (pf-001, The Magic Paintbrush)', () => {
    const s = FableScript.parse(SAMPLE);
    expect(s.scenes).toHaveLength(10);
    expect(s.youtube.made_for_kids).toBe(true);
  });

  it('refuses made_for_kids false, unknown lanes and out-of-order scenes', () => {
    expect(FableScript.safeParse({ ...SAMPLE, youtube: { ...SAMPLE.youtube, made_for_kids: false } }).success).toBe(false);
    expect(FableScript.safeParse({ ...SAMPLE, lane: 'horror' }).success).toBe(false);
    const swapped = [SAMPLE.scenes[1], SAMPLE.scenes[0], ...SAMPLE.scenes.slice(2)];
    expect(FableScript.safeParse({ ...SAMPLE, scenes: swapped }).success).toBe(false);
  });

  it('counts spoken words, not punctuation', () => {
    expect(countWords('Whoosh! The ship — sailed.')).toBe(4);
    expect(narrationWords(FableScript.parse(SAMPLE))).toBeGreaterThan(120);
  });

  it('warns (does not fail) on word count, runtime and description rules', () => {
    const s = FableScript.parse(SAMPLE);
    const w = scriptWarnings({ ...s, scenes: s.scenes.slice(0, 3) });
    expect(w.join('\n')).toMatch(/spoken words/);
    expect(w.join('\n')).toMatch(/add up to/);
    expect(scriptWarnings({ ...s, youtube: { ...s.youtube, description: 'A fun story.' } }).join('\n')).toMatch(/culture of origin/);
    expect(scriptWarnings(s).join('\n')).toMatch(/AI-generated/); // the sample's description doesn't have the line yet
  });
});

describe('saveFableScript', () => {
  it('creates a fables video in script_review with files and a version-1 script row', () => {
    const r = save();
    expect(r).toMatchObject({ version: 1, status: 'script_review' });
    expect(db.prepare('SELECT channel, status, topic FROM videos WHERE id = ?').get(r.video_id)).toEqual({
      channel: 'fables',
      status: 'script_review',
      topic: 'The Magic Paintbrush',
    });
    const row = db.prepare('SELECT lane, origin, scenes_json, word_count, hook FROM scripts WHERE video_id = ?').get(r.video_id) as Record<string, string>;
    expect(row.lane).toBe('folktale');
    expect(row.origin).toMatch(/China/);
    expect(JSON.parse(row.scenes_json!)).toHaveLength(10);
    expect(row.hook).toMatch(/Hi, I'm Pip/);
    const onDisk = JSON.parse(readFileSync(join(runsRoot, String(r.video_id), 'script.json'), 'utf8'));
    expect(onDisk.video_id).toBe(String(r.video_id));
    expect(readFileSync(join(runsRoot, String(r.video_id), 'script.md'), 'utf8')).toMatch(/^# The Magic Paintbrush/);
  });

  it('never approves: the video stops at script_review', () => {
    const r = save();
    expect(r.status).toBe('script_review');
    expect(db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'script_approved'").get()).toEqual({ n: 0 });
  });

  it('refuses a second copy of the same story', () => {
    const r = save();
    expect(() => save()).toThrow(new RegExp(`already video ${r.video_id}`));
  });

  it('writes nothing when the script is invalid', () => {
    expect(() => save({ ...SAMPLE, scenes: [] })).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM videos').get()).toEqual({ n: 0 });
  });

  it('a revision is only possible after Thomas asked for changes, and keeps the old version', () => {
    const { video_id: id } = save();
    expect(() => save(SAMPLE, id)).toThrow(/only be revised after/);

    decideScript(db, id, { decision: 'changes_requested', notes: 'Make the emperor sillier' });
    const r = save({ ...SAMPLE, lesson: 'Share your gifts.' }, id);
    expect(r).toMatchObject({ video_id: id, version: 2, status: 'script_review' });
    expect(db.prepare('SELECT revision_count FROM videos WHERE id = ?').get(id)).toEqual({ revision_count: 1 });
    expect(db.prepare('SELECT version FROM scripts WHERE video_id = ? ORDER BY version').all(id)).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('refuses to revise a NASA video', () => {
    const id = Number(db.prepare("INSERT INTO videos (topic, status) VALUES ('Blue sunsets', 'changes_requested')").run().lastInsertRowid);
    expect(() => save(SAMPLE, id)).toThrow(/not Pocket Fables/);
    expect(existsSync(join(runsRoot, String(id)))).toBe(false);
  });
});

describe('decideScript (gate 1)', () => {
  it.each([
    ['approved', 'script_approved'],
    ['changes_requested', 'script_changes'],
    ['rejected', 'rejected'],
  ])('%s → %s, recorded as a script-gate review', (decision, status) => {
    const { video_id: id } = save();
    decideScript(db, id, { decision, notes: 'note' });
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status });
    expect(db.prepare('SELECT decision, gate, notes FROM reviews WHERE video_id = ?').get(id)).toEqual({ decision, gate: 'script', notes: '[script v1] note' });
  });

  it('request changes needs notes', () => {
    const { video_id: id } = save();
    expect(() => decideScript(db, id, { decision: 'changes_requested', notes: '  ' })).toThrow(/notes/);
  });

  it('refuses when not in script_review, for NASA videos, and for a stale version', () => {
    const { video_id: id } = save();
    expect(() => decideScript(db, id, { decision: 'approved', version: 2 })).toThrow(/version 1/);
    decideScript(db, id, { decision: 'approved' });
    expect(() => decideScript(db, id, { decision: 'approved' })).toThrow(/not script_review/);
    const nasa = Number(db.prepare("INSERT INTO videos (topic, status) VALUES ('x', 'in_review')").run().lastInsertRowid);
    expect(() => decideScript(db, nasa, { decision: 'approved' })).toThrow(/not found/);
  });
});
