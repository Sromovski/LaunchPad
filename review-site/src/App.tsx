import { useCallback, useEffect, useState } from 'react';
import { api, type VideoSummary } from './api';
import { Queue } from './Queue';
import { History } from './History';
import { Detail } from './Detail';

type Route = { page: 'queue' } | { page: 'history' } | { page: 'video'; id: number };

function parseHash(): Route {
  const m = /^#\/v\/(\d+)/.exec(location.hash);
  if (m) return { page: 'video', id: Number(m[1]) };
  if (location.hash.startsWith('#/history')) return { page: 'history' };
  return { page: 'queue' };
}

export const go = (hash: string) => {
  location.hash = hash;
};

const CHANNEL_KEY = 'channel-filter';
function savedChannel(): string {
  try {
    return localStorage.getItem(CHANNEL_KEY) ?? '';
  } catch {
    return ''; // private mode: start on all channels
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [queue, setQueue] = useState<VideoSummary[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  /** '' = every channel. Remembered per browser. */
  const [channel, setChannel] = useState(savedChannel);
  const [channels, setChannels] = useState<{ key: string; title: string }[]>([]);

  const pickChannel = (key: string) => {
    setChannel(key);
    try {
      localStorage.setItem(CHANNEL_KEY, key);
    } catch {
      /* private mode: filter still works for this visit */
    }
  };

  const loadQueue = useCallback(() => {
    api
      .list('in_review', '', channel)
      .then((r) => {
        setQueue(r.videos);
        setQueueError(null);
      })
      .catch((e: Error) => setQueueError(e.message));
  }, [channel]);

  useEffect(() => {
    api
      .channels()
      .then((r) => setChannels(r.channels))
      .catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  useEffect(loadQueue, [loadQueue, route]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <a href="#/" className="font-display text-2xl font-bold text-ink no-underline">
            Launchpad
          </a>
          <nav className="flex gap-1" aria-label="Main">
            <NavLink href="#/" active={route.page === 'queue'}>
              To review{queue ? <span className="ml-2 rounded-full bg-glow px-2 text-sm font-bold text-bg">{queue.length}</span> : null}
            </NavLink>
            <NavLink href="#/history" active={route.page === 'history'}>
              History
            </NavLink>
          </nav>
          {channels.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Channel" data-testid="channel-filter">
              {[{ key: '', title: 'All channels' }, ...channels].map((c) => (
                <button
                  key={c.key}
                  onClick={() => pickChannel(c.key)}
                  aria-pressed={channel === c.key}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${channel === c.key ? 'border-glow bg-glow-soft text-ink' : 'border-line text-muted hover:text-ink'}`}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {route.page === 'queue' && <Queue videos={queue} error={queueError} channel={channel} />}
        {route.page === 'history' && <History channel={channel} />}
        {route.page === 'video' && <Detail key={route.id} id={route.id} queue={queue ?? []} onDecided={loadQueue} />}
      </main>
    </div>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center whitespace-nowrap rounded-lg px-3 py-1.5 no-underline ${active ? 'bg-panel text-ink' : 'text-muted hover:text-ink'}`}
    >
      {children}
    </a>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* private mode: toggle still works for this visit */
    }
    setDark(next);
  };
  return (
    <button onClick={toggle} className="ml-auto whitespace-nowrap rounded-lg border border-line px-3 py-1.5 text-muted hover:text-ink" aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>
      {dark ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
