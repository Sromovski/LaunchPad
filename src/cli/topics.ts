/**
 *   topics:next  [-- --channel blast|wonder] → first open topic in that channel's backlog
 *   topics:mark  -- [--channel ...] --topic "<topic>" --status done|skipped --note "..."
 *   topics:check [-- --channel ...] → NASA library video/image hit counts per open topic (no downloads)
 * No --channel = Blast of Facts (docs/TOPICS.md); I Wonder Why uses docs/TOPICS_WONDER.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { channelByKey } from '../channels.js';
import { PROJECT_ROOT } from '../db/index.js';
import { search } from '../nasa/api.js';
import { markTopic, nextTopic, parseTopics } from '../automation/topics.js';
import { args, main } from './_lib.js';

const command = process.argv[2];
process.argv.splice(2, 1);
const a = args({ channel: { type: 'string' }, topic: { type: 'string' }, status: { type: 'string' }, note: { type: 'string', default: '' } });
const channel = channelByKey(a.channel);
const FILE = channel.topicsFile;

await main(async () => {
  const md = readFileSync(FILE, 'utf8');
  switch (command) {
    case 'next': {
      const t = nextTopic(md);
      if (!t) throw new Error(`no open topics left in ${relative(PROJECT_ROOT, FILE)}`);
      return { channel: channel.key, topic: t.topic, query: t.query };
    }
    case 'mark': {
      if (!a.topic || (a.status !== 'done' && a.status !== 'skipped')) throw new Error('--topic and --status done|skipped are required');
      writeFileSync(FILE, markTopic(md, a.topic, a.status, a.note));
      return { channel: channel.key, topic: a.topic, status: a.status };
    }
    case 'check': {
      const rows = [];
      for (const t of parseTopics(md).filter((x) => x.state === 'todo')) {
        const [videos, images] = await Promise.all([search(t.query, 'video'), search(t.query, 'image')]);
        rows.push({
          topic: t.topic,
          query: t.query,
          videos: videos.length,
          videos_clear: videos.filter((v) => v.rights_preview === 'clear').length,
          images: images.length,
          images_clear: images.filter((v) => v.rights_preview === 'clear').length,
          top_video: videos[0]?.title ?? null,
        });
      }
      return { topics: rows };
    }
    default:
      throw new Error('usage: topics.ts next|mark|check');
  }
});
