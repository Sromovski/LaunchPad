# Needs from Thomas

Running list of things only Thomas can do (accounts, credentials, installs, money).

## Open

### 1. Hand-post video 2 to Blast of Facts (this week)

Video 2 ("Why Are Sunsets on Mars Blue?") is approved. Post it yourself in YouTube Studio:

1. **Switch account → Blast of Facts** (top-right avatar). Check the channel name before uploading.
2. **Create → Upload videos** → pick `C:\Projects\LaunchPad\runs\2\final.mp4`. It's vertical and 41 s, so YouTube treats it as a Short automatically.
3. **Title:** open the video on http://launchpad.localhost → **Publishing text** and copy the title from there (currently *Why Are Sunsets on Mars Blue?*).
4. **Description:** copy the whole description from the same box. It already has the image credits, the NASA source links, "not produced or endorsed by NASA" and "Narration voice is AI-generated." Add the hashtags on the last line: `#Mars #Space #ScienceForKids #MarsSunset`.
5. **Audience:** **Yes, it's made for kids.** (The channel default is already set; confirm it on the upload page.)
6. **Altered or synthetic content:** YouTube asks this for *realistic* content that could mislead, such as a real person saying something they didn't, or a realistic fake event. A generic AI narrator over real NASA pictures isn't that, so **No** is the usual answer, and the description already discloses the AI voice. If you'd rather be extra careful, **Yes** does no harm.
7. **Visibility:** Public (or Scheduled, if you want a set time).
8. After it's live, **send me the video URL**. I'll record it in the DB (Phase 4 adds a `posts` table) so the automatic poster can never upload video 2 twice.

Don't post **video 1**: its description opens with a sentence no source backs up, and video 2 covers the same topic better. I'll suggest retiring it when we build Phase 4.

### 2. Google setup for automatic YouTube uploads (start now; the audit is the slow part)

Google redesigns these screens often. If a name below doesn't match, look for the nearest equivalent. Everything here is free.

**A. Project + API**
1. Go to https://console.cloud.google.com, signed in with the Google login that owns **Blast of Facts**.
2. Top bar project picker → **New project** → name it `launchpad-uploader` → Create. Make sure it's selected.
3. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.

**B. OAuth consent (called "Google Auth Platform" in newer consoles)**
4. **Branding / OAuth consent screen:** App name `Launchpad uploader`, your email as support and developer contact. Leave the logo empty. A logo triggers extra review.
5. **Audience / User type: External.** Add your own Google address under **Test users**.
6. **Data access / Scopes:** add `https://www.googleapis.com/auth/youtube` ("manage your YouTube account"). You chose full automation, and adding videos to the playlist needs this; upload-only permission can't touch playlists. Our code only ever uploads, creates or fills the **Mars Facts for Kids** playlist and reads which channel it's signed in to.
7. **Publishing status:** while the app is in **Testing**, Google makes our login expire every **7 days**, which would break unattended posting. Once uploads work, click **Publish app → In production**. It's only for you, so you'll see an "unverified app" warning when you sign in. That's expected for a personal tool; click *Advanced → continue*. Full Google verification isn't needed for one user.

**C. Credentials**
8. **Clients / Credentials → Create OAuth client ID → Application type: Desktop app**, name `launchpad-desktop` → Create.
9. **Download JSON** and save it as `C:\Projects\LaunchPad\data\google\client_secret.json`. The `data/` folder is gitignored, so it never reaches the public repo. **Never paste it into chat.**

**D. The YouTube API audit (why start now)**
Google locks uploads from new, unaudited API projects to **private**, even when we ask for public. The fix is a free audit:
10. Fill in the **YouTube API Services: Audit and Quota Extension Form** (search that name; it's on Google's support site).
11. What to say: **drafted in `docs/YOUTUBE_AUDIT.md`** (fill in the [BRACKETS]). The privacy policy is `docs/privacy/index.html`; switch on GitHub Pages (steps at the end of that file) so it's live at https://sromovski.github.io/LaunchPad/privacy/, and tell me which **contact email** to put in it (it will be public).
   - **What it is:** a private, single-user tool that uploads your own videos to your own channel after you approve each one by hand. No other users, no viewing or storing of other people's data.
   - **API use:** `videos.insert` only, about 1–2 uploads a day, with `selfDeclaredMadeForKids: true`.
   - They may ask for a **privacy policy URL** and a **screen recording** of the app. I can write a one-page privacy policy (e.g. hosted free on GitHub Pages from this repo) and you'd record the review site's approve flow.
12. Replies usually take days to weeks. Until then, uploads land as **private** and you'd flip them to public by hand, which still works for testing.

**E. Connect Launchpad to the channel (once, after A–C):** in a terminal in `C:\Projects\LaunchPad` run **`npm run youtube:auth`**. A browser opens: sign in and pick **Blast of Facts** on Google's channel picker (you'll see an "unverified app" warning; click *Advanced → continue*). It only saves the login if you picked Blast of Facts. From then on the 16:00 job posts one approved video a day and adds it to **Mars Facts for Kids** (it creates the playlist if you haven't). To check what would go next without posting: `npm run publish -- --dry-run`. To post one right now: `npm run publish`.

### Other
- **ffmpeg on PATH (optional):** ffmpeg 9.0.2 is installed via winget but isn't on PATH in all shells. Launchpad finds it anyway (winget folder fallback). To use it from your own terminal, open a new one or run `winget install Gyan.FFmpeg --force`.
- **Facebook:** on hold until YouTube posting is fully proven (Thomas, 2026-09-27). Nothing needed yet.

## Done
- 2026-09-28 — Google Cloud project `launchpad-uploader` set up, app **In production**, `sromovski.github.io` verified in Search Console, and `npm run youtube:auth` connected to **Blast of Facts** (UCHhHYjq4K0sERPPR2od5kRw). Tip: in Google's picker the channel still showed its old name **Story_Clips**, under sromovski@gmail.com; the account named "Blast of Facts" is the BlastofFacts04 Gmail, which has no channel.
- 2026-09-27 — Hand-posted video 2 to Blast of Facts: https://www.youtube.com/shorts/6qJq2lvEuV0 (recorded with `npm run video:mark-posted`; status `published`).
- 2026-09-27 — Renamed the Story_Clips YouTube channel to **Blast of Facts**: handle, description, profile picture + banner from `assets/channel/`, audience set to made for kids.
- 2026-09-27 — Approved Playwright Chromium install (headless shell, ~115 MB, in %LOCALAPPDATA%\ms-playwright).
- 2026-09-26 — Approved installs: ffmpeg (already present via winget), whisper.cpp b5130 + `ggml-base.en` into `tools/whisper/`, Kokoro q8 model (auto-downloaded to the Hugging Face cache).
