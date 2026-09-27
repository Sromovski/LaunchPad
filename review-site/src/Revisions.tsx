import { useEffect, useState } from 'react';
import { api, type VideoSummary } from './api';

/** Videos Thomas sent back: shows they're waiting, not lost, and when his notes get applied. */
export function Revisions() {
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  useEffect(() => {
    api
      .list('changes_requested')
      .then((r) => setVideos(r.videos))
      .catch(() => setVideos([]));
  }, []);
  if (videos.length === 0) return null;
  return (
    <section className="mt-10" data-testid="revisions">
      <h2 className="font-display text-2xl font-semibold">Being revised</h2>
      <p className="text-muted">
        Your notes are applied at the next automatic run (7:00 or 15:00), before any new video is made. The revised video comes back to this queue.
      </p>
      <ul className="mt-3 space-y-2">
        {videos.map((v) => (
          <li key={v.id} className="rounded-lg border border-line p-3">
            <a href={`#/v/${v.id}`} className="font-semibold text-ink">
              {v.title ?? v.topic}
            </a>{' '}
            <span className="text-muted">video {v.id}, revision {v.revision_count + 1} of 2</span>
            {v.last_review && <span className="ml-2 text-sm text-muted">requested {v.last_review.split('|')[1]?.slice(0, 16)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
