/** npm run nasa:fetch -- --video <id> --nasa-id <nasa_id> */
import { mkdirSync } from 'node:fs';
import { fetchAsset } from '../nasa/fetch.js';
import { args, getVideo, logger, main, requireVideoId, runPath } from './_lib.js';

const a = args({ video: { type: 'string' }, 'nasa-id': { type: 'string' } });

await main(async (db) => {
  const videoId = requireVideoId(a.video);
  const nasaId = a['nasa-id'];
  if (!nasaId) throw new Error('--nasa-id is required');
  getVideo(db, videoId);

  const dir = runPath(videoId, 'assets');
  mkdirSync(dir, { recursive: true });
  return fetchAsset(db, videoId, nasaId, dir, logger(videoId, 'nasa-fetch'));
});
