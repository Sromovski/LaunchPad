export interface VideoSummary {
  id: number;
  /** Channel key (blast | wonder) and its display name. */
  channel: string;
  channel_title: string;
  topic: string;
  status: string;
  title: string | null;
  duration_s: number | null;
  created_at: string;
  updated_at: string;
  revision_count: number;
  rights_warnings: number;
  last_review: string | null;
}

export interface Source {
  ref: string;
  url: string;
  title: string;
  excerpt: string;
}

export interface Detail {
  video: VideoSummary & { final_path: string | null; description: string | null; error: string | null };
  script: {
    title: string;
    hook: string;
    hook_source_ids?: string[];
    lines: { text: string; source_ids: string[] }[];
    end_question: string;
    version: number;
    word_count: number;
    reading_grade: number;
  } | null;
  sources: Source[];
  fact_checks: { claim: string; verdict: string; note: string | null; source_ref: string | null; source_url: string | null }[];
  assets: { nasa_id: string; media_type: string; title: string | null; source_url: string; credit: string | null; rights_status: string; rights_note: string | null }[];
  rights_needed: { nasa_id: string; credit: string | null }[];
  qa: { pass: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null;
  draft: Draft;
  reviews: { id: number; decision: string; notes: string | null; created_at: string }[];
  has_video: boolean;
  posts: { platform: string; url: string; method: string; posted_at: string }[];
  segments: { index: number; text: string; start_s: number; end_s: number }[];
  bonus:
    | { title: string; credit: string | null; date_text: string; page: string; asset_id: string; start_s: number; skipped: null }
    | { skipped: string }
    | null;
}

export interface Draft {
  title: string;
  description: string;
  hashtags: string[];
}

export type Decision = 'approved' | 'changes_requested' | 'rejected';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  list: (status: string, q = '', channel = '') =>
    call<{ videos: VideoSummary[] }>(`/api/videos?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&channel=${encodeURIComponent(channel)}`),
  channels: () => call<{ channels: { key: string; title: string }[] }>('/api/channels'),
  detail: (id: number) => call<Detail>(`/api/videos/${id}`),
  saveDraft: (id: number, d: Draft) => call<{ draft: Draft }>(`/api/videos/${id}/draft`, { method: 'PATCH', body: JSON.stringify(d) }),
  review: (id: number, decision: Decision, notes: string, rights_checked: boolean) =>
    call<{ review_id: number }>(`/api/videos/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, notes, rights_checked }) }),
};

// ---- Pocket Fables (channels/fables/CLAUDE.md §3) --------------------------------

export interface FableScene {
  n: number;
  seconds: number;
  narration: string;
  visuals: string;
  on_screen_text: string;
}

export interface FableScript {
  video_id: string;
  title: string;
  lane: 'folktale' | 'bedtime' | 'lesson';
  origin: string;
  lesson: string;
  narrator: string;
  visual_style: string;
  est_seconds: number;
  word_count: number;
  scenes: FableScene[];
  youtube: { title: string; description: string; tags: string[]; made_for_kids: true };
}

export interface FableSummary {
  id: number;
  topic: string;
  title: string | null;
  status: string;
  revision_count: number;
  updated_at: string;
  version: number | null;
  lane: string | null;
  origin: string | null;
  word_count: number | null;
  lesson: string | null;
  est_seconds: number | null;
  scene_count: number | null;
  last_review: string | null;
}

export interface FableDetail {
  video: { id: number; topic: string; title: string | null; status: string; revision_count: number; error: string | null; updated_at: string };
  script: FableScript | null;
  script_version: number | null;
  script_versions: number;
  script_by: string | null;
  script_problem: string | null;
  warnings: string[];
  est_seconds: number | null;
  reviews: { id: number; gate: 'script' | 'video'; decision: string; notes: string | null; created_at: string }[];
}

export const fablesApi = {
  list: (status = 'script_review') => call<{ videos: FableSummary[] }>(`/api/fables/videos?status=${encodeURIComponent(status)}`),
  counts: () => call<{ counts: Record<string, number> }>('/api/fables/counts'),
  detail: (id: number) => call<FableDetail>(`/api/fables/videos/${id}`),
  reviewScript: (id: number, decision: Decision, notes: string, version: number | null) =>
    call<{ review_id: number }>(`/api/fables/videos/${id}/script-review`, {
      method: 'POST',
      body: JSON.stringify({ decision, notes, ...(version ? { version } : {}) }),
    }),
};

export const STATUS_LABEL: Record<string, string> = {
  script_review: 'Script waiting for review',
  script_approved: 'Script approved, waiting for Everygen',
  script_changes: 'Script changes requested',
  rendering: 'Rendering in Everygen',
  video_review: 'Video waiting for review',
  video_changes: 'Video changes requested',
  uploaded: 'Uploaded',
  in_review: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
};

export const seconds = (s: number | null) => (s == null ? '' : `${Math.round(s)} s`);
