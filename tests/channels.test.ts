import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { CHANNELS, assColor, channelByKey, channelOfVideo } from '../src/channels.js';
import { openDb } from '../src/db/index.js';
import { buildAss, type CreditSpan } from '../src/media/captions.js';

describe('channels', () => {
  it('no --channel means Blast of Facts; unknown channels are refused', () => {
    expect(channelByKey(undefined).key).toBe('blast');
    expect(channelByKey('').key).toBe('blast');
    expect(channelByKey('wonder').title).toBe('I Wonder Why');
    expect(() => channelByKey('Wonder')).toThrow(/unknown channel/);
  });

  it('each channel has its own topics file, login file, YouTube channel and schedule', () => {
    const [b, w] = [CHANNELS.blast, CHANNELS.wonder];
    expect(b.topicsFile).not.toBe(w.topicsFile);
    expect(b.tokenFile).not.toBe(w.tokenFile);
    expect(b.tokenFile).toMatch(/data[\\/]google[\\/]token\.json$/); // Blast's existing login keeps working
    expect(b.youtubeId).toBe('UCHhHYjq4K0sERPPR2od5kRw');
    expect(w.youtubeId).toBe('UCqNwPn4hm_lMSOhHdXcfMig');
    // Builds share one lock: make times must never coincide.
    expect(b.makeTimes.filter((t) => w.makeTimes.includes(t))).toEqual([]);
  });

  it('assColor converts #RRGGBB to ASS &HAABBGGRR', () => {
    expect(assColor('#FFD23F')).toBe('&H003FD2FF');
    expect(assColor('#2B2766', 0x60)).toBe('&H6066272B');
    expect(() => assColor('red')).toThrow();
  });

  it('videos default to Blast of Facts, and the column only accepts known channels', () => {
    const db = openDb(':memory:');
    const id = Number(db.prepare("INSERT INTO videos (topic) VALUES ('t')").run().lastInsertRowid);
    expect(channelOfVideo(db, id).key).toBe('blast');
    db.prepare("UPDATE videos SET channel = 'wonder' WHERE id = ?").run(id);
    expect(channelOfVideo(db, id).key).toBe('wonder');
    expect(() => db.prepare("UPDATE videos SET channel = 'other' WHERE id = ?").run(id)).toThrow(/CHECK/);
  });

  it('an older DB without the column is migrated, existing videos become Blast of Facts', () => {
    const path = `${process.env.TEMP ?? '/tmp'}/lp-channel-migrate-${process.pid}.db`;
    const old = new Database(path);
    old.exec("CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idea'); INSERT INTO videos (topic) VALUES ('old one');");
    old.close();
    const db = openDb(path);
    expect(db.prepare('SELECT channel FROM videos').get()).toEqual({ channel: 'blast' });
    db.close();
    for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
  });
});

describe('caption branding', () => {
  const base = { words: [{ text: 'Hello', start: 0, end: 0.5, segment: 0, matched: true }, { text: 'there', start: 0.5, end: 1, segment: 0, matched: true }], endQuestionSegment: 1, endQuestion: 'Why?', endCardStart: 1, duration: 3, credits: [] as CreditSpan[] };

  it('Blast of Facts output is unchanged (yellow #FFD23F, black end-card dim)', () => {
    const ass = buildAss(base);
    expect(ass).toContain('\\1c&H003FD2FF&');
    expect(ass).toContain('Style: Dim,Fredoka,10,&H60000000,&H60000000');
    expect(buildAss({ ...base, brand: CHANNELS.blast.brand })).toBe(ass);
  });

  it('I Wonder Why uses its own yellow and an indigo end-card tint', () => {
    const ass = buildAss({ ...base, brand: CHANNELS.wonder.brand });
    expect(ass).toContain('\\1c&H003CC9FF&');
    expect(ass).toContain('Style: Dim,Fredoka,10,&H6066272B,&H6066272B');
    expect(ass).not.toContain('&H003FD2FF');
  });
});
