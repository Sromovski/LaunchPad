/**
 * docs/TOPICS.md backlog. One topic per line:
 *   - [ ] Why is Mars red? | query: mars red dust
 *   - [x] ...                         (done: reached in_review, video N)
 *   - [~] ...                         (skipped: reason)
 * Sections set the YouTube playlist for the topics under them:
 *   ## Moon | playlist: Moon Facts for Kids
 * /make-video takes the first `[ ]` line. Code, not the agent, edits the file.
 */

import type Database from 'better-sqlite3';

export type TopicState = 'todo' | 'done' | 'skipped';

export interface Topic {
  line: number;
  state: TopicState;
  topic: string;
  query: string;
  note: string;
  /** From the nearest "## World | playlist: …" heading above it; null if none. */
  playlist: string | null;
}

const SECTION = /^##\s+.+?\|\s*playlist:\s*(.+?)\s*$/i;

const LINE = /^- \[( |x|~)\] (.+?)(?: \| query: (.+?))?(?: — (.+))?$/;

export function parseTopics(md: string): Topic[] {
  const out: Topic[] = [];
  let playlist: string | null = null;
  md.split(/\r?\n/).forEach((raw, line) => {
    const s = SECTION.exec(raw.trim());
    if (s) {
      playlist = s[1]!;
      return;
    }
    const m = LINE.exec(raw.trim());
    if (!m) return;
    const state: TopicState = m[1] === 'x' ? 'done' : m[1] === '~' ? 'skipped' : 'todo';
    out.push({ line, state, topic: m[2]!.trim(), query: (m[3] ?? m[2]!).trim(), note: (m[4] ?? '').trim(), playlist });
  });
  return out;
}

export function nextTopic(md: string): Topic | undefined {
  return parseTopics(md).find((t) => t.state === 'todo');
}

/** Returns the updated markdown; throws if the topic isn't an open line. */
export function markTopic(md: string, topic: string, state: Exclude<TopicState, 'todo'>, note: string): string {
  const lines = md.split(/\r?\n/);
  const t = parseTopics(md).find((x) => x.topic.toLowerCase() === topic.trim().toLowerCase() && x.state === 'todo');
  if (!t) throw new Error(`no open topic "${topic}" in TOPICS.md`);
  const mark = state === 'done' ? 'x' : '~';
  const query = t.query !== t.topic ? ` | query: ${t.query}` : '';
  lines[t.line] = `- [${mark}] ${t.topic}${query} — ${note.replace(/\s+/g, ' ').trim()}`;
  return lines.join('\n');
}


/** The playlist a topic belongs to (case-insensitive topic match), or null. */
export function playlistForTopic(md: string, topic: string): string | null {
  return parseTopics(md).find((t) => t.topic.toLowerCase() === topic.trim().toLowerCase())?.playlist ?? null;
}

/**
 * After this many failed videos on one backlog topic, the topic is skipped
 * automatically. Each failed video already had its one automatic retry, so 2
 * means 4 attempts. Without this a topic that can never pass (e.g. footage
 * with no credit metadata) stalls the channel's schedule indefinitely.
 */
export const MAX_FAILED_VIDEOS_PER_TOPIC = 2;

export interface TopicFailures {
  ids: number[];
  lastError: string | null;
}

/**
 * Marks every open topic at the front of the backlog that has failed too often
 * as skipped, so nextTopic() lands on one that can still be tried.
 * Returns the updated markdown and the topics it skipped.
 */
export function skipFailedTopics(
  md: string,
  failuresFor: (topic: string) => TopicFailures,
): { md: string; skipped: { topic: string; note: string }[] } {
  const skipped: { topic: string; note: string }[] = [];
  for (let t = nextTopic(md); t; t = nextTopic(md)) {
    const f = failuresFor(t.topic);
    if (f.ids.length < MAX_FAILED_VIDEOS_PER_TOPIC) break;
    const why = f.lastError ? `: ${f.lastError.replace(/\s+/g, ' ').slice(0, 140)}` : '';
    const note = `auto-skipped after ${f.ids.length} failed videos (${f.ids.join(', ')})${why}`;
    md = markTopic(md, t.topic, 'skipped', note);
    skipped.push({ topic: t.topic, note });
  }
  return { md, skipped };
}

/** Failed videos for a topic on one channel, oldest first (topic match ignores case). */
export function topicFailuresFromDb(db: Database.Database, channel: string): (topic: string) => TopicFailures {
  const stmt = db.prepare("SELECT id, error FROM videos WHERE channel = ? AND status = 'failed' AND lower(topic) = lower(?) ORDER BY id");
  return (topic) => {
    const rows = stmt.all(channel, topic.trim()) as { id: number; error: string | null }[];
    return { ids: rows.map((r) => r.id), lastError: rows.at(-1)?.error ?? null };
  };
}
