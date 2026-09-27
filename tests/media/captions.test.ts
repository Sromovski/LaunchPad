import { describe, expect, it } from 'vitest';
import type { AlignedWord } from '../../src/media/align.js';
import { CAPTION, assTime, buildAss, chunkWords, coveredWordCount, wrap, type CaptionInput } from '../../src/media/captions.js';
import { H, SAFE_BOTTOM_Y, UNSAFE_RIGHT } from '../../src/media/layout.js';

/** Build timed words: 0.3 s each, 0.35 s gap between segments. */
function timed(segments: string[]): AlignedWord[] {
  const out: AlignedWord[] = [];
  let t = 0.15;
  segments.forEach((s, segment) => {
    for (const text of s.split(' ')) {
      out.push({ text, start: t, end: t + 0.3, segment, matched: true });
      t += 0.3;
    }
    t += 0.35;
  });
  return out;
}

const SEGMENTS = [
  'Did you know sunsets on Mars are blue?',
  'On Earth, sunsets glow orange and red.',
  'But on Mars, the sky near the Sun turns blue.',
  'What color would your sunset be?',
];

function input(): CaptionInput {
  const words = timed(SEGMENTS);
  const eq = words.filter((w) => w.segment === 3);
  return {
    words,
    endQuestionSegment: 3,
    endQuestion: SEGMENTS[3]!,
    endCardStart: eq[0]!.start,
    duration: eq[eq.length - 1]!.end + 3,
    credits: [{ text: 'Image: NASA/JPL-Caltech/MSSS', start: 0, end: 10 }],
  };
}

describe('chunkWords', () => {
  const chunks = chunkWords(timed(SEGMENTS));

  it('makes 2–4 word chunks', () => {
    for (const c of chunks) {
      expect(c.words.length).toBeGreaterThanOrEqual(1);
      expect(c.words.length).toBeLessThanOrEqual(CAPTION.maxWords);
    }
    const singles = chunks.filter((c) => c.words.length === 1);
    expect(singles.length / chunks.length).toBeLessThan(0.2);
  });

  it('never crosses a sentence segment', () => {
    for (const c of chunks) expect(new Set(c.words.map((w) => w.segment)).size).toBe(1);
  });

  it('breaks after punctuation', () => {
    const texts = chunks.map((c) => c.words.map((w) => w.text).join(' '));
    expect(texts).toContain('On Earth,');
  });

  it('keeps every word exactly once, in order', () => {
    expect(chunks.flatMap((c) => c.words.map((w) => w.text))).toEqual(SEGMENTS.join(' ').split(' '));
  });
});

describe('buildAss', () => {
  const ass = buildAss(input());
  const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  const captions = dialogue.filter((l) => l.includes(',Caption,'));

  it('declares 1080×1920', () => {
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
  });

  it('one caption event per spoken word (highlight moves word to word)', () => {
    const spokenWords = SEGMENTS.slice(0, 3).join(' ').split(' ').length;
    expect(captions.length).toBe(spokenWords);
    for (const line of captions) expect(line.match(/&H003FD2FF/g)?.length).toBe(1);
  });

  it('hook caption is on screen within the first 2 s', () => {
    expect(captions[0]).toMatch(/^Dialogue: 2,0:00:00\.(1|2)/);
  });

  it('no caption runs into the end card', () => {
    const endCard = input().endCardStart;
    for (const line of captions) {
      const end = line.split(',')[2]!;
      const [h, m, s] = end.split(':').map(Number);
      expect(h! * 3600 + m! * 60 + s!).toBeLessThanOrEqual(endCard + 0.01);
    }
  });

  it('end card shows the closing question, dimmed background', () => {
    expect(dialogue.some((l) => l.includes(',EndCard,') && l.includes('What color'))).toBe(true);
    expect(dialogue.some((l) => l.includes(',Dim,'))).toBe(true);
  });

  it('credit line is present', () => {
    expect(dialogue.some((l) => l.includes(',Credit,') && l.includes('NASA/JPL-Caltech/MSSS'))).toBe(true);
  });

  it('caption style stays out of the bottom 20% and right 12%', () => {
    const style = ass.split('\n').find((l) => l.startsWith('Style: Caption,'))!.split(',');
    const [marginR, marginV] = [Number(style[20]), Number(style[21])];
    expect(style[18]).toBe('2'); // bottom-centre alignment → MarginV is distance from bottom
    expect(marginR).toBeGreaterThanOrEqual(UNSAFE_RIGHT);
    expect(marginV).toBeGreaterThanOrEqual(H - SAFE_BOTTOM_Y);
  });

  it('strips ASS override characters from text', () => {
    const i = input();
    i.words[0]!.text = '{\\b1}Did';
    expect(buildAss(i)).not.toContain('{\\b1}');
  });

  it('coverage counts every word (captions + end card)', () => {
    expect(coveredWordCount(input())).toBe(input().words.length);
  });
});

describe('zero-length events', () => {
  it('are never emitted (libass stops rendering everything if one is a drawing)', () => {
    const ass = buildAss({ words: [], endQuestionSegment: -1, endQuestion: '', endCardStart: 5, duration: 5, credits: [{ text: 'Image: NASA', start: 0, end: 5 }] });
    const d = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(d).toHaveLength(1);
    expect(d[0]).toContain(',Credit,');
  });
});

describe('helpers', () => {
  it('formats ASS time', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(61.234)).toBe('0:01:01.23');
  });
  it('wraps text', () => {
    expect(wrap('What color would your sunset be?', 15)).toBe('What color\\Nwould your\\Nsunset be?');
    expect(wrap('If you stood on Mars at sunset, which color would you look for?', 18)).not.toMatch(/\\N\w+\?$/);
  });
});
