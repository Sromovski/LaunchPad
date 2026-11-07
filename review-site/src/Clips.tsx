import { useCallback, useEffect, useState } from 'react';
import { STATUS_LABEL, clipsApi, type ClipDetail, type ClipSummary, type Decision } from './api';
import { go } from './App';

/**
 * Curious Clips tab (channels/clips/CLAUDE.md): stick figure reels made in stick-ai-shorts.
 * Gate 1, scripts, before anything is voiced. Gate 2, videos. Approving a video uploads it,
 * scheduled for the next open day, so the channel posts one a day. Not made for kids.
 */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Clips({ id, onChanged }: { id: number | null; onChanged: () => void }) {
  const [lists, setLists] = useState<{ scripts: ClipSummary[]; videos: ClipSummary[]; ready: ClipSummary[]; uploaded: ClipSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([clipsApi.list('script_review'), clipsApi.list('video_review'), clipsApi.list('approved'), clipsApi.list('uploaded')])
      .then(([s, v, a, u]) => {
        setLists({ scripts: s.videos, videos: v.videos, ready: a.videos, uploaded: u.videos });
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load, id]);

  const queue = lists ? [...lists.ready, ...lists.videos, ...lists.scripts] : [];
  if (id !== null)
    return (
      <Detail
        key={id}
        id={id}
        queue={queue}
        onChanged={() => {
          load();
          onChanged();
        }}
      />
    );
  if (error) return <p className="text-rust">Couldn't load Curious Clips: {error}</p>;
  if (!lists) return <p className="text-muted">Loading…</p>;
  const nothing = queue.length === 0 && lists.uploaded.length === 0;
  return (
    <div data-testid="clips-home">
      {nothing && <p className="text-muted">Nothing here yet. Videos and scripts arrive from the stick-ai-shorts project.</p>}
      {lists.ready.length > 0 && <Grid videos={lists.ready} heading="Ready to upload" blurb="You approved these, but they aren't on YouTube yet." testId="clips-ready" />}
      {lists.videos.length > 0 && <Grid videos={lists.videos} heading="Videos to review" blurb="Top to bottom is the suggested posting order. Each one you approve takes the next open day." testId="clips-videos" />}
      {lists.scripts.length > 0 && (
        <section className="mb-12" data-testid="clips-scripts">
          <h1 className="font-display text-3xl font-bold">Scripts to review</h1>
          <p className="mt-1 max-w-2xl text-muted">Nothing is voiced or rendered until you approve.</p>
          <ul className="mt-4 max-w-3xl divide-y divide-line border-y border-line">
            {lists.scripts.map((v) => (
              <li key={v.id}>
                <a href={`#/clips/v/${v.id}`} className="block py-3 font-display text-xl font-semibold">
                  {v.title ?? v.topic}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {lists.uploaded.length > 0 && (
        <section data-testid="clips-uploaded">
          <h2 className="font-display text-2xl font-semibold">On YouTube</h2>
          <ul className="mt-3 max-w-3xl divide-y divide-line border-y border-line">
            {lists.uploaded.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
                <a href={`#/clips/v/${v.id}`} className="font-display text-lg font-semibold">
                  {v.title ?? v.topic}
                </a>
                <span className="text-sm text-muted">{v.publish_at ? (new Date(v.publish_at) > new Date() ? `Goes public ${when(v.publish_at)}` : `Public since ${when(v.publish_at)}`) : 'Public'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Grid({ videos, heading, blurb, testId }: { videos: ClipSummary[]; heading: string; blurb: string; testId: string }) {
  return (
    <section className="mb-12" data-testid={testId}>
      <h1 className="font-display text-3xl font-bold">{heading}</h1>
      <p className="mt-1 max-w-2xl text-muted">{blurb}</p>
      <ol className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
        {videos.map((v) => (
          <li key={v.id}>
            <a href={`#/clips/v/${v.id}`} className="group block text-ink no-underline" data-testid={`clips-video-${v.id}`}>
              <video src={`/media/${v.id}/final.mp4#t=1`} preload="metadata" muted className="mb-3 aspect-[9/16] w-full rounded-2xl border border-line bg-panel object-cover group-hover:border-glow" />
              <span className="block font-display text-lg font-semibold leading-snug">{v.title ?? v.topic}</span>
              <span className="text-sm text-muted">
                {v.playlist}
                {v.duration_s ? `, ${Math.round(v.duration_s)} s` : ''}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(t.tagName));

type Mode = null | 'approve' | 'changes' | 'reject';
const DECISION: Record<Exclude<Mode, null>, Decision> = { approve: 'approved', changes: 'changes_requested', reject: 'rejected' };

function Detail({ id, queue, onChanged }: { id: number; queue: ClipSummary[]; onChanged: () => void }) {
  const [data, setData] = useState<ClipDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    clipsApi
      .detail(id)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const status = data?.video.status;
  const gate = status === 'video_review' ? 'video' : status === 'script_review' ? 'script' : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') setMode(null);
      if (k === 'j' || k === 'k') {
        const i = queue.findIndex((v) => v.id === id);
        const next = k === 'j' ? (i === -1 ? queue[0] : queue[i + 1]) : i > 0 ? queue[i - 1] : undefined;
        if (next) go(`#/clips/v/${next.id}`);
      }
      if (!gate) return;
      if (k === 'a') setMode('approve');
      else if (k === 'c') setMode('changes');
      else if (k === 'r') setMode('reject');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [id, queue, gate]);

  if (error) return <p className="text-rust">Couldn't load video {id}: {error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const done = () => {
    load();
    onChanged();
  };

  const upload = async () => {
    const r = await clipsApi.publish(id);
    return `Uploaded. YouTube makes it public by itself on ${when(r.scheduled_for)}.${r.playlist === 'failed' ? ' Adding it to the playlist failed; add it in YouTube Studio.' : ''}`;
  };

  const submit = async () => {
    if (!mode || !gate) return;
    setBusy(true);
    setError(null);
    try {
      if (gate === 'video') await clipsApi.reviewVideo(id, DECISION[mode], notes);
      else await clipsApi.reviewScript(id, DECISION[mode], notes, data.script_version);
      let text = mode === 'approve' ? 'Approved.' : mode === 'changes' ? 'Changes requested.' : 'Rejected.';
      if (gate === 'video' && mode === 'approve' && data.youtube_connected) {
        try {
          text = `Approved. ${await upload()}`;
        } catch (e) {
          // Approved either way; the upload can be retried from Ready to upload.
          text = `Approved, but the upload didn't work (${(e as Error).message}). Try again below.`;
        }
      }
      setMessage(text);
      setMode(null);
      done();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const { video, script } = data;
  return (
    <div className={`grid gap-8 ${data.has_video ? 'lg:grid-cols-[minmax(280px,340px)_1fr]' : ''}`}>
      {data.has_video && (
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="mx-auto mb-4 w-full max-w-[300px] rounded-[2.2rem] border-[10px] border-[#0a0e1c] bg-black shadow-2xl">
            <video src={`/media/${id}/final.mp4`} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-[1.5rem]" data-testid="clips-player" />
          </div>
        </aside>
      )}
      <article className="min-w-0" data-testid="clips-detail">
        <p className="text-muted">
          <a href="#/clips">Curious Clips</a> <span aria-hidden>/</span> {video.topic} <span aria-hidden>/</span> {STATUS_LABEL[video.status] ?? video.status}
          {video.revision_count > 0 ? `, revision ${video.revision_count} of 2` : ''}
        </p>
        <h1 className="mt-1 font-display text-4xl font-bold leading-tight">{data.draft.title || video.topic}</h1>

        <section className="mt-5 max-w-xl rounded-2xl border border-line bg-panel p-4">
          {message && (
            <p className="mb-3 font-semibold" role="status" data-testid="clips-message">
              {message}
            </p>
          )}
          {gate && mode === null && (
            <div className="grid gap-2">
              <button onClick={() => setMode('approve')} className="rounded-lg bg-glow px-3 py-3 text-left font-bold text-bg" data-testid="clips-approve">
                {gate === 'video' ? 'Approve' : 'Approve script'} <span className="text-xs font-normal opacity-80">key A</span>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMode('changes')} disabled={video.revision_count >= 2} className="rounded-lg bg-dust px-3 py-2.5 font-bold text-bg disabled:opacity-40" data-testid="clips-changes">
                  Request changes
                </button>
                <button onClick={() => setMode('reject')} className="rounded-lg bg-rust px-3 py-2.5 font-bold text-bg" data-testid="clips-reject">
                  Reject
                </button>
              </div>
            </div>
          )}
          {gate && mode === 'approve' && (
            <div>
              <p data-testid="clips-confirm-text">
                {gate === 'script'
                  ? 'Approve this script? Claude then voices and renders it, and the video comes back here. Nothing is posted.'
                  : data.youtube_connected
                    ? `Approve and upload to Curious Clips now? It stays private until ${when(data.next_slot)}, then YouTube makes it public. Not made for kids.`
                    : 'Approve this video? It moves to Ready to upload. YouTube isn’t connected yet, so nothing is posted.'}
              </p>
              <div className="mt-3 flex gap-2">
                <button onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-glow px-4 py-2 font-bold text-bg disabled:opacity-40" data-testid="clips-confirm">
                  {busy ? 'Working…' : 'Yes, approve'}
                </button>
                <button onClick={() => setMode(null)} className="rounded-lg border border-line px-4 py-2">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {gate && (mode === 'changes' || mode === 'reject') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className="block">
                <span className="font-semibold">{mode === 'changes' ? 'What should change?' : 'Reason (optional)'}</span>
                <textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} required={mode === 'changes'} className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-ink" data-testid="clips-notes" />
              </label>
              <div className="mt-2 flex gap-2">
                <button type="submit" disabled={busy || (mode === 'changes' && !notes.trim())} className={`flex-1 rounded-lg px-4 py-2 font-bold text-bg disabled:opacity-40 ${mode === 'changes' ? 'bg-dust' : 'bg-rust'}`} data-testid="clips-confirm">
                  {mode === 'changes' ? 'Request changes' : 'Reject'}
                </button>
                <button type="button" onClick={() => setMode(null)} className="rounded-lg border border-line px-4 py-2">
                  Cancel
                </button>
              </div>
            </form>
          )}
          {status === 'script_approved' && <p>Script approved. Claude voices and renders it, and the video comes back here for review.</p>}
          {(status === 'script_changes' || status === 'video_changes') && <p>Changes requested. Claude revises the script and it comes back here as a new version.</p>}
          {status === 'rejected' && <p>Rejected.</p>}
          {status === 'approved' && <ReadyToUpload data={data} id={id} upload={upload} onMessage={setMessage} onDone={done} />}
          {data.post && (
            <div data-testid="clips-posted">
              <a href={data.post.url} target="_blank" rel="noreferrer" className="break-all font-semibold">
                {data.post.url}
              </a>
              {data.post.publish_at && <p className="mt-1">{new Date(data.post.publish_at) > new Date() ? `Goes public by itself on ${when(data.post.publish_at)}.` : `Public since ${when(data.post.publish_at)}.`}</p>}
            </div>
          )}
        </section>

        {script && (
          <>
            <h2 className="mt-8 font-display text-2xl font-semibold">Script</h2>
            <ol className="mt-2 max-w-3xl space-y-2" data-testid="clips-script">
              {script.lines.map((l, i) => (
                <li key={i} className="text-lg leading-snug">
                  {l.speaker && <span className="font-semibold capitalize text-muted">{l.speaker === 'chatgpt' ? 'ChatGPT' : l.speaker}: </span>}
                  {l.text}
                </li>
              ))}
            </ol>
          </>
        )}

        <DraftEditor key={`${id}-${status}`} id={id} data={data} onSaved={load} />

        {data.reviews.length > 0 && (
          <>
            <h2 className="mt-8 font-display text-2xl font-semibold">Decisions so far</h2>
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
    </div>
  );
}

/** Upload with one click once connected. Otherwise, or if that fails, by hand in YouTube Studio. */
function ReadyToUpload({ data, id, upload, onMessage, onDone }: { data: ClipDetail; id: number; upload: () => Promise<string>; onMessage: (m: string) => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      onMessage(await fn());
      onDone();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="clips-ready-panel">
      {data.youtube_connected ? (
        <button onClick={() => void run(upload)} disabled={busy} className="w-full rounded-lg bg-glow px-3 py-3 text-left font-bold text-bg disabled:opacity-40" data-testid="clips-publish">
          {busy ? 'Uploading…' : 'Upload and schedule'}
          <span className="block text-xs font-normal opacity-80">Goes public {when(data.next_slot)}. Not made for kids.</span>
        </button>
      ) : (
        <p className="rounded-lg bg-dust-soft p-2 text-sm" data-testid="clips-not-connected">
          Not connected to YouTube yet. Add the channel ID, run <code>npm run youtube:auth -- --channel clips</code>, then restart the review site.
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-muted">Upload by hand instead</summary>
        <div className="mt-2 grid gap-2">
          <a href={`/media/${id}/final.mp4`} download={`curious-clips-${data.video.topic}.mp4`} className="rounded-lg border border-line px-3 py-2 font-semibold no-underline">
            Download the video
          </a>
          <p className="text-sm text-muted">Copy the text from "On YouTube" below. In YouTube Studio set the audience to “No, it’s not made for kids”, then paste the link here.</p>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/shorts/…" className="rounded-lg border border-line bg-bg p-2 text-ink" data-testid="clips-youtube-url" />
          <button
            disabled={busy || !url.trim()}
            onClick={() =>
              void run(async () => {
                await clipsApi.markUploaded(id, url);
                return 'Marked as uploaded.';
              })
            }
            className="rounded-lg bg-ink px-4 py-2 font-bold text-bg disabled:opacity-40"
            data-testid="clips-mark-uploaded"
          >
            Mark uploaded
          </button>
        </div>
      </details>
    </div>
  );
}

/** The YouTube text, editable until it's on YouTube. Shows exactly what will be sent. */
function DraftEditor({ id, data, onSaved }: { id: number; data: ClipDetail; onSaved: () => void }) {
  const [title, setTitle] = useState(data.draft.title);
  const [description, setDescription] = useState(data.draft.description);
  const [tags, setTags] = useState(data.draft.hashtags.join(', '));
  const [note, setNote] = useState<string | null>(null);
  const locked = data.video.status === 'uploaded';
  const save = () => {
    clipsApi
      .saveDraft(id, { title, description, hashtags: tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean) })
      .then(() => {
        setNote('Saved.');
        onSaved();
      })
      .catch((e: Error) => setNote(e.message));
  };
  return (
    <section className="mt-8 max-w-3xl" data-testid="clips-youtube">
      <h2 className="font-display text-2xl font-semibold">On YouTube</h2>
      {!locked && (
        <div className="mt-3 grid gap-3">
          <label className="block">
            <span className="font-semibold">Title</span>
            <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-ink" data-testid="clips-title" />
          </label>
          <label className="block">
            <span className="font-semibold">Description</span>
            <textarea value={description} rows={4} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-ink" />
          </label>
          <label className="block">
            <span className="font-semibold">Hashtags, separated by commas</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-ink" />
          </label>
          <div className="flex items-center gap-3">
            <button onClick={save} className="rounded-lg border border-line px-4 py-2 font-semibold" data-testid="clips-save-draft">
              Save text
            </button>
            {note && <span role="status">{note}</span>}
          </div>
        </div>
      )}
      <h3 className="mt-5 font-semibold text-muted">What YouTube gets</h3>
      <p className="mt-1 font-semibold">{data.youtube.title}</p>
      <p className="mt-1 max-w-[70ch] whitespace-pre-line" data-testid="clips-final-description">
        {data.youtube.description}
      </p>
      <p className="mt-2 text-sm text-muted">Audience: {data.youtube.made_for_kids ? 'Made for Kids' : 'Not made for kids'}. Category: Comedy.</p>
    </section>
  );
}
