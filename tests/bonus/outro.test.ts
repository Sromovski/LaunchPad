import { describe, expect, it } from 'vitest';
import { bonusAss, bonusCreditLine } from '../../src/bonus/outro.js';
import { UNSAFE_RIGHT } from '../../src/media/layout.js';

const ass = bonusAss({ title: 'Space Station View of Earth at Night', credit: 'NASA/Jessica Meir', dateText: 'September 28, 2026', titleStart: 2.4, duration: 5.6 });
// Long lines are wrapped with ASS "\N" breaks; compare the text without them.
const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => l.replaceAll('\\N', ' '));

describe('bonusAss', () => {
  it('says "Bonus Space Picture", never "today"', () => {
    expect(dialogue.some((l) => l.includes('Bonus Space Picture'))).toBe(true);
    expect(ass.toLowerCase()).not.toContain('today');
  });

  it('shows NASA’s date and the credit line', () => {
    expect(dialogue.some((l) => l.includes('NASA Image of the Day, September 28, 2026'))).toBe(true);
    expect(dialogue.some((l) => l.includes(',Credit,') && l.includes('Image: NASA/Jessica Meir · NASA Image of the Day'))).toBe(true);
  });

  it('title appears when it is spoken', () => {
    expect(dialogue.find((l) => l.includes(',Title,'))).toMatch(/^Dialogue: 1,0:00:02\.40,0:00:05\.60,Title/);
  });

  it('keeps text out of the right-hand unsafe band', () => {
    for (const style of ass.split('\n').filter((l) => l.startsWith('Style:'))) {
      expect(Number(style.split(',')[20])).toBeGreaterThanOrEqual(UNSAFE_RIGHT);
    }
  });

  it('unknown credit still names NASA Image of the Day', () => {
    expect(bonusCreditLine(null)).toBe('Image: NASA · NASA Image of the Day');
  });
});
