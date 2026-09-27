import { describe, expect, it } from 'vitest';
import { evaluate, frameTimes, type QaFacts } from '../../src/qa/checks.js';

const good = (): QaFacts => ({
  duration: 39.5,
  video: { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', avg_frame_rate: '30/1' },
  audio: { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
  integratedLufs: -14.2,
  maxVolumeDb: -1.6,
  captionsExist: true,
  captionCoverage: 1,
  hookStart: 0.15,
  renderedCredits: ['Image: NASA/JPL-Caltech/MSSS', 'Image: NASA/JPL-Caltech'],
  usedAssets: [
    { nasa_id: 'A', credit: 'NASA/JPL-Caltech/MSSS', rights_status: 'needs_review' },
    { nasa_id: 'B', credit: 'NASA/JPL-Caltech', rights_status: 'clear' },
  ],
  scriptValidated: true,
  scriptValidationNote: 'ok',
  factChecks: [{ verdict: 'supported' }, { verdict: 'supported' }],
});

const failing = (f: QaFacts) => evaluate(f).checks.filter((c) => !c.ok).map((c) => c.name);

describe('evaluate', () => {
  it('passes a good render (needs_review rights do not fail QA — the human gate handles them)', () => {
    const r = evaluate(good());
    expect(failing(good())).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it.each<[string, (f: QaFacts) => void, string]>([
    ['too short', (f) => (f.duration = 29.9), 'duration'],
    ['too long', (f) => (f.duration = 55.1), 'duration'],
    ['landscape', (f) => (f.video!.width = 1920), 'resolution'],
    ['wrong codec', (f) => (f.video!.codec_name = 'hevc'), 'video codec'],
    ['wrong pixel format', (f) => (f.video!.pix_fmt = 'yuv444p'), 'video codec'],
    ['25 fps', (f) => (f.video!.avg_frame_rate = '25/1'), 'frame rate'],
    ['no audio', (f) => (f.audio = undefined), 'audio present'],
    ['44.1 kHz', (f) => (f.audio!.sample_rate = '44100'), 'audio present'],
    ['too quiet', (f) => (f.integratedLufs = -20), 'loudness'],
    ['clipped', (f) => (f.maxVolumeDb = 0), 'not clipped'],
    ['no captions', (f) => (f.captionsExist = false), 'captions file'],
    ['low coverage', (f) => (f.captionCoverage = 0.9), 'caption coverage'],
    ['late hook', (f) => (f.hookStart = 2.5), 'hook in first 2 s'],
    ['credit missing from render', (f) => (f.renderedCredits = ['Image: NASA/JPL-Caltech']), 'credits in render'],
    ['asset with no credit', (f) => (f.usedAssets[1]!.credit = null), 'credits in render'],
    ['rejected asset', (f) => (f.usedAssets[0]!.rights_status = 'rejected'), 'no rejected assets'],
    ['script not validated', (f) => (f.scriptValidated = false), 'script validated'],
    ['unsupported claim', (f) => (f.factChecks[1]!.verdict = 'unsupported'), 'fact checks supported'],
    ['unclear claim', (f) => (f.factChecks[0]!.verdict = 'unclear'), 'fact checks supported'],
    ['no fact checks', (f) => (f.factChecks = []), 'fact checks supported'],
  ])('%s → fails "%s"', (_label, mutate, check) => {
    const f = good();
    mutate(f);
    expect(failing(f)).toEqual([check]);
    expect(evaluate(f).pass).toBe(false);
  });
});

describe('frameTimes', () => {
  // Video 2's real edit: the 33.2–36.8 s clip was missed by the old fixed times.
  const clips = [
    { start_s: 0, end_s: 5.1 },
    { start_s: 5.1, end_s: 9.9 },
    { start_s: 9.9, end_s: 24.7 },
    { start_s: 24.7, end_s: 33.2 },
    { start_s: 33.2, end_s: 36.8 },
    { start_s: 36.8, end_s: 41.4 },
  ];

  it('puts a frame inside every clip, plus the hook and the end card', () => {
    const t = frameTimes(41.4, 37.2, clips);
    expect(t[0]).toBe(1);
    expect(t.at(-1)).toBeGreaterThan(37.2); // lands on the end card
    for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!).toBeGreaterThanOrEqual(0.5); // no near-duplicates
    for (const c of clips) expect(t.some((x) => x > c.start_s && x < c.end_s), `clip ${c.start_s}`).toBe(true);
  });

  it('always returns at least 6 frames, even with one clip', () => {
    const t = frameTimes(40, 35, [{ start_s: 0, end_s: 40 }]);
    expect(t.length).toBeGreaterThanOrEqual(6);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });

  it('keeps top-up frames away from crossfades', () => {
    const t = frameTimes(40, 35, [
      { start_s: 0, end_s: 20 },
      { start_s: 20, end_s: 40 },
    ]);
    for (const x of t) expect(Math.abs(x - 20)).toBeGreaterThanOrEqual(0.5);
  });

  it('works without clip info (old behaviour: spread frames)', () => {
    expect(frameTimes(40, 35).length).toBeGreaterThanOrEqual(6);
  });
});
