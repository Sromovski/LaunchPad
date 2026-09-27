/** YouTube video id from any common link form: /shorts/<id>, watch?v=<id>, youtu.be/<id>. */
export function youtubeId(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error(`not a URL: ${url}`);
  }
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com') {
    const m = /^\/(shorts|embed|live)\/([^/?#]+)/.exec(u.pathname);
    id = m ? m[2]! : u.searchParams.get('v');
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error(`not a YouTube video link: ${url}`);
  return id;
}

export const canonicalShortUrl = (id: string) => `https://www.youtube.com/shorts/${id}`;
