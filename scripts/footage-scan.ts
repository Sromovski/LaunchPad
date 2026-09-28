/**
 * One-off planning helper: how much rights-clear NASA footage exists per candidate topic.
 * npx tsx scripts/footage-scan.ts > out.json
 */
import { search } from '../src/nasa/api.js';

const CANDIDATES: [string, string, string][] = [
  // [world, kid question, NASA search query]
  ['Moon', 'Why does the Moon change shape?', 'moon phases'],
  ['Moon', 'What did astronauts do on the Moon?', 'apollo moonwalk'],
  ['Moon', 'How will Artemis take people back to the Moon?', 'artemis'],
  ['Moon', 'Why does the Moon have so many craters?', 'moon craters'],
  ['Moon', 'Is there water on the Moon?', 'water ice moon south pole'],
  ['Space station', 'How do astronauts sleep in space?', 'astronaut sleep space station'],
  ['Space station', 'How do astronauts eat in space?', 'astronaut food space station'],
  ['Space station', 'How do astronauts go to the bathroom in space?', 'space toilet'],
  ['Space station', 'What happens to water in space?', 'water microgravity'],
  ['Space station', 'How do astronauts exercise in space?', 'astronaut exercise'],
  ['Space station', 'What is a spacewalk?', 'spacewalk'],
  ['Rockets', 'How does a rocket launch?', 'rocket launch'],
  ['Rockets', 'Why do rockets have stages?', 'rocket stage separation'],
  ['Rockets', 'How do rockets land?', 'booster landing'],
  ['Sun', 'What is a solar flare?', 'solar flare'],
  ['Sun', 'What are sunspots?', 'sunspots'],
  ['Sun', 'What makes the northern lights?', 'aurora'],
  ['Sun', 'What happens in a solar eclipse?', 'solar eclipse'],
  ['Earth', 'What does Earth look like from space?', 'earth from space'],
  ['Earth', 'How big are hurricanes from space?', 'hurricane from space'],
  ['Earth', 'What does Earth look like at night?', 'earth at night city lights'],
  ['Jupiter', 'What is the Great Red Spot?', 'great red spot'],
  ['Jupiter', 'How big is Jupiter?', 'jupiter juno'],
  ['Jupiter', 'Does Jupiter have moons with oceans?', 'europa ocean'],
  ['Saturn', 'What are Saturn’s rings made of?', 'saturn rings cassini'],
  ['Saturn', 'Does Saturn’s moon Enceladus shoot water?', 'enceladus plumes'],
  ['Saturn', 'Is there a moon with lakes?', 'titan lakes'],
  ['Small worlds', 'What did we see on Pluto?', 'pluto new horizons'],
  ['Small worlds', 'What is a comet?', 'comet'],
  ['Small worlds', 'Can we push an asteroid?', 'dart asteroid impact'],
  ['Small worlds', 'How did a spacecraft grab asteroid dirt?', 'osiris-rex sample'],
  ['Telescopes', 'What does the Webb telescope see?', 'webb telescope'],
  ['Telescopes', 'What has Hubble shown us?', 'hubble'],
];

const rows = [];
for (const [world, topic, query] of CANDIDATES) {
  const [v, i] = await Promise.all([search(query, 'video'), search(query, 'image')]);
  rows.push({
    world,
    topic,
    query,
    videos_clear: v.filter((c) => c.rights_preview === 'clear').length,
    videos: v.length,
    images_clear: i.filter((c) => c.rights_preview === 'clear').length,
    images: i.length,
    images_rejected: i.filter((c) => c.rights_preview === 'rejected').length,
  });
}
console.log(JSON.stringify(rows));
