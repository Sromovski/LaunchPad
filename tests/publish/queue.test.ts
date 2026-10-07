import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { holdVideo, nextToPost, postingQueue } from '../../src/publish/queue.js';
import { recordPost, setPlaylist } from '../../src/publish/posts.js';

let db: Database.Database;

function video(status: string, approvedAt: string | null, title = 'T') {
  const id = Number(db.prepare('INSERT INTO videos (topic, status, title) VALUES (?, ?, ?)').run('t', status, title).lastInsertRowid);
  if (approvedAt) db.prepare("INSERT INTO reviews (video_id, decision, created_at) VALUES (?, 'approved', ?)").run(id, approvedAt);
  return id;
}

beforeEach(() => {
  db = openDb(':memory:');
});

describe('postingQueue', () => {
  it('approved videos, oldest approval first', () => {
    const late = video('approved', '2026-09-27 14:13:00');
    const early = video('approved', '2026-09-27 14:12:00');
    video('in_review', null);
    video('rejected', null);
    expect(postingQueue(db).map((v) => v.id)).toEqual([early, late]);
    expect(nextToPost(db, 'blast')?.id).toBe(early);
  });

  it('skips held and already-posted videos', () => {
    const a = video('approved', '2026-09-27 10:00:00');
    const b = video('approved', '2026-09-27 11:00:00');
    const c = video('approved', '2026-09-27 12:00:00');
    holdVideo(db, a, 'superseded by a remake');
    recordPost(db, b, 'youtube', 'https://youtu.be/AAAAAAAAAAA', 'manual');
    expect(postingQueue(db).map((v) => v.id)).toEqual([c]);
  });

  it('one queue per channel; no channel = every channel (review site)', () => {
    const blast = video('approved', '2026-09-27 10:00:00');
    const wonder = video('approved', '2026-09-27 09:00:00');
    db.prepare("UPDATE videos SET channel = 'wonder' WHERE id = ?").run(wonder);
    expect(postingQueue(db, 'blast').map((v) => v.id)).toEqual([blast]);
    expect(postingQueue(db, 'wonder').map((v) => v.id)).toEqual([wonder]);
    expect(nextToPost(db, 'wonder')).toMatchObject({ id: wonder, channel: 'wonder' });
    expect(postingQueue(db).map((v) => v.id)).toEqual([wonder, blast]);
  });

  it('empty queue → undefined', () => {
    expect(nextToPost(db, 'blast')).toBeUndefined();
  });
});

describe('holdVideo', () => {
  it('needs a reason and an existing video', () => {
    const a = video('approved', '2026-09-27 10:00:00');
    expect(() => holdVideo(db, a, ' ')).toThrow(/reason/);
    expect(() => holdVideo(db, 999, 'x')).toThrow(/not found/);
    holdVideo(db, a, 'unsourced opening line');
    expect(db.prepare('SELECT do_not_post, do_not_post_reason FROM videos WHERE id = ?').get(a)).toEqual({
      do_not_post: 1,
      do_not_post_reason: 'unsourced opening line',
    });
  });
});

describe('recordPost via the API', () => {
  it('stores visibility (unaudited projects are forced private) and the playlist later', () => {
    const a = video('approved', '2026-09-27 10:00:00');
    recordPost(db, a, 'youtube', 'https://youtu.be/BBBBBBBBBBB', 'api', 'private');
    setPlaylist(db, a, 'youtube', 'PL123');
    expect(db.prepare('SELECT visibility, playlist_id, method FROM posts').get()).toEqual({ visibility: 'private', playlist_id: 'PL123', method: 'api' });
  });

  it('refuses a held video', () => {
    const a = video('approved', '2026-09-27 10:00:00');
    holdVideo(db, a, 'superseded');
    expect(() => recordPost(db, a, 'youtube', 'https://youtu.be/CCCCCCCCCCC', 'api')).toThrow(/held/);
  });
});
