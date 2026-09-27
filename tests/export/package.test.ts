import { describe, expect, it } from 'vitest';
import { descriptionText, slugify, thumbLines } from '../../src/export/package.js';

describe('slugify', () => {
  it.each([
    ['Why Are Sunsets on Mars Blue?', 'why-are-sunsets-on-mars-blue'],
    ["Why Is Mars Red? It's Rusty!", 'why-is-mars-red-its-rusty'],
    ['Ride Along as a Robot Lands on Mars!', 'ride-along-as-a-robot-lands-on-mars'],
    ['???', 'video'],
  ])('%s → %s', (t, s) => expect(slugify(t)).toBe(s));
});

describe('descriptionText', () => {
  it('appends hashtags on their own last line', () => {
    expect(descriptionText('Credits.\nNarration voice is AI-generated.', ['#Mars', '#Space'])).toBe(
      'Credits.\nNarration voice is AI-generated.\n\n#Mars #Space\n',
    );
  });
  it('does not repeat hashtags already in the description', () => {
    expect(descriptionText('Fun facts #Mars', ['#Mars', '#Space'])).toBe('Fun facts #Mars\n\n#Space\n');
  });
});

describe('thumbLines', () => {
  it('wraps into short lines', () => {
    expect(thumbLines('Why Are Sunsets on Mars Blue?', 12)).toEqual(['Why Are', 'Sunsets on', 'Mars Blue?']);
  });
});
