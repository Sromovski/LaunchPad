/**
 * Text → what the narrator should *say*. Kokoro misreads digits like "2,400"
 * (Thomas's note on video 3), so numbers, years, ordinals and units are spelled
 * out before TTS. Captions still show the script's digits.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]!);
  else if (n > 0) parts.push(ONES[n]!);
  return parts.join(' ');
}

export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`numberToWords: ${n}`);
  if (n === 0) return 'zero';
  const parts: string[] = [];
  for (const [value, name] of SCALES) {
    if (n >= value) {
      parts.push(`${under1000(Math.floor(n / value))} ${name}`);
      n %= value;
    }
  }
  if (n > 0) parts.push(under1000(n));
  return parts.join(' ');
}

function yearToWords(y: number): string {
  if (y >= 2000 && y < 2010) return numberToWords(y); // "two thousand eight"
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  return lo === 0 ? `${numberToWords(hi)} hundred` : `${numberToWords(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : numberToWords(lo)}`;
}

const ORDINAL_IRREGULAR: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
function ordinal(words: string): string {
  const m = /([a-z]+)$/.exec(words)!;
  const last = m[1]!;
  const ord = ORDINAL_IRREGULAR[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.slice(0, m.index) + ord;
}

const UNITS: [RegExp, string][] = [
  [/\bmph\b/g, 'miles per hour'],
  [/\bkm\/h\b/g, 'kilometers per hour'],
  [/°\s?F\b/g, 'degrees Fahrenheit'],
  [/°\s?C\b/g, 'degrees Celsius'],
  [/\bkm\b/g, 'kilometers'],
  [/\bft\b/g, 'feet'],
  [/\blbs?\b/g, 'pounds'],
  [/\bkg\b/g, 'kilograms'],
];

export function spokenForm(text: string): string {
  let s = text;
  // Ordinals: 4th, 956th, 1st, 22nd, 3rd
  s = s.replace(/\b(\d{1,3}(?:,\d{3})*|\d+)(st|nd|rd|th)\b/g, (_m, num: string) => ordinal(numberToWords(Number(num.replace(/,/g, '')))));
  // Percent
  s = s.replace(/\b(\d+(?:\.\d+)?)\s?%/g, (_m, num: string) => `${num} percent`);
  // Years: a bare 4-digit 1100–2099 not followed by a unit-ish word is read as a year ("in 2021").
  s = s.replace(/\b(1[1-9]\d{2}|20\d{2})\b(?!,\d)(?!\s*(?:times|feet|ft|miles|mph|meters|kilometers|km|pounds|degrees|°|people|days|sols|hours|minutes|seconds|kg|lbs?))/g, (_m, y: string) =>
    yearToWords(Number(y)),
  );
  // Decimals: 1.61 → one point six one
  s = s.replace(/\b(\d+)\.(\d+)\b/g, (_m, i: string, d: string) => `${numberToWords(Number(i))} point ${d.split('').map((c) => ONES[Number(c)]).join(' ')}`);
  // Integers with or without thousands commas
  s = s.replace(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/g, (m) => numberToWords(Number(m.replace(/,/g, ''))));
  for (const [re, words] of UNITS) s = s.replace(re, words);
  return s;
}
