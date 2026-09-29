/**
 * PROTOTYPE (not part of the pipeline): append a "Space Picture of the Day" outro
 * from NASA's Image of the Day feed to an existing Launchpad video.
 *
 *   npx tsx prototypes/potd/make-potd.ts --video 6 --item 0
 *     --item N  = Nth newest Image of the Day (0 = today's)
 *   → prototypes/potd/out/video<id>-potd-<slug>.mp4 (+ outro pieces)
 *
 * Reuses the real render path (blur_bg framing, Fredoka captions, loudnorm) for the outro.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkCredit } from '../../src/nasa/credits.js';
import { synthesize } from '../../src/media/tts.js';
import { encodeWav } from '../../src/media/wav.js';
import { buildRenderPlan } from '../../src/media/render.js';
import { assEscape, wrap } from '../../src/media/captions.js';
import { ffmpegBin, measureLoudness, probe, run } from '../../src/media/probe.js';
import { slugify } from '../../src/export/package.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = resolve(HERE, 'out');
const FEED = 'https://www.nasa.gov/feeds/iotd-feed/';

const a = parseArgs({ options: { video: { type: 'string' }, item: { type: 'string', default: '0' } } }).values;
const videoId = Number(a.video);
if (!videoId) throw new Error('--video <id> is required');
mkdirSync(OUT, { recursive: true });

// ---- 1. Today's (or the Nth) NASA Image of the Day ------------------------------------
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .trim();
const rss = await (await fetch(FEED)).text();
const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
const raw = items[Number(a.item)];
if (!raw) throw new Error(`feed has no item ${a.item}`);
const pick = (tag: string) => decode(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(raw)?.[1] ?? '');
const item = {
  title: pick('title'),
  link: pick('link'),
  date: new Date(pick('pubDate')),
  image: /<enclosure[^>]+url="([^"]+)"/.exec(raw)?.[1] ?? '',
  description: pick('description'),
};
if (!item.image) throw new Error('feed item has no image');

// Credit is on the image page ("Image Credit: NASA/Jessica Meir").
const page = decode((await (await fetch(item.link)).text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''));
const credit = /Image Credit:?\s*(.+?)\s*(?:Read More|Size\b|\n)/.exec(page.replace(/\s+/g, ' '))?.[1]?.trim() ?? null;
const rights = checkCredit({ credits: [credit], description: item.description });
console.error(`Image of the Day: "${item.title}" (${item.date.toDateString()}) credit=${credit} → ${rights.status} ${rights.note}`);

const slug = slugify(item.title);
const imgPath = resolve(OUT, `${slug}.jpg`);
if (!existsSync(imgPath)) {
  const big = resolve(OUT, `${slug}-orig.jpg`);
  writeFileSync(big, Buffer.from(await (await fetch(item.image)).arrayBuffer()));
  // NASA originals can be 8000+ px wide: scale to 2160 wide first so the render stays quick.
  run(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', big, '-vf', "scale='min(2160,iw)':-2", '-q:v', '2', imgPath]);
}

// ---- 2. Voice: same Kokoro voice/pace as the videos -------------------------------------
const lines = ["Here's your space picture of the day!", `${item.title}.`];
const tts = await synthesize(lines, { gapMs: 300, leadMs: 250, tailMs: 1200 });
const voiceWav = resolve(OUT, `outro-${slug}.wav`);
writeFileSync(voiceWav, encodeWav(tts.samples, tts.sampleRate));
const outroSeconds = Math.round((tts.samples.length / tts.sampleRate) * 30) / 30;

// ---- 3. On-screen text (ASS, same fonts/colours as the videos) -----------------------------
const dateText = item.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const t = (s: number) => {
  const cs = Math.round(s * 100);
  return `0:${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const ass = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1080',
  'PlayResY: 1920',
  'ScaledBorderAndShadow: yes',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Head,Fredoka,92,&H003FD2FF,&H003FD2FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,7,3,8,70,170,150,1',
  'Style: Date,Fredoka SemiBold,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,4,2,8,70,170,390,1',
  'Style: Title,Fredoka,76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,6,3,2,70,170,560,1',
  'Style: Credit,Fredoka SemiBold,34,&H20FFFFFF,&H20FFFFFF,&H90000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,7,48,170,70,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  `Dialogue: 1,${t(0)},${t(outroSeconds)},Head,,0,0,0,,{\\fad(250,0)}Space Picture\\Nof the Day`,
  `Dialogue: 1,${t(0.3)},${t(outroSeconds)},Date,,0,0,0,,{\\fad(250,0)}${assEscape(dateText)}`,
  `Dialogue: 1,${t(tts.segments[1]!.start_s)},${t(outroSeconds)},Title,,0,0,0,,{\\fad(200,0)}${wrap(assEscape(item.title), 20)}`,
  `Dialogue: 1,${t(0)},${t(outroSeconds)},Credit,,0,0,0,,${wrap(assEscape(`Image: ${credit ?? 'NASA'} · NASA Image of the Day`), 44)}`,
  '',
].join('\n');
writeFileSync(resolve(OUT, 'outro.ass'), ass);

// ---- 4. Render the outro with the real render path -------------------------------------------
const s = probe(imgPath).streams.find((x) => x.codec_type === 'video')!;
const outroMp4 = `outro-${slug}.mp4`;
const plan = buildRenderPlan({
  clips: [
    { nasa_id: slug, start_s: 0, end_s: outroSeconds, mode: 'blur_bg', direction: 'in', audio: 'mute', source_in_s: 0, why: '', local_path: imgPath, media_type: 'image', width: s.width, height: s.height },
  ],
  duration_s: outroSeconds,
  voicePath: `outro-${slug}.wav`,
  loudness: measureLoudness(voiceWav),
  captionsFile: 'outro.ass',
  fontsDir: '../../../assets/fonts',
  output: outroMp4,
});
writeFileSync(resolve(OUT, 'filter.txt'), plan.filter);
run(ffmpegBin(), plan.args, { cwd: OUT });

// ---- 5. Append to the real video ------------------------------------------------------------------
const final = resolve(ROOT, 'runs', String(videoId), 'final.mp4');
const result = resolve(OUT, `video${videoId}-potd-${slug}.mp4`);
run(ffmpegBin(), [
  '-y', '-loglevel', 'error', '-i', final, '-i', resolve(OUT, outroMp4),
  '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]',
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', '30',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', result,
]);
const p = probe(result);
console.log(
  JSON.stringify(
    {
      ok: true,
      output: result,
      duration_s: Math.round(p.duration * 10) / 10,
      outro_s: outroSeconds,
      picture: { title: item.title, date: dateText, credit, rights: rights.status, rights_note: rights.note, page: item.link },
    },
    null,
    2,
  ),
);
