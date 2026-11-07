# Curious Clips — CLAUDE.md

> Lives at `channels/clips/CLAUDE.md`. Channel name: **Curious Clips**, YouTube Shorts. Channel key **`clips`** (`CLIPS` in `src/channels.ts`).
> Fourth channel inside Launchpad. **The only one that is NOT made for kids.** It has stick figure insult reels and the AI show, so its content must never reach the kids' channels, and the kids' rules in the root CLAUDE.md (§1, §6, §7, §11) don't apply to it.
> The videos are made in a separate project, `C:\Projects\stick\stick-ai-shorts` (Remotion and Kokoro). Launchpad only reviews and posts them. Don't change the `blast`, `wonder` or `fables` pipelines when working here.

## 1. The workflow (two human review gates)

The same statuses and state machine as Pocket Fables (`workflowOf` in `src/db/status.ts`):

```
idea → scripted → script_review
script_review → script_approved       (Thomas approves in the tab)
script_review → script_changes → scripted → script_review
script_approved → rendering → rendered → video_review
video_review → approved → uploaded    (approving uploads and schedules it)
video_review → video_changes → script_review
```

**Hard rule: Claude never approves anything and never uploads.** Only a click in the review site leaves a gate. Don't voice or render a new script until its status is `script_approved`.

## 2. Sending work here

From `stick-ai-shorts`:
- `npm run launchpad -- ep003 --stage script` puts a script in Scripts to review.
- `npm run launchpad -- ep003` puts the finished MP4 in Videos to review. Its lines must match the approved script, or the import refuses.

The MP4 is copied to `runs/<id>/final.mp4` (gitignored). `APPROVED_BEFORE_TAB` in `src/clips/import.ts` lists the ten videos whose scripts Thomas approved in chat before this tab existed (2026-11-06). Only those may start at Videos to review. **Don't add to that list.**

## 3. Posting

- One video a day, in the order Thomas approves them. Approving uploads it private with YouTube's `publishAt` set to `CLIPS.postHour` (16:00 local) on the next day with no post (`nextOpenSlot`), so YouTube makes it public by itself. There is no local posting job.
- Audience: **not made for kids** (`selfDeclaredMadeForKids: false`). Category: Comedy.
- The signed-in channel is checked by ID before every upload. `CLIPS.youtubeId` empty means sign-in and uploading both refuse.
- Playlists: "The Butter Eye" for reels, "AI Explained by Stick Figures" for the AI show.
- Descriptions automatically get the hashtags, "Voices are AI-generated.", and, on the AI show, a line saying it's parody and not affiliated with any AI company.
- Hand upload stays available in the tab as a fallback.
- Altered content question in YouTube Studio: these are cartoon stick figures, not realistic people or events, so **No** is the usual answer.

## 4. Setup Thomas does once

1. YouTube Studio → Settings → Channel → Advanced: audience **No, not made for kids**.
2. Give Claude the channel's `UC…` ID for `CLIPS.youtubeId`.
3. `npm run youtube:auth -- --channel clips`, pick Curious Clips. Then restart the review site.

The same Google Cloud project and login as the other channels (`docs/YOUTUBE_CHANNEL_PLAYBOOK.md`).

## 5. Content rules

The rules live in the `stick-ai-shorts` CLAUDE.md. Two matter here: Grok's speaking style is a parody only, so never clone a real person's voice or name the person in the title or description. "You have all the confidence" appears in be003, be004 and be009, so keep those posts apart.
