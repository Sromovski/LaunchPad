/**
 * Posting package for one approved video: everything Thomas needs to upload
 * by hand (and what Phase 4 will upload automatically).
 */

/** "Why Are Sunsets on Mars Blue?" → "why-are-sunsets-on-mars-blue" */
export function slugify(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'video'
  );
}

/** Description exactly as approved, hashtags on the last line (YouTube shows the first three above the title). */
export function descriptionText(description: string, hashtags: string[]): string {
  const body = description.trim();
  const tags = hashtags.filter((h) => !body.includes(h)).join(' ');
  return tags ? `${body}\n\n${tags}\n` : `${body}\n`;
}

/** Wrap a title for the thumbnail: short lines, big type. */
export function thumbLines(title: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of title.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${w}`.length > maxChars) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}
