import { seconds, type VideoSummary } from './api';

export function Queue({ videos, error }: { videos: VideoSummary[] | null; error: string | null }) {
  if (error) return <p className="text-rust">Couldn't load the queue: {error}. Is the database at data/launchpad.db?</p>;
  if (!videos) return <p className="text-muted">Loading…</p>;
  if (videos.length === 0) {
    return (
      <section className="py-16 text-center">
        <h1 className="font-display text-3xl font-bold">Nothing to review</h1>
        <p className="mt-2 text-muted">New videos land here after QA. Make one with /make-video in Claude Code.</p>
      </section>
    );
  }
  return (
    <section>
      <h1 className="font-display text-3xl font-bold">
        {videos.length} {videos.length === 1 ? 'video' : 'videos'} to review
      </h1>
      <p className="mt-1 text-muted">Newest first. Open one, then use A, C and R to decide, J and K to move.</p>
      <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-6" data-testid="queue">
        {videos.map((v) => (
          <li key={v.id}>
            <a href={`#/v/${v.id}`} className="group block text-ink no-underline" data-testid={`queue-item-${v.id}`}>
              {/* Portrait thumbnail: you're reviewing phone videos, so they look like phones here too. */}
              <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-panel group-hover:border-glow group-focus-visible:border-glow">
                <img src={`/media/${v.id}/thumb.png`} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
                {v.rights_warnings > 0 && (
                  <span className="absolute left-2 top-2 rounded-md bg-dust px-2 py-0.5 text-sm font-bold text-bg">
                    Check rights ({v.rights_warnings})
                  </span>
                )}
                {v.revision_count > 0 && (
                  <span className="absolute right-2 top-2 rounded-md bg-panel px-2 py-0.5 text-sm font-bold text-ink">Revision {v.revision_count}</span>
                )}
              </div>
              <h2 className="mt-3 font-display text-lg font-semibold leading-snug">{v.title ?? v.topic}</h2>
              <p className="text-sm text-muted">
                {seconds(v.duration_s)} <span aria-hidden>/</span> video {v.id}
              </p>
              {v.title && v.title !== v.topic && <p className="text-sm text-muted">{v.topic}</p>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
