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

- [x] Why are coral reefs so colorful? | query: coral reef — video 94 in review
- [x] Where do big waves come from? | query: ocean waves — video 96 in review
- [x] Why does the Pacific Ocean sometimes get extra warm? | query: el nino — video 100 in review

- [ ] What are the ocean's biggest whirlpools? | query: ocean eddies
- [ ] What is a tsunami? | query: tsunami
- [ ] What is a mangrove forest? | query: mangrove

## Volcanoes | playlist: Volcanoes for Kids

- [x] What does a volcano look like from space? | query: volcano eruption from space — video 43 in review
- [x] Can a volcano make a brand-new island? | query: new island volcano — video 47 in review
- [x] Where does lava come from? | query: lava kilauea — video 49 in review
- [x] How far can volcano ash travel? | query: volcanic ash plume — video 51 in review

- [x] What is an earthquake? | query: earthquake — video 102 in review
- [x] How tall is the tallest mountain? | query: mount everest — video 104 in review

- [ ] How do mountains grow? | query: himalayas
- [ ] How was the Grand Canyon made? | query: grand canyon
- [ ] How did Hawaii get its islands? | query: hawaiian islands
- [ ] Why do Yellowstone geysers shoot water? | query: yellowstone
- [ ] What is a landslide? | query: landslide

## Wild Weather | playlist: Wild Weather for Kids

- [x] Where does lightning come from? | query: lightning — video 55 in review
- [x] How do clouds form? | query: clouds formation — video 57 in review
- [x] What is a tornado? | query: tornado — video 59 in review
- [x] Why does it rain? | query: rainfall precipitation gpm — video 61 in review
- [x] How can dust from Africa cross the ocean? | query: saharan dust — video 63 in review
- [~] How big can a snowstorm get? | query: blizzard snowstorm satellite — no NASA video or pictures found (2026-10-07 scan)

- [x] What makes the wind blow? | query: global winds — video 106 in review
- [x] What happens in a flood? | query: flooding satellite — video 113 in review
- [x] What is a drought? | query: drought — video 114 in review
- [x] What is a rainbow? | query: rainbow — video 117 in review

- [ ] What is the jet stream? | query: jet stream
- [ ] What are the highest clouds in the sky? | query: noctilucent clouds
- [ ] How do we know what the weather will be? | query: weather satellite
- [ ] What is hail? | query: hail storm
- [ ] Why do clouds make giant swirls? | query: von karman vortices

## Ice and Snow | playlist: Ice and Snow for Kids

- [x] What is a glacier? | query: glacier — video 65 in review
- [x] Why does the Arctic ice grow and shrink? | query: arctic sea ice — video 67 in review
- [x] How much ice covers Antarctica? | query: antarctica ice sheet — video 69 in review
- [x] How do icebergs break off? | query: iceberg calving — video 71 in review

- [x] How big is Greenland's ice? | query: greenland ice sheet — video 119 in review
- [x] How do scientists read old ice? | query: ice core — video 121 in review
- [x] What does snow do for our planet? | query: snow cover — video 123 in review

- [ ] How do scientists fly over the ice? | query: operation icebridge
- [ ] What is permafrost? | query: permafrost

## Our Amazing Planet | playlist: Our Wild Planet

- [x] Why do we have seasons? | query: earth seasons — video 73 in review
- [x] How do wildfires look from space? | query: wildfire smoke satellite — video 75 in review
- [x] Why is the sky blue? | query: earth atmosphere blue sky — video 87 in review
- [~] How big is the Amazon rainforest? | query: amazon rainforest — auto-skipped after 2 failed videos (81, 83): QA: caption splits 'Rondônia' into 'Rond'/'nia'. Pipeline bug: words() in src/script/readability.ts only matches ASCII letters
- [x] What does Earth look like at night? | query: earth at night city lights — video 85 in review
- [x] Why is there day and night? | query: earth rotation day night — video 89 in review
- [x] How big is the Sahara desert? | query: sahara desert — video 125 in review
- [x] Why do rivers wiggle? | query: river meander — video 129 in review
- [x] Where do rivers meet the sea? | query: river delta — video 131 in review
- [x] How does Earth turn green in spring? | query: vegetation seasons earth — video 135 in review
- [x] How big are the Great Lakes? | query: great lakes — video 137 in review
- [x] How do sand dunes move? | query: sand dunes — video 140 in review

<!-- Added 2026-11-06 to take the channel to 60 (Thomas). 21 topics for 19 slots: spares cover failures, and the cap stops builds at 60. -->

- [ ] How long is the Nile River? | query: nile river
- [ ] Why do some farms look like circles from space? | query: center pivot irrigation
- [ ] What is the ozone layer? | query: ozone layer
- [ ] What is a salt flat? | query: salt flat
- [ ] What happened to the Aral Sea? | query: aral sea
- [ ] What is the deepest lake? | query: lake baikal
