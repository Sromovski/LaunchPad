/**
 *   topics:next  → first open topic in docs/TOPICS.md
 *   topics:mark  -- --topic "<topic>" --status done|skipped --note "..."
 *   topics:check → NASA library video/image hit counts per open topic (no downloads)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { search } from '../nasa/api.js';
import { markTopic, nextTopic, parseTopics } from '../automation/topics.js';
import { args, main } from './_lib.js';

const FILE = resolve(PROJECT_ROOT, 'docs/TOPICS.md');
const command = process.argv[2];
process.argv.splice(2, 1);
const a = args({ topic: { type: 'string' }, status: { type: 'string' }, note: { type: 'string', default: '' } });

await main(async () => {
  const md = readFileSync(FILE, 'utf8');
  switch (command) {
    case 'next': {
      const t = nextTopic(md);
      if (!t) throw new Error('no open topics left in docs/TOPICS.md');
      return { topic: t.topic, query: t.query };
    }
    case 'mark': {
      if (!a.topic || (a.status !== 'done' && a.status !== 'skipped')) throw new Error('--topic and --status done|skipped are required');
      writeFileSync(FILE, markTopic(md, a.topic, a.status, a.note));
      return { topic: a.topic, status: a.status };
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
