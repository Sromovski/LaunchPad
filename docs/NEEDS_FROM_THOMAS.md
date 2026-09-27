# Needs from Thomas

Running list of things only Thomas can do (accounts, credentials, installs, money).

## Open
- **ffmpeg on PATH (optional):** ffmpeg 9.0.2 is installed via winget but isn't on PATH in all shells. Launchpad finds it anyway (winget folder fallback). To use it from your own terminal, open a new one or run `winget install Gyan.FFmpeg --force`.
- **Phase 4 (later):** confirm platforms (default YouTube Shorts + Facebook Reels), then a Google Cloud project with YouTube Data API v3 and a Facebook Page + Page access token. When authorizing YouTube uploads, pick **Blast of Facts** on Google's channel picker so the token can only upload there.

## Done
- 2026-09-27 — Renamed the Story_Clips YouTube channel to **Blast of Facts**: handle, description, profile picture + banner from `assets/channel/`, audience set to made for kids.
- 2026-09-27 — Approved Playwright Chromium install (headless shell, ~115 MB, in %LOCALAPPDATA%\ms-playwright).
- 2026-09-26 — Approved installs: ffmpeg (already present via winget), whisper.cpp b5130 + `ggml-base.en` into `tools/whisper/`, Kokoro q8 model (auto-downloaded to the Hugging Face cache).
