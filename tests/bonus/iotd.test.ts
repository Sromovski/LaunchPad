import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bonusAssetId, chooseBonus, parseIotdFeed, parsePageCredit, type IotdItem } from '../../src/bonus/iotd.js';

const fixture = (n: string) => readFileSync(new URL(`../fixtures/iotd/${n}`, import.meta.url), 'utf8');

describe('parseIotdFeed (real feed, 2026-09-28)', () => {
  const items = parseIotdFeed(fixture('feed.xml'));

  it('reads title, page, full-size image and date', () => {
    expect(items.length).toBeGreaterThan(10);
    expect(items[0]).toMatchObject({
      title: 'Space Station View of Earth at Night',
      link: 'https://www.nasa.gov/image-detail/gmt251_08_43_jessica-meir_northern-aurora-cupola-14mm/',
    });
    expect(items[0]!.image).toMatch(/^https:\/\/www\.nasa\.gov\/wp-content\/uploads\/.+\.jpg$/);
    expect(items[0]!.date).toBe('2026-09-28T15:22:00.000Z');
    expect(items[0]!.description).toMatch(/^This nighttime view/);
  });
});

describe('parsePageCredit (real pages)', () => {
  it('NASA photographer credit', () => {
    expect(parsePageCredit(fixture('page-earth-night.html'))).toBe('NASA/Jessica Meir');
  });
  it('ESA/Hubble co-credit with HTML entities decoded', () => {
    expect(parsePageCredit(fixture('page-hubble.html'))).toMatch(/^ESA\/Hubble & NASA/);
  });
  it('null when there is no credit', () => {
    expect(parsePageCredit('<html><body>No credit here</body></html>')).toBeNull();
  });
});

describe('chooseBonus', () => {
  const item = (title: string, date: string, slug: string): IotdItem => ({
    title,
    link: `https://www.nasa.gov/image-detail/${slug}/`,
    image: `https://www.nasa.gov/x/${slug}.jpg`,
    date,
    description: '',
  });
  const items = [
    item('Older', '2026-09-24T10:00:00.000Z', 'older'),
    item('Newest', '2026-09-28T10:00:00.000Z', 'newest'),
    item('Middle', '2026-09-25T10:00:00.000Z', 'middle'),
  ];

  it('picks the newest picture', async () => {
    const r = await chooseBonus(items, new Set(), async () => 'NASA');
    expect(r.choice?.item.title).toBe('Newest');
    expect(r.choice?.rights.status).toBe('clear');
    expect(r.choice?.asset_id).toBe('iotd:newest');
  });

  it('skips pictures another video already used', async () => {
    const r = await chooseBonus(items, new Set(['iotd:newest']), async () => 'NASA');
    expect(r.choice?.item.title).toBe('Middle');
    expect(r.skipped).toEqual([{ title: 'Newest', why: 'already used in another video' }]);
  });

  it('skips rights-rejected pictures (e.g. news agency, ESA-only)', async () => {
    const credits: Record<string, string> = { Newest: 'Reuters', Middle: 'ESA', Older: 'NASA/Ryan Kline' };
    const r = await chooseBonus(items, new Set(), async (i) => credits[i.title]!);
    expect(r.choice?.item.title).toBe('Older');
    expect(r.choice?.rights.status).toBe('needs_review'); // photographer co-credit → Thomas ticks rights
    expect(r.skipped.map((s) => s.title)).toEqual(['Newest', 'Middle']);
  });

  it('no usable picture → null (the video just has no bonus)', async () => {
    const r = await chooseBonus(items, new Set(), async () => 'AP Photo');
    expect(r.choice).toBeNull();
  });

  it('asset ids are stable per picture page', () => {
    expect(bonusAssetId({ link: 'https://www.nasa.gov/image-detail/a-galaxy-spinning-out-of-sync/' })).toBe('iotd:a-galaxy-spinning-out-of-sync');
  });
});
