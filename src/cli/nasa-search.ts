/**
 * npm run nasa:search -- --query "mars sunset" [--query "curiosity sunset" ...] --type video [--limit 15] [--video <id>]
 * Several --query flags run in one call (results de-duplicated by nasa_id), so agents never need shell loops.
 */
import { search, type Candidate, type MediaType } from '../nasa/api.js';
import { logger, main } from './_lib.js';
import { parseArgs } from 'node:util';

const a = parseArgs({
  options: {
    query: { type: 'string', multiple: true },
    type: { type: 'string', default: 'video' },
    limit: { type: 'string', default: '15' },
    video: { type: 'string' },
  },
  strict: true,
}).values;

await main(async () => {
  const queries = a.query ?? [];
  if (queries.length === 0) throw new Error('--query is required (repeat it for several searches)');
  const type = a.type as MediaType;
  if (!['video', 'image', 'audio'].includes(type)) throw new Error('--type must be video|image|audio');
  const log = logger(a.video ? Number(a.video) : null, 'nasa-search');
  const limit = Number(a.limit);

  const seen = new Map<string, Candidate & { matched_queries: string[] }>();
  const perQuery: { query: string; count: number }[] = [];
  for (const q of queries) {
    log(`search "${q}" type=${type}`);
    const results = (await search(q, type)).slice(0, limit);
    perQuery.push({ query: q, count: results.length });
    for (const c of results) {
      const existing = seen.get(c.nasa_id);
      if (existing) existing.matched_queries.push(q);
      else seen.set(c.nasa_id, { ...c, matched_queries: [q] });
    }
  }
  const candidates = [...seen.values()];
  log(`${candidates.length} unique candidates from ${queries.length} queries`);
  return { queries: perQuery, type, count: candidates.length, candidates };
});
