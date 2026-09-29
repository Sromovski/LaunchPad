/**
 * NASA Image of the Day (https://www.nasa.gov/feeds/iotd-feed/) for the
 * "bonus space picture" outro (Thomas, 2026-09-28: option B — picked when the
 * video is made and reviewed with it, worded without "today").
 * Not APOD: APOD often features privately copyrighted photos (CLAUDE.md §2.4).
 */
import { checkCredit, type CreditCheck } from '../nasa/credits.js';

export const IOTD_FEED = 'https://www.nasa.gov/feeds/iotd-feed/';

export interface IotdItem {
  title: string;
  link: string;
  image: string;
  date: string; // ISO
  description: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function parseIotdFeed(xml: string): IotdItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => {
      const raw = m[1]!;
      const tag = (t: string) => decode(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(raw)?.[1] ?? '');
      const date = new Date(tag('pubDate'));
      return {
        title: tag('title'),
        link: tag('link'),
        image: /<enclosure[^>]+url="([^"]+)"/.exec(raw)?.[1] ?? '',
        date: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
        description: tag('description'),
      };
    })
    .filter((i) => i.title && i.link && i.image);
}

/** "Image Credit: NASA/Jessica Meir" on the image page. */
export function parsePageCredit(html: string): string | null {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' '));
  const m = /Image Credit:?\s*(.+?)\s*(?:Read More|Size\b|Share\b|Facebook\b|$)/.exec(text);
  return m ? m[1]!.trim().replace(/[.,;]$/, '') : null;
}

export const bonusAssetId = (item: Pick<IotdItem, 'link'>) => `iotd:${item.link.replace(/\/+$/, '').split('/').pop()}`;

export interface BonusChoice {
  item: IotdItem;
  credit: string | null;
  rights: CreditCheck;
  asset_id: string;
}

/**
 * Newest picture that isn't rights-rejected and hasn't been a bonus in another video.
 * `creditOf` fetches the page credit lazily (one page per candidate tried).
 */
export async function chooseBonus(
  items: IotdItem[],
  usedAssetIds: Set<string>,
  creditOf: (item: IotdItem) => Promise<string | null>,
  maxTries = 10,
): Promise<{ choice: BonusChoice | null; skipped: { title: string; why: string }[] }> {
  const skipped: { title: string; why: string }[] = [];
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  for (const item of sorted.slice(0, maxTries)) {
    const asset_id = bonusAssetId(item);
    if (usedAssetIds.has(asset_id)) {
      skipped.push({ title: item.title, why: 'already used in another video' });
      continue;
    }
    const credit = await creditOf(item);
    const rights = checkCredit({ credits: [credit], description: item.description });
    if (rights.status === 'rejected') {
      skipped.push({ title: item.title, why: `rights rejected: ${rights.note}` });
      continue;
    }
    return { choice: { item, credit, rights, asset_id }, skipped };
  }
  return { choice: null, skipped };
}

export const BONUS_INTRO = "Here's a bonus space picture!";
