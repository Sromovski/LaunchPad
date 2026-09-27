import { describe, expect, it } from 'vitest';
import { Edit, computeTimeline, normalizeEdit, type AssetInfo } from '../../src/media/edit.js';

const assets: AssetInfo[] = [
  { nasa_id: 'IMG', media_type: 'image', rights_status: 'needs_review', credit: 'NASA/JPL-Caltech/MSSS' },
  { nasa_id: 'VID', media_type: 'video', rights_status: 'clear', credit: 'NASA/JPL-Caltech', duration_s: 20 },
  { nasa_id: 'BAD', media_type: 'image', rights_status: 'rejected', credit: 'Reuters' },
];

const edit = (clips: object[]) => Edit.parse({ clips });

describe('computeTimeline', () => {
  it('end card starts with the closing question and lasts ≥ 3 s', () => {
    const t = computeTimeline([
      { index: 0, text: 'a', start_s: 0.15, end_s: 2 },
      { index: 1, text: 'q?', start_s: 40, end_s: 41.5 },
    ]);
    expect(t.end_card_start_s).toBe(40);
    expect(t.duration_s).toBeCloseTo(43, 1);
  });

  it('leaves ~1 s of air after a long closing question', () => {
    const t = computeTimeline([{ index: 0, text: 'q?', start_s: 40, end_s: 43.5 }]);
    expect(t.duration_s).toBeCloseTo(44.5, 1);
  });
});

describe('normalizeEdit', () => {
  it('accepts a contiguous edit and snaps the last clip to the duration', () => {
    const r = normalizeEdit(
      edit([
        { nasa_id: 'IMG', start_s: 0, end_s: 20 },
        { nasa_id: 'VID', start_s: 20, end_s: 38, source_in_s: 0 },
      ]),
      40,
      assets,
    );
    expect(r.errors).toEqual([]);
    expect(r.clips.at(-1)!.end_s).toBe(40);
    expect(r.clips[0]!.mode).toBe('blur_bg'); // default framing
  });

  it('flags gaps, short clips, unknown and rejected assets', () => {
    const r = normalizeEdit(
      edit([
        { nasa_id: 'IMG', start_s: 0, end_s: 10 },
        { nasa_id: 'NOPE', start_s: 10, end_s: 11 },
        { nasa_id: 'BAD', start_s: 13, end_s: 40 },
      ]),
      40,
      assets,
    );
    const all = r.errors.join('\n');
    expect(all).toMatch(/gap/);
    expect(all).toMatch(/min 1\.5/);
    expect(all).toMatch(/NOPE not fetched/);
    expect(all).toMatch(/rejected/);
  });

  it('kenburns only on stills; video clips must fit the source', () => {
    const r = normalizeEdit(edit([{ nasa_id: 'VID', start_s: 0, end_s: 40, mode: 'kenburns', source_in_s: 5 }]), 40, assets);
    expect(r.errors.join()).toMatch(/stills only/);
    expect(r.errors.join()).toMatch(/source is 20/);
  });
});
