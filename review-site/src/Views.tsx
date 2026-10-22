import { useEffect, useMemo, useState } from 'react';

interface ChannelViews {
  key: string;
  title: string;
  latest: { day: string; taken_at: string; views: number; subscribers: number | null; videos: number } | null;
  gained: { views: number; subscribers: number | null; since: string } | null;
  series: { day: string; views: number; subscribers: number | null }[];
  videos: { video_id: number; title: string; url: string; posted_at: string; views: number | null; likes: number | null; gained: number | null }[];
}

interface ViewsResponse {
  channels: ChannelViews[];
  can_refresh: boolean;
  errors?: string[];
}

const SERIES: Record<string, string> = { blast: 'var(--series-blast)', wonder: 'var(--series-wonder)' };
const num = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString());
const plus = (n: number | null | undefined) => (n == null ? '' : `${n >= 0 ? '+' : ''}${n.toLocaleString()}`);
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Views and subscribers per channel, from the snapshots each posting run saves (src/publish/stats.ts). */
export function Views({ channel }: { channel: string }) {
  const [d, setD] = useState<ViewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/views')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then(setD)
      .catch((e: Error) => setError(e.message));
  }, []);

  const refresh = () => {
    setBusy(true);
    fetch('/api/views/refresh', { method: 'POST' })
      .then((r) => r.json())
      .then((j: ViewsResponse & { error?: string }) => {
        if (j.error) throw new Error(j.error);
        setD(j);
        setError(j.errors?.length ? j.errors.join('; ') : null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!d) return error ? <p className="text-rust">{error}</p> : <p className="text-muted">Loading…</p>;
  const shown = d.channels.filter((c) => !channel || c.key === channel);
  const updated = shown.map((c) => c.latest?.taken_at).filter(Boolean).sort().at(-1);

  return (
    <div data-testid="views">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="font-display text-3xl font-semibold">Views</h1>
        <p className="text-muted">
          {updated ? `Updated ${updated.slice(0, 16)} UTC` : 'No numbers yet'}. Saved with every posting run; YouTube itself updates counts a few times a day.
        </p>
        {d.can_refresh && (
          <button onClick={refresh} disabled={busy} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-muted hover:text-ink disabled:opacity-50">
            {busy ? 'Refreshing…' : 'Refresh now'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-rust">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {shown.map((c) => (
          <Totals key={c.key} c={c} />
        ))}
      </div>

      <ViewsChart channels={shown} />

      {shown.map((c) => (
        <VideoTable key={c.key} c={c} titled={shown.length > 1} />
      ))}
    </div>
  );
}

function Totals({ c }: { c: ChannelViews }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5" data-testid={`views-${c.key}`}>
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
        <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: SERIES[c.key] }} />
        {c.title}
      </h2>
      {!c.latest ? (
        <p className="mt-2 text-muted">No numbers yet. They appear after the next posting run, or press Refresh now.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-3 gap-4">
          <Stat label="Views" value={num(c.latest.views)} change={c.gained && `${plus(c.gained.views)} since ${shortDay(c.gained.since)}`} />
          <Stat
            label="Subscribers"
            value={c.latest.subscribers == null ? 'hidden' : num(c.latest.subscribers)}
            change={c.gained?.subscribers != null ? `${plus(c.gained.subscribers)} since ${shortDay(c.gained.since)}` : null}
          />
          <Stat label="Videos" value={num(c.latest.videos)} change={null} />
        </dl>
      )}
    </section>
  );
}

function Stat({ label, value, change }: { label: string; value: string; change: string | null }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-display text-4xl font-semibold tabular-nums">{value}</dd>
      {change && <dd className="text-sm text-muted">{change}</dd>}
    </div>
  );
}

const W = 760;
const H = 260;
const PAD = { top: 16, right: 120, bottom: 28, left: 52 };

/** Total views per day, one line per channel, one shared axis. Hover shows that day's numbers. */
function ViewsChart({ channels }: { channels: ChannelViews[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(() => [...new Set(channels.flatMap((c) => c.series.map((s) => s.day)))].sort(), [channels]);

  if (days.length < 2) {
    return (
      <section className="mt-8">
        <h2 className="font-display text-2xl font-semibold">Total views over time</h2>
        <p className="mt-2 text-muted">The chart starts once there are two days of numbers (tomorrow after the first posting run).</p>
      </section>
    );
  }

  const max = Math.max(1, ...channels.flatMap((c) => c.series.map((s) => s.views)));
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  // Placed by date, so a day without a snapshot (PC off, no posting run) leaves a gap instead of squashing the line.
  const t0 = Date.parse(days[0]!);
  const span = Date.parse(days[days.length - 1]!) - t0;
  const x = (i: number) => PAD.left + ((Date.parse(days[i]!) - t0) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const ticks = [0, top / 2, top];
  const labelEvery = Math.ceil(days.length / 6);
  const at = (c: ChannelViews, day: string) => c.series.find((s) => s.day === day);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    // Nearest snapshot day to the pointer.
    let best = 0;
    days.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setHover(best);
  };

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl font-semibold">Total views over time</h2>
      {channels.length > 1 && (
        <ul className="mt-2 flex gap-4 text-sm text-muted" aria-label="Legend">
          {channels.map((c) => (
            <li key={c.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: SERIES[c.key] }} />
              {c.title}
            </li>
          ))}
        </ul>
      )}
      <div className="relative mt-2 rounded-xl border border-line bg-panel p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Total views per day" onPointerMove={onMove} onPointerLeave={() => setHover(null)} data-testid="views-chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 || i === days.length - 1 ? (
              <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--muted)">
                {shortDay(d)}
              </text>
            ) : null,
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
          {channels.map((c) => {
            const pts = days.map((d, i) => [i, at(c, d)] as const).filter(([, s]) => s);
            if (pts.length === 0) return null;
            const path = pts.map(([i, s], k) => `${k ? 'L' : 'M'}${x(i)},${y(s!.views)}`).join(' ');
            const [li, ls] = pts[pts.length - 1]!;
            return (
              <g key={c.key}>
                <path d={path} fill="none" stroke={SERIES[c.key]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {hover != null && at(c, days[hover]!) && (
                  <circle cx={x(hover)} cy={y(at(c, days[hover]!)!.views)} r={4.5} fill={SERIES[c.key]} stroke="var(--panel)" strokeWidth={2} />
                )}
                <text x={x(li) + 8} y={y(ls!.views) + 4} fontSize={13} fill="var(--ink)">
                  {c.title}
                </text>
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute top-3 rounded-lg border border-line bg-bg px-3 py-2 text-sm shadow"
            style={{ left: `clamp(8px, calc(${(x(hover) / W) * 100}% - 70px), calc(100% - 180px))` }}
            data-testid="views-tooltip"
          >
            <div className="font-semibold">{shortDay(days[hover]!)}</div>
            {channels.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES[c.key] }} />
                <span className="text-muted">{c.title}</span>
                <span className="ml-auto tabular-nums">{num(at(c, days[hover]!)?.views)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

type SortKey = 'posted_at' | 'views' | 'gained' | 'likes';

function VideoTable({ c, titled }: { c: ChannelViews; titled: boolean }) {
  const [sort, setSort] = useState<SortKey>('posted_at');
  const rows = useMemo(
    () => [...c.videos].sort((a, b) => (sort === 'posted_at' ? b.posted_at.localeCompare(a.posted_at) : (b[sort] ?? -1) - (a[sort] ?? -1))),
    [c.videos, sort],
  );
  if (c.videos.length === 0) return null;
  const since = c.gained ? `Since ${shortDay(c.gained.since)}` : 'Gained';
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="px-3 py-2 text-right font-normal" aria-sort={sort === k ? 'descending' : 'none'}>
      <button onClick={() => setSort(k)} className={`whitespace-nowrap ${sort === k ? 'font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
        {children}
        {sort === k ? ' ↓' : ''}
      </button>
    </th>
  );
  return (
    <section className="mt-10" data-testid={`views-table-${c.key}`}>
      <h2 className="font-display text-2xl font-semibold">{titled ? `${c.title}: every video` : 'Every video'}</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left">
          <thead className="border-b border-line bg-panel text-sm">
            <tr>
              <th className="px-3 py-2 font-normal text-muted">Video</th>
              <Th k="posted_at">Posted</Th>
              <Th k="views">Views</Th>
              <Th k="gained">{since}</Th>
              <Th k="likes">Likes</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.video_id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <a href={v.url} target="_blank" rel="noreferrer" className="text-ink">
                    {v.title}
                  </a>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{shortDay(v.posted_at.slice(0, 10))}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(v.views)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{c.gained ? plus(v.gained) || '–' : '–'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{num(v.likes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
