/**
 * Automated QA (CLAUDE.md §6 "qa:check"). The CLI gathers facts about the
 * render; this pure function turns them into pass/fail checks.
 */
import type { ProbeStream } from '../media/probe.js';

export const LIMITS = {
  minDuration: 30,
  /** Whole video incl. the bonus-picture outro (Thomas, 2026-09-28: raised from 55). */
  maxDuration: 60,
  lufsTarget: -14,
  lufsTolerance: 2,
  /** Peak above this means clipping risk (loudnorm targets −1.5 dBTP). */
  maxPeakDb: -0.5,
  minCaptionCoverage: 0.95,
  hookMustStartBy: 2,
} as const;

export interface QaFacts {
  duration: number;
  video?: ProbeStream;
  audio?: ProbeStream;
  integratedLufs: number | null;
  maxVolumeDb: number | null;
  captionsExist: boolean;
  captionCoverage: number;
  hookStart: number | null;
  /** Credit lines in render-config.json, and the credits of the assets actually used. */
  renderedCredits: string[];
  usedAssets: { nasa_id: string; credit: string | null; rights_status: string }[];
  scriptValidated: boolean;
  scriptValidationNote: string;
  factChecks: { verdict: string; source_id: number | null }[];
  /** Bonus space picture: chosen by media:bonus (bonus.json) vs. what render-config.json says was rendered. */
  bonus?: { chosen: string | null; rendered: string | null; skipped?: string | null };
}

export interface QaCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const fps = (r?: string) => {
  if (!r) return 0;
  const [n, d] = r.split('/').map(Number);
  return d ? n! / d : n!;
};

export function evaluate(f: QaFacts): { pass: boolean; checks: QaCheck[] } {
  const checks: QaCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add('duration', f.duration >= LIMITS.minDuration && f.duration <= LIMITS.maxDuration, `${f.duration.toFixed(2)} s (${LIMITS.minDuration}–${LIMITS.maxDuration})`);

  const v = f.video;
  add('resolution', v?.width === 1080 && v?.height === 1920, v ? `${v.width}×${v.height}` : 'no video stream');
  add('video codec', v?.codec_name === 'h264' && v?.pix_fmt === 'yuv420p', v ? `${v.codec_name} ${v.pix_fmt}` : 'none');
  const rate = fps(v?.avg_frame_rate ?? v?.r_frame_rate);
  add('frame rate', Math.abs(rate - 30) < 0.05, `${rate.toFixed(2)} fps`);

  const a = f.audio;
  add('audio present', !!a && a.codec_name === 'aac' && a.sample_rate === '48000', a ? `${a.codec_name} ${a.sample_rate} Hz` : 'no audio stream');
  add(
    'loudness',
    f.integratedLufs !== null && Math.abs(f.integratedLufs - LIMITS.lufsTarget) <= LIMITS.lufsTolerance,
    f.integratedLufs === null ? 'not measured' : `${f.integratedLufs} LUFS (target −14 ±2)`,
  );
  add('not clipped', f.maxVolumeDb !== null && f.maxVolumeDb <= LIMITS.maxPeakDb, f.maxVolumeDb === null ? 'not measured' : `peak ${f.maxVolumeDb} dB`);

  add('captions file', f.captionsExist, f.captionsExist ? 'captions.ass' : 'missing');
  add('caption coverage', f.captionCoverage >= LIMITS.minCaptionCoverage, `${(f.captionCoverage * 100).toFixed(1)}% of spoken words`);
  add('hook in first 2 s', f.hookStart !== null && f.hookStart <= LIMITS.hookMustStartBy, f.hookStart === null ? 'unknown' : `starts at ${f.hookStart.toFixed(2)} s`);

  const missingCredit = f.usedAssets.filter((u) => !u.credit || !f.renderedCredits.some((c) => c.includes(u.credit!)));
  add(
    'credits in render',
    f.usedAssets.length > 0 && missingCredit.length === 0,
    missingCredit.length ? `missing for ${missingCredit.map((m) => m.nasa_id).join(', ')}` : `${f.usedAssets.length} asset(s) credited`,
  );
  const rejected = f.usedAssets.filter((u) => u.rights_status === 'rejected');
  add('no rejected assets', rejected.length === 0, rejected.length ? rejected.map((r) => r.nasa_id).join(', ') : 'ok');

  add('script validated', f.scriptValidated, f.scriptValidationNote);
  const bad = f.factChecks.filter((c) => c.verdict !== 'supported');
  const unsourced = f.factChecks.filter((c) => c.verdict === 'supported' && c.source_id == null);
  add(
    'fact checks supported',
    f.factChecks.length > 0 && bad.length === 0 && unsourced.length === 0,
    f.factChecks.length === 0
      ? 'no fact checks recorded'
      : unsourced.length
        ? `${unsourced.length} supported claim(s) have no stored source`
        : `${f.factChecks.length - bad.length}/${f.factChecks.length} supported`,
  );

  if (f.bonus?.skipped && !f.bonus.rendered) {
    add('bonus picture rendered', true, `left off: ${f.bonus.skipped}`);
  } else if (f.bonus && (f.bonus.chosen || f.bonus.rendered)) {
    add(
      'bonus picture rendered',
      f.bonus.chosen === f.bonus.rendered,
      f.bonus.chosen === f.bonus.rendered ? f.bonus.chosen! : `bonus.json has ${f.bonus.chosen ?? 'none'}, render has ${f.bonus.rendered ?? 'none'} — re-run media:render`,
    );
  }

  return { pass: checks.every((c) => c.ok), checks };
}

export const MIN_FRAMES = 6;
/** Stay this far from a cut so a frame never lands mid-crossfade. */
const CUT_MARGIN_S = 0.5;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Frame times for visual review: the hook, the middle of EVERY clip (so a
 * short clip can't go unseen), and the end card — topped up to MIN_FRAMES
 * with frames spread through the longest clips.
 */
export function frameTimes(duration: number, endCardStart: number, clips: { start_s: number; end_s: number }[] = []): number[] {
  const times = [1.0, ...clips.map((c) => (c.start_s + c.end_s) / 2), (endCardStart + duration) / 2];
  const cuts = clips.slice(1).map((c) => c.start_s);
  const nearCut = (t: number) => cuts.some((c) => Math.abs(t - c) < CUT_MARGIN_S);
  const tooClose = (t: number) => times.some((x) => Math.abs(x - t) < 1);

  // Top up: split the widest gaps between chosen frames.
  for (let guard = 0; times.length < MIN_FRAMES && guard < 50; guard++) {
    const sorted = [...times].sort((a, b) => a - b);
    const bounds = [0, ...sorted, duration];
    let best = -1;
    let bestGap = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      const gap = bounds[i + 1]! - bounds[i]!;
      if (gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    let t = (bounds[best]! + bounds[best + 1]!) / 2;
    if (nearCut(t)) t += CUT_MARGIN_S * 1.5;
    if (tooClose(t) || t >= duration) break;
    times.push(t);
  }
  // Drop near-duplicates (e.g. last clip's middle ≈ end-card frame); the kept one is still inside that clip.
  const out: number[] = [];
  for (const t of times.map(r2).filter((x) => x > 0 && x < duration).sort((a, b) => a - b)) {
    if (out.length === 0 || t - out[out.length - 1]! >= 0.5) out.push(t);
  }
  return out;
}
