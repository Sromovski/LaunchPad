# YouTube API audit: step by step

**Why:** a new Google Cloud project can upload videos, but YouTube forces every one of them to **private**, even when we ask for public. The audit lifts that. It's free. It is **not** a request for more quota: our one upload a day uses about 1,650 of the free 10,000 units.

**The form:** https://support.google.com/youtube/contact/yt_api_form ("YouTube API Services – Audit and Quota Extension Form"). It's long, and it asks for **screenshots as file uploads**, so do these first:

## Before you open the form (in this order)

1. **Pick a public contact email** (e.g. a new free `blastoffacts@gmail.com`) and tell Claude. It goes into the three web pages below.
2. **Switch on GitHub Pages:** github.com/Sromovski/LaunchPad → **Settings → Pages** → Source: *Deploy from a branch* → **main** / **/docs** → Save. After about a minute these are live:
   - Homepage: `https://sromovski.github.io/LaunchPad/`
   - Privacy policy: `https://sromovski.github.io/LaunchPad/privacy/`
   - Terms of service: `https://sromovski.github.io/LaunchPad/terms/`
3. **Do the Google Cloud setup** (steps A–C in `NEEDS_FROM_THOMAS.md`).
4. **Run `npm run youtube:auth`** and take screenshots of each Google screen as you go (**Win + Shift + S**, then paste into Paint and save as PNG): the account/channel picker, the "unverified app" warning, and the permission screen. These are the **OAuth flow screenshots**.
5. **Run `npm run publish` once.** The video will land as private, which is expected. Screenshot the terminal output and the video in YouTube Studio (Made for Kids on, in the playlist). These are the **upload screenshots**.
6. Tell Claude when Pages is live. Claude will take the **privacy policy, homepage and terms screenshots** and put all screenshots in `exports/audit/`.

## The form, section by section

### 1. Request type
- **Select the reason for your request:** *Complete a compliance audit to request for additional quota.* This is the option for a first audit, even though we don't want more quota.

### 2. Organization and contact
- **Are you applying:** *As an individual user*
- **Your full legal name:** [your name]
- **Your organization's legal name:** your own name again (individuals are asked this too), or "Blast of Facts" if you prefer
- **Primary website:** `https://sromovski.github.io/LaunchPad/`
- **Legal address:** your address (required; Google doesn't publish it)
- **Category:** *Education and E-Learning*
- **Organization size/type:** *Independent Developer/Sole Proprietor*
- **Primary contact:** your name and the contact email. Tick "Same as primary contact" for the technical and business contacts.

### 3. Business model
- **Describe your organization's work as it relates to YouTube** (paste this):
  > I run Blast of Facts, a YouTube channel of short science videos for kids ages 6–10 (currently about Mars), made from public NASA imagery with a kid-level explanation, narration, captions and full credits. I review and approve every video by hand. Launchpad uploader is my own private tool that uploads one approved video per day to my channel, sets "Made for Kids", and adds it to the channel's playlist. It has one user (me), is not offered to anyone else, and never reads data about viewers.
- **Target audience:** *Internal Users*. The tool is only for me. The channel's audience is kids, but the form asks who uses the API client.
- **How does it monetize:** *Free service (we do not charge users)*
- **Google/YouTube Partner Manager:** *No*
- **How did you learn about the API:** *Google Developer Documentation*
- **Content Owner ID / Ads Customer ID:** leave empty. If there's a "YouTube channel URL" box, add the Blast of Facts channel URL.

### 4. API client
- **API client name:** `Launchpad uploader`
- **Name contains "YouTube":** *No*
- **Primary access URL:** `https://sromovski.github.io/LaunchPad/`
- **Privacy policy URL:** `https://sromovski.github.io/LaunchPad/privacy/`
- **Terms of service URL:** `https://sromovski.github.io/LaunchPad/terms/`
- **Is your API client publicly accessible:** *No*
- **Demo account:** leave empty. It's a private desktop tool, and the screenshots show it working.

### 5. Use case and quota (for your one project)
- **How many project numbers:** *1*
- **Google Cloud project number:** the **numeric** one. In console.cloud.google.com, select the project, open the dashboard ("Project info" card), and copy the *Project number*, not the project ID.
- **Use case category:** *Video Uploading & Account Management*
- **Requires Google sign-in (OAuth 2.0):** *Yes*
- **Derived metrics / data storage:** leave unticked (we store none)
- **Expected usage volume:** *Fewer than 1,000 requests per day*
- **Required screenshots:**
  - *Privacy policy screenshots* → `exports/audit/privacy-*.png` (Claude makes these)
  - *Homepage screenshot* → `exports/audit/homepage.png` (Claude)
  - *Terms of service documentation* → `exports/audit/terms.png` (Claude)
  - *OAuth flow screenshots* → yours from step 4
  - *Upload interface screenshots* → yours from step 5, plus `exports/audit/review-approve.png` (Claude: the approve screen)
- **Endpoints you plan to use:** tick exactly these five:
  - `youtube.channels.list`
  - `youtube.playlists.list`
  - `youtube.playlists.insert`
  - `youtube.playlistItems.insert`
  - `youtube.videos.insert`
- **Total quota requested:** *No change / Default quota (10k quota points)*
- **If it asks separately about `videos.insert` quota:** keep the default. Justification: "One upload per day (1,600 units); the default 10,000 units/day is enough. We only need the private-upload restriction lifted."

### Submit
Google says someone from the YouTube API team "will contact you as soon as possible". Replies often take days to a few weeks, sometimes with follow-up questions: forward them to Claude to draft answers. Until approval, the daily job keeps posting, but videos land as **private** and the review site flags them so you can make them public in Studio.

Sources: [Quota and Compliance Audits (Google)](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits); [the form](https://support.google.com/youtube/contact/yt_api_form), checked 2026-09-27.
