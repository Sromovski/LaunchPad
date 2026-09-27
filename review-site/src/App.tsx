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

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [queue, setQueue] = useState<VideoSummary[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  const loadQueue = useCallback(() => {
    api
      .list('in_review')
      .then((r) => {
        setQueue(r.videos);
        setQueueError(null);
      })
      .catch((e: Error) => setQueueError(e.message));
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
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {route.page === 'queue' && <Queue videos={queue} error={queueError} />}
        {route.page === 'history' && <History />}
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
