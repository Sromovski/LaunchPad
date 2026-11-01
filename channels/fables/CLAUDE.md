# Pocket Fables — CLAUDE.md

> Lives at `channels/fables/CLAUDE.md`. Claude Code loads this file automatically when working in this folder.
> Channel name: **Pocket Fables**. Channel key **`fables`** (alongside `blast` and `wonder` in `src/channels.ts`; commands take `--channel fables`). Audience: ages 5–10, Made for Kids.
> YouTube channel ID: **`UCV0cfNkj1zyBopSoByRkgkw`** (Brand Account, Made for Kids). Approving a video in the review site uploads it to this channel (public, Made for Kids) and adds it to the "World Folktales with Pip" playlist. One-time sign-in: `npm run youtube:auth -- --channel fables` (token in `data/google/token-fables.json`). Hand upload stays available as a fallback.
> Narrator voice: Everygen voice id **`everygen`** (the voice of video 139; Arabella was tried on video 142 and dropped, Thomas 2026-11-01), read at natural speed (slowing it to 0.8 sounded machine-like). At that pace (3.56 words/s) a 45–65 s Short needs about 160–210 spoken words. Captions sit at the bottom. Settings in `FABLES.everygen` in `src/channels.ts`.
> **Careful when adding `fables` to `src/channels.ts`:** `CHANNEL_KEYS` drives the Windows scheduler (`src/cli/schedule.ts`) and the NASA/Kokoro build. Pocket Fables must get **no** `makeTimes`/`postTimes` and must never run the NASA pipeline. Also widen the `videos.channel` CHECK in `src/db/index.ts` with a migration. Check every place that loops over `CHANNEL_KEYS` before adding it.
> Hand-written sample script for testing: `channels/fables/samples/pf-001/` ("The Magic Paintbrush").
> Content lane for the test month: **world folktales and fables retold in 60 seconds**. Bedtime stories may be added later.
> Narrator: **Pip**, a tiny red fox with a patched backpack full of story pockets. Every Short opens with Pip pulling one object from a pocket that hints at the story, and ends with Pip saying the lesson in one line. Pip's voice: warm, playful, gentle, young-sounding but not squeaky. Pip's look stays identical in every video.
> Third channel inside Launchpad, next to Blast of Facts and I Wonder Why. Shares the SQLite DB, `runs/` folder and review site, but has its **own workflow** (Everygen instead of NASA footage + local TTS) and its own tab on the review site. Do not change the `blast`/`wonder` pipelines when working here.

## 1. The workflow (two human review gates)

```
idea → scripted → script_review
script_review → script_approved        (Thomas clicks "Approve & send to Everygen")
script_review → script_changes → scripted   (Thomas leaves notes; Claude revises)
script_review → rejected

script_approved → rendering → rendered → video_review
video_review → approved → uploaded      (approving uploads it to YouTube; hand upload is the fallback)
video_review → video_changes → script_review   (revise script, re-approve, re-render)
video_review → rejected

any step failure → failed (with error), retryable once
```

**Hard rule: never call Everygen for a video unless its status is `script_approved`, and that status was set by Thomas in the review site.** Rendering costs credits; nothing else in this pipeline does. Claude never sets `script_approved` itself.

Max 2 revision loops per video at either gate; after that it's `rejected` unless Thomas overrides.

## 2. Scripts

- Target: 60-second vertical Short, about 130–150 spoken words.
- Every script has a clear beginning, middle and end (YouTube's inauthentic-content policy targets templated or plotless videos). No two scripts may reuse the same structure with names swapped.
- No animals or children in peril or exaggerated distress. Nervous or sad is fine; scary is not.
- Folktales: name the culture of origin in the description; retell in our own words.
- Written to be read aloud: use contractions (he's, didn't, we'll) and mix very short lines with longer ones. Flat, uncontracted, evenly sized sentences make the AI voice sound robotic; the review site warns about both (same rules as Everygen's free `check_voice_cadence`).
- Fit the narrator's natural pace, not a slowed voice: once `FABLES.everygen.wordsPerSecond` is measured, the review site warns when the words won't land in 45–65 s.
- `hero`: the story's main character, with one fixed look. The render saves it as an Everygen character (about 2 credits) so it looks the same in every scene, as Pip does.
- `pip_on_camera` (first and/or last scene only): Pip says that line to the camera, with his mouth moving to his own voiceover. Use it for the opening ("Hi, I'm Pip! …") and the closing lesson.
- Save each script as both:
  - `runs/<video_id>/script.json` (source of truth, shape below)
  - `runs/<video_id>/script.md` (human-readable, rendered in the review site)

```json
{
  "video_id": "",
  "title": "",
  "lane": "folktale | bedtime | lesson",
  "origin": "e.g. Ghana (Akan) or 'original'",
  "lesson": "one sentence",
  "narrator": "recurring narrator character + voice style",
  "visual_style": "one consistent style description for every scene",
  "hero": { "name": "the story's main character", "look": "one fixed description: age, hair, clothes, colours" },
  "est_seconds": 60,
  "word_count": 0,
  "scenes": [
    { "n": 1, "seconds": 6, "narration": "", "visuals": "", "on_screen_text": "", "pip_on_camera": true }
  ],
  "youtube": { "title": "", "description": "", "tags": [], "made_for_kids": true }
}
```

## 3. Review site — new channel tab

Add a **Pocket Fables** tab next to the existing channel views. The Pocket Fables tab has three queues:

**A. Scripts to review** (`script_review`)
- Header: title, lane, origin, lesson, narrator/voice, visual style, word count, estimated runtime.
- Scene table: # · seconds · narration · visuals · on-screen text.
- Buttons: **Approve & send to Everygen** → `script_approved` · **Request changes** (required notes box) → `script_changes` · **Reject**.

**B. Videos to review** (`video_review`)
- 9:16 player on the left, the approved script on the right so narration can be checked against it.
- Shows credits used for this render.
- Buttons: **Approve** → `approved` · **Request changes** (notes; warn "re-render costs credits") → `video_changes` · **Reject**.

**C. Ready to upload** (`approved`)
- Download button for the MP4, plus copy buttons for YouTube title, description and tags.
- Reminder line: set audience to Made for Kids.
- Button: **Mark uploaded** (optional field for the YouTube URL) → `uploaded`.

Also a small credits panel: credits used this month and renders done.

## 4. Everygen step (Claude Code)

The review site can't call Everygen directly; Everygen's MCP is connected in Claude Code (`claude mcp add --transport http everygen https://everygen.ai/api/mcp`). Rendering is triggered from Claude Code:

- Command/skill `render-approved`: find all `script_approved` videos → set `rendering` → call Everygen's compose tool with the script's narration, scenes, visual style, voice, 9:16, ~60s, captions on → download the MP4 to `runs/<video_id>/final.mp4` → record credits used → set `rendered` → run QA → `video_review`.
- QA checks (ffprobe): 9:16, 45–65 s, has audio, file plays.
- Before the first render ever, list the Everygen connector's tools and check the credit balance; log the actual credit cost of the first video in `docs/DECISIONS.md`.
- One render per approved script. Never batch-retry a failed render without checking whether Everygen already produced it.

## 5. Data model changes (shared SQLite)

- `videos.channel` already exists: add the value `fables` and register it in `src/channels.ts` (name, YouTube ID TBD, colours, Made for Kids).
- `scripts`: add `scenes_json`, `lane`, `origin`; keep `version` so revisions are preserved.
- `reviews`: add `gate` (`script` | `video`).
- New `credits` table: `video_id`, `credits_used`, `balance_after`, `created_at`.
- Status transitions for this channel live in the same `src/db/status.ts`, keyed by channel. Unit-test the new transitions, especially that only a review action can produce `script_approved`.

## 6. Build order

1. DB changes + status transitions + tests.
2. Stories tab: Scripts to review (with a hand-written sample script).
3. `render-approved` with one real Everygen render; Videos to review.
4. Ready to upload queue + credits panel.

Keep it simple until one video has gone script → approved → rendered → approved → uploaded end to end.
