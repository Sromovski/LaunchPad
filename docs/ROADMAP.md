# ROADMAP.md — I Wonder Why (Launchpad)

> Future ideas and decisions. **Do not build anything in "Later" sections until Phases 1–4 in CLAUDE.md are done and Thomas says go.**

## Channel decisions (done)

- YouTube channel created: display name **I Wonder Why**, handle **@I_Wonder_Why** (Brand Account under Thomas's Google account), channel ID `UCqNwPn4hm_lMSOhHdXcfMig`.
- Runs **alongside Blast of Facts** (Thomas, 2026-10-07), two videos a day: key `wonder` in `src/channels.ts`, topics in `docs/TOPICS_WONDER.md`. See DECISIONS.md 2026-10-07.
- Channel-level audience: **Made for Kids**.
- Channel art (banner + profile picture) is made. Night-sky look: indigo `#2B2766`, yellow accent `#FFC93C`, sky blue `#6EC6FF`, coral `#FF7A59`. Fonts: Fredoka (headings), Nunito (body). Videos use the yellow for the highlighted caption word and the thumbnail title, and an indigo end-card tint; video text stays Fredoka.
- YouTube login: `npm run youtube:auth -- --channel wonder`, then pick the **I Wonder Why** channel at the consent screen (not Thomas's personal channel, not Blast of Facts). Saved separately in `data/google/token-wonder.json`.
- Scope: kid science about our planet. Starts with NASA Earth-science footage (oceans, volcanoes, weather, ice, the sky); animals, history of flight etc. come with the Phase 5 sources. Space stays on Blast of Facts.

## Later: Phase 5 — more public-domain sources

Each source = one new search/fetch adapter in `src/sources/<name>/`, using the same credit checker, script, render, and review flow. Federal works are generally public domain, but **every item's credit line still goes through the credit checker** (agencies sometimes host contractor or outside-photographer work).

| Source | What it's good for | Notes |
|---|---|---|
| NOAA Ocean Exploration | Deep-sea creatures, glowing animals, ROV footage | Best kids source after NASA |
| NOAA satellites (GOES) | Hurricanes, lightning, wildfire smoke from space | Time-lapses |
| USGS | Volcanoes (Kīlauea lava), earthquakes, geysers | |
| National Park Service | Yellowstone geysers, bison, Grand Canyon | Some photos credited to outside photographers |
| US Fish & Wildlife Service | Wildlife video and photos | |
| DVIDS (US military media) | Jets, carrier landings, rescues | Skip anything combat-related |
| CDC / NIH image libraries | Microscope images of germs and cells | Some items are Creative Commons, not public domain: check each license |
| Smithsonian Open Access | Fossils, gems, Wright Flyer, Apollo artifacts | CC0; mostly stills (use Ken Burns) |
| Library of Congress / National Archives | Historic films (e.g., Wright brothers 1903) | Check each item's rights statement |
| Internet Archive (Prelinger) | Old educational films, newsreels | Modern restorations or added soundtracks may be copyrighted |
| Pexels / Pixabay | Generic b-roll only | Free license; never the main content |

Not usable as-is: ESA (often CC BY-SA, needs attribution and share-alike: treat as needs_review), TED (no derivatives, non-commercial), any news broadcast, sports, movies, TV.

## Later: topic backlog beyond Mars

- This fish glows in the dark (NOAA deep sea)
- What does lava sound like? (USGS)
- A hurricane seen from space (NOAA GOES)
- Why does Old Faithful erupt on schedule? (NPS)
- How does a jet land on a moving ship? (DVIDS)
- The first airplane flight ever filmed (Library of Congress)
- What a germ looks like up close (CDC)
