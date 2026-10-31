/**
 * A DB file made before Pocket Fables (videos CHECK allowed only blast/wonder and the
 * NASA statuses) is rebuilt in place on open, keeping every row, id and child row.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/index.js';

const OLD_SCHEMA = readFileSync(new URL('../fixtures/schema-before-fables.sql', import.meta.url), 'utf8');

function oldDbFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'launchpad-mig-')), 'old.db');
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.exec(OLD_SCHEMA);
  db.exec(`
    INSERT INTO videos (id, topic, channel, status, title, hashtags) VALUES (1, 'Blue sunsets', 'blast', 'approved', 'Blue Sunsets', '["#Mars"]');
    INSERT INTO videos (id, topic, channel, status) VALUES (2, 'Why is the sky blue?', 'wonder', 'in_review');
    INSERT INTO videos (id, topic) VALUES (3, 'deleted later');
    INSERT INTO reviews (video_id, decision, notes) VALUES (1, 'approved', 'lovely');
    INSERT INTO assets (video_id, nasa_id, media_type, source_url) VALUES (2, 'PIA1', 'image', 'u');
    INSERT INTO posts (video_id, platform, external_id, url, method) VALUES (1, 'youtube', 'abc', 'https://youtu.be/abc', 'api');
    DELETE FROM videos WHERE id = 3;
  `);
  expect(() => db.prepare("INSERT INTO videos (topic, channel) VALUES ('x', 'fables')").run()).toThrow(/CHECK/);
  db.close();
  return path;
}

describe('videos table rebuild for Pocket Fables', () => {
  it('widens the channel and status CHECKs', () => {
    const db = openDb(oldDbFile());
    const id = Number(db.prepare("INSERT INTO videos (topic, channel, status) VALUES ('The Magic Paintbrush', 'fables', 'script_review')").run().lastInsertRowid);
    expect(db.prepare('SELECT channel, status FROM videos WHERE id = ?').get(id)).toEqual({ channel: 'fables', status: 'script_review' });
    expect(() => db.prepare("INSERT INTO videos (topic, channel) VALUES ('x', 'bogus')").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO videos (topic, status) VALUES ('x', 'bogus')").run()).toThrow(/CHECK/);
  });

  it('keeps every video, its columns and its child rows', () => {
    const db = openDb(oldDbFile());
    expect(db.prepare('SELECT id, topic, channel, status, title, hashtags FROM videos ORDER BY id').all()).toEqual([
      { id: 1, topic: 'Blue sunsets', channel: 'blast', status: 'approved', title: 'Blue Sunsets', hashtags: '["#Mars"]' },
      { id: 2, topic: 'Why is the sky blue?', channel: 'wonder', status: 'in_review', title: null, hashtags: null },
    ]);
    expect(db.prepare('SELECT video_id, decision, gate FROM reviews').all()).toEqual([{ video_id: 1, decision: 'approved', gate: 'video' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 1 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('foreign keys still point at the rebuilt table (cascade still works)', () => {
    const db = openDb(oldDbFile());
    expect(() => db.prepare("INSERT INTO reviews (video_id, decision) VALUES (999, 'approved')").run()).toThrow(/FOREIGN KEY/);
    db.prepare('DELETE FROM posts').run();
    db.prepare('DELETE FROM videos WHERE id = 2').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 0 });
  });

  it('never reuses the id of a deleted newest video (its runs/<id>/ folder may exist)', () => {
    const db = openDb(oldDbFile());
    const id = Number(db.prepare("INSERT INTO videos (topic) VALUES ('next')").run().lastInsertRowid);
    expect(id).toBe(4);
  });

  it('adds the new scripts columns and the credits table; reopening is a no-op', () => {
    const path = oldDbFile();
    openDb(path).close();
    const db = openDb(path);
    const cols = (db.prepare('PRAGMA table_info(scripts)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['scenes_json', 'lane', 'origin']));
    db.prepare("INSERT INTO credits (video_id, credits_used, balance_after) VALUES (1, 12.5, 100)").run();
    expect(() => db.prepare("INSERT INTO reviews (video_id, decision, gate) VALUES (1, 'approved', 'thumbnail')").run()).toThrow(/CHECK/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM videos').get()).toEqual({ n: 2 });
  });
});
