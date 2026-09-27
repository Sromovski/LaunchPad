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
