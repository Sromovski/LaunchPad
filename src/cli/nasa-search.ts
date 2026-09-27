/** npm run nasa:search -- --query "mars sunset" --type video [--limit 15] [--video <id>] */
import { search, type MediaType } from '../nasa/api.js';
import { args, logger, main } from './_lib.js';

const a = args({
  query: { type: 'string' },
  type: { type: 'string', default: 'video' },
  limit: { type: 'string', default: '15' },
  video: { type: 'string' },
});

await main(async () => {
  if (!a.query) throw new Error('--query is required');
  const type = a.type as MediaType;
  if (!['video', 'image', 'audio'].includes(type)) throw new Error('--type must be video|image|audio');
  const log = logger(a.video ? Number(a.video) : null, 'nasa-search');

  log(`search "${a.query}" type=${type}`);
  const candidates = (await search(a.query, type)).slice(0, Number(a.limit));
  log(`${candidates.length} candidates`);
  return { query: a.query, type, count: candidates.length, candidates };
});
