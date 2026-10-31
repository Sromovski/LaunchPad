/**
 * Pocket Fables scripts (channels/fables/CLAUDE.md §2). `runs/<id>/script.json` is the
 * source of truth; each save is also a new `scripts` row (version n+1) so revisions are kept,
 * and `script.md` is rewritten for humans.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { FABLES } from '../channels.js';
import { PROJECT_ROOT } from '../db/index.js';
import { transitionVideo } from '../db/status.js';

export const WORDS = { min: 130, max: 150 } as const;
export const SECONDS = { min: 50, max: 65 } as const; // same window as the render QA (§4)
const AI_VOICE = 'Narration voice is AI-generated.';

const text = z.string().trim().min(1);

export const Scene = z.object({
  n: z.number().int().positive(),
  seconds: z.number().positive().max(20),
  narration: text,
  visuals: text,
  on_screen_text: z.string().default(''),
});

export const FableScript = z.object({
  /** Our DB id once saved; hand-written samples carry a label like "pf-001". */
  video_id: z.union([z.string(), z.number()]).transform(String),
  title: text.max(100),
  lane: z.enum(['folktale', 'bedtime', 'lesson']),
  origin: text,
  lesson: text,
  narrator: text,
  visual_style: text,
  est_seconds: z.number().positive(),
  word_count: z.number().int().nonnegative(),
  scenes: z
    .array(Scene)
    .min(3)
    .refine((s) => s.every((x, i) => x.n === i + 1), 'scenes must be numbered 1, 2, 3… in order'),
  youtube: z.object({
    title: text.max(100),
    description: text.max(5000),
    tags: z.array(text).max(30),
    made_for_kids: z.literal(true),
  }),
});
export type FableScript = z.infer<typeof FableScript>;

/** Spoken words: tokens with a letter or digit ("Whoosh!" counts, a lone "—" doesn't). */
export const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const narrationWords = (script: Pick<FableScript, 'scenes'>) => script.scenes.reduce((n, s) => n + countWords(s.narration), 0);
export const sceneSeconds = (script: Pick<FableScript, 'scenes'>) => script.scenes.reduce((n, s) => n + s.seconds, 0);

/**
 * Things Thomas should see before approving, not hard errors: the script is still
 * readable and reviewable, he decides. Shown as warnings on the review site.
 */
export function scriptWarnings(script: FableScript): string[] {
  const w: string[] = [];
  const words = narrationWords(script);
  if (words < WORDS.min || words > WORDS.max) w.push(`${words} spoken words; target is ${WORDS.min}–${WORDS.max} for a 60-second Short.`);
  if (words !== script.word_count) w.push(`word_count says ${script.word_count}, but the narration has ${words} words.`);
  const secs = sceneSeconds(script);
  if (secs < SECONDS.min || secs > SECONDS.max) w.push(`Scenes add up to ${secs} s; the render must be ${SECONDS.min}–${SECONDS.max} s.`);
  if (Math.abs(secs - script.est_seconds) > 2) w.push(`Scenes add up to ${secs} s, but est_seconds is ${script.est_seconds}.`);
  const desc = script.youtube.description;
  if (!desc.includes(AI_VOICE)) w.push(`YouTube description is missing "${AI_VOICE}" (required on every channel).`);
  if (script.lane === 'folktale') {
    const culture = script.origin.split(/[\s(,]/)[0] ?? '';
    if (culture && !desc.toLowerCase().includes(culture.toLowerCase())) w.push(`Folktale: the description should name the culture of origin (${script.origin}).`);
  }
  if (/\bnasa\b/i.test(desc)) w.push('Description mentions NASA; Pocket Fables has no NASA material.');
  return w;
}

export function scriptMarkdown(s: FableScript): string {
  const scenes = s.scenes
    .map((x) =>
      [
        `### Scene ${x.n} · ${x.seconds}s`,
        `**Narration:** ${x.narration}`,
        '',
        `**Visuals:** ${x.visuals}`,
        ...(x.on_screen_text ? ['', `**On-screen text:** ${x.on_screen_text}`] : []),
      ].join('\n'),
    )
    .join('\n\n');
  return `# ${s.title}  ·  \`${s.video_id}\`

**Lane:** ${s.lane} · **Origin:** ${s.origin} · **Runtime:** ~${s.est_seconds}s · **Words:** ${narrationWords(s)}

**Lesson:** ${s.lesson}

**Narrator / voice:** ${s.narrator}

**Visual style:** ${s.visual_style}

## Scenes

${scenes}

## YouTube

**Title:** ${s.youtube.title}

**Description:**

${s.youtube.description}

**Tags:** ${s.youtube.tags.join(', ')}

**Made for Kids:** yes
`;
}

export interface SavedScript {
  video_id: number;
  version: number;
  status: string;
  run_dir: string;
  word_count: number;
  warnings: string[];
}

const runDirOf = (runsRoot: string, id: number) => resolve(runsRoot, String(id));

/**
 * Save a script. Without `videoId`: a new Pocket Fables video (idea → scripted → script_review).
 * With `videoId`: a revision of a video Thomas sent back (script_changes → scripted → script_review,
 * or video_changes → script_review). Never moves past script_review: approval is Thomas's.
 */
export function saveFableScript(
  db: Database.Database,
  raw: unknown,
  opts: { videoId?: number; createdBy: string; runsRoot?: string },
): SavedScript {
  const parsed = FableScript.parse(raw);
  const runsRoot = opts.runsRoot ?? resolve(PROJECT_ROOT, 'runs');

  return db.transaction(() => {
    let id: number;
    if (opts.videoId === undefined) {
      const dup = db
        .prepare("SELECT id FROM videos WHERE channel = 'fables' AND lower(topic) = lower(?) AND status != 'rejected'")
        .get(parsed.title) as { id: number } | undefined;
      if (dup) throw new Error(`"${parsed.title}" is already video ${dup.id}; pass --video ${dup.id} to revise it`);
      id = Number(db.prepare('INSERT INTO videos (topic, title, channel) VALUES (?, ?, ?)').run(parsed.title, parsed.youtube.title, FABLES.key).lastInsertRowid);
      db.prepare('UPDATE videos SET run_dir = ? WHERE id = ?').run(relative(PROJECT_ROOT, runDirOf(runsRoot, id)).replace(/\\/g, '/'), id);
    } else {
      id = opts.videoId;
      const v = db.prepare('SELECT channel, status FROM videos WHERE id = ?').get(id) as { channel: string; status: string } | undefined;
      if (!v) throw new Error(`video ${id} not found`);
      if (v.channel !== FABLES.key) throw new Error(`video ${id} is a ${v.channel} video, not Pocket Fables`);
      if (!['script_changes', 'video_changes'].includes(v.status)) {
        throw new Error(`video ${id} is ${v.status}; a script can only be revised after Thomas requests changes`);
      }
      db.prepare("UPDATE videos SET title = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.youtube.title, id);
    }

    const script: FableScript = { ...parsed, video_id: String(id), word_count: narrationWords(parsed) };
    const version = ((db.prepare('SELECT MAX(version) AS v FROM scripts WHERE video_id = ?').get(id) as { v: number | null }).v ?? 0) + 1;
    db.prepare(
      `INSERT INTO scripts (video_id, version, hook, body_json, word_count, created_by, scenes_json, lane, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, version, script.scenes[0]!.narration, JSON.stringify(script), script.word_count, opts.createdBy, JSON.stringify(script.scenes), script.lane, script.origin);

    const status = (db.prepare('SELECT status FROM videos WHERE id = ?').get(id) as { status: string }).status;
    if (status === 'idea' || status === 'script_changes') transitionVideo(db, id, 'scripted');
    transitionVideo(db, id, 'script_review');

    // Files last, so a failed DB step leaves nothing behind (the transaction rolls back).
    const dir = runDirOf(runsRoot, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'script.json'), `${JSON.stringify(script, null, 2)}\n`);
    writeFileSync(resolve(dir, 'script.md'), scriptMarkdown(script));

    return {
      video_id: id,
      version,
      status: 'script_review',
      run_dir: relative(PROJECT_ROOT, dir).replace(/\\/g, '/'),
      word_count: script.word_count,
      warnings: scriptWarnings(script),
    };
  })();
}
