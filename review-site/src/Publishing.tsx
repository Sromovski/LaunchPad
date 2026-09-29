import { useEffect, useState } from 'react';

interface Data {
  next: { id: number; title: string; approved_at: string | null }[];
  posted: { video_id: number; title: string; url: string; visibility: string; in_playlist: number; method: string; posted_at: string; thumbnail: 'set' | 'failed' | null }[];
  held: { id: number; title: string; reason: string }[];
}

/** What the 8:00/16:00 jobs post next, what's live, and what Thomas held back. */
export function Publishing() {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    fetch('/api/publishing')
      .then((r) => (r.ok ? r.json() : null))
      .then(setD)
      .catch(() => setD(null));
  }, []);
  if (!d) return null;
  return (
    <section className="mt-12 grid gap-8 md:grid-cols-2" data-testid="publishing">
      <div>
        <h2 className="font-display text-2xl font-semibold">Posting next</h2>
        <p className="text-muted">Two videos a day, at 8:00 and 16:00, oldest approval first.</p>
        {d.next.length === 0 ? (
          <p className="mt-3 text-muted">Nothing approved is waiting. Approve a video and it joins this list.</p>
        ) : (
          <ol className="mt-3 list-decimal space-y-1 pl-6">
            {d.next.map((v) => (
              <li key={v.id}>
                <a href={`#/v/${v.id}`} className="text-ink">
                  {v.title}
                </a>
              </li>
            ))}
          </ol>
        )}
        {d.held.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Held back: {d.held.map((h) => `video ${h.id} (${h.reason})`).join('; ')}
          </p>
        )}
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold">Live on YouTube</h2>
        {d.posted.length === 0 ? (
          <p className="mt-3 text-muted">Nothing posted yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {d.posted.map((p) => (
              <li key={p.video_id}>
                <a href={p.url} target="_blank" rel="noreferrer" className="font-semibold text-glow">
                  {p.title}
                </a>
                <span className="ml-2 text-sm text-muted">
                  {p.posted_at.slice(0, 16)}
                  {p.visibility !== 'public' && <span className="ml-2 font-semibold text-dust">{p.visibility}: make it public in Studio</span>}
                  {p.method === 'api' && !p.in_playlist && <span className="ml-2 text-dust">not in playlist yet</span>}
                  {p.thumbnail === 'set' ? (
                    <span className="ml-2">thumbnail set</span>
                  ) : (
                    <span className="ml-2" title="YouTube only allows custom Shorts thumbnails for some channels so far; retried weekly">
                      {p.thumbnail === 'failed' ? 'YouTube picked the thumbnail (retrying weekly)' : 'thumbnail on next posting run'}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
