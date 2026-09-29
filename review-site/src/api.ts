export interface VideoSummary {
  id: number;
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
  list: (status: string, q = '') => call<{ videos: VideoSummary[] }>(`/api/videos?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`),
  detail: (id: number) => call<Detail>(`/api/videos/${id}`),
  saveDraft: (id: number, d: Draft) => call<{ draft: Draft }>(`/api/videos/${id}/draft`, { method: 'PATCH', body: JSON.stringify(d) }),
  review: (id: number, decision: Decision, notes: string, rights_checked: boolean) =>
    call<{ review_id: number }>(`/api/videos/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, notes, rights_checked }) }),
};

export const STATUS_LABEL: Record<string, string> = {
  in_review: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
};

export const seconds = (s: number | null) => (s == null ? '' : `${Math.round(s)} s`);
