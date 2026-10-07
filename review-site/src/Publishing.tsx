import { useEffect, useState } from 'react';

interface ChannelPosting {
  key: string;
  title: string;
  post_times: string[];
  next: { id: number; title: string; approved_at: string | null }[];
  posted: { video_id: number; title: string; url: string; visibility: string; in_playlist: number; method: string; posted_at: string; thumbnail: 'set' | 'failed' | null }[];
  held: { id: number; title: string; reason: string }[];
}

/** Per channel: what its posting job posts next, what's live, and what Thomas held back. */
export function Publishing({ channel }: { channel: string }) {
  const [d, setD] = useState<ChannelPosting[] | null>(null);
  useEffect(() => {
    fetch('/api/publishing')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { channels: ChannelPosting[] } | null) => setD(j?.channels ?? null))
      .catch(() => setD(null));
  }, []);
  if (!d) return null;
  const shown = d.filter((c) => !channel || c.key === channel);
  return (
    <div data-testid="publishing">
      {shown.map((c) => (
        <ChannelSection key={c.key} c={c} titled={shown.length > 1 || d.length > 1} />
      ))}
    </div>
  );
}

function ChannelSection({ c, titled }: { c: ChannelPosting; titled: boolean }) {
  const times = c.post_times.join(' and ');
  return (
    <section className="mt-12" data-testid={`publishing-${c.key}`}>
      {titled && <h2 className="font-display text-xl font-semibold text-muted">{c.title}</h2>}
      <div className="mt-2 grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="font-display text-2xl font-semibold">Posting next</h3>
          <p className="text-muted">
            {c.post_times.length === 1 ? 'One video a day' : `${c.post_times.length} videos a day`}, at {times}, oldest approval first.
          </p>
          {c.next.length === 0 ? (
            <p className="mt-3 text-muted">Nothing approved is waiting. Approve a video and it joins this list.</p>
          ) : (
            <ol className="mt-3 list-decimal space-y-1 pl-6">
              {c.next.map((v) => (
                <li key={v.id}>
                  <a href={`#/v/${v.id}`} className="text-ink">
                    {v.title}
                  </a>
                </li>
              ))}
            </ol>
          )}
          {c.held.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              Held back: {c.held.map((h) => `video ${h.id} (${h.reason})`).join('; ')}
            </p>
          )}
        </div>
        <div>
          <h3 className="font-display text-2xl font-semibold">Live on YouTube</h3>
          {c.posted.length === 0 ? (
            <p className="mt-3 text-muted">Nothing posted yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {c.posted.map((p) => (
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
      </div>
    </section>
  );
}
