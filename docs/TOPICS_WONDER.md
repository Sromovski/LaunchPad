# Topics backlog — I Wonder Why

`/make-video --channel wonder` with no topic takes the first open line. Edit freely: reorder, add, delete.
Format: `- [ ] Question kids would ask | query: NASA library search words`.
`[x]` = video reached review, `[~]` = skipped (reason after the dash). Code updates this file (`npm run topics:mark -- --channel wonder`).
A topic whose videos fail twice is skipped automatically (`[~] auto-skipped…`). To try it again, reopen it with a reworded question, or run `/make-video --channel wonder <topic>` by hand.
Each `## World | playlist: Name` heading sets the YouTube playlist for the topics below it (created on first use).

Scope: our planet, seen with NASA footage (oceans, volcanoes, weather, ice, the sky). Space topics belong to Blast of Facts (`docs/TOPICS.md`); don't repeat them here.

<!-- Order within each world: most rights-clear NASA video/images first (topics:check -- --channel wonder, 2026-10-07).
     Most NASA Earth videos credit Goddard producers by name, which the credit checker sends to rights review. -->

## Oceans | playlist: Ocean Facts for Kids

- [x] Why does the ocean swirl? | query: ocean currents — video 30 in review
- [x] Why is the ocean salty? | query: ocean salinity — video 33 in review
- [x] What makes ocean tides? | query: ocean tides — video 35 in review
- [x] Why does the sea turn green and blue? | query: phytoplankton bloom — video 36 in review
- [x] How do we measure the height of the sea? | query: sea level satellite — video 37 in review

- [ ] Why are coral reefs so colorful? | query: coral reef
- [ ] Where do big waves come from? | query: ocean waves
- [ ] Why does the Pacific Ocean sometimes get extra warm? | query: el nino

## Volcanoes | playlist: Volcanoes for Kids

- [x] What does a volcano look like from space? | query: volcano eruption from space — video 43 in review
- [x] Can a volcano make a brand-new island? | query: new island volcano — video 47 in review
- [x] Where does lava come from? | query: lava kilauea — video 49 in review
- [x] How far can volcano ash travel? | query: volcanic ash plume — video 51 in review

- [ ] What is an earthquake? | query: earthquake
- [ ] How tall is the tallest mountain? | query: mount everest

## Wild Weather | playlist: Wild Weather for Kids

- [x] Where does lightning come from? | query: lightning — video 55 in review
- [x] How do clouds form? | query: clouds formation — video 57 in review
- [x] What is a tornado? | query: tornado — video 59 in review
- [x] Why does it rain? | query: rainfall precipitation gpm — video 61 in review
- [x] How can dust from Africa cross the ocean? | query: saharan dust — video 63 in review
- [~] How big can a snowstorm get? | query: blizzard snowstorm satellite — no NASA video or pictures found (2026-10-07 scan)

- [ ] What makes the wind blow? | query: global winds
- [ ] What happens in a flood? | query: flooding satellite
- [ ] What is a drought? | query: drought
- [ ] What is a rainbow? | query: rainbow

## Ice and Snow | playlist: Ice and Snow for Kids

- [x] What is a glacier? | query: glacier — video 65 in review
- [x] Why does the Arctic ice grow and shrink? | query: arctic sea ice — video 67 in review
- [x] How much ice covers Antarctica? | query: antarctica ice sheet — video 69 in review
- [x] How do icebergs break off? | query: iceberg calving — video 71 in review

- [ ] How big is Greenland's ice? | query: greenland ice sheet
- [ ] How do scientists read old ice? | query: ice core
- [ ] What does snow do for our planet? | query: snow cover

## Our Amazing Planet | playlist: Our Wild Planet

- [x] Why do we have seasons? | query: earth seasons — video 73 in review
- [x] How do wildfires look from space? | query: wildfire smoke satellite — video 75 in review
- [x] Why is the sky blue? | query: earth atmosphere blue sky — video 87 in review
- [~] How big is the Amazon rainforest? | query: amazon rainforest — auto-skipped after 2 failed videos (81, 83): QA: caption splits 'Rondônia' into 'Rond'/'nia'. Pipeline bug: words() in src/script/readability.ts only matches ASCII letters
- [x] What does Earth look like at night? | query: earth at night city lights — video 85 in review
- [x] Why is there day and night? | query: earth rotation day night — video 89 in review
- [ ] How big is the Sahara desert? | query: sahara desert
- [ ] Why do rivers wiggle? | query: river meander
- [ ] Where do rivers meet the sea? | query: river delta
- [ ] How does Earth turn green in spring? | query: vegetation seasons earth
- [ ] How big are the Great Lakes? | query: great lakes
- [ ] How do sand dunes move? | query: sand dunes
