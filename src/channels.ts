/**
 * The YouTube channels Launchpad makes videos for. Every video belongs to exactly one
 * (videos.channel); its topics, look, voice, schedule and YouTube login come from here.
 * Blast of Facts keeps every value it had before I Wonder Why was added (2026-10-07).
 */
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { PROJECT_ROOT } from './db/index.js';

/**
 * The NASA-pipeline channels. This list drives the Windows scheduler (src/cli/schedule.ts),
 * posting, view stats and every `--channel` NASA command, so Pocket Fables is NOT in it:
 * it runs its own Everygen workflow, has no scheduled builds and never touches the NASA steps.
 */
export const CHANNEL_KEYS = ['blast', 'wonder'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];
export const DEFAULT_CHANNEL: ChannelKey = 'blast';

/** Every value videos.channel may hold (the CHECK in src/db/schema.sql). */
export const VIDEO_CHANNEL_KEYS = [...CHANNEL_KEYS, 'fables'] as const;
export type VideoChannelKey = (typeof VIDEO_CHANNEL_KEYS)[number];

/**
 * Pocket Fables (channels/fables/CLAUDE.md): world folktales retold by Pip the fox,
 * made with Everygen. Uploaded by hand in YouTube Studio for the test month, so no
 * token file, playlists or post times. Deliberately not a `Channel`: none of the
 * NASA settings (topics file, Kokoro voice, bonus outro, schedule) apply.
 */
export const FABLES = {
  key: 'fables',
  title: 'Pocket Fables',
  youtubeId: 'UCV0cfNkj1zyBopSoByRkgkw',
  madeForKids: true,
  /** Refresh token from `npm run youtube:auth -- --channel fables` (gitignored). */
  tokenFile: resolve(PROJECT_ROOT, 'data/google', 'token-fables.json'),
  /** Every story goes into this playlist after upload. */
  playlist: {
    title: 'World Folktales with Pip',
    description: 'Folktales and fables from around the world, retold in about a minute by Pip the fox. Narration voice is AI-generated.',
  },
  /** Everygen voice id. Back to `everygen`, the voice of video 139 (Thomas, 2026-11-01); Arabella was tried on video 142. */
  everygenVoice: 'everygen',
  brand: { accent: '#E8742A' }, // Pip's fox orange, from channels/fables/art/banner-source.html
  /**
   * Everygen settings for /render-approved. Seedance 2 Mini at 480p: ~40 credits of clips per
   * 60-second video on the 200-credit Starter plan (Thomas, 2026-10-31; Seedance 2.5 was ~108).
   */
  everygen: {
    videoModel: 'Seedance 2 Mini',
    resolution: '480p',
    imageModel: 'gemini-3.1-flash-image-preview', // Nano Banana 2: start frames and Pip's sheet
    minClipSeconds: 4,
    maxClipSeconds: 15,
    /** Don't start a render below this balance: a half-finished render wastes what it spent. */
    minBalance: 80,
    /**
     * Natural speed (Thomas, 2026-10-31): slowing the `everygen` voice to 0.8 on video 139
     * made it sound machine-like. Scripts are written to the voice's pace instead.
     */
    voiceSpeed: 1.0,
    /**
     * Spoken words per second of `everygenVoice` at `voiceSpeed`, so the review site can warn
     * when a script won't land in 50–65 s. Measured on the first render with a voice
     * (the `everygen` voice at 1.0, video 139: 151 words in 42.4 s = 3.56; Arabella at 1.0,
     * video 142: 152 words in 49.8 s = 3.05). null = not measured yet.
     */
    wordsPerSecond: 3.56 as number | null,
    /** Saved Everygen character "Pip (Pocket Fables)", made for video 139. Reuse it: Pip looks the same in every video. */
    pipCharacterId: 'cmvwtswdm000jp002a20oquw6',
    /** Pip's character sheet, passed as a reference image when a frame also uses the story's hero character. */
    pipSheetUrl: 'https://media.viewmax.io/users/egJmG9TOyyA4oDHYC2fN4hD2QzOw8TNR/generated/3bb6b27b-1fd8-4c03-b434-dfa3bcaa8c47.jpg',
  },
} as const;

/** Display name for any videos.channel value (review-site badges). */
export function channelTitle(key: string): string {
  if (key === FABLES.key) return FABLES.title;
  return isChannelKey(key) ? CHANNELS[key].title : key;
}

export interface Channel {
  key: ChannelKey;
  title: string;
  /** Checked by ID only: names can be renamed or differ in capitals. */
  youtubeId: string;
  /** Topic backlog (docs/TOPICS*.md); its "## World | playlist: X" headings set playlists. */
  topicsFile: string;
  /** Refresh token for this channel (gitignored; written by youtube:auth). */
  tokenFile: string;
  /** Playlist for videos whose topic had no playlist heading. */
  defaultPlaylist: string;
  playlistDescription: (title: string) => string;
  /** Windows Task Scheduler times (src/cli/schedule.ts). Staggered so builds never overlap. */
  makeTimes: string[];
  postTimes: string[];
  /** Kokoro voice (LAUNCHPAD_VOICE still overrides for experiments). */
  voice: string;
  /** "Space picture of the day" outro after the end card (src/cli/media-bonus.ts). */
  bonusOutro: boolean;
  brand: {
    /** Highlighted caption word and the thumbnail's last title line (#RRGGBB). */
    highlight: string;
    /** End-card tint behind the closing question (#RRGGBB, drawn at ~60% opacity). */
    endCardTint: string;
  };
}

const google = (file: string) => resolve(PROJECT_ROOT, 'data/google', file);
const AI_VOICE = 'Narration voice is AI-generated.';

export const CHANNELS: Record<ChannelKey, Channel> = {
  blast: {
    key: 'blast',
    title: 'Blast of Facts',
    youtubeId: 'UCHhHYjq4K0sERPPR2od5kRw',
    topicsFile: resolve(PROJECT_ROOT, 'docs/TOPICS.md'),
    tokenFile: google('token.json'),
    defaultPlaylist: 'Mars Facts for Kids',
    playlistDescription: (title) =>
      title === 'Mars Facts for Kids'
        ? `Short, true answers to big Mars questions, made with real NASA pictures and sounds. ${AI_VOICE}`
        : `${title}: short, true answers to big space questions for curious kids, made with real NASA pictures, footage and sounds. ${AI_VOICE}`,
    // 4 builds/day so the review queue outlasts days Thomas doesn't approve (2026-10-24).
    makeTimes: ['07:00', '11:00', '15:00', '19:00'],
    postTimes: ['08:00', '16:00'],
    voice: 'af_heart',
    bonusOutro: true,
    brand: { highlight: '#FFD23F', endCardTint: '#000000' },
  },
  wonder: {
    key: 'wonder',
    title: 'I Wonder Why',
    youtubeId: 'UCqNwPn4hm_lMSOhHdXcfMig',
    topicsFile: resolve(PROJECT_ROOT, 'docs/TOPICS_WONDER.md'),
    tokenFile: google('token-wonder.json'),
    defaultPlaylist: 'Our Wild Planet',
    playlistDescription: (title) =>
      `${title}: short, true answers to the questions curious kids ask about our planet, made with real NASA pictures and footage. ${AI_VOICE}`,
    // Two hours after Blast of Facts: its builds have taken up to 40 min (docs/RUN_LOG.md).
    makeTimes: ['09:00', '13:00', '17:00', '21:00'],
    postTimes: ['10:00', '18:00'],
    voice: 'af_heart', // Same voice as Blast of Facts (Thomas, 2026-10-12; was am_michael)
    bonusOutro: false,
    // Channel art palette (docs/ROADMAP.md): yellow accent on night-sky indigo.
    brand: { highlight: '#FFC93C', endCardTint: '#2B2766' },
  },
};

export function isChannelKey(s: unknown): s is ChannelKey {
  return typeof s === 'string' && (CHANNEL_KEYS as readonly string[]).includes(s);
}

/** `--channel` argument → channel. Missing means Blast of Facts (how everything worked before). */
export function channelByKey(key: string | undefined | null): Channel {
  if (key === undefined || key === null || key === '') return CHANNELS[DEFAULT_CHANNEL];
  if (!isChannelKey(key)) throw new Error(`unknown channel "${key}" (expected ${CHANNEL_KEYS.join(' or ')})`);
  return CHANNELS[key];
}

export function channelOfVideo(db: Database.Database, videoId: number): Channel {
  const row = db.prepare('SELECT channel FROM videos WHERE id = ?').get(videoId) as { channel: string } | undefined;
  if (!row) throw new Error(`video ${videoId} not found`);
  return channelByKey(row.channel);
}

/** #RRGGBB → ASS colour &HAABBGGRR (alpha 00 = opaque). */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const aa = alpha.toString(16).padStart(2, '0');
  return `&H${aa}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}
