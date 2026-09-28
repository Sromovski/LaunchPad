import { describe, expect, it } from 'vitest';
import { markTopic, nextTopic, parseTopics, playlistForTopic } from '../../src/automation/topics.js';

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

describe('world sections → playlists', () => {
  const md = `# Topics

## Mars | playlist: Mars Facts for Kids
- [x] Why are sunsets on Mars blue? — done
- [ ] Why is Mars red?

## The Moon | playlist: Moon Facts for Kids
- [ ] Why does the Moon change shape? | query: moon phases
`;

  it('each topic gets the playlist of the section above it', () => {
    const t = parseTopics(md);
    expect(t.map((x) => x.playlist)).toEqual(['Mars Facts for Kids', 'Mars Facts for Kids', 'Moon Facts for Kids']);
    expect(t[2]).toMatchObject({ topic: 'Why does the Moon change shape?', query: 'moon phases' });
  });

  it('looks up a topic’s playlist (case-insensitive), null if unknown', () => {
    expect(playlistForTopic(md, 'why does the moon change shape?')).toBe('Moon Facts for Kids');
    expect(playlistForTopic(md, 'Something else')).toBeNull();
  });

  it('marking a topic keeps sections intact', () => {
    const out = markTopic(md, 'Why is Mars red?', 'done', 'video 11');
    expect(out).toContain('## The Moon | playlist: Moon Facts for Kids');
    expect(nextTopic(out)?.playlist).toBe('Moon Facts for Kids');
  });
});
