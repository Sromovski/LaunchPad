/**
 * Automated QA (CLAUDE.md §6 "qa:check"). The CLI gathers facts about the
 * render; this pure function turns them into pass/fail checks.
 */
import type { ProbeStream } from '../media/probe.js';

export const LIMITS = {
  minDuration: 30,
  maxDuration: 55,
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
  factChecks: { verdict: string }[];
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

  add('duration', f.duration >= LIMITS.minDuration && f.duration <= LIMITS.maxDuration, `${f.duration.toFixed(2)} s (30–55)`);

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
  add(
    'fact checks supported',
    f.factChecks.length > 0 && bad.length === 0,
    f.factChecks.length === 0 ? 'no fact checks recorded' : `${f.factChecks.length - bad.length}/${f.factChecks.length} supported`,
  );

  return { pass: checks.every((c) => c.ok), checks };
}

/** Frame times for visual review: hook, four spread through the body, and the end card. */
export function frameTimes(duration: number, endCardStart: number): number[] {
  const body = [0.2, 0.4, 0.6, 0.8].map((p) => Math.round(duration * p * 100) / 100);
  return [1.0, ...body, Math.round(((endCardStart + duration) / 2) * 100) / 100];
}
