import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanHref, parseAssetManifest, parseSearch, pickBestFile } from '../../src/nasa/api.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nasa/${name}`, import.meta.url), 'utf8'));

describe('parseSearch (real responses)', () => {
  const images = parseSearch(fixture('search-mars-sunset-image.json'));

  it('parses every item', () => {
    expect(images.length).toBeGreaterThan(5);
    for (const c of images) {
      expect(c.nasa_id).toBeTruthy();
      expect(c.details_url).toMatch(/^https:\/\/images\.nasa\.gov\/details\//);
    }
  });

  it('PIA19400 (Curiosity sunset) is co-credited MSSS → needs_review', () => {
    const c = images.find((i) => i.nasa_id === 'PIA19400')!;
    expect(c.credit).toBe('NASA/JPL-Caltech/MSSS/Texas A&M Univ');
    expect(c.rights_preview).toBe('needs_review');
  });

  it('PIA23202 (InSight sunset) is plain NASA/JPL-Caltech → clear', () => {
    const c = images.find((i) => i.nasa_id === 'PIA23202')!;
    expect(c.rights_preview).toBe('clear');
  });

  it('video whose description names university co-owners → needs_review', () => {
    const videos = parseSearch(fixture('search-mars-sunset-video.json'));
    const c = videos.find((v) => v.nasa_id.includes('Meteoroid'))!;
    expect(c.rights_preview).toBe('needs_review');
    expect(c.credit).toMatch(/University of Maryland/);
  });

  it('rejects malformed responses', () => {
    expect(() => parseSearch({ collection: { items: [{ data: [] }] } })).toThrow();
  });
});

describe('asset manifest', () => {
  it('cleans hrefs to https with encoded spaces', () => {
    expect(cleanHref('http://images-assets.nasa.gov/video/A B/A B~orig.mp4')).toBe(
      'https://images-assets.nasa.gov/video/A%20B/A%20B~orig.mp4',
    );
  });

  it('does not double-encode', () => {
    expect(cleanHref('https://x/A%20B.mp4')).toBe('https://x/A%20B.mp4');
  });

  it('picks orig.mp4 for a real video manifest', () => {
    const hrefs = parseAssetManifest(fixture('asset-video.json'));
    expect(pickBestFile(hrefs, 'video')).toMatch(/~orig\.mp4$/);
  });

  it('falls back to large.mp4 when orig is too big', () => {
    const hrefs = parseAssetManifest(fixture('asset-video.json'));
    expect(pickBestFile(hrefs, 'video', (h) => h.includes('~orig'))).toMatch(/~large\.mp4$/);
  });

  it('picks orig.jpg for a real image manifest', () => {
    const hrefs = parseAssetManifest(fixture('asset-PIA19400.json'));
    expect(pickBestFile(hrefs, 'image')).toBe('https://images-assets.nasa.gov/image/PIA19400/PIA19400~orig.jpg');
  });

  it('never picks preview/small/thumb files', () => {
    expect(pickBestFile(['https://x/a~preview.mp4', 'https://x/a~small.mp4'], 'video')).toBeNull();
    expect(pickBestFile(['https://x/a~thumb.jpg', 'https://x/a~small.jpg'], 'image')).toBeNull();
  });
});
