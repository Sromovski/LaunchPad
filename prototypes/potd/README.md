# Prototype: "Space Picture of the Day" outro

Idea from Thomas's daughter: end every clip with NASA's picture of the day.

**Not part of the pipeline.** Nothing here changes how videos are made or posted.

## Try it

```
npx tsx prototypes/potd/make-potd.ts --video 6 --item 0
```

- `--video`: an existing video (it uses `runs/<id>/final.mp4`)
- `--item`: which Image of the Day to use: 0 = today's, 1 = the one before, and so on

Output goes to `prototypes/potd/out/` (not committed).

## What it does (about 6 s after the closing question card)

1. Reads **NASA Image of the Day** (https://www.nasa.gov/feeds/iotd-feed/) and takes the title, date and full-size picture. The credit comes from the picture's page ("Image Credit: NASA/Jessica Meir") and goes through our credit checker.
2. The same Kokoro voice and pace say: *"Here's your space picture of the day!"* and then NASA's title.
3. The picture sits over a blurred copy with a slow zoom. A big yellow **"Space Picture of the Day"** heading and the date appear at the top, the title shows up as it's spoken, and the credit line reads "Image: … · NASA Image of the Day".
4. It's joined onto the approved video, at −14.7 LUFS overall; the outro voice is as loud as the narration.

## Prototype clips (2026-09-28)

| File | Video | Picture | Total length |
|---|---|---|---|
| `out/video6-potd-space-station-view-of-earth-at-night.mp4` | 6: Why Is Mars Red? | "Space Station View of Earth at Night" (Sep 28), NASA/Jessica Meir | 48.0 s |
| `out/video8-potd-practicing-for-safe-landings-on-the-moon-and-beyond.mp4` | 8: Why Is a Mars Rover Saving Rocks? | "Practicing for Safe Landings on the Moon and Beyond" (Sep 24), NASA/Ryan Kline | 53.8 s |

## What we learned (to decide before building it for real)

1. **Use NASA Image of the Day, not APOD.** APOD (apod.nasa.gov) often features copyrighted photos by private photographers, which CLAUDE.md §2.4 rules out. Image of the Day is mostly NASA's own work.
2. **Rights are still "needs review" most days.** Credits are usually "NASA/<photographer name>", and some are "ESA/Hubble & NASA". Our checker flags both for a human check, the same as other co-credits.
3. **"Of the day" vs. when it's posted.** A video is made 1–3 days before it goes live. Options:
   - **A.** Add the outro **at posting time** with that day's picture. It's truly "of the day", but that part is never reviewed by Thomas, which clashes with the approval gate unless we only allow plain "NASA" credits or pre-approved pictures.
   - **B.** Add it **when the video is made** and word it without "today", e.g. *"Here's a bonus space picture!"*. It's fully reviewed like the rest of the video.
   - **C.** Keep a small **reviewed pool** of picture-of-the-day outros: Thomas approves each picture once, and the poster uses the newest approved one on posting day.
4. **Length.** It adds 5.6–6.8 s, depending on the title. Our limit is 55 s, and video 8 came out at 53.8 s. Either the main script gets about 15 fewer words, or the limit goes up (YouTube Shorts allow up to 3 minutes).
5. **Facts.** The outro only says NASA's own title, so it's sourced. Long or odd titles ("Hubble Spots Chaotic Secret in Galaxy") may need a kid-friendly rewrite, which would then need a fact check.
