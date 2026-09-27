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
