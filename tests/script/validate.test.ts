import { describe, expect, it } from 'vitest';
import { countSyllables, fleschKincaidGrade, splitSentences, words } from '../../src/script/readability.js';
import { spokenText, validateScript } from '../../src/script/validate.js';
import type { Script } from '../../src/agents/schemas.js';

describe('readability', () => {
  it.each([
    ['cat', 1],
    ['blue', 1],
    ['sunset', 2],
    ['sunsets', 2],
    ['Mars', 1],
    ['rover', 2],
    ['particles', 3],
    ['atmosphere', 3],
  ])('%s has %i syllables', (w, n) => {
    expect(countSyllables(w)).toBe(n);
  });

  it('keeps numbers with thousands commas and decimals as one word (video 3 bug: "2,400" became "2" / "400")', () => {
    expect(words('They spun about 2,400 times a minute.')).toEqual(['They', 'spun', 'about', '2,400', 'times', 'a', 'minute']);
    expect(words('It landed at 1.61 mph, 12,000,000 km away.')).toEqual(['It', 'landed', 'at', '1.61', 'mph', '12,000,000', 'km', 'away']);
    expect(words('Red, blue, and 3, 4 or 5.')).toEqual(['Red', 'blue', 'and', '3', '4', 'or', '5']);
  });

  it('does not end a sentence at a decimal point', () => {
    expect(splitSentences('It landed at 1.61 mph. Wow!')).toEqual(['It landed at 1.61 mph.', 'Wow!']);
  });

  it('splits sentences on . ! ?', () => {
    expect(splitSentences('Hi there! Is it blue? Yes. It is.')).toEqual(['Hi there!', 'Is it blue?', 'Yes.', 'It is.']);
  });

  it('counts words, keeping numbers and hyphenated words whole', () => {
    expect(words("Mars's dust is 100 times finer — like flour-dust.")).toEqual([
      "Mars's",
      'dust',
      'is',
      '100',
      'times',
      'finer',
      'like',
      'flour-dust',
    ]);
  });

  it('simple kid text scores low, dense text scores high', () => {
    const easy = 'The sun sets. The sky turns blue. Dust in the air helps. Look up and see!';
    const hard =
      'Atmospheric particulates preferentially transmit shorter wavelengths, producing characteristic chromatic phenomena during crepuscular observations.';
    expect(fleschKincaidGrade(easy)).toBeLessThan(2);
    expect(fleschKincaidGrade(hard)).toBeGreaterThan(12);
  });
});

const SOURCES = new Set(['s1', 's2', 's3']);

// ~100 words, grade ~3.
const good = (): Script => ({
  title: 'Why Are Sunsets on Mars Blue?',
  hook: 'Did you know sunsets on Mars are blue?',
  hook_source_ids: ['s1'],
  lines: [
    { text: 'On Earth, sunsets glow orange and red.', source_ids: ['s2'] },
    { text: 'But on Mars, the sky near the setting Sun turns blue.', source_ids: ['s1'] },
    { text: 'The Curiosity rover took a picture of it.', source_ids: ['s1'] },
    { text: 'Why? Mars has lots of dust in the air.', source_ids: ['s1'] },
    { text: 'The dust bits are super tiny, like flour.', source_ids: ['s3'] },
    { text: 'Tiny dust lets blue light go straight through.', source_ids: ['s1'] },
    { text: 'So the blue stays close to the Sun.', source_ids: ['s1'] },
    { text: 'The red and yellow light gets spread all over the sky.', source_ids: ['s1'] },
    { text: 'It is easiest to see at sunset.', source_ids: ['s1'] },
    { text: 'That is when light takes the longest path through the air.', source_ids: ['s1'] },
  ],
  end_question: 'If you stood on Mars, what color would your sunset be?',
  on_screen_text: ['Blue sunset on Mars!'],
});

describe('validateScript', () => {
  it('passes a good script', () => {
    const r = validateScript(good(), SOURCES);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.word_count).toBeGreaterThanOrEqual(90);
    expect(r.word_count).toBeLessThanOrEqual(130);
    expect(r.reading_grade).toBeLessThanOrEqual(4.5);
  });

  it('spoken text is hook + lines + end question, in order', () => {
    const t = spokenText(good());
    expect(t.startsWith('Did you know')).toBe(true);
    expect(t.endsWith('what color would your sunset be?')).toBe(true);
  });

  it('fails when too short', () => {
    const s = good();
    s.lines = s.lines.slice(0, 3);
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/word count/i);
  });

  it('fails when too long', () => {
    const s = good();
    s.lines = [...s.lines, ...s.lines];
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/word count/i);
  });

  it('fails when reading grade is too high', () => {
    const s = good();
    s.lines = s.lines.map((l) => ({
      ...l,
      text: 'Atmospheric particulates preferentially transmit shorter electromagnetic wavelengths.',
    }));
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/reading grade/i);
  });

  it('fails when a line has no source', () => {
    const s = good();
    s.lines[2]!.source_ids = [];
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/line 3.*source/i);
  });

  it('fails when a source id is not in research.json', () => {
    const s = good();
    s.lines[0]!.source_ids = ['s9'];
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/s9/);
  });

  it('fails when the hook is missing', () => {
    const s = good();
    s.hook = '  ';
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/hook/i);
  });

  it('fails when the hook is too long to say in 2 seconds', () => {
    const s = good();
    s.hook = 'Did you know that when the Sun goes down on the planet Mars the sky turns a pretty blue color?';
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/hook/i);
  });

  it('fails when the end question is not a question', () => {
    const s = good();
    s.end_question = 'Mars is cool.';
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/end question/i);
  });

  it('fails on calls to action or links', () => {
    for (const bad of ['Subscribe for more!', 'Comment below.', 'Visit nasa.gov to learn more.', 'See https://x.com']) {
      const s = good();
      s.lines[0]!.text = bad;
      expect(validateScript(s, SOURCES).errors.join(), bad).toMatch(/call to action|link/i);
    }
  });

  it('fails on very long sentences', () => {
    const s = good();
    s.lines[0]!.text =
      'On Earth the sunsets glow orange and red and pink and gold and they look very pretty when you watch them from your window at home.';
    expect(validateScript(s, SOURCES).errors.join()).toMatch(/sentence/i);
  });
});
