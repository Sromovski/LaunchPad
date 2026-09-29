# YouTube channel playbook

How we set up **Blast of Facts** for automatic posting (September 2026), written so it can be repeated for a new channel. Everything here is free.

Google changes these screens often. If a button name doesn't match, look for the nearest equivalent.

**What you end up with:** a YouTube channel that Launchpad posts approved videos to twice a day, public, marked Made for Kids, added to the right playlist, with nothing posted unless you clicked Approve.

**Time:** about 2 hours the first time, most of it in Google Cloud and Search Console. A second channel reuses most of it (see the end).

---

## Part 1 — Create the channel

1. **Own it from your main Google login, as a Brand Account channel.** In YouTube: profile picture → **Settings → Add or manage your channel(s) → Create a channel**, and give it the new name. That makes a Brand Account that your main login owns.
   - Don't create a separate Gmail for the channel. We made one for Blast of Facts (it's now the public contact address) and it caused confusion later: Google's sign-in listed an *account* called "Blast of Facts" that had no channel at all.
   - Blast of Facts was an older channel (Story_Clips) renamed. Google's channel picker kept showing the **old name** for a day or so.
2. **YouTube Studio → Customization:** name, handle, description, profile picture and banner. For Blast of Facts these are in `assets/channel/`.
   - Never put "NASA" in the channel name or logo, and never use NASA logos (CLAUDE.md §11).
3. **YouTube Studio → Settings → Channel → Advanced settings → Audience: "Yes, set this channel as made for kids."** Our uploads also set Made for Kids on every video.
4. **Copy the channel ID.** YouTube Studio → Settings → Channel → Advanced settings, or the `UC…` part of `youtube.com/channel/UC…`. Blast of Facts is `UCHhHYjq4K0sERPPR2od5kRw`. Launchpad checks the channel by this ID, not the name, because names can be renamed or differ in capitals.

## Part 2 — Public web pages (homepage, privacy policy, terms)

Google's consent screen asks for a homepage, a privacy policy and terms of service on a domain you've proved you own. We host them free on GitHub Pages.

5. Pages for this project are in `docs/`: `index.html`, `privacy/`, `terms/`. **GitHub repo → Settings → Pages → Deploy from branch `main`, folder `/docs`.** They're live at:
   - https://sromovski.github.io/LaunchPad/
   - https://sromovski.github.io/LaunchPad/privacy/
   - https://sromovski.github.io/LaunchPad/terms/
6. The pages give a **public contact email** (BlastofFacts04@gmail.com). Use one you don't mind being public.
7. **Proving you own the domain needs the site root**, not the project folder. Google checks `sromovski.github.io`, and a project site only lives at `/LaunchPad/`. So we made a second repo named exactly **`Sromovski.github.io`** (the "user site"), which serves the root. It holds:
   - `index.html`, which just forwards to `/LaunchPad/`
   - the Search Console verification file (Part 4)

## Part 3 — Google Cloud project

Signed in with the login that owns the channel, at https://console.cloud.google.com:

8. **Create a project** (ours: `launchpad-uploader`).
9. **APIs & Services → Library → YouTube Data API v3 → Enable.**
10. **Google Auth Platform** (older consoles call it "OAuth consent screen"):
    - **Branding:** app name (`Launchpad uploader`), support email, developer contact email.
      - Fill in the **homepage, privacy policy and terms links** from Part 2.
      - Add the **authorized domain** `sromovski.github.io`.
      - Leave the logo empty; a logo triggers a longer Google review.
    - **Audience:** External. Add your own Google address under **Test users**. Without this, sign-in fails with **"Access blocked"**.
    - **Data access (scopes):** `https://www.googleapis.com/auth/youtube`. The upload-only permission can't add videos to playlists, so full automation needs this one.
11. **Clients → Create OAuth client → Desktop app** (ours: `launchpad-desktop`). **Download JSON** and save it as `C:\Projects\LaunchPad\data\google\client_secret.json`.
    - `data/` is gitignored, so it never reaches the public repo.
    - **Never paste it into chat or email.**
12. **Audience → Publish app → In production.** While the app is in *Testing*, Google's login expires every **7 days**, which breaks unattended posting.
    - The **Publish app** button stays greyed out until Branding is complete, including the homepage, privacy policy, terms and a *verified* authorized domain (Part 4).
    - The Branding check may still say the homepage "is not registered to you" even after verification. We published anyway and it worked.
    - Signing in then shows an **"unverified app"** warning. That's normal for a personal tool: click **Advanced → Go to … (unsafe)**. Full Google verification isn't needed for one user.

## Part 4 — Verify the domain (Search Console)

13. https://search.google.com/search-console → **Add property → URL prefix** → `https://sromovski.github.io/`.
14. Choose **HTML file** verification. Download the file (ours: `google927c01bcaa60b347.html`), commit it to the **root of the user-site repo** (`Sromovski.github.io`), wait a minute for Pages to publish, then click **Verify**.
    - If Search Console instead shows "Add a platform account or channel…", that's its newer wizard. Choose the **URL prefix** property type instead.
15. Check: Search Console → the property → **Settings → Ownership verification** should say you're the owner. The Cloud project's authorized domain then counts as verified.

## Part 5 — Connect Launchpad to the channel

16. In a terminal in `C:\Projects\LaunchPad`: **`npm run youtube:auth`**. A browser opens:
    - Pick your **main Google login** (the one that owns the channel), *not* the channel's contact Gmail.
    - On the next screen, pick the **channel** from the Brand Account list. It may still show an old name, as Blast of Facts showed "Story_Clips".
    - Get past the "unverified app" warning (step 12) and allow access.
17. It only saves the login if the channel ID matches. Success prints `"ok": true` with the channel ID. It saves `data/google/token.json` (gitignored, and agents are blocked from reading it).
    - If it says **"this Google login has no YouTube channel"**, you picked the wrong account in the first screen. Run it again.

## Part 6 — First posts

18. **Optional hand post first.** We posted video 2 ourselves in YouTube Studio (Create → Upload), set Made for Kids, then recorded it with `npm run video:mark-posted`.
    - Altered/synthetic content question: a generic AI narrator over real NASA pictures isn't "realistic altered content", so **No** is the usual answer. The description already says the narration voice is AI-generated.
19. **`npm run publish -- --dry-run`** shows what would post next without posting.
20. **`npm run publish`** posts one approved video now. Check it on YouTube: visibility **Public**, Made for Kids, in the right playlist.
21. Scheduled posting: `npm run schedule:install` adds Task Scheduler jobs. Videos are made at 07:00 and 15:00 and posted at 08:00 and 16:00. Only videos you've **approved** in the review site are ever posted.

## Part 7 — The API audit (turned out optional)

Google says uploads from new, unaudited API projects are locked to **private**. Ours came out **public** from the first automatic post, so we haven't needed the audit.

If a new project's uploads do come out private:
- Fill in the **YouTube API Services: Audit and Quota Extension Form**.
- Answers are drafted in `docs/YOUTUBE_AUDIT.md`, and screenshots are in `exports/audit/`.
- Launchpad re-checks each post's visibility on every posting run.

## Limits worth knowing

- `videos.insert` (the upload) has its own allowance: **100 uploads/day** per Cloud project.
- Everything else (playlists, checks) shares **10,000 units/day**; one post uses about 53.
- The real ceiling is the channel's own daily upload cap (not published; roughly 10–20/day for newer channels) and YouTube's spam and repeated-content rules. At 2 posts a day we're far below all of these.

## Snags we hit (and the fix)

| What happened | Fix |
|---|---|
| "Access blocked" at sign-in | Add yourself as a **Test user** (Part 3, step 10) |
| **Publish app** greyed out | Finish **Branding**: homepage, privacy, terms, verified authorized domain |
| Domain wouldn't verify for `/LaunchPad/` | Verify the **root** via the user-site repo `Sromovski.github.io` |
| Branding says homepage "not registered to you" | Publish to production anyway; it worked |
| `youtube:auth`: "no YouTube channel" | Pick the **main login**, then the Brand Account channel (not the contact Gmail) |
| Channel showed under its old name | Normal for a while after renaming; pick it anyway (checked by ID) |
| Login expiring weekly | App must be **In production**, not Testing |

---

## Checklist: a second channel

**Reuse:**
- The same Google Cloud project, OAuth client and consent screen. One project can post to several channels you own, and the quotas above are per project, which is plenty at 2 posts a day per channel.
- The same user-site domain (`sromovski.github.io`), already verified. Just add pages for the new channel, e.g. a new repo or folder with its own homepage/privacy/terms, and add those links wherever the new channel lists a website.

**Do again:**
- Part 1 (new Brand Account channel under your main login: name, handle, art, Made for Kids if it's for kids, channel ID).
- Part 5 (`youtube:auth` for the new channel).
- Part 6 (test post).

**Code change needed:** Launchpad currently knows **one** channel. `src/publish/config.ts` holds the channel ID, and there's a single `data/google/token.json`. A second channel needs:
- a channel setting per project or per topic list,
- a token file per channel,
- its own playlists.

This is a small change; ask Claude when you're ready.

**Another platform:** Facebook Reels is **on hold** until Thomas says to start it.
