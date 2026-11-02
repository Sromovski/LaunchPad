# Pocket Fables — CLAUDE.md

> Lives at `channels/fables/CLAUDE.md`. Claude Code loads this file automatically when working in this folder.
> Channel name: **Pocket Fables**. Channel key **`fables`** (alongside `blast` and `wonder` in `src/channels.ts`; commands take `--channel fables`). Audience: ages 5–10, Made for Kids.
> YouTube channel ID: **`UCV0cfNkj1zyBopSoByRkgkw`** (Brand Account, Made for Kids). Approving a video in the review site uploads it to this channel (public, Made for Kids) and adds it to the "World Folktales with Pip" playlist. One-time sign-in: `npm run youtube:auth -- --channel fables` (token in `data/google/token-fables.json`). Hand upload stays available as a fallback.
> Narrator voice: Everygen voice id **`everygen`** (the voice of video 139; Arabella was tried on video 142 and dropped, Thomas 2026-11-01), read at natural speed (slowing it to 0.8 sounded machine-like). At that pace (3.56 words/s) a 45–65 s Short needs about 160–210 spoken words. Captions sit at the bottom. Settings in `FABLES.everygen` in `src/channels.ts`.
> **Careful when adding `fables` to `src/channels.ts`:** `CHANNEL_KEYS` drives the Windows scheduler (`src/cli/schedule.ts`) and the NASA/Kokoro build. Pocket Fables must get **no** `makeTimes`/`postTimes` and must never run the NASA pipeline. Also widen the `videos.channel` CHECK in `src/db/index.ts` with a migration. Check every place that loops over `CHANNEL_KEYS` before adding it.
> Sample scripts: `channels/fables/samples/pf-001/` ("The Magic Paintbrush", single part) and `channels/fables/samples/ep02/` ("The Lantern Bridge", Parts 1 and 2).
> **Main format (Thomas, 2026-11-01): "Pip & Ma Adventures"**, two-part adventure episodes (see §2a). "The Magic Paintbrush" is Episode 1, the origin story of how Ma Liang got his brush. Single-part folktales are still allowed but are no longer the main lane.
> Characters: **Pip**, a tiny red fox with a patched backpack full of pockets, is the narrator and talks to the viewer; every episode he pulls one helpful object from a pocket. **Ma Liang** ("Ma"), a cheerful boy about 9 with a magic golden paintbrush whose paintings come to life, is Pip's best friend and sidekick. Pip's voice: warm, playful, gentle, young-sounding but not squeaky. Both characters' looks stay identical in every video (save each as an Everygen character once and reuse it).
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

- Target: 45–65 s vertical Short (each part of an episode is its own Short), about 160–210 spoken words at the narrator's pace.
- Every script has a clear beginning, middle and end (YouTube's inauthentic-content policy targets templated or plotless videos). The episode *shape* in §2a repeats; the plot, place, puzzle and solution must be genuinely different every episode, never the same story with names swapped.
- Excitement comes from puzzles and races against time (a wobbly bridge, a rising river, a lost map), never threats. No animals or children hurt, frightened or in exaggerated distress, and no villains who menace. Surprised or worried for a moment is fine; scared is not.
- Folktales: name the culture of origin in the description; retell in our own words.
- Written to be read aloud: use contractions (he's, didn't, we'll) and mix very short lines with longer ones. Flat, uncontracted, evenly sized sentences make the AI voice sound robotic; the review site warns about both (same rules as Everygen's free `check_voice_cadence`).
- Fit the narrator's natural pace, not a slowed voice: once `FABLES.everygen.wordsPerSecond` is measured, the review site warns when the words won't land in 45–65 s.
- `hero`: the story's main character, with one fixed look. The render saves it as an Everygen character (about 2 credits) so it looks the same in every scene, as Pip does.
- `pip_on_camera` (first and/or last scene only): Pip says that line to the camera, with his mouth moving to his own voiceover. Use it for the opening ("Hi, I'm Pip! …") and the closing lesson.
- Save each script as both:
  - `runs/<video_id>/script.json` (source of truth, shape below)
  - `runs/<video_id>/script.md` (human-readable, rendered in the review site)

## 2a. Two-part episodes ("Pip & Ma Adventures")

**Part 1 (~45–55 s):** Pip says hi on camera and introduces Ma → Pip pulls an object from a pocket that hints at the place → they arrive in a real country (on-screen country name) → one true, kid-level fact about it → a first small challenge with a **viewer question** (two choices, ~2 s pause for kids to answer, then Pip confirms) → trouble starts → **cliffhanger** → Pip on camera: "Find out in Part Two! Same pocket, same fox!" with a "To be continued..." card.

**Part 2 (~45–55 s):** Pip on camera with a 5-second "Last time on Pocket Fables…" recap (Part 2 must make sense to a kid who never saw Part 1) → a second **viewer question** → the solution uses Ma's brush and/or Pip's pocket object → celebration → **word of the day** in that country's language with its meaning on screen → Pip on camera says the lesson and goodbye.

Rules:
- Facts and foreign words must be correct; put them in `episode.fact` and `episode.word_of_day` so they can be checked at script review.
- Original only: no map songs, no sneaky-thief character and no catchphrases borrowed from Dora or any other show.
- Titles: `<Episode title> <emoji> Part 1 | Pip & Ma in <Country> | Pocket Fables` (Part 2 likewise). Each description names the other part.
- Review both parts together: Part 2's script is approved with Part 1's. Render them back to back and **reuse Part 1's saved characters and place pictures in Part 2** to save credits.
- Post Part 1 first and Part 2 the next day. Put both in a "Pip & Ma Adventures" playlist. How (Thomas, 2026-11-01): approving Part 1's video uploads it public; approving Part 2's uploads it private with YouTube's `publishAt` set `FABLES.partGapHours` (24 h) after Part 1, so YouTube makes it public by itself. No local scheduler, no `postTimes`. Part 2 can't upload before Part 1.
- Viewer-question pauses: the render splits the story voiceover right after each viewer question and holds the picture `FABLES.everygen.questionPauseSeconds` (2 s) in silence (`fables:render voiceovers` / `plan`).
- Ma Liang is saved once as an Everygen character (`FABLES.everygen.maCharacterId`) and reused in every episode, like Pip.
- The review site shows the two parts of a pair side by side and warns if a pair has only one part approved. The render starts neither part until both are approved.

```json
{
  "video_id": "",
  "title": "",
  "lane": "adventure | folktale | bedtime | lesson",
  "episode": { "series": "Pip & Ma Adventures", "pair_id": "ep02", "episode": 2, "part": 1, "of": 2, "country": "Japan", "word_of_day": { "word": "arigatō", "meaning": "thank you" }, "fact": "one true kid-level fact" },
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
