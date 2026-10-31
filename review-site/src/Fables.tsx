import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, fablesApi, type Decision, type FableCredits, type FableDetail, type FableScene, type FableScript, type FableSummary } from './api';
import { go } from './App';

/**
 * Pocket Fables tab (channels/fables/CLAUDE.md §3). Gate 1, "Scripts to review": Thomas reads
 * the script before any Everygen credits are spent. Gate 2, "Videos to review": the render,
 * next to the approved script. "Ready to upload": download, copy the YouTube text, upload by
 * hand in YouTube Studio, then paste the link to mark it uploaded.
 */
export function Fables({ id, onChanged }: { id: number | null; onChanged: () => void }) {
  const [scripts, setScripts] = useState<FableSummary[] | null>(null);
  const [videos, setVideos] = useState<FableSummary[] | null>(null);
  const [ready, setReady] = useState<FableSummary[] | null>(null);
  const [uploaded, setUploaded] = useState<FableSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([fablesApi.list('script_review'), fablesApi.list('video_review'), fablesApi.list('approved'), fablesApi.list('uploaded')])
      .then(([s, v, a, u]) => {
        setScripts(s.videos);
        setVideos(v.videos);
        setReady(a.videos);
        setUploaded(u.videos);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  // J/K walk ready-to-upload first, then videos (they cost credits already), then scripts.
  const queue = [...(ready ?? []), ...(videos ?? []), ...(scripts ?? [])];
  useEffect(load, [load, id]);

  if (id !== null)
    return (
      <ScriptDetail
        key={id}
        id={id}
        queue={queue}
        onDecided={() => {
          load();
          onChanged();
        }}
      />
    );
  if (error) return <p className="text-rust">Couldn't load Pocket Fables: {error}</p>;
  if (!scripts || !videos || !ready) return <p className="text-muted">Loading…</p>;
  return (
    <>
      <CreditsPanel />
      {ready.length > 0 && (
        <VideoQueue
          videos={ready}
          testId="fables-ready-queue"
          heading={`${ready.length} ${ready.length === 1 ? 'video' : 'videos'} ready to upload`}
          blurb="You approved these. Upload each one in YouTube Studio, then paste its link here."
        />
      )}
      {videos.length > 0 && (
        <VideoQueue
          videos={videos}
          testId="fables-video-queue"
          heading={`${videos.length} ${videos.length === 1 ? 'video' : 'videos'} to review`}
          blurb="Rendered by Everygen from scripts you approved. Watch each one against its script."
        />
      )}
      <ScriptQueue videos={scripts} />
      {uploaded.length > 0 && <UploadedList videos={uploaded} />}
    </>
  );
}

/** On YouTube already: newest first, with the Short's link. */
function UploadedList({ videos }: { videos: FableSummary[] }) {
  return (
    <section className="mt-12" data-testid="fables-uploaded">
      <h2 className="font-display text-2xl font-semibold">On YouTube</h2>
      <ul className="mt-3 max-w-3xl divide-y divide-line border-y border-line">
        {videos.map((v) => (
          <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
            <a href={`#/fables/v/${v.id}`} className="font-display text-lg font-semibold">
              {v.topic}
            </a>
            {v.youtube_url && (
              <a href={v.youtube_url} target="_blank" rel="noreferrer" className="text-sm">
                Watch on YouTube
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Everygen credits: the last balance Claude checked, and this month's renders (from the credits ledger). */
function CreditsPanel() {
  const [c, setC] = useState<FableCredits | null>(null);
  useEffect(() => {
    fablesApi
      .credits()
      .then(setC)
      .catch(() => setC(null));
  }, []);
  if (!c) return null;
  const pct = c.remaining != null && c.plan_max ? Math.min(100, (c.remaining / c.plan_max) * 100) : null;
  const day = (iso: string | null) => (iso ? new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);
  return (
    <section className="mb-10 max-w-3xl rounded-2xl border border-line bg-panel p-4" data-testid="fables-credits">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="font-display text-xl font-semibold">Everygen credits</h2>
        {c.checked_at && <span className="text-sm text-muted">checked {day(c.checked_at)}, {c.checked_at.slice(11, 16)} UTC</span>}
      </div>
      {c.remaining == null ? (
        <p className="mt-1 text-muted">No balance checked yet. It's saved each time Claude renders a video.</p>
      ) : (
        <>
          <p className="mt-1">
            <span className="font-display text-3xl font-bold">{c.remaining}</span>
            {c.plan_max ? <span className="text-muted"> of {c.plan_max} left</span> : <span className="text-muted"> left</span>}
            {c.period_end && <span className="text-muted">, renews {day(c.period_end)}</span>}
          </p>
          {pct != null && (
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-fox-soft" role="meter" aria-valuemin={0} aria-valuemax={c.plan_max ?? 0} aria-valuenow={c.remaining} aria-label="Credits left">
              <div className="h-full rounded-full bg-fox" style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      )}
      <p className="mt-2 text-sm text-muted">
        This month: {c.renders_this_month} {c.renders_this_month === 1 ? 'render' : 'renders'}, {c.used_this_month} credits.
      </p>
    </section>
  );
}

function VideoQueue({ videos, heading, blurb, testId }: { videos: FableSummary[]; heading: string; blurb: string; testId: string }) {
  return (
    <section className="mb-12" data-testid={testId}>
      <h1 className="font-display text-3xl font-bold">{heading}</h1>
      <p className="mt-1 max-w-2xl text-muted">{blurb}</p>
      <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
        {videos.map((v) => (
          <li key={v.id}>
            <a href={`#/fables/v/${v.id}`} className="group block text-ink no-underline" data-testid={`fables-video-${v.id}`}>
              <video src={`/media/${v.id}/final.mp4#t=1`} preload="metadata" muted className="mb-3 aspect-[9/16] w-full rounded-2xl border border-line bg-panel object-cover group-hover:border-fox" />
              <span className="block font-display text-lg font-semibold leading-snug group-hover:text-fox">{v.topic}</span>
              <span className="text-sm text-muted">{v.origin}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScriptQueue({ videos }: { videos: FableSummary[] }) {
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

  const gate: Gate = data?.video.status === 'video_review' ? 'video' : 'script';
  const reviewable = (data?.video.status === 'script_review' || data?.video.status === 'video_review') && !!data.script;

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

  const afterApproval = !!script && (video.status === 'approved' || video.status === 'uploaded');
  const decision = afterApproval ? (
    <UploadPanel
      id={id}
      script={script}
      post={data.post}
      connected={data.youtube_connected}
      onDone={() => {
        load();
        onDecided();
      }}
    />
  ) : (
    <ScriptDecision
      id={id}
      gate={gate}
      status={video.status}
      canDecide={reviewable}
      version={data.script_version}
      revisions={video.revision_count}
      autoUpload={data.youtube_connected}
      mode={mode}
      setMode={setMode}
      onDone={() => {
        load();
        onDecided();
      }}
    />
  );
  const creditsUsed = data.credits.reduce((n, c) => n + c.credits_used, 0);

  return (
    <div className={`grid gap-8 ${data.has_video ? 'lg:grid-cols-[minmax(280px,340px)_1fr]' : 'lg:grid-cols-[1fr_minmax(280px,340px)]'}`}>
      {/* Videos: the phone player on the left so the narration can be checked against the script on the right. */}
      {data.has_video && (
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="mx-auto mb-4 w-full max-w-[300px] rounded-[2.2rem] border-[10px] border-[#0a0e1c] bg-black shadow-2xl">
            <video src={`/media/${id}/final.mp4`} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-[1.5rem]" data-testid="fables-player" />
          </div>
          {decision}
        </aside>
      )}
      <article className="min-w-0" data-testid="fables-detail">
        <p className="text-muted">
          <a href="#/fables">{video.status === 'approved' ? 'Ready to upload' : video.status === 'uploaded' ? 'On YouTube' : gate === 'video' ? 'Videos to review' : 'Scripts to review'}</a> <span aria-hidden>/</span> Video {video.id}
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

        {data.has_video && (
          <dl className="mt-6 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]" data-testid="fables-render">
            <Meta term="Everygen credits">
              {data.credits.length === 0 ? 'not recorded' : `${creditsUsed} for this render (${data.credits[data.credits.length - 1]!.balance_after} left)`}
            </Meta>
            {data.qa && (
              <Meta term="Checks">
                <ul>
                  {data.qa.checks.map((c) => (
                    <li key={c.name} className={c.ok ? '' : 'text-rust'}>
                      {c.ok ? 'Passed' : 'Failed'}: {c.name} ({c.detail})
                    </li>
                  ))}
                </ul>
              </Meta>
            )}
          </dl>
        )}

        {data.script_problem && (
          <p className="mt-4 rounded-lg border border-rust p-3 text-rust" role="alert">
            This script doesn't match the Pocket Fables format, so it can't be reviewed: {data.script_problem}
          </p>
        )}

        {script && (
          <>
            <dl className="mt-6 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]" data-testid="fables-header">
              <Meta term="Lane">{script.lane}</Meta>
              <Meta term="Origin">{script.origin}</Meta>
              <Meta term="Length">
                {script.word_count} words, about {data.est_seconds} s in {script.scenes.length} scenes
              </Meta>
              <Meta term="Narrator and voice">{script.narrator}</Meta>
              <Meta term="Visual style">{script.visual_style}</Meta>
              {script.hero && (
                <Meta term="Hero">
                  <span className="font-semibold">{script.hero.name}</span>: {script.hero.look}
                </Meta>
              )}
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
                      <td className="w-[38%] py-3 pr-3 text-lg leading-snug">
                        {s.pip_on_camera && <span className="mb-1 block text-sm font-bold text-fox">Pip says it on camera</span>}
                        {s.narration}
                      </td>
                      <td className="w-[38%] py-3 pr-3 text-sm text-muted">{s.visuals}</td>
                      <td className="py-3 text-sm">{s.on_screen_text || <span className="text-muted">none</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="mt-8 font-display text-2xl font-semibold">On YouTube</h2>
            <dl className="mt-3 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]">
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

      {!data.has_video && <aside className="lg:sticky lg:top-4 lg:self-start">{decision}</aside>}
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

type Gate = 'script' | 'video';

function ScriptDecision({
  id,
  gate,
  status,
  canDecide,
  version,
  revisions,
  autoUpload,
  mode,
  setMode,
  onDone,
}: {
  id: number;
  gate: Gate;
  status: string;
  canDecide: boolean;
  version: number | null;
  revisions: number;
  /** Approving a video uploads it to YouTube straight away (when the channel is connected). */
  autoUpload: boolean;
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
        : status === 'script_changes' || status === 'video_changes'
          ? 'Changes requested. Claude revises the script and it comes back under Scripts to review as a new version.'
          : status === 'approved'
            ? 'Approved and ready to upload.'
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
      if (gate === 'video') await fablesApi.reviewVideo(id, DECISION[mode], notes);
      else await fablesApi.reviewScript(id, DECISION[mode], notes, version);
      let uploaded = '';
      if (gate === 'video' && mode === 'approve' && autoUpload) {
        try {
          const r = await fablesApi.publish(id);
          uploaded = r.visibility === 'public' ? ' Uploaded to YouTube.' : ` Uploaded to YouTube as ${r.visibility}.`;
        } catch (e) {
          // Approved either way; the upload can be retried from Ready to upload.
          uploaded = ` The YouTube upload didn't work (${(e as Error).message}); try again from Ready to upload.`;
        }
      }
      setDone(mode === 'approve' ? (gate === 'video' ? `Approved.${uploaded}` : 'Sent to Everygen.') : mode === 'changes' ? 'Changes requested.' : 'Rejected.');
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
            {gate === 'video' ? 'Approve' : 'Approve & send to Everygen'}
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
          <p>
            {gate === 'video'
              ? autoUpload
                ? 'Approve this video and upload it to the Pocket Fables channel now (public, Made for Kids)?'
                : 'Approve this video? It moves to Ready to upload. YouTube isn’t connected yet, so nothing is posted.'
              : 'Send this script to Everygen? Rendering it spends Everygen credits. Nothing is posted.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button ref={confirmBtn} onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-fox px-4 py-2 font-bold text-bg disabled:opacity-40" data-testid="fables-confirm">
              {busy ? 'Working…' : gate === 'video' ? (autoUpload ? 'Approve & upload' : 'Approve') : 'Approve & send to Everygen'}
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
          {gate === 'video' && mode === 'changes' && (
            <p className="mt-1 rounded-lg bg-dust-soft p-2 text-sm" data-testid="fables-rerender-warning">
              Claude revises the script, you approve it again, then Everygen re-renders the whole video. A re-render costs credits.
            </p>
          )}
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
      <p className="mt-3 text-sm text-muted">J and K move through the queue.</p>
    </div>
  );
}

/** Copies one field for YouTube Studio and says so for two seconds. */
function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setState('copied');
            setTimeout(() => setState('idle'), 2000);
          })
          .catch(() => setState('failed'));
      }}
      className="rounded-lg border border-line px-3 py-2 text-left font-semibold hover:border-fox"
      data-testid={`fables-copy-${label.toLowerCase()}`}
    >
      {state === 'copied' ? `${label} copied` : state === 'failed' ? `Couldn't copy the ${label.toLowerCase()}` : `Copy ${label.toLowerCase()}`}
    </button>
  );
}

/**
 * Ready to upload: the MP4 and the YouTube text in the order Studio asks for them,
 * then the link back. Once uploaded: the link.
 */
function UploadPanel({
  id,
  script,
  post,
  connected,
  onDone,
}: {
  id: number;
  script: FableScript;
  post: FableDetail['post'];
  connected: boolean;
  onDone: () => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (post)
    return (
      <div className="rounded-2xl border border-line bg-panel p-4" data-testid="fables-uploaded-panel">
        <p className="font-semibold">On YouTube since {post.posted_at.slice(0, 10)}.</p>
        <a href={post.url} target="_blank" rel="noreferrer" className="mt-1 block break-all">
          {post.url}
        </a>
        {post.visibility !== 'public' && (
          <p className="mt-2 rounded-lg bg-dust-soft p-2 text-sm">YouTube shows it as {post.visibility}. Make it public in YouTube Studio.</p>
        )}
      </div>
    );

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      await fablesApi.publish(id);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const byHand = <ManualUpload id={id} script={script} url={url} setUrl={setUrl} busy={busy} setBusy={setBusy} setError={setError} onDone={onDone} />;

  return (
    <div className="rounded-2xl border border-line bg-panel p-4" data-testid="fables-upload">
      {connected ? (
        <>
          <button onClick={upload} disabled={busy} className="w-full rounded-lg bg-fox px-3 py-3 text-left font-bold text-bg disabled:opacity-40" data-testid="fables-publish">
            {busy ? 'Uploading…' : 'Upload to YouTube'}
            <span className="block text-xs font-normal opacity-80">Pocket Fables channel, Made for Kids, public</span>
          </button>
          {error && (
            <p className="mt-3 text-rust" role="alert">
              {error}
            </p>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted">Upload by hand instead</summary>
            <div className="mt-2">{byHand}</div>
          </details>
        </>
      ) : (
        <>
          <p className="mb-3 rounded-lg bg-dust-soft p-2 text-sm" data-testid="fables-not-connected">
            Not connected to YouTube yet. Run <code>npm run youtube:auth -- --channel fables</code> once, then reload this page to upload with one click.
          </p>
          {byHand}
          {error && (
            <p className="mt-3 text-rust" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Hand upload: download, copy the text into YouTube Studio, paste the link back. */
function ManualUpload({
  id,
  script,
  url,
  setUrl,
  busy,
  setBusy,
  setError,
  onDone,
}: {
  id: number;
  script: FableScript;
  url: string;
  setUrl: (s: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onDone: () => void;
}) {

  const file = `pocket-fables-${id}-${script.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.mp4`;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await fablesApi.markUploaded(id, url);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="fables-manual-upload">
      <a href={`/media/${id}/final.mp4`} download={file} className="block rounded-lg bg-fox px-3 py-3 font-bold text-bg no-underline" data-testid="fables-download">
        Download the video
        <span className="block break-all text-xs font-normal opacity-80">{file}</span>
      </a>
      <div className="mt-2 grid gap-2">
        <CopyButton label="Title" text={script.youtube.title} />
        <CopyButton label="Description" text={script.youtube.description} />
        <CopyButton label="Tags" text={script.youtube.tags.join(', ')} />
      </div>
      <p className="mt-3 text-sm text-muted">In YouTube Studio, upload it to Pocket Fables and set the audience to “Yes, it’s made for kids”.</p>
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block">
          <span className="font-semibold">Link to the Short</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://youtube.com/shorts/…"
            className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-ink placeholder:text-muted"
            data-testid="fables-youtube-url"
          />
        </label>
        <button type="submit" disabled={busy || !url.trim()} className="mt-2 w-full rounded-lg bg-ink px-4 py-2 font-bold text-bg disabled:opacity-40" data-testid="fables-mark-uploaded">
          Mark uploaded
        </button>
      </form>
    </div>
  );
}
