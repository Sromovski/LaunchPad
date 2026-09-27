# YouTube API audit: draft answers

For the **YouTube API Services: Audit and Quota Extension Form**. Google changes the form's wording from time to time. Match each answer below to the closest question, and fill in the `[BRACKETS]`.

**Why we're submitting:** API projects that haven't been audited can only upload **private** videos. The audit lifts that. We are **not** asking for more quota: the free 10,000 units/day covers about 6 uploads, and we do one a day.

---

## You / your organization

- **Individual or organization:** Individual (channel owner).
- **Name:** [YOUR FULL NAME]
- **Email:** [CONTACT EMAIL] (the same one as in the privacy policy)
- **Country:** [COUNTRY]
- **Website / privacy policy URL:** `https://sromovski.github.io/LaunchPad/privacy/` (after GitHub Pages is switched on; see the end of this file)

## Your API client

- **Google Cloud project ID / number:** [from console.cloud.google.com → project picker, e.g. `launchpad-uploader`]
- **OAuth client ID:** [from APIs & Services → Credentials, "launchpad-desktop"]. Only the ID, **never** the client secret.
- **App name:** Launchpad uploader
- **Type:** Desktop application, used only by me on my own computer.
- **YouTube channel(s) it acts for:** Blast of Facts, [CHANNEL URL, e.g. https://www.youtube.com/@BlastOfFacts]. It checks the signed-in channel before every upload and refuses to post anywhere else.
- **Number of users:** 1 (me). It is not offered to anyone else.
- **API services used:** YouTube Data API v3.

## What it does (use case)

> Launchpad uploader is a private, single-user tool that posts my own videos to my own YouTube channel, "Blast of Facts", a channel of short science videos for kids ages 6–10.
>
> I review every video myself on a local review page and approve it by hand. Once a day, the tool uploads **one** approved video to my channel with the title, description and tags I approved. It sets `selfDeclaredMadeForKids: true` on every upload and adds the video to my channel's "Mars Facts for Kids" playlist.
>
> The videos are original edits of public NASA imagery, with an explanation for kids, narration (AI-generated voice, disclosed in every description), captions and credits. They are never re-uploads of raw clips.

## Which API calls and why

| Method | Why | Units/day |
|---|---|---|
| `channels.list` (`mine=true`, `part=snippet`) | Check it's signed in to Blast of Facts before uploading | 1 |
| `playlists.list` (`mine=true`) / `playlists.insert` (once) | Find or create the "Mars Facts for Kids" playlist | 1 |
| `videos.insert` | Upload one approved video | 1,600 |
| `playlistItems.insert` | Add that video to the playlist | 50 |
| **Total** | | **≈ 1,652 of 10,000** |

- **OAuth scope:** `https://www.googleapis.com/auth/youtube`. It's needed because `youtube.upload` alone can't add videos to playlists. The tool never deletes, edits or reads anything else on the channel.
- **Quota extension requested:** No.

## Data handling

- **Does the client show YouTube data to other users?** No. There are no other users and no public interface.
- **What YouTube data is stored?** Only what's needed to avoid double posting: for each upload, the video ID, its link, visibility and date, plus the playlist ID. It's stored in a local database on my computer.
- **Tokens:** the OAuth refresh token is stored in a local file on my computer, outside the code repository. It is never shared.
- **Data about viewers:** none. No comments, analytics, subscribers or watch data are accessed.
- **Sharing or selling data:** none.
- **Deletion:** I can revoke access at myaccount.google.com/permissions, or delete the local token file. The privacy policy explains this.
- **Made for Kids:** every upload sets `selfDeclaredMadeForKids: true`, and the channel's audience is set to "made for kids". No personal information is collected from anyone, including children.

## Compliance

- **Terms and privacy links:** the privacy policy links to the YouTube Terms of Service and the Google Privacy Policy, explains what data is used and stored, and explains how to revoke access (YouTube API Developer Policies, section III.A).
- **Content:** original, educational, human-approved before posting, with credits to NASA sources. No NASA logos are added and no NASA endorsement is claimed.

## Screencast (if they ask)

Record 1–2 minutes of the screen (Windows: **Win + Alt + R** starts and stops recording with the Xbox Game Bar):

1. `npm run review`: show a video on http://launchpad.localhost and click **Approve**.
2. `npm run youtube:auth`: show Google's consent screen with the scope and picking **Blast of Facts**. You can stop before finishing if already connected.
3. `npm run publish`: show the terminal output with the uploaded video link.
4. Open the video in YouTube Studio: Made for Kids is on, and the video is in the playlist.

Upload the recording to **your own YouTube channel as Unlisted** and paste its link into the form.

---

## Publishing the privacy policy (free, about 2 minutes)

The repo is public, so GitHub can host the page:

1. github.com/Sromovski/LaunchPad → **Settings → Pages**.
2. **Source: Deploy from a branch** → Branch **main**, folder **/docs** → **Save**.
3. Wait about a minute, then open **https://sromovski.github.io/LaunchPad/privacy/**.

Note: this also publishes the other files in `docs/` as web pages (decision log, topic list). They're already public in the repo, so nothing new is exposed.
