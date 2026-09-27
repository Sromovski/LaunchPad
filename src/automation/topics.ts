/**
 * docs/TOPICS.md backlog. One topic per line:
 *   - [ ] Why is Mars red? | query: mars red dust
 *   - [x] ...                         (done: reached in_review, video N)
 *   - [~] ...                         (skipped: reason)
 * /make-video takes the first `[ ]` line. Code, not the agent, edits the file.
 */

export type TopicState = 'todo' | 'done' | 'skipped';

export interface Topic {
  line: number;
  state: TopicState;
  topic: string;
  query: string;
  note: string;
}

const LINE = /^- \[( |x|~)\] (.+?)(?: \| query: (.+?))?(?: — (.+))?$/;

export function parseTopics(md: string): Topic[] {
  const out: Topic[] = [];
  md.split(/\r?\n/).forEach((raw, line) => {
    const m = LINE.exec(raw.trim());
    if (!m) return;
    const state: TopicState = m[1] === 'x' ? 'done' : m[1] === '~' ? 'skipped' : 'todo';
    out.push({ line, state, topic: m[2]!.trim(), query: (m[3] ?? m[2]!).trim(), note: (m[4] ?? '').trim() });
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
