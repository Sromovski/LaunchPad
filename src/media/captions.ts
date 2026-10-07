/**
 * ASS subtitles: big 2–4 word captions with the spoken word highlighted,
 * a small per-clip credit line at the top, and the end card. All positioned
 * inside the platform safe zones (see layout.ts).
 */
import { CHANNELS, assColor, type Channel } from '../channels.js';
import type { AlignedWord } from './align.js';
import { FONT_BOLD, FONT_SEMIBOLD, H, SAFE_BOTTOM_Y, SAFE_RIGHT_X, UNSAFE_RIGHT, W } from './layout.js';

export const CAPTION = {
  fontSize: 92,
  minWords: 2,
  maxWords: 4,
  maxChars: 18,
  /** Caption baseline sits this far above the unsafe bottom band. */
  liftAboveSafe: 170,
  marginL: 70,
  marginR: UNSAFE_RIGHT + 40,
  /** Keep a caption up through short pauses so it doesn't flicker. */
  holdGapS: 0.4,
} as const;

const WHITE = '&H00FFFFFF';
const BLACK = '&H00000000';
/** End-card tint opacity: alpha 0x60 ≈ 62% opaque (ASS alpha counts transparency). */
const END_CARD_ALPHA = 0x60;

export interface Chunk {
  words: AlignedWord[];
  start: number;
  end: number;
  segment: number;
}

const endsPhrase = (w: string) => /[.,!?;:—–]$/.test(w);

export function chunkWords(words: AlignedWord[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: AlignedWord[] = [];
  const flush = () => {
    if (cur.length) chunks.push({ words: cur, start: cur[0]!.start, end: cur[cur.length - 1]!.end, segment: cur[0]!.segment });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && cur[0]!.segment !== w.segment) flush();
    const chars = cur.map((x) => x.text).join(' ').length + 1 + w.text.length;
    if (cur.length >= CAPTION.maxWords || (cur.length >= CAPTION.minWords && chars > CAPTION.maxChars)) flush();
    cur.push(w);
    if (cur.length >= CAPTION.minWords && endsPhrase(w.text)) flush();
  }
  flush();

  // Merge a lone trailing word into its predecessor when they share a segment and it fits.
  for (let i = chunks.length - 1; i > 0; i--) {
    const c = chunks[i]!;
    const p = chunks[i - 1]!;
    if (c.words.length === 1 && p.segment === c.segment && p.words.length < CAPTION.maxWords && !endsPhrase(p.words.at(-1)!.text)) {
      p.words.push(...c.words);
      p.end = c.end;
      chunks.splice(i, 1);
    }
  }
  return chunks;
}

export function assTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Strip characters that ASS would treat as override tags. */
export const assEscape = (t: string) => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ');

/** Greedy word wrap into lines of at most `max` chars (joined with ASS \N). */
export function wrap(text: string, max: number, sep = '\\N'): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join(sep);
}

export interface CreditSpan {
  text: string;
  start: number;
  end: number;
}

export interface CaptionInput {
  words: AlignedWord[];
  /** Segment index of the closing question — shown on the end card instead of as captions. */
  endQuestionSegment: number;
  endQuestion: string;
  endCardStart: number;
  duration: number;
  credits: CreditSpan[];
  /** The video's channel look (src/channels.ts). Omitted = Blast of Facts. */
  brand?: Channel['brand'];
}

export function buildAss(input: CaptionInput): string {
  const brand = input.brand ?? CHANNELS.blast.brand;
  const HIGHLIGHT = assColor(brand.highlight);
  const TINT = assColor(brand.endCardTint, END_CARD_ALPHA);
  const captionMarginV = H - SAFE_BOTTOM_Y + CAPTION.liftAboveSafe;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${FONT_BOLD},${CAPTION.fontSize},${WHITE},${WHITE},${BLACK},&H80000000,-1,0,0,0,100,100,1,0,1,7,3,2,${CAPTION.marginL},${CAPTION.marginR},${captionMarginV},1`,
    `Style: Credit,${FONT_SEMIBOLD},34,&H20FFFFFF,&H20FFFFFF,&H90000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,7,48,${CAPTION.marginR},110,1`,
    `Style: EndCard,${FONT_BOLD},104,${WHITE},${WHITE},${BLACK},&H80000000,-1,0,0,0,100,100,1,0,1,8,4,5,${CAPTION.marginL},${CAPTION.marginR},0,1`,
    `Style: Dim,${FONT_BOLD},10,${TINT},${TINT},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events: string[] = [];
  // Never emit zero-length events: libass drops ALL rendering when a zero-length drawing (\p1) is present.
  const ev = (layer: number, start: number, end: number, style: string, text: string) => {
    if (assTime(end) <= assTime(start)) return;
    events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);
  };

  // Captions (everything except the closing question, which the end card shows).
  const spoken = input.words.filter((w) => w.segment !== input.endQuestionSegment);
  const chunks = chunkWords(spoken);
  chunks.forEach((c, ci) => {
    const next = chunks[ci + 1];
    let chunkEnd = c.end;
    if (next && next.start - c.end <= CAPTION.holdGapS) chunkEnd = next.start;
    chunkEnd = Math.min(chunkEnd, input.endCardStart);
    c.words.forEach((w, wi) => {
      const start = wi === 0 ? c.start : w.start;
      const end = wi === c.words.length - 1 ? chunkEnd : c.words[wi + 1]!.start;
      if (end <= start) return;
      const text = c.words
        .map((x, xi) => `{\\1c${xi === wi ? HIGHLIGHT : WHITE}&}${assEscape(x.text)}`)
        .join(' ');
      ev(2, start, end, 'Caption', text);
    });
  });

  // Per-clip credit line at the top, whole video.
  for (const c of input.credits) ev(1, c.start, c.end, 'Credit', wrap(assEscape(c.text), 44));

  // End card: dim the picture, then the question in large text, centred in the safe area.
  const box = `{\\p1\\bord0\\shad0}m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}{\\p0}`;
  ev(0, input.endCardStart, input.duration, 'Dim', `{\\fad(300,0)}${box}`);
  const cx = Math.round((CAPTION.marginL + SAFE_RIGHT_X) / 2);
  const cy = Math.round(SAFE_BOTTOM_Y / 2) + 40;
  ev(3, input.endCardStart, input.duration, 'EndCard', `{\\an5\\pos(${cx},${cy})\\fad(300,0)}${wrap(assEscape(input.endQuestion), 18)}`);

  return [...header, ...events, ''].join('\n');
}

/** Words that appear in caption or end-card events (for the QA coverage check). */
export function coveredWordCount(input: CaptionInput): number {
  const spoken = input.words.filter((w) => w.segment !== input.endQuestionSegment);
  const inChunks = chunkWords(spoken).reduce((n, c) => n + c.words.length, 0);
  const endQ = input.words.filter((w) => w.segment === input.endQuestionSegment).length;
  return inChunks + endQ;
}
