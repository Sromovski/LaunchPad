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

/** Spoken words for a 45–65 s Short at the `everygen` voice's natural pace (3.56 words/s). */
export const WORDS = { min: 160, max: 210 } as const;
export const SECONDS = { min: 45, max: 65 } as const; // same window as the render QA (§4)
const AI_VOICE = 'Narration voice is AI-generated.';

const text = z.string().trim().min(1);

export const Scene = z.object({
  n: z.number().int().positive(),
  seconds: z.number().positive().max(20),
  narration: text,
  visuals: text,
  on_screen_text: z.string().default(''),
  /**
   * Pip talks to camera in this scene: its clip is generated from Pip's own voiceover so
   * the mouth moves with the words. Only the first and last scenes (intro and lesson).
   */
  pip_on_camera: z.boolean().default(false),
});

/** The story's main character, saved as an Everygen character so they look the same in every scene. */
export const Hero = z.object({
  name: text.max(60),
  /** One fixed description: age, hair, clothes, colours. Used for the character sheet. */
  look: text.max(600),
});

/**
 * A "Pip & Ma Adventures" two-part episode (channels/fables/CLAUDE.md §2a). Both parts share
 * pair_id, country, fact and word of the day; each part is its own video and Short.
 */
export const Episode = z.object({
  series: text.max(60),
  /** Links the two parts, e.g. "ep02". */
  pair_id: z.string().regex(/^[a-z0-9-]+$/, 'pair_id: lowercase letters, digits and dashes'),
  episode: z.number().int().positive(),
  part: z.number().int().positive(),
  of: z.number().int().min(2),
  country: text.max(60),
  /** Checked by Thomas at script review, so it sits in its own field. */
  word_of_day: z.object({ word: text.max(40), meaning: text.max(80) }),
  /** The one true, kid-level fact about the country. Checked at script review. */
  fact: text.max(300),
});
export type Episode = z.infer<typeof Episode>;

export const FableScript = z.object({
  /** Our DB id once saved; hand-written samples carry a label like "pf-001". */
  video_id: z.union([z.string(), z.number()]).transform(String),
  title: text.max(100),
  lane: z.enum(['adventure', 'folktale', 'bedtime', 'lesson']),
  episode: Episode.optional(),
  origin: text,
  lesson: text,
  narrator: text,
  visual_style: text,
  hero: Hero.optional(),
  est_seconds: z.number().positive(),
  word_count: z.number().int().nonnegative(),
  scenes: z
    .array(Scene)
    .min(3)
    .refine((s) => s.every((x, i) => x.n === i + 1), 'scenes must be numbered 1, 2, 3… in order')
    .refine((s) => s.every((x, i) => !x.pip_on_camera || i === 0 || i === s.length - 1), 'only the first and last scenes can have Pip talking to camera'),
  youtube: z.object({
    title: text.max(100),
    description: text.max(5000),
    tags: z.array(text).max(30),
    made_for_kids: z.literal(true),
  }),
})
  .refine((s) => s.lane !== 'adventure' || !!s.episode, { message: 'an adventure needs its episode block (pair_id, part, country…)', path: ['episode'] })
  .refine((s) => !s.episode || s.episode.part <= s.episode.of, { message: 'episode.part is larger than episode.of', path: ['episode', 'part'] });
export type FableScript = z.infer<typeof FableScript>;

/** Spoken words: tokens with a letter or digit ("Whoosh!" counts, a lone "—" doesn't). */
export const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const narrationWords = (script: Pick<FableScript, 'scenes'>) => script.scenes.reduce((n, s) => n + countWords(s.narration), 0);
export const sceneSeconds = (script: Pick<FableScript, 'scenes'>) => script.scenes.reduce((n, s) => n + s.seconds, 0);

/** Sentences of spoken text (split after . ! ? and any closing quote). */
export const sentences = (s: string) =>
  s
    .split(/(?<=[.!?]["”’]?)\s+/)
    .map((x) => x.trim())
    .filter((x) => countWords(x) > 0);

/** n't, 'm, 're, 've, 'll, 'd always; 's only after words where it means "is" (not possessives). */
const CONTRACTION = /\b(?:\w+n['’]t|\w+['’](?:m|re|ve|ll|d)|(?:it|that|what|there|here|he|she|who|let|where|how)['’]s)\b/gi;
export const countContractions = (s: string) => (s.match(CONTRACTION) ?? []).length;

/**
 * Same idea as Everygen's free check_voice_cadence: AI narration sounds flat when nothing
 * is contracted and every sentence is the same length. Thresholds match that tool.
 */
export function cadenceWarnings(narration: string): string[] {
  const w: string[] = [];
  const lens = sentences(narration).map(countWords);
  if (lens.length < 4) return w;
  const contractions = countContractions(narration);
  if (contractions < lens.length / 4) w.push(`Sounds stiff read aloud: ${contractions} contractions in ${lens.length} sentences. Use more (he's, didn't, we'll).`);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const stdev = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  if (stdev < 3) w.push(`Sentence lengths are too even (spread ${stdev.toFixed(1)} words) and will sound robotic. Mix short punches with longer lines.`);
  return w;
}

/**
 * Things Thomas should see before approving, not hard errors: the script is still
 * readable and reviewable, he decides. Shown as warnings on the review site.
 */
export function scriptWarnings(script: FableScript): string[] {
  const w: string[] = [];
  const words = narrationWords(script);
  if (words < WORDS.min || words > WORDS.max) w.push(`${words} spoken words; target is ${WORDS.min}–${WORDS.max} for a ${SECONDS.min}–${SECONDS.max} s Short.`);
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
  w.push(...cadenceWarnings(script.scenes.map((x) => x.narration).join(' ')));
  const wps = FABLES.everygen.wordsPerSecond;
  if (wps) {
    const spoken = Math.round(words / wps);
    if (spoken < SECONDS.min || spoken > SECONDS.max) w.push(`At the narrator's natural pace this reads in about ${spoken} s; it must land in ${SECONDS.min}–${SECONDS.max} s.`);
  }
  if (!script.hero) w.push("No hero set: the story's main character may look different from scene to scene.");
  if (script.episode) w.push(...episodeWarnings(script, script.episode));
  return w;
}

/** Catchphrases and characters that belong to other shows (§2a: original only). */
const BORROWED = /\b(?:swiper|no swiping|backpack,? backpack|i'?m the map|we did it)\b/i;

/** The §2a episode shape: Pip opens and closes on camera, a viewer question, the cliffhanger or recap, the word of the day. */
export function episodeWarnings(s: FableScript, e: Episode): string[] {
  const w: string[] = [];
  const first = s.scenes[0]!;
  const last = s.scenes[s.scenes.length - 1]!;
  const all = s.scenes.map((x) => `${x.narration} ${x.on_screen_text}`).join(' ');
  const title = s.youtube.title;
  if (!title.includes(`Part ${e.part}`) || !title.includes(`| Pip & Ma in ${e.country} | Pocket Fables`)) {
    w.push(`YouTube title should read "<Episode title> <emoji> Part ${e.part} | Pip & Ma in ${e.country} | Pocket Fables".`);
  }
  const others = Array.from({ length: e.of }, (_, i) => i + 1).filter((p) => p !== e.part);
  const desc = s.youtube.description;
  const names = (p: number) => new RegExp(`\\bpart (?:${p}|${['zero', 'one', 'two', 'three', 'four'][p] ?? p})\\b`, 'i').test(desc);
  if (!others.every(names)) w.push(`The description should name the other part (Part ${others.join(', ')}).`);
  if (!first.pip_on_camera) w.push('Scene 1 should be Pip on camera (hi, or the "last time" recap).');
  if (!last.pip_on_camera) w.push('The last scene should be Pip on camera.');
  if (!s.scenes.some((x) => /\bor\b[^.!]*\?/i.test(`${x.narration} ${x.on_screen_text}`))) {
    w.push('No viewer question found (two choices, e.g. "By the big tree, or by the little pond?").');
  }
  if (e.part < e.of && !/continued/i.test(last.on_screen_text)) w.push('Part 1 should end on a cliffhanger with a "To be continued..." card.');
  if (e.part > 1 && !/last time/i.test(`${first.narration} ${first.on_screen_text}`)) {
    w.push('Part 2 should open with a short "Last time on Pocket Fables…" recap so it makes sense on its own.');
  }
  if (e.part === e.of) {
    const word = e.word_of_day.word.toLowerCase();
    if (!s.scenes.some((x) => x.narration.toLowerCase().includes(word))) w.push(`The word of the day "${e.word_of_day.word}" is never said.`);
    if (!s.scenes.some((x) => x.on_screen_text.toLowerCase().includes(word))) w.push(`The word of the day "${e.word_of_day.word}" should be on screen with its meaning.`);
  }
  const borrowed = all.match(BORROWED);
  if (borrowed) w.push(`"${borrowed[0]}" sounds borrowed from another show; Pocket Fables uses its own lines.`);
  return w;
}

export function scriptMarkdown(s: FableScript): string {
  const scenes = s.scenes
    .map((x) =>
      [
        `### Scene ${x.n} · ${x.seconds}s${x.pip_on_camera ? ' · Pip talks to camera' : ''}`,
        `**Narration:** ${x.narration}`,
        '',
        `**Visuals:** ${x.visuals}`,
        ...(x.on_screen_text ? ['', `**On-screen text:** ${x.on_screen_text}`] : []),
      ].join('\n'),
    )
    .join('\n\n');
  return `# ${s.title}  ·  \`${s.video_id}\`

${s.episode ? `**${s.episode.series}**, episode ${s.episode.episode}, part ${s.episode.part} of ${s.episode.of} · pair \`${s.episode.pair_id}\` · **Country:** ${s.episode.country}

**Fact to check:** ${s.episode.fact}

**Word of the day:** ${s.episode.word_of_day.word} = ${s.episode.word_of_day.meaning}

` : ''}**Lane:** ${s.lane} · **Origin:** ${s.origin} · **Runtime:** ~${s.est_seconds}s · **Words:** ${narrationWords(s)}

**Lesson:** ${s.lesson}

**Narrator / voice:** ${s.narrator}

**Visual style:** ${s.visual_style}
${s.hero ? `\n**Hero:** ${s.hero.name}: ${s.hero.look}\n` : ''}
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
      if (parsed.episode) {
        const taken = pairVideos(db, parsed.episode.pair_id).find((p) => p.part === parsed.episode!.part);
        if (taken) throw new Error(`${parsed.episode.pair_id} part ${parsed.episode.part} is already video ${taken.video_id}; pass --video ${taken.video_id} to revise it`);
      }
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

export interface PairPart {
  video_id: number;
  part: number;
  status: string;
}

/**
 * The videos of one two-part episode, by part (latest script version of each, rejected left out).
 * The review site shows them side by side and the render step only starts a pair together.
 */
export function pairVideos(db: Database.Database, pairId: string): PairPart[] {
  return db
    .prepare(
      `SELECT v.id AS video_id, CAST(json_extract(s.body_json, '$.episode.part') AS INTEGER) AS part, v.status
       FROM videos v
       JOIN scripts s ON s.video_id = v.id AND s.version = (SELECT MAX(version) FROM scripts WHERE video_id = v.id)
       WHERE v.channel = ? AND v.status != 'rejected' AND json_extract(s.body_json, '$.episode.pair_id') = ?
       ORDER BY part, v.id`,
    )
    .all(FABLES.key, pairId) as PairPart[];
}
