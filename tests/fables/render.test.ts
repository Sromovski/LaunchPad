import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { saveFableScript } from '../../src/fables/script.js';
import { assertScriptApproved, creditsSummary, fablesQa, finishRender, logJob, plannedWindows, readRenderLog, recordBalance, sceneWindows, startRender } from '../../src/fables/render.js';
import { ffmpegBin, run } from '../../src/media/probe.js';
import { decideScript, decideVideo } from '../../src/review/fables.js';
import { transitionVideo } from '../../src/db/status.js';

const SAMPLE = JSON.parse(readFileSync(new URL('../../channels/fables/samples/pf-001/script.json', import.meta.url), 'utf8'));

let db: Database.Database;
let runsRoot: string;
beforeEach(() => {
  db = openDb(':memory:');
  runsRoot = mkdtempSync(join(tmpdir(), 'launchpad-render-'));
});
const approved = () => {
  const id = saveFableScript(db, SAMPLE, { createdBy: 'test', runsRoot }).video_id;
  decideScript(db, id, { decision: 'approved', version: 1 });
  return id;
};

describe('the hard rule, checked again before credits are spent', () => {
  it('passes for a script Thomas approved in the review site', () => {
    expect(assertScriptApproved(db, approved())).toBe(1);
  });

  it('refuses a script still in review', () => {
    const id = saveFableScript(db, SAMPLE, { createdBy: 'test', runsRoot }).video_id;
    expect(() => startRender(db, id, 178, runsRoot)).toThrow(/not script_approved/);
    expect(existsSync(join(runsRoot, String(id), 'everygen.json'))).toBe(false);
  });

  it('refuses script_approved with no matching review on record (status forced in the DB)', () => {
    const id = saveFableScript(db, SAMPLE, { createdBy: 'test', runsRoot }).video_id;
    db.prepare("UPDATE videos SET status = 'script_approved' WHERE id = ?").run(id);
    expect(() => startRender(db, id, 178, runsRoot)).toThrow(/no review-site approval/);
  });

  it('refuses NASA videos', () => {
    const nasa = Number(db.prepare("INSERT INTO videos (topic) VALUES ('x')").run().lastInsertRowid);
    expect(() => startRender(db, nasa, 178, runsRoot)).toThrow(/not found/);
  });
});

describe('startRender / logJob', () => {
  it('moves to rendering and writes a render log with the starting balance', () => {
    const id = approved();
    startRender(db, id, 178, runsRoot);
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status: 'rendering' });
    logJob(runsRoot, id, { step: 'voiceover', id: 'gen-1', url: 'https://x/vo.wav' });
    expect(readRenderLog(runsRoot, id)).toMatchObject({ script_version: 1, balance_before: 178, jobs: [{ step: 'voiceover', id: 'gen-1' }] });
  });

  it('one render per approved script: a second start is refused', () => {
    const id = approved();
    startRender(db, id, 178, runsRoot);
    transitionVideo(db, id, 'failed', { error: 'Everygen timeout' });
    transitionVideo(db, id, 'rendering'); // the one automatic retry
    db.prepare("UPDATE videos SET status = 'script_approved' WHERE id = ?").run(id);
    expect(() => startRender(db, id, 170, runsRoot)).toThrow(/already has an Everygen render log/);
  });
});

describe('sceneWindows', () => {
  const narr = ['one two three four', 'five six seven eight', 'nine ten'];

  it('splits by spoken words, snaps cuts to nearby sentence ends, last scene ends with the voiceover', () => {
    const w = sceneWindows(narr, [4.4, 8.6, 10.2], 10.2);
    expect(w.map((x) => [x.start, x.end])).toEqual([
      [0, 4],
      [4, 9],
      [9, 11],
    ]);
  });

  it('never makes a clip shorter than the model minimum, and windows are contiguous', () => {
    const w = sceneWindows(narr, [], 10, 4);
    expect(w.every((x) => x.clip_seconds >= 4)).toBe(true);
    for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBe(w[i - 1]!.end);
  });

  it('cuts on the exact sentence ends when the voiceover reports one per sentence (real video 139 timing)', () => {
    const ends = [1.242, 3.053, 4.272, 10.844, 15.441, 19.481, 21.641, 24.95, 29.733, 32.554, 34.4, 35.178, 39.37, 40.147, 40.867, 41.808, 42.237, 46.661, 50.074, 52.709];
    const w = sceneWindows(SAMPLE.scenes.map((s: { narration: string }) => s.narration), ends, 52.71);
    // Scene 1 is three sentences ("Hi, I'm Pip! … today? A paintbrush!"), ending at 4.27 s, not 3.05 s.
    expect(w.map((x) => x.end)).toEqual([4, 11, 15, 22, 30, 35, 42, 47, 50, 53]);
  });

  it('works on the real sample (10 scenes, ~58 s of speech)', () => {
    const w = sceneWindows(SAMPLE.scenes.map((s: { narration: string }) => s.narration), [], 58);
    expect(w).toHaveLength(10);
    expect(w[9]!.end).toBe(58);
  });
});

describe('fablesQa', () => {
  const streams = (w: number, h: number, audio = true) => [
    { codec_type: 'video', codec_name: 'h264', width: w, height: h },
    ...(audio ? [{ codec_type: 'audio', codec_name: 'aac' }] : []),
  ];
  it('passes 9:16, 45–65 s, with audio, decoding cleanly', () => {
    expect(fablesQa({ duration: 59.5, streams: streams(1080, 1920) }, null).pass).toBe(true);
  });
  it.each([
    ['landscape', { duration: 59, streams: streams(1920, 1080) }, null],
    ['too long', { duration: 70, streams: streams(720, 1280) }, null],
    ['silent', { duration: 59, streams: streams(720, 1280, false) }, null],
    ['broken file', { duration: 59, streams: streams(720, 1280) }, 'Invalid data'],
  ])('fails when %s', (_name, p, err) => {
    expect(fablesQa(p, err as string | null).pass).toBe(false);
  });
});

describe('finishRender (real ffprobe on tiny test clips)', () => {
  const clips: Record<string, Buffer> = {};
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'launchpad-clip-'));
    for (const [name, secs] of [['good', 55], ['short', 10]] as const) {
      const out = join(dir, `${name}.mp4`);
      run(ffmpegBin(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=orange:s=90x160:r=5:d=${secs}`, '-f', 'lavfi', '-i', `sine=d=${secs}`, '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', out]);
      clips[name] = readFileSync(out);
    }
  }, 60_000);
  const fakeFetch = (buf: Buffer) => (async () => new Response(new Uint8Array(buf))) as unknown as typeof fetch;

  it('downloads, records credits used, passes QA and lands in video_review', async () => {
    const id = approved();
    startRender(db, id, 178, runsRoot);
    const r = await finishRender(db, id, { url: 'https://everygen.example/final.mp4', balanceAfter: 120, runsRoot, fetchImpl: fakeFetch(clips.good!) });
    expect(r).toMatchObject({ status: 'video_review', credits_used: 58 });
    expect(db.prepare('SELECT status, final_path FROM videos WHERE id = ?').get(id)).toEqual({ status: 'video_review', final_path: `runs/${id}/final.mp4` });
    expect(db.prepare('SELECT credits_used, balance_after FROM credits WHERE video_id = ?').get(id)).toEqual({ credits_used: 58, balance_after: 120 });
    expect(JSON.parse(readFileSync(join(runsRoot, String(id), 'qa.json'), 'utf8')).pass).toBe(true);
  }, 60_000);

  it('a QA failure still records the credits, then fails with the reason', async () => {
    const id = approved();
    startRender(db, id, 178, runsRoot);
    const r = await finishRender(db, id, { url: 'https://everygen.example/final.mp4', balanceAfter: 150, runsRoot, fetchImpl: fakeFetch(clips.short!) });
    expect(r.status).toBe('failed');
    expect(db.prepare('SELECT status, error FROM videos WHERE id = ?').get(id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/length/) });
    expect(db.prepare('SELECT credits_used FROM credits WHERE video_id = ?').get(id)).toEqual({ credits_used: 28 });
  }, 60_000);

  it('refuses unless rendering, and refuses non-https URLs', async () => {
    const id = approved();
    await expect(finishRender(db, id, { url: 'https://x/y.mp4', balanceAfter: 1, runsRoot })).rejects.toThrow(/not rendering/);
    startRender(db, id, 178, runsRoot);
    await expect(finishRender(db, id, { url: 'file:///etc/passwd', balanceAfter: 1, runsRoot })).rejects.toThrow(/https/);
  });
});

describe('decideVideo (gate 2)', () => {
  const inReview = () => {
    const id = approved();
    for (const s of ['rendering', 'rendered', 'video_review'] as const) transitionVideo(db, id, s);
    return id;
  };
  it.each([
    ['approved', 'approved'],
    ['changes_requested', 'video_changes'],
    ['rejected', 'rejected'],
  ])('%s → %s, recorded as a video-gate review', (decision, status) => {
    const id = inReview();
    decideVideo(db, id, { decision, notes: 'n' });
    expect(db.prepare('SELECT status FROM videos WHERE id = ?').get(id)).toEqual({ status });
    expect(db.prepare('SELECT gate FROM reviews WHERE video_id = ? ORDER BY id DESC LIMIT 1').get(id)).toEqual({ gate: 'video' });
  });

  it('video changes go back through the script gate as a new version, and the next render archives the old log', () => {
    const id = inReview();
    decideVideo(db, id, { decision: 'changes_requested', notes: 'Pip should wave at the end' });
    expect(saveFableScript(db, SAMPLE, { videoId: id, createdBy: 'test', runsRoot })).toMatchObject({ version: 2, status: 'script_review' });
    expect(() => assertScriptApproved(db, id)).toThrow(/not script_approved/);
  });

  it('refuses outside video_review and needs notes for changes', () => {
    const id = approved();
    expect(() => decideVideo(db, id, { decision: 'approved' })).toThrow(/not video_review/);
    for (const st of ['rendering', 'rendered', 'video_review'] as const) transitionVideo(db, id, st);
    expect(() => decideVideo(db, id, { decision: 'changes_requested', notes: '' })).toThrow(/notes/);
  });
});

describe('credits panel data', () => {
  it('is empty before any balance check', () => {
    expect(creditsSummary(db)).toMatchObject({ remaining: null, used_this_month: 0, renders_this_month: 0 });
  });

  it('shows the latest balance, carries plan size and renewal forward, and sums this month’s renders', () => {
    recordBalance(db, { remaining: 178, plan_max: 200, period_end: '2026-11-30T18:37:57.000Z' });
    recordBalance(db, { remaining: 112 });
    const id = approved();
    db.prepare("INSERT INTO credits (video_id, credits_used, balance_after, created_at) VALUES (?, 66, 112, '2026-10-31 20:20:00')").run(id);
    db.prepare("INSERT INTO credits (video_id, credits_used, balance_after, created_at) VALUES (?, 50, 62, '2026-09-30 10:00:00')").run(id);
    expect(creditsSummary(db, new Date('2026-10-31T21:00:00Z'))).toMatchObject({
      remaining: 112,
      plan_max: 200,
      period_end: '2026-11-30T18:37:57.000Z',
      used_this_month: 66,
      renders_this_month: 1,
    });
  });
});

describe('plannedWindows (Pip talks to camera in the first and last scene)', () => {
  const scenes = [
    { narration: "Hi, I'm Pip!", pip_on_camera: true },
    { narration: 'one two three four' },
    { narration: 'five six seven eight' },
    { narration: 'Remember: share!', pip_on_camera: true },
  ];

  it('gives Pip his own windows around the story voiceover, contiguous, with a breath after his line', () => {
    const w = plannedWindows(scenes, { total: 10.2, sentenceEnds: [] }, { intro: 2.4, outro: 4.1 });
    expect(w.map((x) => [x.n, x.start, x.end, x.audio])).toEqual([
      [1, 0, 4, 'intro'],
      [2, 4, 9, 'story'],
      [3, 9, 15, 'story'],
      [4, 15, 20, 'outro'],
    ]);
  });

  it('works like sceneWindows when nobody is on camera, and asks for missing Pip lengths', () => {
    const plain = scenes.map(({ narration }) => ({ narration }));
    expect(plannedWindows(plain, { total: 12, sentenceEnds: [] }, {}).every((x) => x.audio === 'story')).toBe(true);
    expect(() => plannedWindows(scenes, { total: 10, sentenceEnds: [] }, { outro: 3 })).toThrow(/--intro/);
  });
});
