import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { IllegalTransitionError, transitionVideo } from '../../src/db/status.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
});

const newVideo = (topic = 'Why are sunsets on Mars blue?') =>
  Number(db.prepare('INSERT INTO videos (topic) VALUES (?)').run(topic).lastInsertRowid);

describe('schema', () => {
  it('creates all §5 tables', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_'))
      .sort();
    expect(names).toEqual(['assets', 'fact_checks', 'reviews', 'runs', 'scripts', 'sources', 'videos']);
  });

  it('is idempotent (re-applying does not throw)', () => {
    expect(() => openDb(':memory:')).not.toThrow();
  });

  it('new videos start as idea', () => {
    const id = newVideo();
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'idea' });
  });

  it('rejects bad enum values', () => {
    const id = newVideo();
    expect(() => db.prepare("UPDATE videos SET status = 'bogus' WHERE id = ?").run(id)).toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO assets (video_id, nasa_id, media_type, source_url, rights_status) VALUES (?, 'x', 'video', 'u', 'maybe')")
        .run(id),
    ).toThrow();
  });

  it('assets default to needs_review (rights first: never assume clear)', () => {
    const id = newVideo();
    db.prepare("INSERT INTO assets (video_id, nasa_id, media_type, source_url) VALUES (?, 'PIA1', 'video', 'u')").run(id);
    expect(db.prepare('SELECT rights_status FROM assets').get()).toEqual({ rights_status: 'needs_review' });
  });

  it('enforces foreign keys', () => {
    expect(() => db.prepare("INSERT INTO reviews (video_id, decision) VALUES (999, 'approved')").run()).toThrow();
  });

  it('requires valid JSON in scripts.body_json', () => {
    const id = newVideo();
    expect(() =>
      db.prepare("INSERT INTO scripts (video_id, version, hook, body_json) VALUES (?, 1, 'h', 'not json')").run(id),
    ).toThrow();
  });
});

describe('transitionVideo', () => {
  it('persists a legal transition', () => {
    const id = newVideo();
    transitionVideo(db, id, 'researched');
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'researched' });
  });

  it('throws and leaves the row untouched on an illegal move', () => {
    const id = newVideo();
    expect(() => transitionVideo(db, id, 'approved')).toThrow(IllegalTransitionError);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'idea' });
  });

  it('stores the error on failure and clears it on retry', () => {
    const id = newVideo();
    transitionVideo(db, id, 'failed', { error: 'NASA API timeout' });
    expect(db.prepare('SELECT status, error, failed_from_status FROM videos WHERE id = ?').get(id)).toEqual({
      status: 'failed',
      error: 'NASA API timeout',
      failed_from_status: 'idea',
    });
    transitionVideo(db, id, 'idea');
    expect(db.prepare('SELECT status, error, retry_count FROM videos WHERE id = ?').get(id)).toEqual({
      status: 'idea',
      error: null,
      retry_count: 1,
    });
  });

  it('throws for a missing video', () => {
    expect(() => transitionVideo(db, 42, 'researched')).toThrow(/not found/);
  });
});
