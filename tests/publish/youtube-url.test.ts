import { describe, expect, it } from 'vitest';
import { youtubeId } from '../../src/publish/youtube-url.js';

describe('youtubeId', () => {
  it.each([
    ['https://youtube.com/shorts/6qJq2lvEuV0?feature=share', '6qJq2lvEuV0'],
    ['https://www.youtube.com/watch?v=6qJq2lvEuV0&t=3', '6qJq2lvEuV0'],
    ['https://youtu.be/6qJq2lvEuV0', '6qJq2lvEuV0'],
    ['https://m.youtube.com/shorts/6qJq2lvEuV0', '6qJq2lvEuV0'],
  ])('%s', (url, id) => expect(youtubeId(url)).toBe(id));

  it.each(['https://vimeo.com/123', 'https://youtube.com/shorts/short', 'nonsense'])('rejects %s', (url) => {
    expect(() => youtubeId(url)).toThrow();
  });
});
