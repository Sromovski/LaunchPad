import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, fablesApi, type Decision, type FableDetail, type FableScene, type FableSummary } from './api';
import { go } from './App';

/**
 * Pocket Fables tab (channels/fables/CLAUDE.md §3). Gate 1, "Scripts to review": Thomas reads
 * the script before any Everygen credits are spent. Videos to review and Ready to upload
 * come with the render step (build order steps 3–4).
 */
export function Fables({ id, onChanged }: { id: number | null; onChanged: () => void }) {
  const [queue, setQueue] = useState<FableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fablesApi
      .list('script_review')
      .then((r) => {
        setQueue(r.videos);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load, id]);

  if (id !== null)
    return (
      <ScriptDetail
        key={id}
        id={id}
        queue={queue ?? []}
        onDecided={() => {
          load();
          onChanged();
        }}
      />
    );
  return <ScriptQueue videos={queue} error={error} />;
}

function ScriptQueue({ videos, error }: { videos: FableSummary[] | null; error: string | null }) {
  if (error) return <p className="text-rust">Couldn't load Pocket Fables scripts: {error}</p>;
  if (!videos) return <p className="text-muted">Loading…</p>;
  return (
    <section data-testid="fables-queue">
      <h1 className="font-display text-3xl font-bold">
        {videos.length === 0 ? 'No scripts to review' : `${videos.length} ${videos.length === 1 ? 'script' : 'scripts'} to review`}
      </h1>
      <p className="mt-1 max-w-2xl text-muted">
        {videos.length === 0
          ? 'New Pocket Fables scripts land here. Add one in Claude Code with npm run fables:script -- --file <script.json>.'
          : 'Read each story before it goes to Everygen. Nothing is rendered, and no credits are spent, until you approve.'}
      </p>
      <ul className="mt-6 max-w-3xl divide-y divide-line border-y border-line">
        {videos.map((v) => (
          <li key={v.id}>
            <a href={`#/fables/v/${v.id}`} className="group flex gap-4 py-4 text-ink no-underline" data-testid={`fables-item-${v.id}`}>
              <span aria-hidden className="mt-2 h-3 w-3 shrink-0 rounded-full bg-fox" />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-xl font-semibold leading-snug group-hover:text-fox">{v.topic}</span>
                {v.lesson && <span className="block text-muted">{v.lesson}</span>}
                <span className="mt-1 block text-sm text-muted">
                  {[v.origin, v.lane, v.word_count != null && `${v.word_count} words`, v.est_seconds != null && `${v.est_seconds} s`, v.scene_count != null && `${v.scene_count} scenes`]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </span>
              {(v.version ?? 1) > 1 && (
                <span className="self-start whitespace-nowrap rounded-md bg-fox-soft px-2 py-0.5 text-sm font-bold">Version {v.version}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">Videos to review and Ready to upload appear here after the first Everygen render.</p>
    </section>
  );
}

/** True only where a keystroke is text (same rule as the NASA detail page). */
const isTyping = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(t.type);
};

type Mode = null | 'approve' | 'changes' | 'reject';
const DECISION: Record<Exclude<Mode, null>, Decision> = { approve: 'approved', changes: 'changes_requested', reject: 'rejected' };

function ScriptDetail({ id, queue, onDecided }: { id: number; queue: FableSummary[]; onDecided: () => void }) {
  const [data, setData] = useState<FableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [activeScene, setActiveScene] = useState<number | null>(null);

  const load = useCallback(() => {
    fablesApi
      .detail(id)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const reviewable = data?.video.status === 'script_review' && !!data.script;

  // A approve, C changes, R reject, J/K next/previous script. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        const i = queue.findIndex((v) => v.id === id);
        const next = k === 'j' ? (i === -1 ? queue[0] : queue[i + 1]) : i > 0 ? queue[i - 1] : undefined;
        if (next) go(`#/fables/v/${next.id}`);
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

  if (error) return <p className="text-rust">Couldn't load script {id}: {error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const { video, script } = data;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_minmax(280px,340px)]">
      <article className="min-w-0" data-testid="fables-detail">
        <p className="text-muted">
          <a href="#/fables">Scripts to review</a> <span aria-hidden>/</span> Video {video.id}
          {data.script_version && (
            <>
              {' '}
              <span aria-hidden>/</span> script version {data.script_version}
              {data.script_by ? ` (${data.script_by})` : ''}
            </>
          )}
          {video.revision_count > 0 && (
            <>
              {' '}
              <span aria-hidden>/</span> revision {video.revision_count} of 2
            </>
          )}
        </p>
        <h1 className="font-display text-4xl font-bold leading-tight">{script?.title ?? video.topic}</h1>
        {script && <p className="mt-2 max-w-2xl font-display text-2xl font-semibold leading-snug text-fox">“{script.lesson}”</p>}
        {!reviewable && <p className="mt-3 inline-block rounded-lg bg-panel px-3 py-1 font-semibold">{STATUS_LABEL[video.status] ?? video.status}</p>}

        {data.script_problem && (
          <p className="mt-4 rounded-lg border border-rust p-3 text-rust" role="alert">
            This script doesn't match the Pocket Fables format, so it can't be reviewed: {data.script_problem}
          </p>
        )}

        {script && (
          <>
            <dl className="mt-6 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]" data-testid="fables-header">
              <Meta term="Lane">{script.lane}</Meta>
              <Meta term="Origin">{script.origin}</Meta>
              <Meta term="Length">
                {script.word_count} words, about {data.est_seconds} s in {script.scenes.length} scenes
              </Meta>
              <Meta term="Narrator and voice">{script.narrator}</Meta>
              <Meta term="Visual style">{script.visual_style}</Meta>
            </dl>

            {data.warnings.length > 0 && (
              <div className="mt-6 max-w-3xl rounded-lg bg-dust-soft p-4" data-testid="fables-warnings">
                <h2 className="font-semibold">Worth a look before approving</h2>
                <ul className="mt-1 list-disc pl-5">
                  {data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <h2 className="mt-8 font-display text-2xl font-semibold">Scenes</h2>
            <Timeline scenes={script.scenes} active={activeScene} setActive={setActiveScene} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left" data-testid="scene-table">
                <thead>
                  <tr className="border-b border-line text-sm text-muted">
                    <th scope="col" className="py-2 pr-3 font-semibold">#</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Seconds</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Narration</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Visuals</th>
                    <th scope="col" className="py-2 font-semibold">On-screen text</th>
                  </tr>
                </thead>
                <tbody>
                  {script.scenes.map((s) => (
                    <tr
                      key={s.n}
                      id={`scene-${s.n}`}
                      onMouseEnter={() => setActiveScene(s.n)}
                      onMouseLeave={() => setActiveScene(null)}
                      className={`scroll-mt-4 border-b border-line align-top ${activeScene === s.n ? 'bg-fox-soft' : ''}`}
                    >
                      <td className="py-3 pr-3 font-display text-lg font-bold text-fox">{s.n}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-muted">{s.seconds} s</td>
                      <td className="w-[38%] py-3 pr-3 text-lg leading-snug">{s.narration}</td>
                      <td className="w-[38%] py-3 pr-3 text-sm text-muted">{s.visuals}</td>
                      <td className="py-3 text-sm">{s.on_screen_text || <span className="text-muted">none</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="mt-8 font-display text-2xl font-semibold">On YouTube</h2>
            <dl className="mt-3 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
              <Meta term="Title">{script.youtube.title}</Meta>
              <Meta term="Description">
                <span className="whitespace-pre-line">{script.youtube.description}</span>
              </Meta>
              <Meta term="Tags">{script.youtube.tags.join(', ')}</Meta>
              <Meta term="Audience">Made for Kids</Meta>
            </dl>
          </>
        )}

        {data.reviews.length > 0 && (
          <>
            <h2 className="mt-8 font-display text-2xl font-semibold">Your earlier decisions</h2>
            <ul className="mt-2 max-w-3xl space-y-2">
              {data.reviews.map((r) => (
                <li key={r.id} className="rounded-lg border border-line p-3">
                  <span className="font-semibold">
                    {r.gate === 'script' ? 'Script' : 'Video'}: {r.decision.replace('_', ' ')}
                  </span>{' '}
                  <span className="text-sm text-muted">{r.created_at.slice(0, 16)}</span>
                  {r.notes && <p className="mt-1">{r.notes}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <ScriptDecision
          id={id}
          status={video.status}
          canDecide={reviewable}
          version={data.script_version}
          revisions={video.revision_count}
          mode={mode}
          setMode={setMode}
          onDone={() => {
            load();
            onDecided();
          }}
        />
      </aside>
    </div>
  );
}

function Meta({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-muted">{term}</dt>
      <dd className="max-w-[70ch]">{children}</dd>
    </>
  );
}

/** Each scene as wide as it is long, so pacing and the 50–65 s window read at a glance. Click to jump to the row. */
function Timeline({ scenes, active, setActive }: { scenes: FableScene[]; active: number | null; setActive: (n: number | null) => void }) {
  const total = scenes.reduce((n, s) => n + s.seconds, 0);
  const span = Math.max(total, 65);
  return (
    <div className="mt-3 max-w-3xl" data-testid="scene-timeline">
      <div className="relative">
        <div className="flex h-12 gap-[3px]" style={{ width: `${(total / span) * 100}%` }}>
          {scenes.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => document.getElementById(`scene-${s.n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              onMouseEnter={() => setActive(s.n)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.n)}
              onBlur={() => setActive(null)}
              style={{ flexGrow: s.seconds, flexBasis: 0 }}
              className={`min-w-0 rounded-md border font-display font-bold ${active === s.n ? 'border-fox bg-fox text-bg' : 'border-fox/50 bg-fox-soft text-ink'}`}
              aria-label={`Scene ${s.n}, ${s.seconds} seconds`}
            >
              {s.n}
            </button>
          ))}
        </div>
        {/* The window the render must land in (50–65 s). */}
        <div aria-hidden className="pointer-events-none absolute inset-y-[-6px] border-x-2 border-dashed border-muted/60" style={{ left: `${(50 / span) * 100}%`, width: `${(15 / span) * 100}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {total} s in total. The dashed lines mark the 50–65 s a Short must fit.
      </p>
    </div>
  );
}

function ScriptDecision({
  id,
  status,
  canDecide,
  version,
  revisions,
  mode,
  setMode,
  onDone,
}: {
  id: number;
  status: string;
  canDecide: boolean;
  version: number | null;
  revisions: number;
  mode: Mode;
  setMode: (m: Mode) => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const notesBox = useRef<HTMLTextAreaElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const canRevise = revisions < 2;

  useEffect(() => {
    setError(null);
    if (mode === 'changes' || mode === 'reject') notesBox.current?.focus();
    else if (mode === 'approve') confirmBtn.current?.focus();
  }, [mode]);
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode(null);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [mode, setMode]);

  if (!canDecide) {
    const after =
      status === 'script_approved'
        ? 'Approved. Claude renders it with Everygen from Claude Code; it comes back under Videos to review.'
        : status === 'script_changes'
          ? 'Changes requested. Claude revises the script and it comes back here as a new version.'
          : `${STATUS_LABEL[status] ?? status}. Nothing to decide.`;
    return (
      <p className="rounded-2xl border border-line bg-panel p-4 text-muted" data-testid="fables-decided">
        {done ? `${done} ` : ''}
        {after}
      </p>
    );
  }

  const submit = async () => {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      await fablesApi.reviewScript(id, DECISION[mode], notes, version);
      setDone(mode === 'approve' ? 'Sent to Everygen.' : mode === 'changes' ? 'Changes requested.' : 'Rejected.');
      setMode(null);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-panel p-4" data-testid="fables-decision">
      {mode === null && (
        <div className="grid gap-2">
          <button onClick={() => setMode('approve')} className="rounded-lg bg-fox px-3 py-3 text-left font-bold text-bg" aria-keyshortcuts="A" data-testid="fables-approve">
            Approve & send to Everygen
            <span className="block text-xs font-normal opacity-80">key A</span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMode('changes')}
              disabled={!canRevise}
              className="rounded-lg bg-dust px-3 py-2.5 font-bold leading-tight text-bg disabled:cursor-not-allowed disabled:opacity-40"
              aria-keyshortcuts="C"
              data-testid="fables-changes"
            >
              Request changes
              <span className="block text-xs font-normal opacity-80">key C</span>
            </button>
            <button onClick={() => setMode('reject')} className="rounded-lg bg-rust px-3 py-2.5 font-bold leading-tight text-bg" aria-keyshortcuts="R" data-testid="fables-reject">
              Reject
              <span className="block text-xs font-normal opacity-80">key R</span>
            </button>
          </div>
          {!canRevise && <p className="text-sm text-dust">This video has had 2 revisions. Approve or reject it.</p>}
        </div>
      )}

      {mode === 'approve' && (
        <div>
          <p>Send this script to Everygen? Rendering it spends Everygen credits. Nothing is posted.</p>
          <div className="mt-3 flex gap-2">
            <button ref={confirmBtn} onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-fox px-4 py-2 font-bold text-bg disabled:opacity-40" data-testid="fables-confirm">
              Approve & send to Everygen
            </button>
            <button onClick={() => setMode(null)} className="rounded-lg border border-line px-4 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {(mode === 'changes' || mode === 'reject') && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="font-semibold">{mode === 'changes' ? 'What should change?' : 'Reason (optional)'}</span>
            <textarea
              ref={notesBox}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={4}
              required={mode === 'changes'}
              placeholder={mode === 'changes' ? 'e.g. Scene 7 is too long; make the emperor sillier' : 'e.g. Too close to last week’s story'}
              className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-ink placeholder:text-muted"
              data-testid="fables-notes"
            />
          </label>
          <p className="text-sm text-muted">Ctrl+Enter to send, Esc to cancel.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={busy || (mode === 'changes' && !notes.trim())}
              className={`flex-1 rounded-lg px-4 py-2 font-bold text-bg disabled:opacity-40 ${mode === 'changes' ? 'bg-dust' : 'bg-rust'}`}
              data-testid="fables-confirm"
            >
              {mode === 'changes' ? 'Request changes' : 'Reject'}
            </button>
            <button type="button" onClick={() => setMode(null)} className="rounded-lg border border-line px-4 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-3 text-rust" role="alert">
          {error}
        </p>
      )}
      <p className="mt-3 text-sm text-muted">J and K move between scripts.</p>
    </div>
  );
}
