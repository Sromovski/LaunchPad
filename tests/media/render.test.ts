import { describe, expect, it } from 'vitest';
import { XFADE_S, buildRenderPlan, type RenderClip, type RenderPlanInput } from '../../src/media/render.js';

const clip = (o: Partial<RenderClip>): RenderClip => ({
  nasa_id: 'X',
  start_s: 0,
  end_s: 10,
  mode: 'blur_bg',
  source_in_s: 0,
  why: '',
  local_path: 'C:/runs/1/assets/x.jpg',
  media_type: 'image',
  width: 1352,
  height: 1088,
  ...o,
});

const plan = (clips: RenderClip[], duration = 40) =>
  buildRenderPlan({
    clips,
    duration_s: duration,
    voicePath: 'voice.wav',
    loudness: { input_i: '-20', input_tp: '-3', input_lra: '4', input_thresh: '-30', target_offset: '0.1' },
    captionsFile: 'captions.ass',
    fontsDir: '../../assets/fonts',
    output: 'final.mp4',
  } satisfies RenderPlanInput);

const three = [
  clip({ nasa_id: 'A', start_s: 0, end_s: 12, mode: 'kenburns' }),
  clip({ nasa_id: 'B', start_s: 12, end_s: 25, mode: 'pan', direction: 'left' }),
  clip({ nasa_id: 'C', start_s: 25, end_s: 40, mode: 'blur_bg', media_type: 'video', local_path: 'v.mp4', source_in_s: 3 }),
];

describe('buildRenderPlan', () => {
  const { args, filter } = plan(three);

  it('outputs the §6 spec: H.264 yuv420p 30 fps, AAC 48 kHz, exact duration', () => {
    const s = args.join(' ');
    expect(s).toContain('-c:v libx264');
    expect(s).toContain('-pix_fmt yuv420p -color_range tv');
    expect(s).toContain('-r 30');
    expect(s).toContain('-c:a aac');
    expect(s).toContain('-ar 48000');
    expect(s).toContain('-t 40');
    expect(args.at(-1)).toBe('final.mp4');
  });

  it('loops stills and seeks into video sources', () => {
    const s = args.join(' ');
    expect(s).toContain(`-loop 1 -framerate 30 -t ${12 + XFADE_S} -i C:/runs/1/assets/x.jpg`);
    expect(s).toContain('-ss 3 -t 15 -i v.mp4'); // last clip is not extended
  });

  it('every clip is scaled/cropped to 1080×1920', () => {
    for (const i of [0, 1, 2]) expect(filter).toContain(`[c${i}]`);
    expect(filter.match(/crop=1080:1920/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('ken burns zoom never exceeds 1.15×', () => {
    expect(filter).toContain('(1+0.15*t/12.4)');
  });

  it('pan left moves from the right edge to the left', () => {
    expect(filter).toContain("x='(iw-ow)*(1-t/13.4)'");
  });

  it('video blur_bg has no zoom on the foreground', () => {
    expect(filter).toContain('[fgsrc2]scale=1080:-2[fg2]');
  });

  it('crossfades at the clip boundaries so the timeline stays exact', () => {
    expect(filter).toContain('xfade=transition=fade:duration=0.4:offset=12[x1]');
    expect(filter).toContain('xfade=transition=fade:duration=0.4:offset=25[vx]');
  });

  it('burns in captions with the bundled fonts', () => {
    expect(filter).toContain('[vx]subtitles=captions.ass:fontsdir=../../assets/fonts,scale=out_range=tv,format=yuv420p[vout]');
  });

  it('two-pass loudnorm to −14 LUFS, padded to the full duration', () => {
    expect(filter).toContain('loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-20');
    expect(filter).toContain('apad=whole_dur=40');
    // Video 7 clipped at 0 dB: a true-peak limiter after loudnorm keeps peaks under −1.5 dBFS.
    expect(filter).toMatch(/loudnorm=[^;]*,aresample=48000,alimiter=limit=0\.8:level=false[^;]*,apad=/);
    expect(filter).toContain('[3:a]'); // voice is the input after the 3 clips
  });

  it('single clip skips the crossfade', () => {
    const p = plan([clip({ end_s: 40 })]);
    expect(p.filter).not.toContain('xfade');
    expect(p.filter).toContain('[c0]subtitles=');
  });
});

describe('edge trim', () => {
  it('shaves still-image borders but not video', () => {
    const { filter } = plan(three);
    expect(filter).toContain('[0:v]fps=30,setsar=1,crop=iw-8:ih-8');
    expect(filter).toContain('[2:v]fps=30,setsar=1,split');
  });
});

describe('focus + zoom on stills', () => {
  it('blur_bg zooms inside a fixed box toward the focus point', () => {
    const { filter } = plan([clip({ end_s: 40, focus: { x: 0.34, y: 0.59 }, zoom: 1.15, direction: 'in' })]);
    // box = 1080 wide, height from the trimmed 1344×1080 source → 868
    expect(filter).toContain("scale=w='trunc(1080*(1+0.15*t/40)/2)*2':h=-2:eval=frame,crop=1080:868:x='0.34*(1080*(1+0.15*t/40)-1080)':y='0.59*(868*(1+0.15*t/40)-868)'");
  });

  it('defaults to a gentle centred zoom', () => {
    const { filter } = plan([clip({ end_s: 40 })]);
    expect(filter).toContain("(1+0.08*t/40)");
    expect(filter).toContain("x='0.5*(1080*(1+0.08*t/40)-1080)'");
  });

  it('kenburns honours focus', () => {
    const { filter } = plan([clip({ end_s: 40, mode: 'kenburns', focus: { x: 0.2, y: 0.8 } })]);
    expect(filter).toContain("crop=1080:1920:x='0.2*(1080*(1+0.15*t/40)-1080)':y='0.8*(1920*(1+0.15*t/40)-1920)'");
  });

  it('refuses a still without dimensions', () => {
    expect(() => plan([clip({ end_s: 40, width: undefined })])).toThrow(/width\/height/);
  });
});
describe('pano (panoramas)', () => {
  // Real case: PIA24935 is 4884×958.
  const pano = (o: Partial<RenderClip> = {}) =>
    plan([clip({ end_s: 10, mode: 'pano', width: 4884, height: 958, ...o })], 10).filter;

  it('shows a tall band (≤1.2× upscale) instead of filling the frame', () => {
    // (958-8)·1.2 = 1140 → capped at 1100; width 4876·1100/950 = 5646
    expect(pano()).toContain('[fgsrc0]scale=5646:1100,crop=1080:1100:');
  });

  it('slides at most 80 px/s, centred on the focus', () => {
    const f = pano();
    // travel = 800 px over 10 s, centred: centre = 0.5·5646 − 540 = 2283 → start 1883
    expect(f).toContain("x='1883+800*t/10'");
  });

  it('left direction slides the other way', () => {
    expect(pano({ direction: 'left' })).toContain("x='2683+-800*t/10'");
  });

  it('band sits in the middle of the safe area', () => {
    expect(pano()).toContain('overlay=x=0:y=218');
  });
});

describe('crop (part of the picture)', () => {
  it('crops a video to one camera view, then frames it', () => {
    // 1920×1080 split screen, take the left half.
    const { filter } = plan([clip({ end_s: 40, media_type: 'video', local_path: 'v.mp4', width: 1920, height: 1080, crop: { x: 0, y: 0, w: 0.5, h: 1 } })]);
    expect(filter).toContain('[0:v]fps=30,setsar=1,crop=960:1080:0:0,split');
  });

  it('box height follows the cropped shape for stills', () => {
    const { filter } = plan([clip({ end_s: 40, width: 1352, height: 1088, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } })]);
    // trimmed 1344×1080 → crop 672×1080 → box 1080 wide × 1736 tall
    expect(filter).toContain('crop=iw-8:ih-8,crop=672:1080:336:0');
    expect(filter).toContain('crop=1080:1736:');
  });
});
