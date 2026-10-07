import { useEffect, useState } from 'react';

interface Run {
  id: number;
  trigger: string;
  channel: string;
  channel_title: string;
  started_at: string;
  topic: string | null;
  video_id: number | null;
  outcome: string | null;
  error: string | null;
}

const SAY: Record<string, string> = {
  running: 'is running now',
  in_review: 'made a video',
  skip: 'skipped',
  locked: 'skipped (another run was going)',
  preflight_fail: 'could not start',
  failed: 'failed',
  incomplete: 'stopped before review',
  timeout: 'timed out',
  error: 'crashed',
};

/** One line per channel about its last automatic run, so a failed run is obvious the moment the queue opens. */
export function RunHealth({ channel }: { channel: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    fetch('/api/automation')
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d: { runs: Run[] }) => setRuns(d.runs))
      .catch(() => setRuns([]));
  }, []);
  if (!runs || runs.length === 0) return null;

  // Newest first from the API: the first run seen per channel is its latest.
  const latest = new Map<string, Run>();
  for (const r of runs) if (!latest.has(r.channel) && (!channel || r.channel === channel)) latest.set(r.channel, r);
  const several = new Set(runs.map((r) => r.channel)).size > 1;
  return (
    <>
      {[...latest.values()].map((last) => {
        const bad = !['in_review', 'skip', 'locked', 'running'].includes(last.outcome ?? '');
        const when = `${last.started_at.slice(5, 16).replace(' ', ' at ')} UTC`;
        return (
          <p key={last.channel} className={`mt-2 ${bad ? 'font-semibold text-rust' : 'text-muted'}`} data-testid="run-health">
            Last automatic run{several ? ` for ${last.channel_title}` : ''} ({when}) {SAY[last.outcome ?? ''] ?? last.outcome}
            {last.topic ? `: ${last.topic}` : ''}
            {last.video_id && last.outcome === 'in_review' ? ` (video ${last.video_id})` : ''}
            {bad && last.error ? `. ${last.error.slice(0, 160)}` : '.'}
          </p>
        );
      })}
    </>
  );
}
