import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { recordPost } from '../../src/publish/posts.js';

let db: Database.Database;
const video = (status: string) => Number(db.prepare("INSERT INTO videos (topic, status) VALUES ('t', ?)").run(status).lastInsertRowid);
const status = (id: number) => (db.prepare('SELECT status FROM videos WHERE id = ?').get(id) as { status: string }).status;
const URL = 'https://youtube.com/shorts/6qJq2lvEuV0?feature=share';

beforeEach(() => {
  db = openDb(':memory:');
});

describe('recordPost (hand-posted video)', () => {
  it('records the post and moves approved → scheduled → published', () => {
    const id = video('approved');
    const p = recordPost(db, id, 'youtube', URL, 'manual');
    expect(p).toMatchObject({ external_id: '6qJq2lvEuV0', url: 'https://www.youtube.com/shorts/6qJq2lvEuV0' });
    expect(status(id)).toBe('published');
  });

  it('refuses a video that is not approved (the approval gate holds for hand-posting too)', () => {
    for (const s of ['in_review', 'rendered', 'rejected']) {
      const id = video(s);
      expect(() => recordPost(db, id, 'youtube', URL, 'manual')).toThrow(/not approved/);
      expect(status(id)).toBe(s);
    }
  });

  it('refuses to record the same video twice on one platform, or one YouTube video for two of ours', () => {
    const a = video('approved');
    recordPost(db, a, 'youtube', URL, 'manual');
    expect(() => recordPost(db, a, 'youtube', 'https://youtu.be/AAAAAAAAAAA', 'manual')).toThrow(/already posted/);
    const b = video('approved');
    expect(() => recordPost(db, b, 'youtube', URL, 'manual')).toThrow(/already recorded/);
    expect(status(b)).toBe('approved');
  });
});
