---
name: render-approved
description: Render every Pocket Fables script Thomas approved in the review site with Everygen and put the videos in Videos to review. Invoke as /render-approved [<video_id>]. Spends Everygen credits.
---

# /render-approved (Pocket Fables only)

Turns `script_approved` Pocket Fables videos into finished 9:16 MP4s with the Everygen MCP tools (`mcp__everygen__*`), then hands them to Thomas under **Videos to review**. Read `channels/fables/CLAUDE.md` first if it isn't in context.

**Hard rules**
- Only videos `npm run fables:render -- list` returns. `fables:render start` re-checks Thomas's review-site approval of the newest script version and refuses otherwise; never work around a refusal, and never call an Everygen generation tool before `start` succeeded for that video.
- **One render per approved script.** Every Everygen job goes into the render log the moment it starts (`fables:render log`). If a step fails or the session dies, read `runs/<id>/everygen.json` and reuse finished jobs; never start a job that the log shows already ran. Use `idempotencyKey` `pf<id>-v<version>-<step>[-s<n>]` on every `generate_video`.
- Never pick other models than `list` returns (`everygen` settings). Never use a paid step this skill doesn't name (no upscales, no exports, no music).
- Run **one `npm run` command per Bash call**. No git.
- Kid-safe: nothing scary, no injury, no text in generated frames (on-screen text comes from overlays), no real brands or trademarked characters.

## 0. Preflight
1. `npm run fables:render -- list` → the videos, model settings and voice. None → say so and stop. With an id argument, do only that one.
2. `mcp__everygen__get_credit_balance` → `remaining`.
3. Per video, in order: `npm run fables:render -- start --video <id> --balance <remaining>`. It moves the video to `rendering` and refuses below the minimum balance.
4. Read `runs/<id>/script.json` (title, narrator, visual_style, scenes).

## 1. Pip (once for the channel, reused forever)
Use `everygen.pipCharacterId` from `list` ("Pip (Pocket Fables)", made 2026-10-31). Only if `list_characters` no longer finds it:
- `generate_image` (imageModel from `list`, aspectRatio 16:9): a character sheet of Pip, "a tiny red fox with a patched backpack full of story pockets", in the script's visual style: front, side, back and a happy pose, plain warm background, no text. Log it (`--step pip-sheet`).
- Look at the image. If Pip isn't one consistent, friendly fox, make one more attempt with a clearer prompt; still wrong → `fables:render fail` and stop.
- `create_character` name `Pip (Pocket Fables)` with that image URL.
Tell Thomas the character id at the end so it can go into `src/channels.ts`.

## 2. Voiceover
`generate_voiceover` with `voiceId` = the `voice` from `list`, `voiceSettings` `{ speed: everygen.voiceSpeed }` and `text` = every scene's narration in order, joined with a space. Log it (`--step voiceover --url <audioUrl>`). Then:
`npm run fables:render -- plan --video <id> --total <durationSeconds> --sentence-ends "<timing.sentenceEnds, comma separated>"`
That writes `runs/<id>/scene-plan.json`: one window (`start`, `end`) and `clip_seconds` per scene. Check `durationSeconds` before planning: under 50 s → one more voiceover with speed lowered to bring it to ~53 s (never below 0.7); over 65 s, or a plan that fails → `fables:render fail` with the reason and stop (the script needs cutting, not a longer video). Never render clips against a voiceover outside 50–65 s.

## 3. Start frames (one per scene)
`generate_image`, imageModel from `list`, aspectRatio 9:16, at most 4 per reply. Prompt = `visual_style` + the scene's `visuals`, posed mid-action, "no text, no letters". Pass `characterId` (Pip) for scenes with Pip in them. For the other scenes, pass scene 2's finished frame as `referenceImageUrls` from scene 3 on, so the story's own characters stay the same. Log each (`--step frame --scene <n> --url …`). Look at every frame; redo a frame once if a character is wrong, scary or has text in it.

## 4. Clips (one per scene)
`generate_video`: model and resolution from `list`, `orientation` "portrait", `firstFrameUrls` [that scene's frame], `duration` = its `clip_seconds`, `idempotencyKey` `pf<id>-v<version>-clip-s<n>`. Prompt = the scene's `visuals` as gentle action + "calm camera, soft storybook motion, no text, no speech". At most 4 per reply; log each generation id right away (`--step clip --scene <n> --job <generationId>`). Then repeat `wait_for_generation` (type video, timeout 50) until all settle. A failed clip: change the prompt (simpler action) and try once more with a new key ending `-r1`; failing again → `fables:render fail` and stop.

## 5. Stitch, overlays, captions
- `compose_video`, aspectRatio 9:16: clips in scene order, each `durationSeconds` = `end − start` from the plan (never more than the clip's real length), `audioUrl` = the voiceover URL. `overlays`: for each scene with `on_screen_text`, `{ text, style: "label", position: "top", clip: n }`. Log it; poll `get_compose_status` every ~10 s until done.
- `add_captions` on the composed URL: style `story-box`, overrides `{ font: "fredoka", yPercent: 70 }` (clear of the bottom 20% where YouTube's buttons sit), language `en`. Log it; poll `get_caption_render_status` until done. If captions fail twice, use the uncaptioned video and say so.

## 6. Before finishing
Download the captioned file to the scratchpad and look at 5–6 frames (ffmpeg): captions readable and above the bottom 20%, overlays at the top, characters consistent, nothing scary. Note anything off in the report; it's Thomas's call at the video gate.

## 7. Finish
`mcp__everygen__get_credit_balance`, then:
`npm run fables:render -- finish --video <id> --url <final captioned https URL> --balance <remaining>`
It downloads `runs/<id>/final.mp4`, records the credits used, runs QA (9:16, 50–65 s, audio, plays) and moves the video to `video_review`, or `failed` with the reason.

## Report
Per video: final status, credits used, the QA result, and anything you changed or redid. The first render ever: add its real credit cost to `docs/DECISIONS.md` (Pocket Fables section), as channels/fables/CLAUDE.md §4 asks.

## On any failure
`npm run fables:render -- fail --video <id> --error "<what failed>"`, then stop that video. The state machine allows one retry; before retrying, check the render log so nothing already paid for is generated again.
