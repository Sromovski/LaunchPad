# CLAUDE.md — Project "Launchpad"

> Codename **Launchpad**. Two YouTube channels, both Brand Accounts under Thomas's Google login, both Made for Kids, running side by side:
> - **Blast of Facts** (space; renamed from Story_Clips). Key `blast`, topics in `docs/TOPICS.md`.
> - **I Wonder Why** (@I_Wonder_Why; our planet seen with NASA footage, added 2026-10-07). Key `wonder`, topics in `docs/TOPICS_WONDER.md`.
>
> Each video belongs to one channel (`videos.channel`). Per-channel settings (YouTube ID, login file, playlists, schedule, colours, voice, outro) live in `src/channels.ts`; commands take `--channel blast|wonder` (default `blast`).
> Channel decisions, brand colors, future sources and topics: see `docs/ROADMAP.md`. Read it when relevant; don't build its "Later" items until Phases 1–4 are done and Thomas says go.
>
> This is a standalone project (not part of Lantern).

## 1. Mission

Build a local, mostly autonomous pipeline that turns **public-domain NASA footage** into short vertical science videos for **kids ages 6–10**, queues them for **human review on a local website**, and (later) posts approved videos to **two platforms**.

- **Start:** ONE Mars video, end to end, done well.
- **Eventually:** 2 videos/day, produced by cooperating Claude Code subagents, waiting in a review queue.
- **Never:** publish anything without Thomas clicking Approve.

## 2. Ground rules (read before every task)

1. **$0 budget.** Only free, local, or free-tier tools. The one existing cost is Thomas's Claude subscription (Claude Code). If a task seems to need a paid service, STOP and tell Thomas instead of adding it.
2. **Simple first.** Build the smallest thing that works, test it, then extend. No queues, containers, cloud hosting, or microservices until a phase explicitly calls for them.
3. **Code does mechanics, agents do judgment.** Deterministic work (API calls, downloads, ffmpeg, DB writes, validation) lives in TypeScript CLI scripts. Subagents decide *what* to make and *whether it's good*, and call those scripts. Never have an agent hand-type ffmpeg commands that a script should own.
4. **Rights first.** Every asset must have its source URL, NASA ID, and credit line stored before it's used. Unclear rights → flag for human review, never guess.
5. **Facts traced to sources.** Every factual sentence in a script must map to a NASA source URL stored in the DB. Unsupported claims get cut.
6. **Human approval gate is absolute.** No code path may publish a video whose status is not `approved`.
7. **Ask Thomas when blocked** on anything requiring accounts, credentials, installs, or money. Keep a running list in `docs/NEEDS_FROM_THOMAS.md`.

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript on Node.js 20+ | Thomas's primary stack |
| Package manager | npm | Keep it simple |
| DB | SQLite via `better-sqlite3` | Local, zero setup |
| Validation | `zod` | Validate every agent JSON output and API response |
| NASA media | NASA Image and Video Library API `https://images-api.nasa.gov` | Free, no API key |
| Voiceover | `kokoro-js` (Kokoro-82M, runs locally) | Free, good quality, Node-native. Fallback: Piper TTS |
| Word timings for captions | whisper.cpp (local), via a thin Node wrapper | Free, word-level timestamps |
| Video assembly | ffmpeg (system install) + ASS subtitles | Free, deterministic |
| Review site | Vite + React + Tailwind (frontend), Hono (API) | Modern, light, one `npm run dev` |
| Tests | Vitest (unit), Playwright (review UI e2e) | Free |
| Scheduling (Phase 3) | Claude Code headless (`claude -p`) triggered by cron / launchd / Task Scheduler | Uses existing subscription |

Do not add a dependency without stating why in the commit message.

## 4. Directory layout

```
launchpad/
├── CLAUDE.md
├── .claude/
│   ├── agents/            # subagent definitions (generated in Phase 0 from §7)
│   └── skills/            # entry-point skills, e.g. make-video (see §8)
├── docs/
│   ├── NEEDS_FROM_THOMAS.md
│   └── DECISIONS.md       # short log of design decisions
├── src/
│   ├── db/                # schema.sql, migrations, typed queries
│   ├── nasa/              # search, metadata, download, credit checker
│   ├── script/            # script schema + validators (reading level, word count)
│   ├── media/             # tts, align (whisper), captions (ASS), render (ffmpeg)
│   ├── qa/                # automated checks on rendered output (ffprobe etc.)
│   ├── publish/           # Phase 4 only
│   └── cli/               # one entry file per pipeline step (see §6)
├── review-site/           # Vite + React + Tailwind app, Hono API in review-site/server
├── runs/<video_id>/       # all working files for one video (gitignored)
├── data/launchpad.db      # SQLite (gitignored)
└── tests/
```

## 5. Data model (SQLite)

Keep it to these tables until a phase needs more.

- **videos** — `id`, `topic`, `status`, `title`, `created_at`, `updated_at`, `run_dir`, `final_path`, `duration_s`, `error`
- **assets** — `id`, `video_id`, `nasa_id`, `media_type` (video|image|audio), `title`, `description`, `source_url`, `credit`, `date_created`, `local_path`, `rights_status` (clear|needs_review|rejected), `rights_note`
- **scripts** — `id`, `video_id`, `version`, `hook`, `body_json` (array of lines, each with `text` and `source_ids`), `word_count`, `reading_grade`, `created_by` (agent name)
- **sources** — `id`, `video_id`, `url`, `title`, `excerpt` (short, for fact-check evidence)
- **fact_checks** — `id`, `script_id`, `claim`, `source_id`, `verdict` (supported|unsupported|unclear), `note`
- **reviews** — `id`, `video_id`, `decision` (approved|rejected|changes_requested), `notes`, `created_at`
- **runs** — `id`, `video_id`, `step`, `agent`, `started_at`, `finished_at`, `ok`, `log_path`

### Status state machine

```
idea → researched → scripted → fact_checked → rendered → qa_passed → in_review
in_review → approved → (Phase 4) scheduled → published
in_review → changes_requested → scripted (loop, max 2 revisions, then rejected)
in_review → rejected
any step failure → failed (with error), retryable once automatically; after that only Thomas can reset it (`npm run video:reset -- --video <id> --reason "..."`, denied to agents), e.g. when the failure was a pipeline bug that has been fixed
```

Implement transitions in one module (`src/db/status.ts`) that throws on illegal moves. Unit-test it thoroughly.

## 6. Pipeline steps (deterministic CLI scripts)

Each is `npm run <name> -- --video <id> [...]`, idempotent, logs to `runs/<id>/logs/`, and writes a JSON summary to stdout.

1. `nasa:search -- --query "mars sunset" --type video` → candidate list (nasa_id, title, credit, duration if known, preview URL). No downloads.
2. `nasa:fetch -- --video <id> --nasa-id <nasa_id>` → downloads best file from the asset manifest, stores metadata + credit, runs **credit checker**.
3. `script:validate -- --video <id>` → checks word count, reading grade, every line has ≥1 source, hook present, ending question present.
4. `media:tts -- --video <id>` → Kokoro voiceover → `runs/<id>/voice.wav`.
5. `media:align -- --video <id>` → whisper.cpp word timings → `runs/<id>/words.json`.
6. `media:captions -- --video <id>` → ASS subtitle file (big, bold, 2–4 words per caption, active word highlighted).
7. `media:render -- --video <id>` → final MP4 (spec below).
8. `qa:check -- --video <id>` → automated checks (below). Pass → `qa_passed` → `in_review`.

### Credit checker rules
- **clear:** credit is exactly or only `NASA`, `NASA/JPL`, `NASA/JPL-Caltech`, `NASA/GSFC`, `NASA/JSC`, `NASA/KSC`, `NASA/MSFC` (keep this allowlist in `src/nasa/credits.ts`).
- **needs_review:** any additional co-credit (universities, `MSSS`, `ESA`, `STScI`, photographers, companies) or no credit at all.
- **rejected:** credit mentions ESA-only, a news agency (AP, Reuters, Getty), or a named private photographer as sole owner.
- Also flag if the description contains "courtesy of", "©", or "used with permission".
- `needs_review` assets may still be rendered, but the review site must show a prominent rights warning and require Thomas to tick "rights checked" before Approve is enabled.

### Video output spec
- 1080×1920, 30 fps, H.264 (yuv420p), AAC 48 kHz, loudness normalized to about −14 LUFS.
- Length **30–60 s** including the bonus outro. Hook on screen and spoken within the first 2 s.
- Captions burned in, inside safe zones: nothing important in the bottom 20% or right 12% (platform UI overlaps).
- Landscape NASA footage: scale to fill height with a gentle pan, OR blurred-background letterbox — pick per clip, default to blurred background.
- Still images: slow Ken Burns zoom (max 1.15×).
- On-screen credit line, small, top area, whole video: e.g. `Footage: NASA/JPL-Caltech`.
- End card (3 s): the closing question in large text.
- Bonus outro after the end card (`media:bonus`): "And now… for your space picture of the day!" + the newest NASA Image of the Day not used before, with its credit. Chosen when the video is made and reviewed with it; it's an asset like any other (credit checker, rights gate). Left off if it would push the video past 60 s or nothing usable is in the feed.
- No NASA logos/insignia added by us. No music in v1.

### Automated QA checks (`qa:check`)
Duration in range, resolution/codec/fps correct, audio present and not clipped, caption file exists and covers ≥95% of spoken words, credit text present in the render config, script validated, all fact checks `supported`, no asset `rejected`. Write results to `runs/<id>/qa.json`.

## 7. Subagents (source of truth for `.claude/agents/*.md`)

Each agent reads/writes JSON files in `runs/<id>/` and calls CLI scripts. Every agent output is validated with zod before the orchestrator advances status. Keep agent prompts short and specific.

**researcher**
- Goal: pick the best footage + gather facts for the topic.
- Does: runs `nasa:search` with 3–5 query variants, picks 1 primary clip (+ up to 3 supporting clips/images), runs `nasa:fetch`, collects 3–8 NASA source pages (nasa.gov, science.nasa.gov, jpl.nasa.gov, mars.nasa.gov) with short excerpts.
- Output: `research.json` → `{ primary_asset, supporting_assets[], sources[], kid_angle, surprising_fact }`.
- Rule: prefers footage over stills; prefers credits that pass the checker.

**scriptwriter**
- Goal: 90–130 word voiceover for ages 6–10.
- Style: hook question first ("Did you know sunsets on Mars are BLUE?"), one big idea, one everyday comparison kids know, one "wow" number made relatable, end with a question for kids to answer in their head. Short sentences. Warm, curious, never scary or sarcastic. No slang that will date. Grade 2–4 reading level.
- Output: `script.json` → `{ title, hook, lines: [{ text, source_ids[] }], end_question, on_screen_text[] }`, then runs `script:validate`.
- Rule: no fact without a `source_id` from `research.json`.

**fact-checker**
- Goal: independently verify every claim.
- Does: splits the script into atomic claims, checks each against stored source excerpts (and re-fetches the source page if needed). Flags simplifications that become *wrong* (simplifying is fine, false is not).
- Output: `factcheck.json` → claims with verdicts. Any `unsupported` → send back to scriptwriter with notes (max 2 loops).

**producer**
- Goal: turn approved script + assets into the MP4.
- Does: runs `media:tts` → `media:align` → `media:captions` → `media:render`. Chooses clip timing so visuals match what's being said.
- Output: `render.json` → `{ final_path, duration_s, edit_decisions[] }`.

**qa-reviewer**
- Goal: final gatekeeper before the human queue.
- Does: runs `qa:check`, extracts 6 frames with ffmpeg and inspects them (caption legibility, safe zones, nothing broken), sanity-checks title and description for kids.
- Output: `qa-review.json` → pass/fail with reasons, plus a draft **title**, **description** (credits + sources + AI-voice disclosure line), and **3–5 hashtags**.

**publisher** *(Phase 4 only — do not create earlier)*
- Posts `approved` videos only, to the two platforms, then records post IDs/URLs.

## 8. Orchestration

- Create a project skill `.claude/skills/make-video/SKILL.md`. Invoked as `/make-video <topic>` (or no topic = take next from `topics` backlog file `docs/TOPICS.md`).
- The main session is the orchestrator: create `videos` row → researcher → scriptwriter → fact-checker (loop) → producer → qa-reviewer → set `in_review`. Log each step in `runs`.
- On any failure: record error, retry that step once, then mark `failed` and stop. Never skip a step.
- Create a second skill `/revise-video <id>` that reads the latest `changes_requested` review notes and re-runs from the scriptwriter (or producer, if notes are only about visuals).

## 9. Review site (local)

Run with `npm run review` → opens `http://launchpad.localhost`. Local only, no auth.

Must-haves:
- **Queue view:** cards for videos `in_review`, newest first, with thumbnail, title, duration, topic, and badges (rights warning, revision count).
- **Detail view:** 9:16 player (phone-sized frame), script with each line's sources as clickable links, fact-check table, asset credits + NASA links, QA results, and the draft title/description/hashtags (editable).
- **Actions:** Approve, Request changes (required notes box), Reject (optional reason). Keyboard shortcuts: `A` approve, `C` changes, `R` reject, `J/K` next/prev.
- **Rights gate:** if any asset is `needs_review`, Approve is disabled until "I checked the rights" is ticked.
- **History tab:** approved/rejected/published with filters.
- Modern and clean: dark mode by default, light mode toggle, responsive, large readable type. Use the `frontend-design` skill if installed.
- Server serves video files from `runs/` with range requests so scrubbing works.

## 10. Phases and definition of done

Do phases in order. Don't start the next until the current one's DoD passes and Thomas says go.

### Phase 0 — Setup and verification
- Init repo, TypeScript, lint, Vitest, folder layout, SQLite schema + status machine with tests.
- Verify tools: `node -v` (≥20), `ffmpeg -version`, whisper.cpp binary + small English model, `kokoro-js` generates a test WAV.
- Generate `.claude/agents/*.md` (all except publisher) and `.claude/skills/make-video` from §7–8.
- Write `docs/NEEDS_FROM_THOMAS.md` with anything missing.
- **DoD:** `npm test` green; `npm run doctor` prints ✅ for every tool.

### Phase 1 — One Mars video, end to end
- Build CLI steps 1–8 with unit tests (credit checker, script validator, caption generator, state machine).
- Run each step **manually** first, then via the agents, then via `/make-video`.
- **First topic: "Why are sunsets on Mars blue?"**
  - Search ideas: `mars sunset`, `curiosity sunset`, `gale crater sunset`, `perseverance sunset`, `blue sunset mars`.
  - Expect co-credits (e.g. MSSS) → this is a good real test of the rights-review flow.
  - Backup topics if footage is weak: Phobos eclipsing the Sun (seen from Perseverance), Mars dust devils, Ingenuity helicopter flights, Olympus Mons size.
- **DoD:** one MP4 in `runs/` meeting the §6 spec, all QA checks pass, Thomas has watched it and signed off on style (or given notes that were applied).

### Phase 2 — Review site
- Build §9. Playwright tests for: queue loads, video plays, approve/changes/reject update the DB, rights gate blocks approval.
- **DoD:** Thomas reviews the Phase 1 video entirely through the site.

### Phase 3 — Reliability and autonomy
- Produce 5 videos on 5 different Mars topics with `/make-video`. Track failure rate, time per video, and Claude usage per run in `docs/RUN_LOG.md`.
- Harden failure spots. Add `docs/TOPICS.md` backlog (Mars first, ~20 topics).
- Headless run: `claude -p "/make-video"` with a lockfile so two runs never overlap. Schedule 2 runs/day (cron/launchd on Mac, Task Scheduler on Windows). Scheduled runs only fill the review queue.
- **DoD:** 5 consecutive scheduled runs succeed with no manual fixes; quality holds up in review.

### Phase 4 — Publishing to two platforms
- Default platforms: **YouTube Shorts** and **Facebook Reels** (confirm with Thomas before building).
- YouTube: Data API v3 `videos.insert`, set `status.selfDeclaredMadeForKids: true`. Note free quota (10,000 units/day; one upload ≈ 1,600) and that uploads from an unaudited API project stay **private** until Google's free API audit is approved.
- Facebook: Graph API Reels publishing to Thomas's Page with a Page access token.
- Approved videos get a scheduled post time; a daily job posts them and writes post URLs back to the DB.
- **DoD:** one approved video posted to both platforms from the queue, with URLs shown in the review site.

## 11. Kids' content and platform rules

- YouTube channels: **Blast of Facts** and **I Wonder Why** (separate Brand Accounts, never Thomas's main channel). Set each channel's audience to Made for Kids. Channel names/logos must not include "NASA".
- A posting run is signed in to exactly one channel and only ever touches that channel's videos. Topics must not repeat across the two channels (YouTube's repetitive-content rules).
- YouTube: mark every video **Made for Kids**. Expect comments off and lower ad revenue; that's accepted.
- Description always includes: footage credit(s), source links, and "Narration voice is AI-generated."
- No personal data collection, no calls to comment, no links to external sites in the video itself.
- Reused-content policy: our value-add is the kid-level explanation, narration, captions, and editing. Never post raw NASA clips unedited.
- Never imply NASA endorsement. Never add NASA logos.

## 12. Working style for Claude Code

- Before a phase: write a short plan, list files to touch, and wait for "go."
- Small commits with clear messages. Update `docs/DECISIONS.md` for any design choice.
- After every change: run `npm test`; for media changes, render a test clip and run `qa:check`.
- Prefer boring, readable code over clever code. Comment the *why*.
- If something needs money, an account, credentials, or an install: add it to `docs/NEEDS_FROM_THOMAS.md` and ask.
