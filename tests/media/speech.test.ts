import { describe, expect, it } from 'vitest';
import { numberToWords, spokenForm } from '../../src/media/speech.js';

describe('numberToWords', () => {
  it.each([
    [0, 'zero'],
    [7, 'seven'],
    [13, 'thirteen'],
    [40, 'forty'],
    [99, 'ninety-nine'],
    [100, 'one hundred'],
    [956, 'nine hundred fifty-six'],
    [2400, 'two thousand four hundred'],
    [10000, 'ten thousand'],
    [140000000, 'one hundred forty million'],
    [1000001, 'one million one'],
  ])('%i → %s', (n, words) => expect(numberToWords(n)).toBe(words));
});

describe('spokenForm', () => {
  it('reads Thomas’s example the way he asked', () => {
    expect(spokenForm('The blades spin 2,400 times per minute.')).toBe('The blades spin two thousand four hundred times per minute.');
  });

  it('handles plain numbers, decimals and percent', () => {
    expect(spokenForm('It flew 72 times!')).toBe('It flew seventy-two times!');
    expect(spokenForm('It landed at 1.61 mph.')).toBe('It landed at one point six one miles per hour.');
    expect(spokenForm('The air is 99% thinner.')).toBe('The air is ninety-nine percent thinner.');
  });

  it('reads years as years', () => {
    expect(spokenForm('In 2021, it flew.')).toBe('In twenty twenty-one, it flew.');
    expect(spokenForm('In 2008 and 1997.')).toBe('In two thousand eight and nineteen ninety-seven.');
  });

  it('handles ordinals', () => {
    expect(spokenForm('its 4th flight and 956th day, 1st try, 22nd, 3rd')).toBe(
      'its fourth flight and nine hundred fifty-sixth day, first try, twenty-second, third',
    );
  });

  it('expands common units kids hear', () => {
    expect(spokenForm('10 ft up, 12,000 mph, minus 80 °F, 5 km')).toBe('ten feet up, twelve thousand miles per hour, minus eighty degrees Fahrenheit, five kilometers');
  });

  it('leaves text without numbers alone', () => {
    expect(spokenForm('Did you know sunsets on Mars are BLUE?')).toBe('Did you know sunsets on Mars are BLUE?');
  });
});
