import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { ReviewError, decide, saveDraft } from '../../src/review/decide.js';

let db: Database.Database;

function video(status = 'in_review', revisions = 0): number {
  const id = Number(db.prepare('INSERT INTO videos (topic, status, revision_count) VALUES (?, ?, ?)').run('t', status, revisions).lastInsertRowid);
  return id;
}
function asset(videoId: number, nasaId: string, rights: string) {
  db.prepare("INSERT INTO assets (video_id, nasa_id, media_type, source_url, credit, rights_status) VALUES (?, ?, 'image', 'u', 'NASA/JPL-Caltech/MSSS', ?)").run(
    videoId,
    nasaId,
    rights,
  );
}
const status = (id: number) => (db.prepare('SELECT status FROM videos WHERE id = ?').get(id) as { status: string }).status;
const reviews = (id: number) => db.prepare('SELECT decision, notes FROM reviews WHERE video_id = ?').all(id);

beforeEach(() => {
  db = openDb(':memory:');
});

describe('rights gate', () => {
  it('blocks approval when an asset needs review and rights are not checked', () => {
    const id = video();
    asset(id, 'PIA19400', 'needs_review');
    expect(() => decide(db, id, { decision: 'approved' })).toThrow(/rights not checked.*PIA19400/);
    expect(status(id)).toBe('in_review');
    expect(reviews(id)).toEqual([]);
  });

  it('approves when rights are checked, and marks those assets clear with a note', () => {
    const id = video();
    asset(id, 'PIA19400', 'needs_review');
    asset(id, 'PIA23202', 'clear');
    const r = decide(db, id, { decision: 'approved', rights_checked: true }, new Date('2026-09-27T12:00:00Z'));
    expect(status(id)).toBe('approved');
    expect(r.cleared_assets).toEqual(['PIA19400']);
    const a = db.prepare("SELECT rights_status, rights_note FROM assets WHERE nasa_id = 'PIA19400'").get() as { rights_status: string; rights_note: string };
    expect(a.rights_status).toBe('clear');
    expect(a.rights_note).toMatch(/cleared by Thomas on 2026-09-27 \(video \d+ review \d+\)/);
  });

  it('approves without the tick when every asset is already clear', () => {
    const id = video();
    asset(id, 'PIA23202', 'clear');
    expect(decide(db, id, { decision: 'approved' }).state.status).toBe('approved');
  });

  it('ticking rights does not clear anything on reject', () => {
    const id = video();
    asset(id, 'PIA19400', 'needs_review');
    decide(db, id, { decision: 'rejected', rights_checked: true });
    expect(db.prepare('SELECT rights_status FROM assets').get()).toEqual({ rights_status: 'needs_review' });
  });
});

describe('decisions', () => {
  it('request changes needs notes', () => {
    const id = video();
    expect(() => decide(db, id, { decision: 'changes_requested', notes: '   ' })).toThrow(/notes/);
    decide(db, id, { decision: 'changes_requested', notes: 'Show the Sun sooner.' });
    expect(status(id)).toBe('changes_requested');
    expect(reviews(id)).toEqual([{ decision: 'changes_requested', notes: 'Show the Sun sooner.' }]);
  });

  it('reject works with or without a reason', () => {
    const a = video();
    const b = video();
    decide(db, a, { decision: 'rejected' });
    decide(db, b, { decision: 'rejected', notes: 'Duplicate of video 1' });
    expect([status(a), status(b)]).toEqual(['rejected', 'rejected']);
    expect(reviews(a)).toEqual([{ decision: 'rejected', notes: null }]);
  });

  it('only in_review videos can be reviewed (409)', () => {
    const id = video('rendered');
    try {
      decide(db, id, { decision: 'approved' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReviewError);
      expect((e as ReviewError).status).toBe(409);
    }
  });

  it('third request for changes hits the revision cap (409), nothing written', () => {
    const id = video('in_review', 2);
    expect(() => decide(db, id, { decision: 'changes_requested', notes: 'again' })).toThrow(/revision/);
    expect(status(id)).toBe('in_review');
    expect(reviews(id)).toEqual([]);
  });

  it('unknown video is 404; bad decision is rejected by the schema', () => {
    expect(() => decide(db, 999, { decision: 'approved' })).toThrow(/not found/);
    const id = video();
    expect(() => decide(db, id, { decision: 'published' })).toThrow();
  });
});

describe('saveDraft', () => {
  const draft = { title: 'Why Are Sunsets on Mars Blue?', description: 'Footage: NASA\n\nNarration voice is AI-generated.', hashtags: ['#Mars', '#Space', '#ScienceForKids'] };

  it('saves title, description and hashtags', () => {
    const id = video();
    saveDraft(db, id, draft);
    expect(db.prepare('SELECT title, description, hashtags FROM videos WHERE id = ?').get(id)).toEqual({
      title: draft.title,
      description: draft.description,
      hashtags: JSON.stringify(draft.hashtags),
    });
  });

  it('keeps the AI-voice disclosure mandatory', () => {
    expect(() => saveDraft(db, video(), { ...draft, description: 'Footage: NASA' })).toThrow(/AI-generated/);
  });

  it('validates hashtags', () => {
    expect(() => saveDraft(db, video(), { ...draft, hashtags: ['Mars', '#Space', '#Kids'] })).toThrow();
    expect(() => saveDraft(db, video(), { ...draft, hashtags: ['#a', '#b'] })).toThrow();
  });
});
