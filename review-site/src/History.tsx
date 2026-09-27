import { useEffect, useState } from 'react';
import { STATUS_LABEL, api, seconds, type VideoSummary } from './api';

const FILTERS: { key: string; label: string }[] = [
  { key: 'history', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'published', label: 'Published' },
];

const TONE: Record<string, string> = {
  approved: 'text-ok',
  published: 'text-ok',
  rejected: 'text-rust',
  failed: 'text-rust',
  changes_requested: 'text-dust',
};

export function History() {
  const [filter, setFilter] = useState('history');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<VideoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .list(filter, q)
        .then((r) => {
          setRows(r.videos);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [filter, q]);

  return (
    <section>
      <h1 className="font-display text-3xl font-bold">History</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-full border px-3 py-1 ${filter === f.key ? 'border-glow bg-glow-soft text-ink' : 'border-line text-muted hover:text-ink'}`}
          >
            {f.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2">
          <span className="sr-only">Search titles and topics</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles and topics"
            className="w-64 rounded-lg border border-line bg-panel px-3 py-1.5 text-ink placeholder:text-muted"
          />
        </label>
      </div>

      {error && <p className="mt-6 text-rust">Couldn't load history: {error}</p>}
      {rows && rows.length === 0 && <p className="mt-6 text-muted">No videos match. Decided videos show up here.</p>}
      {rows && rows.length > 0 && (
        <table className="mt-6 w-full border-collapse text-left">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-4 font-semibold">Video</th>
              <th className="py-2 pr-4 font-semibold">Status</th>
              <th className="py-2 pr-4 font-semibold">Length</th>
              <th className="py-2 font-semibold">Last change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className="border-b border-line">
                <td className="py-3 pr-4">
                  <a href={`#/v/${v.id}`} className="font-semibold text-ink">
                    {v.title ?? v.topic}
                  </a>
                  <div className="text-sm text-muted">video {v.id}</div>
                </td>
                <td className={`py-3 pr-4 font-semibold ${TONE[v.status] ?? ''}`}>{STATUS_LABEL[v.status] ?? v.status}</td>
                <td className="py-3 pr-4 text-muted">{seconds(v.duration_s)}</td>
                <td className="py-3 text-muted">{v.updated_at.slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
