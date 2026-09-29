# Decisions

Short log of design choices. Newest last.

## 2026-09-26 — Phase 0

- **Node 26 + better-sqlite3 works.** The prebuilt binary loads (SQLite 3.53.4), so no switch to `node:sqlite` was needed.
- **ESM + `tsx`, no build step.** CLI scripts run straight from TypeScript. `tsc --noEmit` is typecheck only.
- **Extra `videos` columns: `revision_count`, `retry_count`, `failed_from_status`.** The state machine needs them to enforce "max 2 revisions" and "retry once, back to the step that failed". Storing them is simpler than deriving them from `reviews`/`runs` on every check.
- **State machine details** (`src/db/status.ts`):
  - `changes_requested → scripted` (script notes) or `→ fact_checked` (visual-only notes; re-runs the producer). Both count as one revision.
  - After 2 revisions, `in_review → changes_requested` throws. The reviewer must approve or reject.
  - Any non-terminal status can go to `failed`. `failed` can go back only to the status it came from, once. `failed → rejected` is always allowed.
  - `rejected` and `published` are terminal.
- **Assets default to `rights_status = needs_review`** at the DB level, so a missed credit check can never mean "clear".
- **whisper.cpp lives in `tools/whisper/` (gitignored).** Prebuilt `whisper-bin-x64.zip` b5130 + `ggml-base.en`. Override with `WHISPER_BIN` / `WHISPER_MODEL`. It needs 16 kHz mono WAV, so `media:align` will resample with ffmpeg first (the doctor already does this).
- **ffmpeg lookup order:** `FFMPEG_PATH` → PATH → winget package folder (winget often doesn't update PATH for open shells).
- **Kokoro:** `onnx-community/Kokoro-82M-v1.0-ONNX`, `dtype: q8`, voice `af_heart` for now (style choice in Phase 1). Synthesis takes ~14 s for one sentence on first run, including the model download.
- **`npm audit`: 3 high findings in `sharp`** (libvips/libheif), pulled in by `kokoro-js` → `@huggingface/transformers`. No fix is available. Accepted because we never pass images to sharp; transformers only uses it for image pipelines. Re-check when kokoro-js updates.
- **CLI scripts beyond §6 that the agents/skill expect (to build in Phase 1):** `video:new`, `video:status`, `run:start`, `run:finish`, `agent:validate` (zod schemas for each agent output), `qa:frames` (extract 6 frames). These keep "code does mechanics": agents never touch the DB or ffmpeg directly. The producer writes `edit.json` (clip timing choices) for `media:render` to read.

## 2026-09-26 — Phase 1 (build)

- **Credit aliases approved by Thomas:** exact spelled-out forms ("NASA's Jet Propulsion Laboratory", "NASA Goddard", …) normalize to their allowlisted short form. Anything else stays `needs_review`.
- **Credit checker also reads `Credit:` lines in the description** and the strictest verdict wins. Real JPL videos list `photographer: NASA's Jet Propulsion Laboratory` but the description credits universities and people.
- **Private photographer rule:** we can't tell NASA staff from private photographers by name. So a credit with ©/copyright and no NASA is `rejected`; a bare person name with no NASA is `needs_review` (a human decides).
- **Source domains:** any `https://*.nasa.gov` host (superset of the four in §7; includes photojournal.jpl.nasa.gov and images.nasa.gov). Checked with a strict hostname suffix, not a substring.
- **`sources.ref`** (s1, s2…) added so scripts and fact checks can cite research sources. Added via a tiny additive migration in `openDb`.
- **Every script line needs ≥1 source** (CLAUDE.md §6 wins over my first scriptwriter prompt). Optional `hook_source_ids` for a factual hook.
- **Script rules in code:** 90–130 words over hook+lines+end question; Flesch-Kincaid ≤ 4.5; hook ≤ 10 words (≈2 s); no sentence > 18 words; no links or calls to action. The syllable counter is a heuristic (e.g. "curiosity" → 4), good enough for a threshold.
- **`script:validate` writes `script-validation.json` with the script's sha256**, so `qa:check` can confirm the rendered script is the validated one.
- **No real Mars-sunset video exists in the NASA library** → the first video uses stills (approved by Thomas). The "Sunset Sequence Animation" (PIA19401) is stored only as a JPG.
- **TTS per segment:** hook, each line and the end question are spoken separately, trimmed, and joined with 350 ms pauses (150 ms lead-in so the hook starts at 0.15 s). Exact line timings come for free; whisper is only needed for word timings. Speed 0.95 for young listeners.
- **Alignment keeps script spelling:** whisper words are LCS-matched onto script words (edit distance or same consonant skeleton, so "Gail" ↔ "Gale"). Missed words are interpolated inside their TTS segment. Video 1 matched 126/126.
- **Timeline:** end card starts when the closing question starts and lasts ≥ 3 s (at least 1 s of air after the voice). Its words show on the end card instead of as karaoke captions. Deviation from "last 3 s" only in that the card can run slightly longer than 3 s.
- **Credit line is per clip** (shows the credit of what's on screen, all video long), labelled `Image:` or `Footage:`.
- **Captions:** Fredoka Bold 92 px, white with a thick black outline, current word in yellow (#FFD23F). Bottom-centre with MarginV 554 px (bottom edge ≈ y 1366, well above the 1536 px unsafe line), MarginR 170 px (> 130 px unsafe band).
- **Render:** crossfades of 0.4 s (clips are extended so the timeline stays exact); still images get 4 px edges shaved (InSight JPEGs have coloured border rows); output converted to TV range (NASA JPEGs are full-range `yuvj420p` and QA flagged it). Filter graph goes in `filter.txt` and ffmpeg runs from the run dir so paths in the graph have no Windows drive letters.
- **Soft-still warning:** `normalizeEdit` warns when `kenburns`/`pan` would upscale a still more than 1.6×. Video 1 accepts one (the 4884×958 Perseverance panorama pans at 2.0×; fitting its width would leave a thin strip).
- **QA thresholds:** −14 LUFS ±2, peak ≤ −0.5 dBFS, coverage ≥ 95%, hook starts ≤ 2 s, fact checks must exist and all be `supported`, script.json must match both its validation hash and the fact-checked DB version. `needs_review` rights do not fail QA; they're surfaced as `rights_warnings` for the human gate.
- **Voice pace (Thomas, 2026-09-27):** "slightly fast, slow by ~10%". Kokoro speed 0.95 → 0.86 and inter-line pause 350 → 400 ms so the whole video slows evenly (video 1: 38.75 s → 42.1 s of voice). Voice `af_heart` confirmed. TTS cache key now includes pause settings.
- **Focus + zoom for stills (Thomas asked to zoom in on the sun):** `edit.json` clips take `focus {x,y}` (fractions of the picture) and `zoom` (≤ 1.15, the §6 cap). blur_bg stills now zoom *inside* a fixed picture box instead of the box growing.
- **Bug fixed:** ffmpeg `crop` reads `iw/ih` once at startup, so offsets like `(iw-ow)/2` were always 0 after a per-frame `scale` and every zoom was anchored top-left. Offsets are now computed from the zoom expression itself.
- **Style sign-off (Thomas, 2026-09-27):** video 1 at speed 0.86 with the sun push-in "looks good now". Zoom cap stays 1.15×.

- **First `/make-video` run (video 2, same topic):** ~13.5 min end to end. The fact check failed once ("colors switched places" implied an unsourced claim about Earth sunsets); the scriptwriter cut the line and the re-check passed 14/14. The producer ran for 7.4 min (it re-rendered once to avoid a soft 2× pan).
- **qa-reviewer now only states facts already in the script** (video 1's draft description added "On Earth, sunsets glow orange and red").
- **Backlog found by the agents:** (1) `qa:frames` uses fixed timestamps, so short clips can go unchecked → take at least one frame per clip. (2) Panoramas have no good framing: `pan` fills the frame at 2× upscale, `blur_bg` leaves a thin strip → add a partial pan (taller strip over blur, slow slide across part of the width).
- **Backlog fix 1 — frames per clip:** `qa:frames` now takes the hook (1 s), the middle of every clip, and the end card, topped up to ≥ 6 and de-duplicated (≥ 0.5 s apart, away from crossfades). Video 2's unchecked 33–37 s clip now gets a frame.
- **Backlog fix 2 — `pano` mode:** panoramas show as a tall band (≤ 1100 px, ≤ 1.2× upscale, so sharp) over the blurred copy, sliding ≤ 80 px/s around `focus.x`, instead of a 2× soft fill (`pan`) or a thin strip (`blur_bg`).
- **`media:test-clip`:** renders one asset/mode into `runs/_test/` with a silent track and a credit line, so media changes can be checked without touching a video's status.
- **Bug found by the test clip:** a zero-length ASS drawing event (`\p1`) makes libass render *nothing* for the whole file. `buildAss` now never emits zero-length events. (Real videos never hit this — their end card always lasts ≥ 3 s — but the test clip did.)

## 2026-09-27 — Phase 2 (review site)

- **One process:** `npm run review` runs Vite with the Hono API inside it (`@hono/vite-dev-server`), bound to 127.0.0.1:5173. Only `/api/*` and `/media/*` reach Hono.
- **The approval gate lives on the server** (`src/review/decide.ts`), not just the UI: approve without "rights checked" → 400; changes without notes → 400; wrong status / revision cap → 409; everything in one transaction. There is no publish route.
- **Rights on approve (Thomas: yes):** ticking "I checked the rights" + Approve sets those assets to `clear` with `cleared by Thomas on <date> (video N review M)`. `nasa:fetch` reuses that clearance for the same nasa_id **and** identical credit on later videos; it never overrides `rejected`.
- **Keyboard safety:** A and R open a confirm step (Enter confirms, Esc cancels); C opens the notes box (Ctrl+Enter sends). Keys are ignored while typing in text fields but NOT on the rights checkbox (e2e caught that bug: tick box → A did nothing).
- **Transcript follows the player** using TTS segment timings; click a line to jump there.
- **Design:** Martian twilight dark theme (dusk navy, sunset-glow blue for approve, dust amber for rights, rust for reject), cool dust-grey light theme; Fredoka (the caption font) for headings, Atkinson Hyperlegible Next for body at 18 px. One bold element: the blue sunset halo behind the phone-frame player.
- **Publishing text in the DB:** `videos.description`, `videos.hashtags` (qa-review saves the draft; the site edits it; the AI-voice line stays mandatory).
- **e2e isolation:** Playwright seeds `tests/e2e/.tmp` (DB + generated MP4s) and serves on port 5199, never touching real data.
- **/revise-video** added (§8): restarts from the scriptwriter (word/fact notes) or the producer (visual-only notes); both count as a revision.

## 2026-09-27 — Channel

- **Public name: "Blast of Facts"** (Thomas). On YouTube it's a Brand Account channel under Thomas's Google login, separate from his main channel. Thomas first planned a new channel, then chose to rename the existing Story_Clips one instead. Channel audience is set to Made for Kids, and the name/logo avoid "NASA" (no implied endorsement, §11). Phase 4 OAuth must pick this channel on Google's channel picker. Setup steps are in `NEEDS_FROM_THOMAS.md`.
- **Channel art:** original vector art (no NASA imagery or logos) in `assets/channel/art.html`, rendered to PNG by `node assets/channel/render.mjs`: banner 2560×1440 (text inside YouTube's 1546×423 safe area) and profile picture 800×800 (reads as a circle).

## 2026-09-27 — Phase 3 (reliability)

- **Headless runs** use Thomas's subscription login (no API key: $0 rule), `--permission-mode dontAsk` and a narrow allow list in `.claude/settings.json` (npm run, read project, write runs/ only, `*.nasa.gov` fetches, subagents). Probes confirmed refused actions are logged in `permission_denials` and the run continues. Project subagents and skills load in `-p` mode.
- **`npm run scheduled`**: lockfile → preflight (queue cap 6, tools, disk; "skip" is not a failure) → `claude -p "/make-video"` with a 60-min process-tree kill → outcome judged from the DB (video reached `in_review`), not from the agent's summary → `automation_runs` row. `claude -p` reports token usage and an API-equivalent cost (not billed on the subscription).
- **Topics backlog** ordered by rights-clear NASA *video* hits (`topics:check`); `topics:next/mark` so code edits TOPICS.md.
- **Hardening from run 1:** agents tried shell loops/ffmpeg/sqlite3/rm (refused). Added multi-`--query` search, `media:preview`, frame-dir cleanup, exact step names, and a "only `npm run` works in Bash" rule in every agent prompt. Run 2 had 0 denials.
- **Hardening from run 2:** a fact was verified against a NASA page never stored as a source. Fact checks now carry `extra_sources` (saved to `sources`), and schema + `qa:check` fail a supported claim without a stored source (§2.5). Added `crop` for split-screen footage; moved the font license out of the libass fonts dir.
- **Everyday comparisons (Thomas: option b):** common-knowledge reference points (walking speed, a basketball hoop, a school bus) need no source; the NASA number does, and the comparison must be true.
- **Schedule:** 07:00 and 15:00 daily via Task Scheduler, wake to run, only while logged on (no stored password), 90-min task limit, no overlapping instances.
- **Numbers are spoken as words (Thomas's video 3 note: "2,400" was misread).** `spokenForm()` spells out integers, thousands separators, decimals, percents, ordinals, years ("2021" → "twenty twenty-one") and common units (mph, ft, °F, km) before TTS; captions keep the script's digits. `SPEECH_RULES_VERSION` is in the TTS cache key so old narration is regenerated.
- **Revisions are automatic:** every scheduled run first handles the oldest `changes_requested` video with `/revise-video <id>` (no queue cap: it doesn't add to the queue), then new videos on later runs. Pronunciation/pace notes restart from the producer. The review site lists "Being revised" videos and says when notes will be applied.
- **Site address: http://launchpad.localhost** (port 80; browsers resolve `*.localhost` to this PC, no hosts file). Vite `allowedHosts` limited to launchpad.localhost/localhost/127.0.0.1; still bound to 127.0.0.1 only. e2e keeps using port 5199.
- **Platforms (Thomas, 2026-09-27): YouTube first, Facebook only after YouTube posting is fully proven.** Phase 4 is built YouTube-only; Facebook becomes a later step.
- **Video 2 is hand-posted by Thomas** (approved, so the approval gate holds). Its URL gets recorded so the automatic poster never double-posts it. Video 1 won't be posted (unsourced opening line, same topic as video 2).
- **Google setup started early, in parallel with Phase 3:** the unaudited-project "uploads are private" lock is the slowest part, so the audit request goes in before the code exists. OAuth app will be moved to "In production" (unverified, single user) to avoid Testing mode's 7-day refresh-token expiry. Scope `youtube.upload` only. Client secret lives in gitignored `data/google/`.
- **Bug found by the first automatic revision (video 3):** `words()` split "2,400" into "2" / "400", so captions showed "400 times a minute", and sentence splitting broke at decimal points. Numbers with thousands commas and decimals are now one word; "1.61" no longer ends a sentence. Only video 3 had such a number. The revision agent correctly refused to patch code, marked the video `failed` and described the fix.
- **Manual reset (Thomas, 2026-09-27):** `manualReset()` / `npm run video:reset -- --video <id> --reason "..."` puts a failed video back at the step it failed, even after its one automatic retry. Only for failures caused by a pipeline bug that has since been fixed. It's logged (runs row `manual-reset` by Thomas + `logs/manual-reset.log`), and `.claude/settings.json` denies it (and `schedule:*`) to agents; a headless probe confirmed both attempts were refused. First use: video 3 → re-captioned with the "2,400" fix → back to review.
- **Peak limiter (run 5 / video 7 clipped at 0 dB):** `loudnorm` targets −1.5 dBTP but doesn't guarantee it. Audio chain is now loudnorm → resample 48 kHz → `alimiter=limit=0.8:level=false` (≈ −2 dBFS, room for AAC overshoot) → pad. Video 7 re-rendered on its one automatic retry: peak −4.4 dB, −14.5 LUFS.
- **Known gap: clip audio is always dropped.** Fine for most topics, but "What does Mars sound like?" uses NASA's sound-comparison clip, whose on-screen countdown promises sounds kids never hear. Needs an edit.json option to play source audio for a stretch (narration ducked or paused). Flagged to Thomas; not built yet.
- **Sound moments (clip audio), 2026-09-27:** `edit.json` `pauses: [{after_segment, seconds}]` stop the narration after a line (0.5–8 s each, ≤ 12 s total, never after the closing question); clips with `audio: "full"` are heard **only inside those pauses** (gated, 0.15 s fades, each clip loudness-normalised to −16 LUFS), so nothing talks over the narrator. One mapping (`src/media/timeline.ts`) shifts segments, words, captions and the end card; the voice gets silence inserted into `voice-edit.wav`. `npm run media:timeline` shows the producer the final line times. Verified on an isolated copy of video 7: narration −91 dB inside the 4 s pause, final mix −16.7 dB there (clip sound), captions shifted, QA passes. A regression render of video 8 without pauses matched the original exactly (47.03 s). Video 7 itself stays as approved.
- **Isolated re-renders:** set `LAUNCHPAD_DB` (a `better-sqlite3` `.backup()` copy — a plain file copy misses WAL data) and `LAUNCHPAD_RUNS`; the review queue is never touched.
- **Clip sound uses one fixed gain per recording** (`clipGainDb`: whole-file integrated loudness → −18 LUFS, capped ±20 dB), not per-moment loudnorm, so NASA's own mix (e.g. Earth bell vs muffled Mars bell) is kept as NASA made it. Checked on video 9 against a per-second loudness map of the source.
- **Video 9 = remake of approved video 7 with sound moments** (Thomas, 2026-09-27): reused video 7's fact-checked research/script/fact check (re-validated through `agent:validate`), assets re-fetched (Thomas's earlier rights clearance reused), new edit by the producer. **Video 7 is superseded: never schedule it.**
- **Hand-posting packages (`npm run export`)**: `exports/<id>-<slug>/` (gitignored) with `<slug>.mp4`, `title.txt`, `description.txt` (approved description + hashtags on the last line) and two thumbnails (1080×1920 for Shorts, 1280×720 wide) made from a clean NASA frame (the producer's crop applied; `--source/--at` to pick another frame) with the title in Fredoka, last line in brand yellow. Refuses videos that aren't approved. Shorts usually can't take an uploaded custom thumbnail from desktop Studio; the vertical one is ready if that changes, the wide one for non-Short uploads.
- **`posts` table + `video:mark-posted` (started early for hand-posting):** one row per platform post, unique per (video, platform) and per (platform, external id), so nothing is posted twice. Recording goes through the state machine (approved → scheduled → published) and refuses unapproved videos. The command is denied to agents. The review site shows the live link. Video 2 = https://www.youtube.com/shorts/6qJq2lvEuV0.

## 2026-09-27 — Phase 4 (YouTube, fully automatic)

- **Thomas: "completely automated"**: one approved video a day at **16:00**, oldest approval first, uploaded and added to the **Mars Facts for Kids** playlist (created if missing). Facebook stays on hold.
- **No AI in posting.** `npm run publish` is plain code (`src/publish/`): verify the signed-in channel is "Blast of Facts" → retry missing playlist adds → upload at most ONE video (`selfDeclaredMadeForKids: true`, category 27 Education, approved title/description/hashtags) → record in `posts` → add to playlist. Its own lock (`data/publish.lock`) and a third Task Scheduler job (`publish-1600`).
- **Guards:** only `approved`, not held (`video:hold`, Thomas-only), never twice (`posts` uniques); a pending marker written before upload stops blind re-uploads after a crash; wrong channel → refuses; unaudited "forced private" uploads are recorded as private and flagged on the site; before Google setup the job returns `not_connected` quietly.
- **OAuth:** Desktop-app client, loopback redirect + PKCE, offline access, scope `https://www.googleapis.com/auth/youtube` (upload-only can't manage playlists). `npm run youtube:auth` saves the refresh token only if the chosen channel is Blast of Facts. Files in gitignored `data/google/`; agents are denied `Read(./data/google/**)`, `publish`, `youtube:auth`, `video:hold` (headless probe: all refused).
- **Plain fetch against the YouTube Data API v3** (resumable upload, playlists, playlistItems, channels): no `googleapis` dependency. Tested against an in-memory fake YouTube.
- **Held back:** video 1 (same topic as posted video 2; unsourced opening line) and video 7 (superseded by video 9).
- **Phase 4 DoD met (2026-09-28):** `npm run publish` posted video 5 ("How Does a Rover Drive on Mars?") from the queue: https://www.youtube.com/shorts/J_C8LG6ga0o, Made for Kids, added to "Mars Facts for Kids", link shown on the review site. YouTube reported it public at upload.
- **Visibility is re-checked every run** (`videos.list?part=status`, 1 unit) because YouTube may lock unaudited uploads to private after processing; the site shows what YouTube really says.
- **Channel is identified by ID** (UCHhHYjq4K0sERPPR2od5kRw), not name: Google's account picker still showed the old Brand Account name "Story_Clips", and the BlastofFacts04 Gmail is also named "Blast of Facts" but owns no channel.
- **First API upload stayed public (Thomas checked in Studio, 2026-09-28):** the unaudited-project private lock didn't apply to this project, so the YouTube audit is optional for now (still recommended as insurance). The per-run visibility re-check will flag it if YouTube starts locking uploads.


## 2026-09-28 — Beyond Mars

- **Worlds after Mars (Thomas: go):** Moon → Life in Space → Sun and Earth → Jupiter → Asteroids, Comets and Pluto → Saturn → Telescopes and Deep Space; 35 topics, most rights-clear NASA footage first within each world (`scripts/footage-scan.ts`). Rockets are folded into the Moon/Artemis topics. Mars finishes first.
- **Playlists per world:** `## World | playlist: Name` headings in `docs/TOPICS.md`; `video:new` stores the topic's playlist on the video; the publisher finds or creates it on first use (NULL = "Mars Facts for Kids").
- **Review site starts at Windows logon** (`\Launchpad\review-site`, hidden via wscript) after it went down when its terminal closed.
- **YouTube API costs corrected (Google's quota page, checked 2026-09-28):** `videos.insert` now has its own allowance of 100 calls/day at 1 unit each (it was ~1,600 units until Dec 2025 and moved to its own bucket on 1 Jun 2026). Everything else shares 10,000 units/day; a post uses ~53. The binding limits are the channel's own daily upload cap (unpublished; ~10–20/day reported for newer channels) and YouTube's spam/repetitive-content policies, not cost.

- **Two posts a day (Thomas, 2026-09-28):** one `\Launchpad\publish` task with triggers at 08:00 and 16:00 (each run posts at most one video); the old `publish-1600` task is removed on install. Matches production (07:00 and 15:00), well under YouTube's 100 uploads/day API allowance and the channel's daily upload cap.


- **Bonus space picture outro (Thomas, 2026-09-28, option B; idea from his daughter):** `media:bonus` picks the newest NASA Image of the Day (`nasa.gov/feeds/iotd-feed/`) not used by another video and not rights-rejected; the credit comes from the picture's page ("Image Credit: …"). It is chosen when the video is made, stored as an asset + source, and reviewed with the video, so the approval gate covers it. Worded "Here's a bonus space picture!" (never "today": the post goes up hours or days later). Not APOD, which often features privately copyrighted photos. Video limit raised from 55 to 60 s; the outro (~5–7 s) is left off if it would go past 60.
