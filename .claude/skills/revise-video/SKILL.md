---
name: revise-video
description: Apply Thomas's "Request changes" notes to a Launchpad video and put it back in the review queue. Invoke as /revise-video <video_id>.
---

# /revise-video

You are the **orchestrator** again (same rules as /make-video): run subagents, validate their output, move status with the CLI, log every step. The pipeline **ends at `in_review`**. Nothing is ever published from here.

**Never use git** (Thomas commits). Run **one `npm run` command per Bash call** (no `&&`, pipes or `$(...)`; headless runs refuse them).

## 0. Read the request
- `npm run video:show -- --video <id>` → status must be `changes_requested`; otherwise stop and say so.
- The notes are `reviews[0].notes` (newest first). Quote them back in your final report.
- `video.channel` is the video's channel (`blast` = Blast of Facts, `wonder` = I Wonder Why). Tell every subagent the channel's name.
- `video.revision_count` is how many revisions already happened. The state machine allows **2**; if this would be a third, it refuses — stop and tell Thomas the video must be approved or rejected.

## 1. Choose where to restart
Decide from the notes (when unsure, restart from the script):
- **Words, facts, tone, length, the hook or the question** → restart from the **scriptwriter**: `npm run video:status -- --video <id> --to scripted`
- **Only pictures, timing, zoom, framing, captions, or how the narrator pronounces/paces the same words** (no word changes) → restart from the **producer** (it re-runs `media:tts`, so voice fixes land): `npm run video:status -- --video <id> --to fact_checked`

Either move counts as one revision.

## 2. Run the steps
Same per-step routine as /make-video (`run:start` → Agent → `agent:validate` → `video:status` → `run:finish`), same retry and failure rules.

**From the scriptwriter:**
1. scriptwriter — prompt: "REVISION requested by Thomas. His notes: <notes>. Revise runs/<id>/script.json to address every note, fill revision_notes, run script:validate until it passes." (status stays `scripted`; save with `agent:validate --step script`)
2. fact-checker → loop with the scriptwriter as in /make-video (max 2) → `fact_checked`
3. producer → `rendered`
4. qa-reviewer → `qa_passed` → `in_review`

**From the producer:**
1. producer — prompt: "REVISION requested by Thomas. His notes: <notes>. Re-edit runs/<id>/edit.json to address them and re-render." → `rendered`
2. qa-reviewer → `qa_passed` → `in_review`

Tell the qa-reviewer that Thomas may have edited the title/description/hashtags in the review site (`npm run video:show -- --video <id>` → `video.title`, `video.description`, `video.hashtags`); it should start from his wording and change only what the revision made wrong.

## 3. Finish
This skill also runs unattended: scheduled runs pick up any `changes_requested` video before making a new one. Nobody is watching, so never ask questions — decide from the notes and explain your choice in the report.

Report to Thomas: video id, what the notes asked for, what changed (script diff summary or edit changes), new duration, revision count (n of 2), and that it's back at http://launchpad.localhost.
