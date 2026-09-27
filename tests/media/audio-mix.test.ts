import { describe, expect, it } from 'vitest';
import { buildAudioGraph, gateExpr } from '../../src/media/audio-mix.js';

const L = { input_i: '-20', input_tp: '-3', input_lra: '4', input_thresh: '-30', target_offset: '0.1' };
const windows = [{ at_voice_s: 5, start_s: 5, end_s: 8.5 }];

describe('gateExpr', () => {
  it('opens only inside the pause window that overlaps the clip, with fades', () => {
    expect(gateExpr({ inputIndex: 1, start_s: 4, end_s: 12 }, windows)).toBe('max(0,min(1,min((t-5)/0.15,(8.5-t)/0.15)))');
  });

  it('clips its window to the clip', () => {
    expect(gateExpr({ inputIndex: 1, start_s: 6, end_s: 12 }, windows)).toContain('(t-6)/0.15');
  });

  it('is null when the clip does not overlap any pause', () => {
    expect(gateExpr({ inputIndex: 1, start_s: 10, end_s: 20 }, windows)).toBeNull();
  });
});

describe('buildAudioGraph', () => {
  it('without clip audio it is the plain narration chain with the limiter', () => {
    const g = buildAudioGraph({ voiceIndex: 3, loudness: L, duration_s: 40, clips: [], windows: [] });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatch(/^\[3:a\]loudnorm=I=-14.*aresample=48000,alimiter=limit=0\.8:level=false.*apad=whole_dur=40\[aout\]$/);
  });

  it('mixes gated clip audio under the limiter', () => {
    const g = buildAudioGraph({ voiceIndex: 3, loudness: L, duration_s: 40, clips: [{ inputIndex: 1, start_s: 4, end_s: 12 }], windows });
    expect(g[0]).toMatch(/\[voice\]$/);
    expect(g[1]).toContain('[1:a]aresample=48000');
    expect(g[1]).toContain('loudnorm=I=-16');
    expect(g[1]).toContain('adelay=4000:all=1');
    expect(g[1]).toContain("volume='max(0,min(1,min((t-5)/0.15,(8.5-t)/0.15)))':eval=frame[clipa0]");
    expect(g[2]).toBe('[voice][clipa0]amix=inputs=2:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.8:level=false:attack=5:release=50,apad=whole_dur=40[aout]');
  });

  it('drops clip audio that would never be heard', () => {
    const g = buildAudioGraph({ voiceIndex: 3, loudness: L, duration_s: 40, clips: [{ inputIndex: 1, start_s: 20, end_s: 30 }], windows });
    expect(g).toHaveLength(1);
  });
});
