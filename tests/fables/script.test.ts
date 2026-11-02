import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { FableScript, cadenceWarnings, countContractions, countWords, episodeWarnings, narrationWords, pairVideos, saveFableScript, scriptMarkdown, scriptWarnings } from '../../src/fables/script.js';
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
    expect(scriptWarnings(s).join('\n')).not.toMatch(/AI-generated/); // the sample has the line (added 2026-10-31)
    const noLine = { ...s.youtube, description: s.youtube.description.replace('Narration voice is AI-generated.', '') };
    expect(scriptWarnings({ ...s, youtube: noLine }).join('\n')).toMatch(/AI-generated/);
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

describe('next-short improvements (2026-10-31)', () => {
  it('counts contractions but not possessives', () => {
    expect(countContractions("I'm Pip. What's that? He couldn't. Ma Liang's brush. We'll see, they've gone, she'd go.")).toBe(6);
  });

  it('flags stiff, even narration like Everygen check_voice_cadence does', () => {
    const stiff = 'The boy did not have a brush. The man gave him a brush. The boy painted a bird. The bird flew far away.';
    expect(cadenceWarnings(stiff).join(' ')).toMatch(/contractions/);
    expect(cadenceWarnings(stiff).join(' ')).toMatch(/too even/);
    expect(cadenceWarnings("Hi, I'm Pip! What's in my pocket today? A paintbrush! Long ago in China, a boy who couldn't afford a brush drew pictures in the sand every day.")).toEqual([]);
  });

  it('video 139 gets the contraction warning Everygen gave it (3 contractions)', () => {
    const narration = SAMPLE.scenes.map((s: { narration: string }) => s.narration).join(' ');
    expect(cadenceWarnings(narration)).toEqual([expect.stringMatching(/^Sounds stiff read aloud: 3 contractions in /)]);
  });

  it('warns when no hero is set, and keeps hero and Pip-on-camera scenes', () => {
    expect(scriptWarnings(FableScript.parse(SAMPLE)).join(' ')).toMatch(/No hero set/);
    const s = FableScript.parse({
      ...SAMPLE,
      hero: { name: 'Ma Liang', look: 'a boy of about ten, short black hair, blue tunic' },
      scenes: SAMPLE.scenes.map((x: object, i: number) => ({ ...x, pip_on_camera: i === 0 || i === SAMPLE.scenes.length - 1 })),
    });
    expect(scriptWarnings(s).join(' ')).not.toMatch(/No hero set/);
    expect(scriptMarkdown(s)).toMatch(/Hero:\*\* Ma Liang/);
    expect(scriptMarkdown(s)).toMatch(/Scene 1 · 5s · Pip talks to camera/);
  });

  it('refuses Pip on camera in a middle scene', () => {
    const bad = { ...SAMPLE, scenes: SAMPLE.scenes.map((x: object, i: number) => ({ ...x, pip_on_camera: i === 3 })) };
    expect(() => FableScript.parse(bad)).toThrow(/first and last scenes/);
  });
});

describe('two-part episodes (Pip & Ma Adventures, §2a)', () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../../channels/fables/samples/ep02/${f}`, import.meta.url), 'utf8'));
  const P1 = read('ep02-p1.json');
  const P2 = read('ep02-p2.json');
  const episodeOnly = (raw: unknown) => {
    const s = FableScript.parse(raw);
    return episodeWarnings(s, s.episode!);
  };

  it('accepts both parts of the ep02 sample with no episode warnings', () => {
    for (const raw of [P1, P2]) {
      const s = FableScript.parse(raw);
      expect(s.lane).toBe('adventure');
      expect(s.episode).toMatchObject({ pair_id: 'ep02', of: 2, country: 'Japan' });
      expect(episodeOnly(raw)).toEqual([]);
      expect(scriptWarnings(s).join('\n')).not.toMatch(/AI-generated|spoken words/);
    }
  });

  it('an adventure needs its episode block, and part can not exceed of', () => {
    const noEpisode = { ...P1, episode: undefined };
    expect(FableScript.safeParse(noEpisode).success).toBe(false);
    expect(FableScript.safeParse({ ...P1, episode: { ...P1.episode, part: 3 } }).success).toBe(false);
    expect(FableScript.safeParse({ ...P1, episode: { ...P1.episode, pair_id: 'Ep 02' } }).success).toBe(false);
  });

  it('warns when a part breaks the episode shape', () => {
    const lastP1 = P1.scenes.length - 1;
    const p1 = {
      ...P1,
      youtube: { ...P1.youtube, title: 'The Lantern Bridge', description: P1.youtube.description.replace('Part 2', 'the next one') },
      scenes: P1.scenes.map((x: Record<string, unknown>, i: number) => (i === lastP1 ? { ...x, on_screen_text: 'The end', pip_on_camera: false } : x)),
    };
    const w = episodeOnly(p1).join('\n');
    expect(w).toMatch(/YouTube title should read/);
    expect(w).toMatch(/name the other part/);
    expect(w).toMatch(/To be continued/);
    expect(w).toMatch(/last scene should be Pip on camera/);

    const p2 = {
      ...P2,
      scenes: P2.scenes.map((x: Record<string, unknown>, i: number) => ({
        ...x,
        narration: i === 0 ? 'Hi, it is Pip! We are back at the bridge.' : String(x.narration).replace(/arigatō/gi, 'thanks').replace(/\bor\b/g, 'and'),
        on_screen_text: i === 0 ? '' : String(x.on_screen_text).replace(/arigatō/gi, 'thanks').replace(/\bor\b/g, 'and'),
      })),
    };
    const w2 = episodeOnly(p2).join('\n');
    expect(w2).toMatch(/Last time/);
    expect(w2).toMatch(/viewer question/);
    expect(w2).toMatch(/is never said/);
    expect(w2).toMatch(/on screen with its meaning/);
  });

  it('flags catchphrases borrowed from other shows', () => {
    const p2 = { ...P2, scenes: P2.scenes.map((x: Record<string, unknown>, i: number) => (i === 6 ? { ...x, narration: 'We did it! We did it!' } : x)) };
    expect(episodeOnly(p2).join('\n')).toMatch(/borrowed from another show/);
  });

  it('pairVideos links the two parts, and a part can only be saved once', () => {
    const a = save(P1);
    const b = save(P2);
    expect(pairVideos(db, 'ep02')).toEqual([
      { video_id: a.video_id, part: 1, status: 'script_review' },
      { video_id: b.video_id, part: 2, status: 'script_review' },
    ]);
    expect(() => save({ ...P1, title: 'The Lantern Bridge (again)' })).toThrow(new RegExp(`ep02 part 1 is already video ${a.video_id}`));
    expect(pairVideos(db, 'ep99')).toEqual([]);
  });

  it('script.md shows the fact and word of the day for checking', () => {
    const md = scriptMarkdown(FableScript.parse(P2));
    expect(md).toMatch(/\*\*Fact to check:\*\* Japanese paper lanterns/);
    expect(md).toMatch(/\*\*Word of the day:\*\* arigatō = thank you/);
  });
});
