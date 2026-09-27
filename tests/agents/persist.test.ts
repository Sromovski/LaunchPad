import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { saveFactCheck, saveResearch, saveScript } from '../../src/agents/persist.js';
import { FactCheck, QaReview, Research, Script } from '../../src/agents/schemas.js';
import type { ScriptValidation } from '../../src/script/validate.js';

let db: Database.Database;
let vid: number;

const research = (): Research =>
  Research.parse({
    primary_asset: { nasa_id: 'PIA19400', why: 'the sunset itself' },
    supporting_assets: [{ nasa_id: 'PIA23202', why: 'second sunset' }],
    sources: [
      { id: 's1', url: 'https://photojournal.jpl.nasa.gov/catalog/PIA19400', title: 'Sunset in Gale', excerpt: 'Dust…' },
      { id: 's2', url: 'https://science.nasa.gov/mars/', title: 'Mars', excerpt: 'Mars is…' },
      { id: 's3', url: 'https://www.jpl.nasa.gov/news/x', title: 'News', excerpt: '…' },
    ],
    kid_angle: 'Blue sunsets!',
    surprising_fact: 'Sunsets on Mars are blue.',
  });

const script = (): Script =>
  Script.parse({ title: 'T', hook: 'H?', lines: [1, 2, 3].map((i) => ({ text: `L${i}`, source_ids: ['s1'] })), end_question: 'Q?', on_screen_text: [] });

const okValidation: ScriptValidation = { ok: true, errors: [], warnings: [], word_count: 100, reading_grade: 3, estimated_seconds: 38 };

beforeEach(() => {
  db = openDb(':memory:');
  vid = Number(db.prepare("INSERT INTO videos (topic) VALUES ('t')").run().lastInsertRowid);
  const ins = db.prepare("INSERT INTO assets (video_id, nasa_id, media_type, source_url, rights_status) VALUES (?, ?, 'image', 'u', ?)");
  ins.run(vid, 'PIA19400', 'needs_review');
  ins.run(vid, 'PIA23202', 'clear');
  ins.run(vid, 'BADONE', 'rejected');
});

describe('schemas', () => {
  it('rejects non-NASA source URLs', () => {
    const r = research();
    (r.sources[0] as { url: string }).url = 'https://en.wikipedia.org/wiki/Mars';
    expect(Research.safeParse(r).success).toBe(false);
  });

  it('rejects look-alike domains', () => {
    const r = research();
    (r.sources[0] as { url: string }).url = 'https://nasa.gov.evil.com/x';
    expect(Research.safeParse(r).success).toBe(false);
    (r.sources[0] as { url: string }).url = 'https://notnasa.gov/x';
    expect(Research.safeParse(r).success).toBe(false);
  });

  it('fact check: pass must match verdicts', () => {
    const claim = { claim: 'c', line_index: 0, source_id: 's1', verdict: 'unsupported', note: '' };
    expect(FactCheck.safeParse({ claims: [claim], pass: true, notes_for_scriptwriter: 'x' }).success).toBe(false);
    expect(FactCheck.safeParse({ claims: [claim], pass: false, notes_for_scriptwriter: '' }).success).toBe(false);
    expect(FactCheck.safeParse({ claims: [claim], pass: false, notes_for_scriptwriter: 'fix it' }).success).toBe(true);
  });

  it('qa review: description must carry the AI voice line', () => {
    const base = {
      pass: true,
      reasons: [],
      frame_notes: Array.from({ length: 6 }, (_, i) => ({ frame: `f${i}`, ok: true, note: '' })),
      title: 'T',
      hashtags: ['#Mars', '#Space', '#Kids'],
    };
    expect(QaReview.safeParse({ ...base, description: 'Footage: NASA' }).success).toBe(false);
    expect(QaReview.safeParse({ ...base, description: 'Footage: NASA\nNarration voice is AI-generated.' }).success).toBe(true);
  });
});

describe('saveResearch', () => {
  it('saves sources keyed by ref, idempotently', () => {
    saveResearch(db, vid, research());
    saveResearch(db, vid, research());
    expect(db.prepare('SELECT ref FROM sources ORDER BY ref').all()).toEqual([{ ref: 's1' }, { ref: 's2' }, { ref: 's3' }]);
  });

  it('refuses assets that were never fetched', () => {
    const r = research();
    r.primary_asset.nasa_id = 'PIA99999';
    expect(() => saveResearch(db, vid, r)).toThrow(/not fetched/);
  });

  it('refuses rejected assets', () => {
    const r = research();
    r.supporting_assets = [{ nasa_id: 'BADONE', why: 'x' }];
    expect(() => saveResearch(db, vid, r)).toThrow(/rejected/);
  });
});

describe('saveScript / saveFactCheck', () => {
  it('versions scripts and sets the video title', () => {
    expect(saveScript(db, vid, script(), okValidation).version).toBe(1);
    expect(saveScript(db, vid, script(), okValidation).version).toBe(2);
    expect(db.prepare('SELECT title FROM videos WHERE id = ?').get(vid)).toEqual({ title: 'T' });
  });

  it('refuses an invalid script', () => {
    expect(() => saveScript(db, vid, script(), { ...okValidation, ok: false, errors: ['too long'] })).toThrow(/too long/);
  });

  it('fact checks attach to the latest script and replace earlier ones', () => {
    saveResearch(db, vid, research());
    saveScript(db, vid, script(), okValidation);
    const { script_id } = saveScript(db, vid, script(), okValidation);
    const fc = FactCheck.parse({
      claims: [{ claim: 'Sunsets on Mars are blue', line_index: -1, source_id: 's1', verdict: 'supported' }],
      pass: true,
    });
    saveFactCheck(db, vid, fc);
    saveFactCheck(db, vid, fc);
    const rows = db.prepare('SELECT script_id, verdict FROM fact_checks').all();
    expect(rows).toEqual([{ script_id, verdict: 'supported' }]);
  });

  it('fact check citing an unknown source fails', () => {
    saveResearch(db, vid, research());
    saveScript(db, vid, script(), okValidation);
    const fc = FactCheck.parse({ claims: [{ claim: 'x', line_index: 0, source_id: 's7', verdict: 'supported' }], pass: true });
    expect(() => saveFactCheck(db, vid, fc)).toThrow(/s7/);
  });
});

describe('fact-check extra sources (§2.5: every fact maps to a stored source)', () => {
  it('schema refuses a supported claim without a source_id', () => {
    const r = FactCheck.safeParse({ claims: [{ claim: 'x', line_index: 0, source_id: null, verdict: 'supported' }], pass: true });
    expect(r.success).toBe(false);
  });

  it('saves pages the fact-checker fetched, so claims can cite them', () => {
    saveResearch(db, vid, research());
    saveScript(db, vid, script(), okValidation);
    const fc = FactCheck.parse({
      claims: [{ claim: 'The parachute slows the rover', line_index: 0, source_id: 's9', verdict: 'supported' }],
      pass: true,
      extra_sources: [{ id: 's9', url: 'https://www.jpl.nasa.gov/press-kit', title: 'Press kit', excerpt: 'The parachute…' }],
    });
    saveFactCheck(db, vid, fc);
    const row = db.prepare('SELECT s.ref, s.url FROM fact_checks f JOIN sources s ON s.id = f.source_id').get();
    expect(row).toEqual({ ref: 's9', url: 'https://www.jpl.nasa.gov/press-kit' });
  });

  it('extra sources must be NASA pages', () => {
    const r = FactCheck.safeParse({
      claims: [{ claim: 'x', line_index: 0, source_id: 's9', verdict: 'supported' }],
      pass: true,
      extra_sources: [{ id: 's9', url: 'https://en.wikipedia.org/wiki/Mars', title: 't', excerpt: 'e' }],
    });
    expect(r.success).toBe(false);
  });
});
