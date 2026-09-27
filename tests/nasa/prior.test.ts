import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { priorClearance } from '../../src/nasa/fetch.js';

let db: Database.Database;
const CREDIT = 'NASA/JPL-Caltech/MSSS/Texas A&M Univ';

function asset(videoId: number, rights: string, note: string | null, credit = CREDIT) {
  db.prepare("INSERT INTO assets (video_id, nasa_id, media_type, source_url, credit, rights_status, rights_note) VALUES (?, 'PIA19400', 'image', 'u', ?, ?, ?)").run(
    videoId,
    credit,
    rights,
    note,
  );
}

beforeEach(() => {
  db = openDb(':memory:');
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO videos (topic) VALUES ('t')").run();
});

describe('priorClearance', () => {
  it('finds a clearance Thomas made on another video', () => {
    asset(1, 'clear', 'co-credit; cleared by Thomas on 2026-09-27 (video 1 review 3)');
    expect(priorClearance(db, 'PIA19400', CREDIT, 2)?.video_id).toBe(1);
  });

  it('ignores assets that were only machine-cleared', () => {
    asset(1, 'clear', '');
    expect(priorClearance(db, 'PIA19400', CREDIT, 2)).toBeUndefined();
  });

  it('requires the same credit (a changed credit is a new question)', () => {
    asset(1, 'clear', 'cleared by Thomas on 2026-09-27');
    expect(priorClearance(db, 'PIA19400', 'NASA/JPL-Caltech/MSSS/Someone Else', 2)).toBeUndefined();
  });

  it('ignores the same video and non-clear rows', () => {
    asset(2, 'clear', 'cleared by Thomas on 2026-09-27');
    asset(1, 'needs_review', 'cleared by Thomas on 2026-09-27');
    expect(priorClearance(db, 'PIA19400', CREDIT, 2)).toBeUndefined();
  });
});
