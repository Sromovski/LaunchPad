/**
 * NASA Image and Video Library API (https://images-api.nasa.gov). Free, no key.
 * Every response is zod-validated; unknown extra fields are ignored.
 */
import { z } from 'zod';
import { checkCredit, type CreditCheck } from './credits.js';

export const API_ROOT = 'https://images-api.nasa.gov';

const ItemData = z.object({
  nasa_id: z.string(),
  title: z.string(),
  media_type: z.enum(['image', 'video', 'audio']),
  description: z.string().optional(),
  date_created: z.string().optional(),
  center: z.string().optional(),
  photographer: z.string().optional(),
  secondary_creator: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});
export type ItemData = z.infer<typeof ItemData>;

const SearchResponse = z.object({
  collection: z.object({
    items: z.array(
      z.object({
        data: z.array(ItemData).min(1),
        links: z.array(z.object({ href: z.string(), rel: z.string().optional() })).optional(),
      }),
    ),
    metadata: z.object({ total_hits: z.number() }).optional(),
  }),
});

const AssetResponse = z.object({
  collection: z.object({ items: z.array(z.object({ href: z.string() })) }),
});

export type MediaType = 'image' | 'video' | 'audio';

export interface Candidate {
  nasa_id: string;
  title: string;
  media_type: MediaType;
  date_created: string | null;
  center: string | null;
  credit: string | null;
  rights_preview: CreditCheck['status'];
  rights_note: string;
  preview_url: string | null;
  details_url: string;
  description: string;
}

export const detailsUrl = (nasaId: string) => `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`;

/** Asset hrefs come back as http:// with raw spaces; make them fetchable. */
export function cleanHref(href: string): string {
  return encodeURI(decodeURI(href)).replace(/^http:\/\//, 'https://');
}

export function creditCheckFor(d: ItemData): CreditCheck {
  return checkCredit({ credits: [d.secondary_creator, d.photographer], description: d.description });
}

export function parseSearch(json: unknown): Candidate[] {
  const parsed = SearchResponse.parse(json);
  return parsed.collection.items.map((item) => {
    const d = item.data[0]!;
    const rights = creditCheckFor(d);
    const preview = item.links?.find((l) => l.rel === 'preview') ?? item.links?.[0];
    return {
      nasa_id: d.nasa_id,
      title: d.title,
      media_type: d.media_type,
      date_created: d.date_created ?? null,
      center: d.center ?? null,
      credit: rights.credit,
      rights_preview: rights.status,
      rights_note: rights.note,
      preview_url: preview ? cleanHref(preview.href) : null,
      details_url: detailsUrl(d.nasa_id),
      description: (d.description ?? '').slice(0, 400),
    };
  });
}

export function parseAssetManifest(json: unknown): string[] {
  return AssetResponse.parse(json).collection.items.map((i) => cleanHref(i.href));
}

/**
 * Best file to download. Video: orig → large → medium → mobile MP4 (skip
 * ~preview / ~small, too low-res for 1080×1920). Image: orig (if JPG/PNG) →
 * large → medium. `tooBig` lets the caller veto a huge original.
 */
export function pickBestFile(hrefs: string[], mediaType: MediaType, tooBig: (href: string) => boolean = () => false): string | null {
  const order =
    mediaType === 'video'
      ? ['~orig.mp4', '~large.mp4', '~medium.mp4', '~mobile.mp4']
      : mediaType === 'image'
        ? ['~orig.jpg', '~orig.jpeg', '~orig.png', '~large.jpg', '~large.png', '~medium.jpg']
        : ['~orig.mp3', '~128k.mp3', '~orig.wav', '~orig.m4a'];
  for (const suffix of order) {
    const hit = hrefs.find((h) => decodeURI(h).toLowerCase().endsWith(suffix));
    if (hit && !tooBig(hit)) return hit;
  }
  return null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`NASA API ${res.status} for ${url}`);
  return res.json();
}

export async function search(query: string, mediaType: MediaType): Promise<Candidate[]> {
  const u = new URL('/search', API_ROOT);
  u.searchParams.set('q', query);
  u.searchParams.set('media_type', mediaType);
  return parseSearch(await getJson(u.toString()));
}

export async function getItem(nasaId: string): Promise<ItemData> {
  const u = new URL('/search', API_ROOT);
  u.searchParams.set('nasa_id', nasaId);
  const items = SearchResponse.parse(await getJson(u.toString())).collection.items;
  const exact = items.map((i) => i.data[0]!).find((d) => d.nasa_id === nasaId);
  if (!exact) throw new Error(`NASA item not found: ${nasaId}`);
  return exact;
}

export async function getAssetManifest(nasaId: string): Promise<string[]> {
  return parseAssetManifest(await getJson(`${API_ROOT}/asset/${encodeURIComponent(nasaId)}`));
}
