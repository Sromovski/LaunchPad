/**
 * npm run stats [-- --channel blast|wonder]
 * Saves today's YouTube view/subscriber counts for the review site's Views page.
 * Read-only on YouTube (a few quota units). No --channel = every connected channel.
 * Posting runs already do this; use it to refresh by hand.
 */
import { CHANNELS, channelByKey } from '../channels.js';
import { youtubeFor } from '../publish/client.js';
import { snapshotStats } from '../publish/stats.js';
import { args, main } from './_lib.js';

const a = args({ channel: { type: 'string' } });
const channels = a.channel ? [channelByKey(a.channel)] : Object.values(CHANNELS);

await main(async (db) => {
  const results = [];
  for (const ch of channels) {
    const yt = youtubeFor(ch);
    results.push(yt ? await snapshotStats(db, ch.key, yt) : { channel: ch.key, outcome: 'not_connected' });
  }
  return { results };
});
