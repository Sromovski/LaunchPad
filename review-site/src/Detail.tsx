import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, api, seconds, type Detail as DetailData, type VideoSummary } from './api';
import { go } from './App';
import { DecisionPanel, type DecisionMode } from './DecisionPanel';
import { DraftEditor } from './DraftEditor';

/** True only where a keystroke is text. A focused checkbox (the rights box!) must still let A through. */
const isTyping = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(t.type);
};

export function Detail({ id, queue, onDecided }: { id: number; queue: VideoSummary[]; onDecided: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DecisionMode>(null);
  const [now, setNow] = useState(0);
  const player = useRef<HTMLVideoElement>(null);

  const load = useCallback(() => {
    api
      .detail(id)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const reviewable = data?.video.status === 'in_review';

  // Keyboard: A approve, C changes, R reject, J/K next/previous in the queue. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        const i = queue.findIndex((v) => v.id === id);
        const next = k === 'j' ? (i === -1 ? queue[0] : queue[i + 1]) : i > 0 ? queue[i - 1] : undefined;
        if (next) go(`#/v/${next.id}`);
        return;
      }
      if (!reviewable) return;
      if (k === 'a') setMode('approve');
      else if (k === 'c') setMode('changes');
      else if (k === 'r') setMode('reject');
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [id, queue, reviewable]);

  if (error) return <p className="text-rust">Couldn't load video {id}: {error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const { video, script, segments } = data;
  const spoken = script ? [script.hook, ...script.lines.map((l) => l.text), script.end_question] : [];
  const sourceIds = script ? [script.hook_source_ids ?? [], ...script.lines.map((l) => l.source_ids), []] : [];
  const activeIndex = segments.findIndex((s, i) => now >= s.start_s && now < (segments[i + 1]?.start_s ?? Infinity));
  const sourceByRef = new Map(data.sources.map((s) => [s.ref, s]));
  const qaPassed = data.qa?.checks.filter((c) => c.ok).length ?? 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(300px,380px)_1fr]">
      {/* Left: phone player + decision. Sticky so the decision is always next to the picture. */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="sunset-glow -mx-10 px-10 py-8">
          <div className="mx-auto w-full max-w-[300px] rounded-[2.2rem] border-[10px] border-[#0a0e1c] bg-black shadow-2xl">
            {data.has_video ? (
              <video
                ref={player}
                src={`/media/${id}/final.mp4`}
                controls
                playsInline
                preload="metadata"
                className="aspect-[9/16] w-full rounded-[1.5rem]"
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                data-testid="player"
              />
            ) : (
              <div className="flex aspect-[9/16] items-center justify-center p-6 text-center text-muted">No final.mp4 for this video yet.</div>
            )}
          </div>
        </div>
        <DecisionPanel
          id={id}
          status={video.status}
          rightsNeeded={data.rights_needed}
          mode={mode}
          setMode={setMode}
          onDone={() => {
            load();
            onDecided();
          }}
        />
      </aside>

      {/* Right: everything needed to judge it, in reading order. */}
      <article className="min-w-0 max-w-3xl">
        <p className="text-muted">
          Video {video.id} <span aria-hidden>/</span> {seconds(video.duration_s)}
          {video.revision_count > 0 && (
            <>
              {' '}
              <span aria-hidden>/</span> revision {video.revision_count} of 2
            </>
          )}
        </p>
        <h1 className="font-display text-4xl font-bold leading-tight">{video.title ?? video.topic}</h1>
        <p className="mt-1 text-lg text-muted">{video.topic}</p>
        {!reviewable && (
          <p className="mt-3 inline-block rounded-lg bg-panel px-3 py-1 font-semibold">{STATUS_LABEL[video.status] ?? video.status}</p>
        )}
        {data.posts.map((p) => (
          <p key={p.platform} className="mt-2" data-testid="post-link">
            Live on {p.platform === 'youtube' ? 'YouTube' : p.platform}:{' '}
            <a href={p.url} target="_blank" rel="noreferrer" className="font-semibold text-glow">
              {p.url.replace('https://www.', '')}
            </a>
          </p>
        ))}

        {data.rights_needed.length > 0 && (
          <section className="mt-6 rounded-xl border-2 border-dust bg-dust-soft p-4" data-testid="rights-warning">
            <h2 className="font-display text-xl font-bold text-dust">Check the image rights before approving</h2>
            <p className="mt-1">These images are co-credited, so they may not be plain NASA public domain. Open each NASA page and check the credit and any usage notes.</p>
            <ul className="mt-2 list-disc pl-6">
              {data.rights_needed.map((r) => {
                const a = data.assets.find((x) => x.nasa_id === r.nasa_id);
                return (
                  <li key={r.nasa_id}>
                    <a href={a?.source_url} target="_blank" rel="noreferrer" className="font-semibold text-ink">
                      {r.nasa_id}
                    </a>{' '}
                    <span className="text-muted">{r.credit ?? 'no credit found'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {script && (
          <Section title="Script" aside={`${script.word_count} words, reading grade ${script.reading_grade}, version ${script.version}`}>
            <p className="mb-3 text-muted">Click a line to jump there. The line being spoken is highlighted.</p>
            <ol className="space-y-1" data-testid="transcript">
              {spoken.map((text, i) => {
                const seg = segments[i];
                const active = i === activeIndex && now > 0;
                const refs = sourceIds[i] ?? [];
                return (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={!seg || !data.has_video}
                      onClick={() => {
                        if (seg && player.current) {
                          player.current.currentTime = seg.start_s;
                          void player.current.play().catch(() => undefined);
                        }
                      }}
                      className={`w-full rounded-lg px-3 py-2 text-left ${active ? 'bg-glow-soft ring-2 ring-glow' : 'hover:bg-panel'} ${
                        i === 0 || i === spoken.length - 1 ? 'font-semibold' : ''
                      }`}
                    >
                      <span className="mr-3 inline-block w-12 text-sm text-muted tabular-nums">{seg ? `${seg.start_s.toFixed(1)}s` : ''}</span>
                      {text}
                      {i === 0 && <span className="ml-2 text-sm text-muted">(hook)</span>}
                      {i === spoken.length - 1 && <span className="ml-2 text-sm text-muted">(end card)</span>}
                    </button>
                    {refs.length > 0 && (
                      <span className="ml-[4.25rem] flex flex-wrap gap-x-5 gap-y-1 pb-1 text-sm">
                        {refs.map((r) => {
                          const s = sourceByRef.get(r);
                          return s ? (
                            <a key={r} href={s.url} target="_blank" rel="noreferrer" title={s.excerpt} className="text-glow">
                              {s.title}
                            </a>
                          ) : (
                            <span key={r} className="text-rust">
                              missing source {r}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}

        <Section title="Fact check" aside={`${data.fact_checks.filter((f) => f.verdict === 'supported').length} of ${data.fact_checks.length} claims supported`}>
          <table className="w-full border-collapse text-left">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-semibold">Claim</th>
                <th className="py-2 pr-3 font-semibold">Verdict</th>
                <th className="py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.fact_checks.map((f, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="py-2 pr-3">
                    {f.claim}
                    {f.note && <div className="text-sm text-muted">{f.note}</div>}
                  </td>
                  <td className={`py-2 pr-3 font-semibold ${f.verdict === 'supported' ? 'text-ok' : 'text-rust'}`}>{f.verdict}</td>
                  <td className="py-2">
                    {f.source_url ? (
                      <a href={f.source_url} target="_blank" rel="noreferrer" className="text-glow">
                        {f.source_ref}
                      </a>
                    ) : (
                      <span className="text-muted">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {data.bonus && (
          <Section title="Bonus picture" aside={'start_s' in data.bonus ? `from ${data.bonus.start_s.toFixed(1)}s` : 'left off'}>
            {'start_s' in data.bonus ? (
              <div className="space-y-1">
                <button
                  type="button"
                  disabled={!data.has_video}
                  onClick={() => {
                    const b = data.bonus;
                    if (b && 'start_s' in b && player.current) {
                      player.current.currentTime = b.start_s;
                      void player.current.play().catch(() => undefined);
                    }
                  }}
                  className="rounded-lg px-3 py-2 text-left font-semibold hover:bg-panel"
                >
                  “Here's a bonus space picture! {data.bonus.title}.”
                </button>
                <div className="px-3 text-muted">
                  Image: {data.bonus.credit ?? 'no credit found'} ·{' '}
                  <a href={data.bonus.page} target="_blank" rel="noreferrer" className="text-glow">
                    NASA Image of the Day, {data.bonus.date_text}
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-muted">Not added: {data.bonus.skipped}</p>
            )}
          </Section>
        )}

        <Section title="Images and credits">
          <ul className="space-y-3">
            {data.assets.map((a) => (
              <li key={a.nasa_id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <a href={a.source_url} target="_blank" rel="noreferrer" className="font-semibold text-glow">
                    {a.nasa_id}
                  </a>
                  <span>{a.title}</span>
                  <span className={`ml-auto text-sm font-semibold ${a.rights_status === 'clear' ? 'text-ok' : a.rights_status === 'rejected' ? 'text-rust' : 'text-dust'}`}>
                    {a.rights_status === 'clear' ? 'Rights clear' : a.rights_status === 'rejected' ? 'Rights rejected' : 'Rights need checking'}
                  </span>
                </div>
                <div className="text-muted">{a.credit ?? 'No credit found'}</div>
                {a.rights_note && <div className="text-sm text-muted">{a.rights_note}</div>}
              </li>
            ))}
          </ul>
        </Section>

        {data.qa && (
          <Section title="Automated checks" aside={`${qaPassed} of ${data.qa.checks.length} passed`}>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {data.qa.checks.map((c) => (
                <li key={c.name} className="flex gap-2">
                  <span className={c.ok ? 'text-ok' : 'text-rust'} aria-label={c.ok ? 'passed' : 'failed'}>
                    {c.ok ? '✓' : '✗'}
                  </span>
                  <span>
                    {c.name} <span className="text-sm text-muted">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Publishing text">
          <DraftEditor id={id} initial={data.draft} readOnly={video.status === 'published'} />
        </Section>

        {data.reviews.length > 0 && (
          <Section title="Review history">
            <ul className="space-y-2">
              {data.reviews.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{STATUS_LABEL[r.decision] ?? r.decision}</span> <span className="text-muted">{r.created_at}</span>
                  {r.notes && <p className="text-muted">{r.notes}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </article>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-line pb-2">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        {aside && <span className="text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
