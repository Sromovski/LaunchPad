import { describe, expect, it } from 'vitest';
import { markTopic, nextTopic, parseTopics } from '../../src/automation/topics.js';

const MD = `# Topics

Some intro text that is not a topic.

- [x] Why are sunsets on Mars blue? | query: mars sunset — done: video 2
- [~] Mars quakes | query: insight marsquake — skipped: no usable footage
- [ ] How did Ingenuity fly on Mars? | query: ingenuity helicopter flight
- [ ] Why is Mars red?
`;

describe('topics', () => {
  it('parses states, queries and notes', () => {
    const t = parseTopics(MD);
    expect(t.map((x) => x.state)).toEqual(['done', 'skipped', 'todo', 'todo']);
    expect(t[2]).toMatchObject({ topic: 'How did Ingenuity fly on Mars?', query: 'ingenuity helicopter flight', note: '' });
    expect(t[3]).toMatchObject({ topic: 'Why is Mars red?', query: 'Why is Mars red?' });
    expect(t[0]!.note).toBe('done: video 2');
  });

  it('next topic is the first open one', () => {
    expect(nextTopic(MD)?.topic).toBe('How did Ingenuity fly on Mars?');
    expect(nextTopic('- [x] a — done')).toBeUndefined();
  });

  it('marks a topic done and keeps its query', () => {
    const md = markTopic(MD, 'how did ingenuity fly on mars?', 'done', 'video 7 in review');
    expect(md).toContain('- [x] How did Ingenuity fly on Mars? | query: ingenuity helicopter flight — video 7 in review');
    expect(nextTopic(md)?.topic).toBe('Why is Mars red?');
    expect(md.split('\n')[0]).toBe('# Topics'); // rest untouched
  });

  it('marks skipped with a reason', () => {
    const md = markTopic(MD, 'Why is Mars red?', 'skipped', 'no footage\nat all');
    expect(md).toContain('- [~] Why is Mars red? — no footage at all');
  });

  it('refuses to mark a topic that is not open', () => {
    expect(() => markTopic(MD, 'Why are sunsets on Mars blue?', 'done', 'x')).toThrow(/no open topic/);
    expect(() => markTopic(MD, 'Unknown', 'done', 'x')).toThrow();
  });
});
