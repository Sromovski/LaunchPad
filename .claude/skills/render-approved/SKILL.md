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
3. Per video, in order: `npm run fables:render -- start --video <id> --balance <remaining>`. It moves the video to `rendering` and refuses below the minimum balance. A two-part episode (`episode` in the script) only starts when **both** parts are approved; render Part 1 completely, then Part 2 straight after (start Part 2 only once Part 1 is in `video_review`, so its frames can be reused). A whole pair costs roughly twice a single video: check the balance covers both before starting Part 1, otherwise stop and tell Thomas.
4. Read `runs/<id>/script.json` (title, narrator, visual_style, hero, scenes with `pip_on_camera`).
5. **Re-render** (`start` moved the earlier log to `runs/<id>/everygen.v<n>.json`): read it, and Thomas's latest video-gate notes. Reuse every finished job the change doesn't touch: re-log it in the new log under the same step and scene with its URL and `--job reused-<old id>`, and don't generate it again. The hero character is reused. A voice change redoes the voiceovers, the Pip-on-camera clips (his mouth follows the voice) and both composes and captions; story clips are reused as long as the new plan's window for a scene fits that clip's real length (a window longer than the clip would freeze, so only that scene's clip is redone, at the new `clip_seconds`).

## 1. Characters
**Pip** (once for the channel, reused forever): `everygen.pipCharacterId` ("Pip (Pocket Fables)"); his sheet is `everygen.pipSheetUrl`. Only if `list_characters` no longer finds him: `generate_image` (imageModel, 16:9) a character sheet of Pip, "a tiny red fox with a patched backpack full of story pockets", in the visual style: front, side, back and a happy pose, plain warm background, no text. Log it (`--step pip-sheet`), check it's one consistent friendly fox (one retry), then `create_character` "Pip (Pocket Fables)". Tell Thomas the new id and sheet URL for `src/channels.ts`.

**Ma Liang** (the hero of every "Pip & Ma Adventures" episode): reuse `everygen.maCharacterId` / `everygen.maSheetUrl` and skip the hero sheet. If they're still null (the first adventure ever), make him once exactly as for a hero below, but name the character "Ma Liang (Pocket Fables)", log it as `hero-sheet` / `hero-character`, and tell Thomas the id and sheet URL to put in `src/channels.ts` (as was done for Pip). Part 2 of the same episode reuses the character Part 1 made: re-log it with `--job reused-<id>`.

**The story's hero** (any other `hero`; about 2 credits): `generate_image` (imageModel, 16:9): a character sheet of `hero.name`, exactly `hero.look`, in the script's `visual_style`: front, side, back and one happy pose, plain warm background, no text. Log it (`--step hero-sheet --url …`). Look at it: one consistent, friendly character matching `hero.look`. Make one retry with a clearer prompt if it's wrong, else use the better of the two. Then `create_character` named `<hero.name> (Pocket Fables <id>)` with that image, and log its id (`--step hero-character --job <characterId>`).

## 2. Voiceover
1. Free check first: `mcp__everygen__check_voice_cadence` on all the narration. Note warnings in the report (Thomas already approved the wording; never change it here).
2. `npm run fables:render -- voiceovers --video <id>` → `pieces`: exactly what to voice, in order, each with its log `step` (`voiceover-intro`, `voiceover` or `voiceover-s1`/`-s2`…, `voiceover-outro`), its scenes and `text`. Never join or edit narration by hand. In a two-part adventure the story is split right after each viewer question (`pause_after: 2`), because the voice never pauses on its own and kids need 2 s to answer.
3. One `generate_voiceover` per piece, `text` as given, `voiceId` = `voice` from `list`, `voiceSettings` `{ speed: everygen.voiceSpeed }` (natural speed; Thomas found 0.8 machine-like). Log each under its `step`.
4. `npm run fables:render -- plan --video <id> --story "<durationSeconds>:<timing.sentenceEnds, comma separated>" [--story "…" for each further story piece, in order] [--intro <intro timing.speechEndSeconds>] [--outro <outro timing.speechEndSeconds>]`
   It writes `runs/<id>/scene-plan.json` (each scene's window, `clip_seconds`, `audio`: intro, story or outro, and for story scenes its `section`; a viewer-question scene has `pause_after` and its window already includes the quiet) and refuses a plan outside 45–65 s. Too short: one retry of the story voiceover(s) at speed 0.9, never lower. Too long, or still too short → `fables:render fail` with the reason and stop (the script needs changing, not a slower voice).
5. Work out the voice's pace for `everygen.wordsPerSecond` (spoken words ÷ seconds of speech, at this speed) and put it in the report.

## 3. Start frames (one per scene)
`generate_image`, imageModel from `list`, aspectRatio 9:16, at most 4 per reply. Prompt = `visual_style` + the scene's `visuals`, posed mid-action, "no text, no letters". Which character to pass:
- Hero in the scene (visuals mention `hero.name`): `characterId` = the hero's; if Pip is in it too, add `everygen.pipSheetUrl` to `referenceImageUrls`.
- Only Pip: `characterId` = Pip's.
- Neither (other story characters): `referenceImageUrls` = scene 2's finished frame, so supporting characters stay the same.
- **Part 2 of an episode:** same place, same characters. Add Part 1's frame of the same place (read `runs/<part 1 id>/everygen.json`) to `referenceImageUrls` so the town, bridge and supporting characters match. Where a Part 2 scene shows exactly a Part 1 shot (the "last time" recap), reuse that Part 1 frame instead of generating one: re-log it with `--job reused-<old id>`.
- **Pip on camera** scenes: Pip close up, facing the camera, mouth clearly visible, friendly expression.

Log each (`--step frame --scene <n> --url …`). Look at every frame; redo a frame once if a character is wrong, scary or has text in it.

## 4. Clips (one per scene)
`generate_video`: model and resolution from `list`, `orientation` "portrait", `firstFrameUrls` [that scene's frame], `duration` = its `clip_seconds`, `idempotencyKey` `pf<id>-v<version>-clip-s<n>`. At most 4 per reply; log each generation id right away (`--step clip --scene <n> --job <generationId>`). Then repeat `wait_for_generation` (type video, timeout 50) until all settle.
- Story scenes: prompt = the scene's `visuals` as gentle action + "calm camera, soft storybook motion, no text, no speech". No `audio`.
- **Pip on camera** scenes: `audio: true`, `referenceAudios` [{ url: that Pip voiceover, durationSeconds: its length }] (must be 2–15 s; a shorter line goes without the reference). Seedance 2 Mini refuses a first frame together with references, so **no `firstFrameUrls` and no `characterId`**: pass the scene's frame as `referenceImageUrls` [frame] instead. Prompt: "Exactly the scene in the reference image, same style:" Pip the fox looks into the camera and happily says the scene's narration word for word, in the voice of the reference audio; his mouth moves in time with the words; small friendly gestures; calm camera; no text. About the same cost as a silent clip (video 142: 4 and 3 credits).

A failed clip: change the prompt (simpler action) and try once more with a new key ending `-r1`; failing again → `fables:render fail` and stop.

## 5. Stitch, overlays, captions
- **No Pip-on-camera scenes:** `compose_video`, aspectRatio 9:16: clips in scene order, each `durationSeconds` = `end − start` from the plan (never more than the clip's real length), `audioUrl` = the voiceover URL. `overlays`: for each scene with `on_screen_text`, `{ text, style: "label", position: "top", clip: n }`.
- **With Pip on camera** (two passes):
  1. `compose_video` of only the **story** scenes' clips, in order, windows from the plan, no audio, no overlays → the story cut (`--step compose-story`). With several story sections (a two-part adventure), one story cut per `section` (`--step compose-story-s<k>`).
  2. `compose_video` of [intro clip { durationSeconds: its window, audioUrl: intro voiceover }, each story cut { durationSeconds: that section's total window (pause included), audioUrl: that section's voiceover }, outro clip { durationSeconds: its window, audioUrl: outro voiceover }], leaving out whichever Pip scene the script doesn't have. The section's voiceover is shorter than its window by the pause, so the quiet after the viewer question comes for free. Overlays by time from the plan: `{ text, style: "label", position: "top", startSeconds: start, endSeconds: end }`. Each clip's own audio is muted; Pip's voiceover plays over the clip it drove.
- Log each compose; poll `get_compose_status` every ~10 s until done.
- `add_captions` on the composed URL: style `story-box`, `position: "bottom"` (Thomas, 2026-11-01: subtitles at the bottom; Everygen's bottom zone sits above the app's on-screen buttons), overrides `{ font: "fredoka" }`, language `en`. Log it; poll `get_caption_render_status` until done. If captions fail twice, use the uncaptioned video and say so.

## 6. Before finishing
Download the captioned file to the scratchpad and look at 5–6 frames (ffmpeg), including the Pip scenes. Check:
- captions are readable at the bottom and not cut off or hidden behind where YouTube's buttons go (right edge), and overlays sit at the top;
- Pip and the hero look the same throughout, and Pip's mouth moves while he speaks;
- nothing is scary.

Note anything off in the report; it's Thomas's call at the video gate.

## 7. Finish
`mcp__everygen__get_credit_balance`, then:
`npm run fables:render -- finish --video <id> --url <final captioned https URL> --balance <remaining>`
It downloads `runs/<id>/final.mp4`, records the credits used, runs QA (9:16, 45–65 s, audio, plays) and moves the video to `video_review`, or `failed` with the reason.

## Report
Per video: final status, credits used (and the hero sheet's share), the QA result, the voice's words per second, whether Pip's lip movement worked, and anything you changed or redid.

## On any failure
`npm run fables:render -- fail --video <id> --error "<what failed>"`, then stop that video. The state machine allows one retry; before retrying, check the render log so nothing already paid for is generated again.
