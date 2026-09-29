/**
 * Builds a throwaway DB + runs folder for the e2e tests (never the real data):
 *   1: in_review, one co-credited asset  → rights gate + approve
 *   2: in_review, clear assets           → reject
 *   3: in_review, clear assets           → request changes
 *   4: approved                          → shows in History
 * Each gets a 3 s test MP4 (with audio) and a thumbnail.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDb } from '../../src/db/index.js';
import { ffmpegPath } from '../../src/media/tools.js';

const TMP = resolve(import.meta.dirname, '.tmp');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(resolve(TMP, 'runs'), { recursive: true });
const db = openDb(resolve(TMP, 'e2e.db'));
const ffmpeg = ffmpegPath();
if (!ffmpeg) throw new Error('ffmpeg not found');

const script = {
  title: 'Why Are Sunsets on Mars Blue?',
  hook: 'Did you know sunsets on Mars are blue?',
  hook_source_ids: ['s1'],
  lines: [{ text: 'Fine dust lets blue light through.', source_ids: ['s1'] }],
  end_question: 'What color would you see?',
  on_screen_text: [],
};

function seed(status: string, title: string, rights: string) {
  const id = Number(
    db
      .prepare("INSERT INTO videos (topic, status, title, duration_s, description, hashtags) VALUES (?, ?, ?, 3, ?, ?)")
      .run('Why are sunsets on Mars blue?', status, title, 'Footage: NASA/JPL-Caltech\n\nNarration voice is AI-generated.', JSON.stringify(['#Mars', '#Space', '#ScienceForKids']))
      .lastInsertRowid,
  );
  db.prepare("INSERT INTO assets (video_id, nasa_id, media_type, source_url, credit, rights_status) VALUES (?, 'PIA19400', 'image', 'https://images.nasa.gov/details/PIA19400', ?, ?)").run(
    id,
    rights === 'clear' ? 'NASA/JPL-Caltech' : 'NASA/JPL-Caltech/MSSS/Texas A&M Univ',
    rights,
  );
  const src = Number(db.prepare("INSERT INTO sources (video_id, ref, url, title, excerpt) VALUES (?, 's1', 'https://science.nasa.gov/mars/', 'Mars facts', 'Dust…')").run(id).lastInsertRowid);
  const scriptId = Number(
    db.prepare("INSERT INTO scripts (video_id, version, hook, body_json, word_count, reading_grade, created_by) VALUES (?, 1, ?, ?, 20, 2, 'e2e')").run(id, script.hook, JSON.stringify(script))
      .lastInsertRowid,
  );
  db.prepare("INSERT INTO fact_checks (script_id, claim, source_id, verdict) VALUES (?, 'Sunsets on Mars are blue', ?, 'supported')").run(scriptId, src);

  const dir = resolve(TMP, 'runs', String(id));
  mkdirSync(resolve(dir, 'frames'), { recursive: true });
  const r = spawnSync(ffmpeg!, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
    resolve(dir, 'final.mp4'),
  ]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  spawnSync(ffmpeg!, ['-y', '-loglevel', 'error', '-ss', '1', '-i', resolve(dir, 'final.mp4'), '-frames:v', '1', resolve(dir, 'frames', 'frame-1.png')]);
  return id;
}

seed('in_review', 'Rights gate video', 'needs_review');
seed('in_review', 'Reject me', 'clear');
seed('in_review', 'Needs changes', 'clear');
const approved = seed('approved', 'Already approved', 'clear');
// A bonus space picture after the end card (media:render records it in render-config.json).
writeFileSync(
  resolve(TMP, 'runs', String(approved), 'render-config.json'),
  JSON.stringify({
    duration_s: 2,
    bonus: { asset_id: 'iotd:earth-at-night', title: 'Space Station View of Earth at Night', credit: 'NASA/Jessica Meir', date_text: 'September 28, 2026', page: 'https://www.nasa.gov/image-detail/earth-at-night/', start_s: 2, end_s: 3 },
  }),
);
db.close();
console.log(`seeded ${TMP}`);
