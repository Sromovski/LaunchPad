/**
 * The YouTube channels Launchpad makes videos for. Every video belongs to exactly one
 * (videos.channel); its topics, look, voice, schedule and YouTube login come from here.
 * Blast of Facts keeps every value it had before I Wonder Why was added (2026-10-07).
 */
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { PROJECT_ROOT } from './db/index.js';

export const CHANNEL_KEYS = ['blast', 'wonder'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];
export const DEFAULT_CHANNEL: ChannelKey = 'blast';

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
    makeTimes: ['07:00', '15:00'],
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
    makeTimes: ['09:00', '17:00'],
    postTimes: ['10:00', '18:00'],
    voice: 'am_michael', // Thomas picked from the samples (2026-10-07)
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
