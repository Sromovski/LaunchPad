/** On-screen text for the bonus-picture outro (same fonts and colours as the videos). */
import { assEscape, assTime, wrap } from '../media/captions.js';
import { FONT_BOLD, FONT_SEMIBOLD, UNSAFE_RIGHT } from '../media/layout.js';

export interface BonusAssInput {
  title: string;
  credit: string | null;
  /** e.g. "September 28, 2026" — the day NASA featured it, not "today". */
  dateText: string;
  /** When "for your space picture of the day" is spoken — the heading appears with it. */
  headStart: number;
  titleStart: number;
  duration: number;
}

export const bonusCreditLine = (credit: string | null) => `Image: ${credit ?? 'NASA'} · NASA Image of the Day`;

export function bonusAss(o: BonusAssInput): string {
  const mr = UNSAFE_RIGHT + 40;
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Head,${FONT_BOLD},92,&H003FD2FF,&H003FD2FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,7,3,8,70,${mr},150,1`,
    `Style: Sub,${FONT_SEMIBOLD},44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,4,2,8,70,${mr},390,1`,
    `Style: Title,${FONT_BOLD},76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,6,3,2,70,${mr},560,1`,
    `Style: Credit,${FONT_SEMIBOLD},34,&H20FFFFFF,&H20FFFFFF,&H90000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,7,48,${mr},70,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 1,${assTime(o.headStart)},${assTime(o.duration)},Head,,0,0,0,,{\\fad(250,0)}Space Picture\\Nof the Day`,
    `Dialogue: 1,${assTime(o.headStart + 0.3)},${assTime(o.duration)},Sub,,0,0,0,,{\\fad(250,0)}${assEscape(`From NASA, ${o.dateText}`)}`,
    `Dialogue: 1,${assTime(o.titleStart)},${assTime(o.duration)},Title,,0,0,0,,{\\fad(200,0)}${wrap(assEscape(o.title), 20)}`,
    `Dialogue: 1,${assTime(0)},${assTime(o.duration)},Credit,,0,0,0,,${wrap(assEscape(bonusCreditLine(o.credit)), 44)}`,
    '',
  ].join('\n');
}
