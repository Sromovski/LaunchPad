-- Launchpad schema (CLAUDE.md §5). Idempotent: safe to run on every open.

CREATE TABLE IF NOT EXISTS videos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  topic              TEXT NOT NULL,
  -- Which YouTube channel this video is for (src/channels.ts)
  channel            TEXT NOT NULL DEFAULT 'blast' CHECK (channel IN ('blast','wonder')),
  status             TEXT NOT NULL DEFAULT 'idea' CHECK (status IN (
                       'idea','researched','scripted','fact_checked','rendered','qa_passed',
                       'in_review','approved','changes_requested','rejected',
                       'scheduled','published','failed')),
  title              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  run_dir            TEXT,
  final_path         TEXT,
  duration_s         REAL,
  error              TEXT,
  -- Publishing text (drafted by qa-reviewer, edited by Thomas in the review site)
  description        TEXT,
  hashtags           TEXT CHECK (hashtags IS NULL OR json_valid(hashtags)),
  -- Thomas can hold an approved video back from automatic posting (e.g. superseded by a remake)
  do_not_post        INTEGER NOT NULL DEFAULT 0 CHECK (do_not_post IN (0,1)),
  do_not_post_reason TEXT,
  -- YouTube playlist for this video (from its TOPICS.md world section); NULL = the channel's default playlist
  playlist           TEXT,
  -- State-machine bookkeeping (see src/db/status.ts, docs/DECISIONS.md)
  revision_count     INTEGER NOT NULL DEFAULT 0,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  failed_from_status TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  nasa_id       TEXT NOT NULL,
  media_type    TEXT NOT NULL CHECK (media_type IN ('video','image','audio')),
  title         TEXT,
  description   TEXT,
  source_url    TEXT NOT NULL,
  credit        TEXT,
  date_created  TEXT,
  local_path    TEXT,
  rights_status TEXT NOT NULL DEFAULT 'needs_review'
                CHECK (rights_status IN ('clear','needs_review','rejected')),
  rights_note   TEXT,
  UNIQUE (video_id, nasa_id)
);

CREATE TABLE IF NOT EXISTS scripts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  hook          TEXT NOT NULL,
  body_json     TEXT NOT NULL CHECK (json_valid(body_json)),
  word_count    INTEGER,
  reading_grade REAL,
  created_by    TEXT,
  UNIQUE (video_id, version)
);

CREATE TABLE IF NOT EXISTS sources (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  ref      TEXT,           -- research.json source id (s1, s2…) that scripts cite
  url      TEXT NOT NULL,
  title    TEXT,
  excerpt  TEXT
);

CREATE TABLE IF NOT EXISTS fact_checks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  claim     TEXT NOT NULL,
  source_id INTEGER REFERENCES sources(id),
  verdict   TEXT NOT NULL CHECK (verdict IN ('supported','unsupported','unclear')),
  note      TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('approved','rejected','changes_requested')),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  step        TEXT NOT NULL,
  agent       TEXT,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  ok          INTEGER CHECK (ok IN (0,1)),
  log_path    TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_assets_video ON assets(video_id);
CREATE INDEX IF NOT EXISTS idx_runs_video ON runs(video_id);

-- Phase 3: one row per scheduled/manual headless run (src/cli/scheduled-run.ts)
CREATE TABLE IF NOT EXISTS automation_runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger            TEXT NOT NULL CHECK (trigger IN ('scheduled','manual')),
  channel            TEXT NOT NULL DEFAULT 'blast',
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at        TEXT,
  topic              TEXT,
  video_id           INTEGER REFERENCES videos(id),
  -- in_review = success; skip = nothing to do (queue full / no topics); the rest are failures
  outcome            TEXT CHECK (outcome IN ('running','in_review','skip','preflight_fail','failed','incomplete','timeout','locked','error')),
  duration_s         REAL,
  num_turns          INTEGER,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cost_usd_equiv     REAL,   -- API-equivalent cost reported by claude -p; not billed on the subscription
  permission_denials INTEGER,
  log_path           TEXT,
  error              TEXT
);

-- Phase 4 (started early for hand-posting): one row per platform post; prevents double posting.
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    INTEGER NOT NULL REFERENCES videos(id),
  platform    TEXT NOT NULL CHECK (platform IN ('youtube','facebook')),
  external_id TEXT NOT NULL,
  url         TEXT NOT NULL,
  method      TEXT NOT NULL CHECK (method IN ('manual','api')),
  -- what YouTube reports after upload; unaudited API projects are forced to private
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
  playlist_id TEXT,  -- set once the video was added to the channel playlist
  posted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (video_id, platform),
  UNIQUE (platform, external_id)
);
