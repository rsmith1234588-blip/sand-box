'use strict';
// Material definitions and the reaction table.
// Every cell in the world holds one material id (0..255).

const STATE = { EMPTY: 0, SOLID: 1, POWDER: 2, LIQUID: 3, GAS: 4, FIRE: 5 };

const MATS = [];   // id -> material
const ID = {};     // key -> id

function material(key, props) {
  const m = Object.assign({
    key,
    name: key[0].toUpperCase() + key.slice(1),
    state: STATE.SOLID,
    density: 10,      // heavier things sink through lighter liquids/gases
    color: '#ffffff',
    vary: 0.08,       // per-grain brightness variation
    flow: 0,          // liquids: how far they spread sideways per step
    moveChance: 1,    // < 1 makes things sluggish (lava)
    life: null,       // [min, max] frames before expiring
    expire: null,     // { into, p } what it turns into when life runs out
    decay: null,      // { into, p } spontaneous change each frame
    burn: null,       // { chance, life:[min,max], into, intoChance, free }
    explode: 0,       // explosion radius when ignited
    blast: 1,         // 0..1 how easily explosions destroy it (solids)
    hot: 0,           // ignites neighbours like fire (0..1 strength)
    glow: false,      // flickers
    sink: false,      // gases: heavier than air, sinks
    dissolve: 0,      // chance acid eats it per contact
    indestructible: false,
    category: null,   // palette group; null = hidden
    desc: '',
  }, props);
  m.id = MATS.length;
  MATS.push(m);
  ID[key] = m.id;
  return m;
}

// ---------------------------------------------------------------- materials
material('empty', { state: STATE.EMPTY, density: 0, name: 'Empty' });

// Powders
material('sand', { state: STATE.POWDER, density: 3, color: '#d9c27a', category: 'Powders',
  dissolve: 0.05, desc: 'Piles up. Lava melts it into glass.' });
material('salt', { state: STATE.POWDER, density: 2.8, color: '#eeeeee', vary: 0.04, category: 'Powders',
  dissolve: 0.1, desc: 'Dissolves in water. Melts ice.' });
material('snow', { state: STATE.POWDER, density: 1, color: '#f4f8ff', vary: 0.03, category: 'Powders',
  dissolve: 0.2, desc: 'Light and fluffy. Melts near heat or salt.' });
material('ash', { state: STATE.POWDER, density: 2.2, color: '#6e6a66', category: 'Powders',
  dissolve: 0.1, desc: 'What is left after wood and plants burn.' });

// Liquids
material('water', { state: STATE.LIQUID, density: 2, flow: 5, color: '#2f6fdc', vary: 0.04, category: 'Liquids',
  desc: 'Puts out fire. Turns lava into stone.' });
material('saltwater', { name: 'Salt Water', state: STATE.LIQUID, density: 2.05, flow: 5, color: '#3d8ac4', vary: 0.04,
  category: 'Liquids', desc: 'Rusts metal fast. Boils away to leave salt.' });
material('oil', { state: STATE.LIQUID, density: 1.5, flow: 3, color: '#5b3a1a', vary: 0.05, category: 'Liquids',
  burn: { chance: 0.3, life: [20, 50], free: true }, desc: 'Floats on water. Very flammable.' });
material('lava', { state: STATE.LIQUID, density: 2.6, flow: 2, moveChance: 0.35, color: '#ff5a1f', vary: 0.15,
  hot: 0.6, glow: true, category: 'Liquids', desc: 'Molten rock. Sets things on fire, melts metal.' });

// Solids
material('wall', { color: '#5a5f6b', vary: 0.03, indestructible: true, category: 'Solids',
  desc: 'Indestructible. Nothing gets through.' });
material('stone', { color: '#8a8580', blast: 0.4, dissolve: 0.03, category: 'Solids',
  desc: 'Tough rock. Acid eats it slowly.' });
material('wood', { color: '#7a5230', blast: 1, dissolve: 0.08, category: 'Solids',
  burn: { chance: 0.02, life: [60, 120], into: 'ash', intoChance: 0.35 }, desc: 'Burns slowly into ash.' });
material('plant', { color: '#3fa34d', blast: 1, dissolve: 0.15, category: 'Solids',
  burn: { chance: 0.06, life: [20, 40], into: 'ash', intoChance: 0.2 }, desc: 'Grows into water. Chlorine kills it.' });
material('metal', { color: '#a9b4bf', vary: 0.04, blast: 0.1, dissolve: 0.02, category: 'Solids',
  desc: 'Conducts electricity. Rusts in water (faster in salt water). Lava melts it.' });
material('rust', { color: '#9a4e24', vary: 0.12, blast: 0.6, dissolve: 0.15, category: 'Solids',
  desc: 'Corroded metal. Acid eats it quickly.' });
material('glass', { color: '#a8d8e0', vary: 0.03, blast: 1, category: 'Solids',
  desc: 'Acid-proof. Great for holding chemicals.' });
material('ice', { color: '#bfe6ff', vary: 0.04, blast: 1, dissolve: 0.1, category: 'Solids',
  desc: 'Slowly freezes nearby water. Salt and heat melt it.' });

// Energy
material('fire', { state: STATE.FIRE, density: 0.1, life: [25, 55], color: '#ff8c1a', category: 'Energy',
  desc: 'Burns wood, plants, oil, hydrogen. Water puts it out.' });
material('gunpowder', { state: STATE.POWDER, density: 2.9, color: '#3b3b40', vary: 0.1, category: 'Energy',
  burn: { chance: 0.8, life: [2, 4] }, explode: 5, dissolve: 0.08, desc: 'Explodes when lit. Chains together.' });
material('smoke', { state: STATE.GAS, density: 0.3, life: [80, 160], color: '#4a4a50', vary: 0.1, category: 'Energy',
  desc: 'Drifts up and fades.' });
material('steam', { state: STATE.GAS, density: 0.2, life: [100, 200], expire: { into: 'water', p: 0.35 },
  color: '#c8d4e0', vary: 0.05, category: 'Energy', desc: 'Rises, then condenses back into water.' });

// Chemicals
material('acid', { state: STATE.LIQUID, density: 2.1, flow: 4, color: '#9cff3a', vary: 0.06, category: 'Chemicals',
  desc: 'Dissolves almost everything except glass and wall.' });
material('lye', { name: 'Lye (base)', state: STATE.LIQUID, density: 2.1, flow: 4, color: '#c9b8ff', vary: 0.05,
  category: 'Chemicals', desc: 'A strong base. Neutralizes acid. Turns oil into soap.' });
material('bleach', { state: STATE.LIQUID, density: 2.05, flow: 4, color: '#f2f7c4', vary: 0.04, category: 'Chemicals',
  desc: 'Never mix with acid: releases chlorine gas!' });
material('sodium', { state: STATE.POWDER, density: 1.9, color: '#c9c9b8', vary: 0.06, category: 'Chemicals',
  desc: 'Reactive metal. Fizzes violently in water.' });
material('cryo', { name: 'Liquid Nitrogen', state: STATE.LIQUID, density: 1.7, flow: 5, color: '#9ff3ff', vary: 0.04,
  decay: { into: 'empty', p: 0.004 }, category: 'Chemicals', desc: 'Super cold. Freezes water, cools lava, boils away.' });
material('soap', { state: STATE.LIQUID, density: 1.8, flow: 3, color: '#ff9ad5', vary: 0.05, category: 'Chemicals',
  desc: 'Makes bubbles in water.' });
material('hydrogen', { state: STATE.GAS, density: 0.05, color: '#e8d6ff', vary: 0.04, category: 'Chemicals',
  burn: { chance: 0.9, life: [3, 8], into: 'steam', intoChance: 0.7, free: true },
  desc: 'Lightest gas. Burns with a whoosh into steam.' });
material('chlorine', { state: STATE.GAS, density: 1.2, sink: true, color: '#b8e04a', vary: 0.06,
  decay: { into: 'empty', p: 0.0008 }, category: 'Chemicals', desc: 'Toxic, heavier than air. Kills plants.' });

// More powders
material('dirt', { state: STATE.POWDER, density: 2.5, color: '#7b5a3a', vary: 0.1, category: 'Powders',
  dissolve: 0.08, desc: 'Soaks up water and turns into mud. Seeds sprout in it.' });
material('mud', { state: STATE.POWDER, density: 2.6, color: '#4e3822', vary: 0.08, category: 'Powders',
  dissolve: 0.08, desc: 'Wet dirt. The best place to plant seeds. Heat dries it out.' });
material('bakingsoda', { name: 'Baking Soda', state: STATE.POWDER, density: 2.2, color: '#f7f3e8', vary: 0.03,
  category: 'Chemicals', dissolve: 0.3, desc: 'Fizzes like crazy with vinegar or acid.' });
material('thermite', { state: STATE.POWDER, density: 3, color: '#8a3d2b', vary: 0.12, category: 'Energy',
  dissolve: 0.05, burn: { chance: 0.5, life: [40, 80], into: 'lava', intoChance: 0.5 },
  desc: 'Burns white-hot and leaves molten metal behind.' });
material('fireworks', { state: STATE.POWDER, density: 2.5, color: '#ff4d6d', vary: 0.15, category: 'Energy',
  burn: { chance: 0.6, life: [1, 1] }, rocket: true, paint: 0.3, dissolve: 0.1,
  desc: 'Light it and watch it launch and burst!' });

// More liquids
material('honey', { state: STATE.LIQUID, density: 2.4, flow: 2, moveChance: 0.12, color: '#e8a317', vary: 0.06,
  category: 'Liquids', desc: 'Very thick and slow.' });
material('mercury', { state: STATE.LIQUID, density: 6, flow: 4, color: '#c7ccd4', vary: 0.05, conduct: true,
  category: 'Liquids', desc: 'Liquid metal. Super heavy, sinks under everything. Conducts electricity.' });
material('cement', { state: STATE.LIQUID, density: 2.4, flow: 2, moveChance: 0.5, color: '#9a9a96', vary: 0.04,
  decay: { into: 'stone', p: 0.0015 }, category: 'Liquids', desc: 'Pour it, shape it, and it sets into stone.' });
material('nitro', { name: 'Nitroglycerin', state: STATE.LIQUID, density: 1.6, flow: 3, color: '#e8e3a0', vary: 0.04,
  burn: { chance: 1, life: [1, 1] }, explode: 9, category: 'Chemicals', desc: 'Extremely explosive. Handle with care!' });
material('vinegar', { state: STATE.LIQUID, density: 2.02, flow: 4, color: '#e9dcb8', vary: 0.04, category: 'Chemicals',
  desc: 'A weak acid. Mix with baking soda for a volcano.' });

// More solids
material('copper', { color: '#c87533', vary: 0.08, blast: 0.15, dissolve: 0.02, conduct: true, category: 'Electric',
  desc: 'Conducts electricity. Never rusts.' });
material('obsidian', { color: '#2a1d3a', vary: 0.12, blast: 0.15, immune: true, category: 'Solids',
  desc: 'Volcanic glass, made by flash-cooling lava. Acid-proof.' });
material('torch', { color: '#b5651d', vary: 0.05, hot: 0.3, tick: 'torch', category: 'Energy',
  desc: 'Burns forever.' });
material('cloud', { color: '#d9dde6', vary: 0.05, tick: 'cloud', category: 'Life & Weird',
  desc: 'Floats in place and rains.' });

// More gases
material('co2', { name: 'CO₂', state: STATE.GAS, density: 1.5, sink: true, color: '#8f99a6', vary: 0.06,
  decay: { into: 'empty', p: 0.0006 }, category: 'Chemicals', desc: 'Heavy gas. Smothers fire. Plants love it.' });
material('methane', { state: STATE.GAS, density: 0.08, color: '#a6c8a0', vary: 0.05, category: 'Chemicals',
  burn: { chance: 0.9, life: [6, 14], into: ['co2', 'steam', 'empty'], free: true },
  desc: 'Flammable natural gas. Burns into CO₂ and water.' });

// Electricity
material('spark', { state: STATE.GAS, density: 0.1, life: [5, 10], color: '#fff7a0', vary: 0.1, tick: 'spark',
  paint: 0.3, category: 'Electric', desc: 'Electricity! Travels through metal, copper and mercury. Splits water.' });
material('battery', { color: '#2f9e6a', vary: 0.04, blast: 0.5, immune: true, tick: 'battery', category: 'Electric',
  desc: 'Keeps pulsing electricity into touching conductors (metal, copper, mercury, lamps...).' });
material('lamp', { color: '#5c5530', vary: 0.05, conduct: true, halo: true, blast: 0.5, category: 'Electric',
  desc: 'Lights up when electricity flows through it.' });
material('neon', { state: STATE.GAS, density: 0.15, color: '#4a3640', vary: 0.08, conduct: true, category: 'Electric',
  desc: 'A noble gas that glows pink when electrified. Seal it in glass for a neon sign (run a wire through the glass, since glass blocks electricity)!' });
material('switchOff', { name: 'Switch', color: '#a33b3b', vary: 0.04, immune: true, category: 'Electric',
  desc: 'Click a placed switch with this tool to flip it. Green = on (conducts), red = off.' });
material('switchOn', { name: 'Switch (on)', color: '#2fbf71', vary: 0.04, conduct: true, immune: true });
material('plate', { name: 'Pressure Plate', color: '#8c7a5b', vary: 0.04, tick: 'plate', category: 'Electric',
  desc: 'Sends power while a person (or anything) is standing on it.' });
material('diodeR', { name: 'Diode →', color: '#6b3fa0', vary: 0.04, conduct: true, diode: 1, category: 'Electric',
  desc: 'Electricity can only pass through it going right.' });
material('diodeL', { name: 'Diode ←', color: '#3f6ba0', vary: 0.04, conduct: true, diode: -1, category: 'Electric',
  desc: 'Electricity can only pass through it going left.' });
material('heater', { name: 'Heating Coil', color: '#5a2a1a', vary: 0.05, conduct: true, hold: 10, tick: 'heater',
  category: 'Electric', desc: 'Glows red-hot when powered: boils water, melts ice, lights fires.' });
material('cooler', { name: 'Cooling Coil', color: '#1a3a5a', vary: 0.05, conduct: true, hold: 10, tick: 'cooler',
  category: 'Electric', desc: 'Freezing cold when powered: freezes water, puts out fire, turns steam to snow.' });
material('emagnet', { name: 'Electromagnet', color: '#4a4f6a', vary: 0.05, conduct: true, hold: 10, category: 'Electric',
  desc: 'Pulls Iron Filings, but only while powered.' });
material('magnet', { color: '#c0392b', vary: 0.05, category: 'Electric', desc: 'Always pulls Iron Filings.' });
material('iron', { name: 'Iron Filings', state: STATE.POWDER, density: 3.5, color: '#5d6166', vary: 0.18, conduct: true,
  tick: 'iron', dissolve: 0.05, category: 'Electric', desc: 'Magnetic metal dust. Conducts electricity.' });
material('tesla', { name: 'Tesla Coil', color: '#8a8f99', vary: 0.05, conduct: true, hold: 10, tick: 'tesla',
  category: 'Electric', desc: 'Shoots crackling lightning arcs while powered.' });
material('efan', { name: 'Electric Fan', color: '#3d5266', vary: 0.05, conduct: true, hold: 10, tick: 'efan',
  category: 'Electric', desc: 'A fan that blows an updraft only while powered.' });
material('solar', { name: 'Solar Panel', color: '#1f3a6e', vary: 0.06, tick: 'solar', category: 'Electric',
  desc: 'Makes electricity while it can see the sky.' });
material('thermo', { name: 'Thermo Generator', color: '#6e4a1f', vary: 0.05, tick: 'thermo', category: 'Electric',
  desc: 'Makes electricity from heat. Put fire or lava next to it.' });
material('lightning', { color: '#ffffff', tick: 'lightning', single: true, category: 'Electric',
  desc: 'Click to call down a lightning strike!' });
material('arc', { color: '#cfe8ff', life: [2, 5], tick: 'arc', inedible: true, immune: true });

// Life & weird
material('muncher', { color: '#ff3df2', vary: 0.2, glow: true, tick: 'muncher', inedible: true, dissolve: 0.3,
  paint: 0.04, category: 'Life & Weird',
  desc: 'Eats pixels! Multiplies when well fed, starves when food runs out. Fireproof (it even eats fire and lava), but acid kills it.' });
material('picky', { name: 'Picky Muncher', color: '#3df2c0', vary: 0.2, glow: true, tick: 'picky', inedible: true,
  paint: 0.04, category: 'Life & Weird',
  desc: 'A muncher that only eats the one material you choose, and duplicates with every pixel it eats.' });
material('antipicky', { name: 'Reverse Picky', color: '#ff6b4a', vary: 0.2, glow: true, tick: 'picky', reverse: true,
  inedible: true, dissolve: 0.3, paint: 0.04, category: 'Life & Weird',
  desc: 'A muncher that eats everything except the one material you choose.' });
material('corpse', { name: 'Dead Muncher', state: STATE.POWDER, density: 2.4, color: '#5b4a5e', vary: 0.15,
  inedible: true, dissolve: 0.2, pickerOnly: true, burn: { chance: 0.05, life: [10, 20], into: 'ash', intoChance: 0.5 },
  desc: 'What is left of a muncher that starved. Only Picky Munchers can eat it.' });
material('void', { color: '#1f0d3a', vary: 0.5, glow: true, tick: 'void', indestructible: true, inedible: true,
  immune: true, category: 'Life & Weird', desc: 'A hungry hole. Swallows anything that touches it (except Wall).' });
material('virus', { color: '#7dd13b', vary: 0.3, glow: true, life: [40, 90], tick: 'virus', immune: true,
  paint: 0.15, burn: { chance: 0.5, life: [5, 10] }, dissolve: 0.3, category: 'Life & Weird',
  desc: 'Infects whatever it touches, then dies. Fire and bleach stop it.' });
material('clone', { color: '#d4af37', vary: 0.05, tick: 'clone', indestructible: true, immune: true, inedible: true,
  category: 'Life & Weird', desc: 'Copies the first thing that touches it, forever.' });
material('seed', { state: STATE.POWDER, density: 2.3, color: '#c8b06a', vary: 0.1, tick: 'seed', paint: 0.08,
  dissolve: 0.2, burn: { chance: 0.2, life: [5, 10] }, category: 'Life & Weird',
  desc: 'Drop on mud (or dirt) and it grows into a flower.' });

// Physics
material('portalA', { name: 'Blue Portal', color: '#3fa9ff', vary: 0.3, glow: true, tick: 'portal', portal: 0,
  indestructible: true, immune: true, inedible: true, category: 'Physics',
  desc: 'Anything that falls, flows or walks in comes out of an Orange Portal.' });
material('portalB', { name: 'Orange Portal', color: '#ff9a1f', vary: 0.3, glow: true, tick: 'portal', portal: 1,
  indestructible: true, immune: true, inedible: true, category: 'Physics',
  desc: 'Anything that falls, flows or walks in comes out of a Blue Portal.' });
material('fan', { color: '#6d7b8c', vary: 0.05, blast: 0.3, tick: 'fan', category: 'Physics',
  desc: 'Blows a strong updraft. Powders, liquids, gases and people get lifted.' });
material('blackhole', { name: 'Black Hole', color: '#5a1f8f', vary: 0.6, glow: true, tick: 'blackhole', single: true,
  indestructible: true, immune: true, inedible: true, category: 'Physics',
  desc: 'Pulls in everything nearby (even people) and swallows it.' });

// ---- Big batch of extras
// Powders
material('sugar', { state: STATE.POWDER, density: 2.4, color: '#f6f1ea', vary: 0.04, dissolve: 0.3, category: 'Powders',
  desc: 'Dissolves in water. Heat melts it into caramel.' });
material('coal', { state: STATE.POWDER, density: 2.6, color: '#2a2a2e', vary: 0.12, dissolve: 0.05, category: 'Powders',
  burn: { chance: 0.03, life: [150, 250], into: 'ash', intoChance: 0.6 }, desc: 'Hard to light, but burns long and hot.' });
material('sawdust', { state: STATE.POWDER, density: 1.3, color: '#d8b47a', vary: 0.1, dissolve: 0.2, category: 'Powders',
  burn: { chance: 0.3, life: [10, 25], into: 'ash', intoChance: 0.3 }, desc: 'Light enough to float on water. Very flammable.' });
material('gravel', { state: STATE.POWDER, density: 3.2, color: '#77736e', vary: 0.18, dissolve: 0.02, category: 'Powders',
  desc: 'Heavy chunky stones.' });
material('glitter', { state: STATE.POWDER, density: 1.6, color: '#ff4fd8', vary: 0, glow: true, dissolve: 0.1,
  category: 'Powders', desc: 'Sparkly! Light enough to float on water.' });
material('clay', { state: STATE.POWDER, density: 2.6, color: '#b5651d', vary: 0.06, dissolve: 0.05, category: 'Powders',
  desc: 'Bake it with fire, lava or a heating coil to make bricks.' });

// Liquids
material('slime', { state: STATE.LIQUID, density: 2.2, flow: 2, moveChance: 0.25, color: '#6be04a', vary: 0.08,
  category: 'Liquids', desc: 'Thick green goo.' });
material('chocolate', { state: STATE.LIQUID, density: 2.3, flow: 2, moveChance: 0.3, color: '#5a3418', vary: 0.05,
  decay: { into: 'chocobar', p: 0.0008 }, category: 'Liquids', desc: 'Melted chocolate. Slowly sets into a bar.' });
material('napalm', { state: STATE.LIQUID, density: 1.4, flow: 2, moveChance: 0.5, color: '#c25a1a', vary: 0.06,
  burn: { chance: 0.12, life: [150, 250] }, category: 'Energy', desc: 'Sticky fuel that burns for a very long time.' });
material('caramel', { state: STATE.LIQUID, density: 2.3, flow: 1, moveChance: 0.1, color: '#c27c2c', vary: 0.06,
  burn: { chance: 0.02, life: [20, 40], into: 'ash', intoChance: 0.5 }, desc: 'Melted sugar.' });

// Solids
material('brick', { color: '#a5462f', vary: 0.1, blast: 0.3, dissolve: 0.02, category: 'Solids', desc: 'Baked clay. Sturdy.' });
material('gold', { color: '#ffcc33', vary: 0.1, blast: 0.2, conduct: true, immune: true, category: 'Solids',
  desc: 'Never rusts, acid can\'t touch it, and it conducts electricity.' });
material('sponge', { color: '#f2d16b', vary: 0, tick: 'sponge', blast: 1, dissolve: 0.2, category: 'Solids',
  burn: { chance: 0.02, life: [20, 40], into: 'ash', intoChance: 0.5 }, desc: 'Soaks up water. Heat dries it out as steam.' });
material('crystal', { color: '#c9a0ff', vary: 0, glow: true, blast: 0.6, category: 'Solids',
  desc: 'Grows in salt water, just like real salt crystals.' });
material('chocobar', { name: 'Chocolate Bar', color: '#4a2a12', vary: 0.05, blast: 1, dissolve: 0.2, category: 'Solids',
  desc: 'Solid chocolate. Heat melts it.' });

// Energy
material('fuse', { color: '#6b4f2a', vary: 0.1, blast: 1, dissolve: 0.2, category: 'Energy',
  burn: { chance: 0.35, life: [20, 28], into: 'ash', intoChance: 0.3 }, desc: 'Burns slowly along its length. Light gunpowder from a safe distance!' });
material('c4', { name: 'C4', color: '#e8e2c8', vary: 0.03, explode: 12, c4: true, category: 'Energy',
  desc: 'Huge explosive. Fire won\'t set it off, only electricity or another explosion.' });
material('bomb', { color: '#2b2b2b', vary: 0, tick: 'bomb', explode: 10, single: true, category: 'Energy',
  burn: { chance: 0.3, life: [1, 1] }, desc: 'Ticks for 4 seconds, then BOOM. Fire sets it off early.' });
material('volcano', { color: '#5b2c1a', vary: 0.1, tick: 'volcano', blast: 0.1, immune: true, category: 'Energy',
  desc: 'Leaks lava, and every so often erupts.' });

// Chemicals
material('oxygen', { state: STATE.GAS, density: 0.9, color: '#d6efff', vary: 0.03, category: 'Chemicals',
  desc: 'Fire burns fiercely in it.' });
material('helium', { state: STATE.GAS, density: 0.02, color: '#fff0f6', vary: 0.03, category: 'Chemicals',
  desc: 'The lightest gas. Floats straight up.' });

// Life & weird
material('fish', { color: '#ff8c1a', vary: 0, tick: 'fish', paint: 0.05, dissolve: 0.3, category: 'Life & Weird',
  desc: 'Swims in water and slowly breeds. Out of water it flops around and dies.' });
material('deadfish', { name: 'Dead Fish', state: STATE.POWDER, density: 1.9, color: '#a89f8a', vary: 0.08, dissolve: 0.3,
  burn: { chance: 0.05, life: [10, 20], into: 'ash', intoChance: 0.6 } });
material('ant', { color: '#3b1f12', vary: 0.1, tick: 'ant', paint: 0.05, dissolve: 0.3, category: 'Life & Weird',
  desc: 'Crawls over everything and digs dirt and sand to build anthills.' });
material('moss', { color: '#4f7d3a', vary: 0.12, tick: 'moss', dissolve: 0.2, category: 'Life & Weird',
  burn: { chance: 0.05, life: [15, 30], into: 'ash', intoChance: 0.3 }, desc: 'Slowly creeps over damp stone, brick, gravel and wood.' });
material('treeseed', { name: 'Tree Seed', state: STATE.POWDER, density: 2.3, color: '#8b5a2b', vary: 0.1, tick: 'treeseed',
  paint: 0.05, dissolve: 0.2, category: 'Life & Weird', desc: 'Drop on dirt or mud and a whole tree grows.' });
material('trunk', { color: '#6e4524', vary: 0.08, tick: 'trunk', burn: { chance: 0.02, life: [60, 120], into: 'ash', intoChance: 0.35 } });
material('storm', { name: 'Storm Cloud', color: '#4a4f5c', vary: 0.08, tick: 'storm', category: 'Life & Weird',
  desc: 'Pours rain, and every now and then, lightning!' });

// Hidden helpers
material('bubbles', { state: STATE.GAS, density: 0.1, life: [20, 60], expire: { into: 'water', p: 0.5 },
  color: '#e8f6ff', vary: 0.04 });
material('charge', { color: '#fff5b0', vary: 0.1, glow: true, tick: 'charge', inedible: true, immune: true });
material('stem', { color: '#4fbf4f', vary: 0.08, tick: 'stem', dissolve: 0.15,
  burn: { chance: 0.06, life: [20, 40], into: 'ash', intoChance: 0.2 } });
material('flower', { color: '#ff7eb6', blast: 1, dissolve: 0.2, burn: { chance: 0.08, life: [10, 20] } });
material('rocket', { color: '#ffffff', tick: 'rocket', inedible: true, immune: true });
material('sparkle', { state: STATE.GAS, density: 0.01, sink: true, life: [15, 45], color: '#ffffff' });

for (const k of ['wall', 'glass', 'muncher']) MATS[ID[k]].immune = true;
MATS[ID.metal].conduct = true;
// Things that hurt little people
for (const k of ['fire', 'lava', 'acid', 'void', 'muncher', 'picky', 'antipicky', 'virus', 'chlorine', 'charge', 'spark', 'blackhole', 'cryo',
  'arc']) {
  MATS[ID[k]].deadly = true;
}
MATS[ID.wall].inedible = true;

// ---------------------------------------------------------------- temperature
// Every cell has a temperature (°C-ish). Things drift back to their natural temperature (`temp`,
// room temperature unless set) and change state when pushed past `melt` (heating) or `freeze` (cooling).
// Flammable things catch fire at `ignite`. Wall and other indestructible things have no temperature.
const AMBIENT = 20;
function thermal(key, props) { Object.assign(MATS[ID[key]], props); }
const melts = (at, into) => ({ at, into });
// Solids & powders that melt
for (const k of ['stone', 'gravel', 'obsidian', 'rust', 'brick']) thermal(k, { melt: melts(900, 'lava') });
thermal('metal', { melt: melts(1000, 'lava') });
thermal('iron', { melt: melts(1000, 'lava') });
thermal('copper', { melt: melts(900, 'lava') });
thermal('gold', { melt: melts(800, 'lava') });
thermal('glass', { melt: melts(700, 'lava') });
thermal('crystal', { melt: melts(700, 'lava') });
thermal('sand', { melt: melts(600, 'glass') });
thermal('salt', { melt: melts(650, 'lava') });
thermal('clay', { melt: melts(350, 'brick') });
thermal('mud', { melt: melts(100, 'dirt') });
thermal('sugar', { melt: melts(160, 'caramel') });
thermal('chocobar', { melt: melts(35, 'chocolate') });
thermal('ice', { temp: -10, melt: melts(0, 'water') });
thermal('snow', { temp: -5, melt: melts(0, 'water') });
thermal('cement', { melt: melts(150, 'stone') });
// Liquids that boil or freeze
thermal('water', { melt: melts(100, 'steam'), freeze: melts(0, 'ice') });
thermal('saltwater', { melt: melts(105, ['steam', 'steam', 'salt']), freeze: melts(-20, 'ice') });
thermal('vinegar', { melt: melts(100, 'steam'), freeze: melts(-2, 'ice') });
thermal('lava', { temp: 1200, freeze: melts(700, 'stone') });
thermal('chocolate', { temp: 45, freeze: melts(15, 'chocobar') });
thermal('caramel', { temp: 170, freeze: melts(40, 'sugar') });
thermal('honey', { freeze: melts(-30, 'sugar') });
thermal('cryo', { temp: -196, melt: melts(-150, 'empty') });
thermal('steam', { temp: 110, freeze: melts(90, 'water') });
thermal('bubbles', { melt: melts(60, 'steam') });
// Default ignition point for anything flammable (lower = catches fire sooner)
for (const m of MATS) if (m.burn) m.ignite = m.ignite ?? (m.explode || m.rocket ? 150 : 250);
thermal('nitro', { ignite: 80 });
thermal('c4', { ignite: 600 });   // only extreme heat sets C4 off
thermal('coal', { ignite: 400 });
thermal('hydrogen', { ignite: 100 });
// No temperature at all: wall, portals, black holes and other untouchable things
// Heat capacity: how much heating it takes to change temperature (water soaks up a lot)
for (const k of ['water', 'saltwater', 'vinegar']) MATS[ID[k]].heatCap = 5;
thermal('ice', { heatCap: 3 });
thermal('snow', { heatCap: 2 });
for (const m of MATS) {
  m.heatCap = m.heatCap ?? (m.state === STATE.LIQUID ? 3 : 1);
  m.temp = m.temp ?? AMBIENT;
  m.noHeat = m.state === STATE.EMPTY || m.state === STATE.FIRE || m.indestructible || m.key === 'arc';
}

// ---------------------------------------------------------------- falling solids
// When falling solids are on, connected lumps of solid fall as one piece and can shatter on impact.
// `toughness`: how hard a hit it takes to break (higher = tougher). `debris`: what the cracks turn into.
// Things that hold their own position (clouds, critters, munchers...) never fall.
for (const k of ['cloud', 'storm', 'muncher', 'picky', 'antipicky', 'fish', 'ant', 'arc', 'rocket', 'lightning', 'virus']) {
  MATS[ID[k]].anchored = true;
}
const breaks = (toughness, debris) => ({ toughness, debris });
thermal('stone', breaks(1, 'gravel'));
thermal('brick', breaks(1, 'gravel'));
thermal('obsidian', breaks(0.6, 'gravel'));
thermal('rust', breaks(0.7, 'gravel'));
thermal('glass', breaks(0.4, 'sand'));
thermal('ice', breaks(0.5, 'snow'));
thermal('crystal', breaks(0.5, 'glitter'));
thermal('wood', breaks(2, 'sawdust'));
thermal('trunk', breaks(2, 'sawdust'));
thermal('metal', breaks(4, 'iron'));
thermal('copper', breaks(3, 'iron'));
thermal('gold', breaks(3, null));
thermal('chocobar', breaks(0.8, null));
for (const k of ['plant', 'stem', 'flower', 'moss', 'sponge']) thermal(k, { toughness: 3 });
// Light solids float on water (water is 2)
for (const k of ['wood', 'trunk', 'fuse', 'sponge']) MATS[ID[k]].density = 1.4;
for (const k of ['plant', 'stem', 'flower', 'moss']) MATS[ID[k]].density = 1.2;
MATS[ID.ice].density = 1.85;
MATS[ID.chocobar].density = 2.3;
for (const m of MATS) {
  m.dynamic = m.state === STATE.SOLID && !m.indestructible && !m.anchored;
  m.toughness = m.toughness ?? 1.5;
}
MATS[ID.charge].dynamic = false;   // electricity passing through: counts as whatever it's flowing through

// ---------------------------------------------------------------- colors
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function packRGB(r, g, b) {
  // ImageData as Uint32 is little-endian ABGR
  return ((255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0;
}
const BG_COLOR = packRGB(14, 16, 22);
for (const m of MATS) {
  const [r, g, b] = hexToRgb(m.color);
  m.colors = new Uint32Array(4);
  for (let s = 0; s < 4; s++) {
    const f = 1 + ((s - 1.5) / 1.5) * m.vary;
    m.colors[s] = packRGB(Math.round(r * f), Math.round(g * f), Math.round(b * f));
  }
}
// Multi-colored materials: the "shade" picks one of four distinct colors
function setPalette(key, hexes) { MATS[ID[key]].colors = Uint32Array.from(hexes.map(h => packRGB(...hexToRgb(h)))); }
setPalette('sparkle', ['#ff4d4d', '#ffd23f', '#3fd8ff', '#ff5cf0']);
setPalette('flower', ['#ff7eb6', '#ff4d4d', '#b36bff', '#fff1a8']);
setPalette('spark', ['#fffbe0', '#fff7a0', '#ffe14d', '#bfe9ff']);
setPalette('charge', ['#fffbe0', '#fff7a0', '#ffe14d', '#bfe9ff']);
setPalette('arc', ['#ffffff', '#cfe8ff', '#a8d4ff', '#e6d6ff']);
setPalette('glitter', ['#ff4fd8', '#ffd23f', '#3fd8ff', '#b6ff3f']);
setPalette('sponge', ['#f2d16b', '#c9b066', '#8f8a6e', '#5f6f7a']);   // dry -> soaked
setPalette('crystal', ['#c9a0ff', '#a0d8ff', '#e0c0ff', '#ffffff']);
setPalette('bomb', ['#2b2b2b', '#2b2b2b', '#2b2b2b', '#ff2a2a']);
setPalette('fish', ['#ff8c1a', '#ffb02e', '#ff6a00', '#ffd166']);
// Colors for powered conductors (and pressed plates)
function setLit(key, hexes) { MATS[ID[key]].lit = Uint32Array.from(hexes.map(h => packRGB(...hexToRgb(h)))); }
setLit('lamp', ['#fff3a0', '#fffbe0']);
setLit('neon', ['#ff4fa3', '#ff86c2']);
setLit('heater', ['#ff5a1f', '#ff8c3a']);
setLit('cooler', ['#7fe8ff', '#c8f6ff']);
setLit('emagnet', ['#8f9bff', '#b8c0ff']);
setLit('tesla', ['#cfe8ff', '#ffffff']);
setLit('efan', ['#6fa8dc', '#9fc5e8']);
setLit('plate', ['#d8c48e', '#e6d5a5']);
setLit('thermo', ['#b8732a', '#d08a3a']);
setLit('diodeR', ['#c08cff', '#d8b0ff']);
setLit('diodeL', ['#8cc0ff', '#b0d4ff']);
const HALO_COLOR = packRGB(70, 64, 30);

// Fire color by remaining life: dark red embers -> bright yellow
const FIRE_COLORS = new Uint32Array(256);
for (let l = 0; l < 256; l++) {
  const c = Math.min(l / 35, 1);
  FIRE_COLORS[l] = packRGB(Math.round(150 + 105 * c), Math.round(20 + 190 * c), Math.round(5 + 65 * c));
}

// ---------------------------------------------------------------- reactions
// REACTIONS.get((a << 8) | b) -> [{ p, ra, rb, fx, r }]
// ra / rb: array of result ids to pick from, or null to leave unchanged.
const REACTIONS = new Map();
const REACTION_GUIDE = [];

function resolveResult(r) {
  if (r == null) return null;
  return (Array.isArray(r) ? r : [r]).map(k => {
    if (!(k in ID)) throw new Error('Unknown material ' + k);
    return ID[k];
  });
}
function addReaction(a, b, rule) {
  const key = (a << 8) | b;
  if (!REACTIONS.has(key)) REACTIONS.set(key, []);
  REACTIONS.get(key).push(rule);
  MATS[a].reacts = true;
}
// a + b -> ra + rb (registered both ways round)
function react(a, b, p, ra, rb, opts = {}) {
  const A = ID[a], B = ID[b];
  const RA = resolveResult(ra), RB = resolveResult(rb);
  addReaction(A, B, { p, ra: RA, rb: RB, fx: opts.fx, r: opts.r });
  addReaction(B, A, { p, ra: RB, rb: RA, fx: opts.fx, r: opts.r });
  if (opts.note) {
    let products = opts.products;
    if (!products) {
      const names = new Set();
      // list only what's produced (unchanged inputs are left out)
      for (const res of [ra, rb]) {
        if (res == null) continue;
        for (const k of Array.isArray(res) ? res : [res]) if (k !== 'empty') names.add(MATS[ID[k]].name);
      }
      products = [...names].join(', ') || 'nothing';
    }
    REACTION_GUIDE.push({ inputs: MATS[A].name + ' + ' + MATS[B].name, products, note: opts.note });
  }
}
function guideNote(inputs, products, note) {
  REACTION_GUIDE.push({ inputs, products, note });
}

// Heat & fire (handled in the sim via burn/hot properties)
guideNote('Fire / Lava + Wood, Plant, Oil', 'Fire, Smoke, Ash', 'Flammable things catch fire');
guideNote('Fire / Lava + Gunpowder', 'BOOM', 'Explodes, and sets off nearby gunpowder');
guideNote('Fire + Hydrogen', 'Steam', '2H₂ + O₂ → 2H₂O, burning hydrogen makes water');

// Water & lava
react('water', 'lava', 0.6, 'steam', 'stone', { note: 'Lava cools into stone' });
react('saltwater', 'lava', 0.6, ['steam', 'salt'], 'stone', { note: 'Boils off and leaves salt behind' });
react('water', 'fire', 0.4, 'steam', 'empty', { note: 'Water puts out fire' });
react('saltwater', 'fire', 0.4, ['steam', 'salt'], 'empty');
react('lava', 'sand', 0.004, null, 'glass', { note: 'Sand melts into glass' });
react('lava', 'metal', 0.003, null, 'lava', { note: 'Metal melts' });

// Salt, ice & cold
react('water', 'salt', 0.03, 'saltwater', 'empty', { note: 'Salt dissolves in water' });
react('ice', 'water', 0.0015, null, 'ice', { note: 'Ice slowly freezes water' });
react('ice', 'salt', 0.01, 'water', null, { note: 'Salt melts ice (why roads get salted)' });
react('ice', 'fire', 0.3, 'water', 'empty', { note: 'Melts' });
react('ice', 'lava', 0.1, 'water', 'stone');
react('ice', 'steam', 0.05, null, 'water', { note: 'Steam condenses on cold ice' });
react('snow', 'fire', 0.4, 'water', 'empty');
react('snow', 'lava', 0.3, 'water', 'stone');
react('snow', 'salt', 0.02, 'water', null);
react('cryo', 'water', 0.25, null, 'ice', { note: 'Flash-freezes water' });
react('cryo', 'saltwater', 0.1, null, 'ice');
react('cryo', 'steam', 0.3, null, 'snow', { note: 'Turns steam into snow' });
react('cryo', 'lava', 0.5, 'empty', 'obsidian', { note: 'Flash-cools lava into obsidian' });
react('cryo', 'fire', 0.5, 'empty', 'empty');

// Metals
react('metal', 'water', 0.0006, 'rust', null, { note: 'Metal slowly rusts' });
react('metal', 'saltwater', 0.004, 'rust', null, { note: 'Salt water rusts metal much faster' });

// Life
react('plant', 'water', 0.01, null, 'plant', { note: 'Plants grow by drinking water' });

// Sodium
react('sodium', 'water', 0.03, null, null, { fx: 'explode', r: 4 });
react('sodium', 'water', 0.15, 'hydrogen', 'lye',
  { note: '2Na + 2H₂O → 2NaOH + H₂, fizzes and sometimes explodes!' });
react('acid', 'sodium', 0.3, 'hydrogen', 'salt', { note: 'Metal + acid → salt + hydrogen' });

// Acids & bases
react('acid', 'lye', 0.3, 'saltwater', 'steam', { note: 'Neutralization: salt water + heat' });
react('acid', 'bleach', 0.3, 'saltwater', 'chlorine', { note: 'Releases toxic chlorine gas!' });
react('lye', 'oil', 0.04, 'soap', 'soap', { note: 'Saponification: how soap is made' });
react('soap', 'water', 0.02, null, 'bubbles', { note: 'Makes bubbles' });
react('chlorine', 'plant', 0.05, null, 'empty', { note: 'Chlorine kills plants' });
react('chlorine', 'water', 0.01, 'empty', 'acid', { note: 'Dissolves into hydrochloric acid' });

// Dirt, mud & growing things
react('dirt', 'water', 0.02, 'mud', 'empty', { note: 'Dirt soaks up water' });
react('mud', 'fire', 0.1, 'dirt', null, { note: 'Heat dries mud out' });
react('mud', 'lava', 0.1, 'dirt', null);
react('plant', 'co2', 0.02, null, 'plant', { note: 'Photosynthesis: plants grow by eating CO₂' });
guideNote('Seed + Mud / Dirt', 'Flower', 'Plant a seed and it grows a stem, leaves and a flower');

// Fizzing & CO2
react('vinegar', 'bakingsoda', 0.3, 'water', ['co2', 'co2', 'bubbles'],
  { products: 'CO₂, Water, Bubbles', note: 'The classic science-fair volcano' });
react('acid', 'bakingsoda', 0.3, 'saltwater', ['co2', 'co2', 'bubbles'], { products: 'CO₂, Salt Water', note: 'Fizzes hard' });
react('lye', 'vinegar', 0.2, 'saltwater', 'water', { note: 'Base + acid neutralize each other' });
react('co2', 'fire', 0.5, null, 'empty', { note: 'CO₂ smothers fire (how some extinguishers work)' });

// Burning & blasting
guideNote('Fire + Thermite', 'Lava', 'Burns white-hot and melts into molten metal');
guideNote('Fire + Nitroglycerin', 'HUGE BOOM', 'The biggest explosion in the box');
guideNote('Fire + Fireworks', 'Rocket', 'Launches upward and bursts into colored sparkles');
guideNote('Fire + Methane', 'CO₂, Steam', 'CH₄ + 2O₂ → CO₂ + 2H₂O');

// Electricity
guideNote('Spark / Battery + Metal, Copper, Mercury', 'Electricity', 'Current flows through conductors');
guideNote('Electricity + Water', 'Hydrogen', 'Electrolysis splits water apart');
guideNote('Electricity + Salt Water', 'Chlorine, Hydrogen', 'Chlor-alkali process, used to make bleach');
guideNote('Electricity + Wood, Oil, Gunpowder...', 'Fire', 'Sparks set flammable things alight');
guideNote('Electricity + Lamp / Neon', 'Light', 'Lamps glow yellow, neon glows pink');
guideNote('Switch / Diode', 'Control', 'Flip switches to open/close a circuit. Diodes only let current flow one way');
guideNote('Person / stuff + Pressure Plate', 'Electricity', 'Step on it to power the circuit');
guideNote('Electricity + Heating / Cooling Coil', 'Hot / Cold', 'Boil water and light fires, or freeze water and snuff fires');
guideNote('Magnet / powered Electromagnet + Iron Filings', 'Attraction', 'Iron dust flies to magnets');
guideNote('Electricity + Tesla Coil', 'Lightning arcs', 'Zaps anything nearby');
guideNote('Sunlight + Solar Panel', 'Electricity', 'Needs a clear view of the sky');
guideNote('Fire / Lava + Thermo Generator', 'Electricity', 'Turns heat into power');
guideNote('Lightning + Sand', 'Glass', 'Real lightning makes glass tubes called fulgurites');

// Physics
guideNote('Blue Portal ⇄ Orange Portal', 'Teleport', 'Things go in one color and come out the other, still moving the same way');
guideNote('Fan + anything above it', 'Updraft', 'Blows powders, liquids, gases and people upward');
guideNote('Black Hole + everything nearby', 'Nothing', 'Pulls things in and swallows them');
guideNote('Wind tool', 'Whoosh', 'Drag across the world to blow stuff (and people) around');

// People
guideNote('Person + Fire, Lava, Acid', 'Ash / Smoke', 'People avoid danger when they see it coming... mostly');
guideNote('Person + Liquid Nitrogen', 'Ice statue', 'Frozen solid');
guideNote('Person + Muncher / Void / Black Hole', 'Nothing', 'Gobbled up');

// Life & weird
guideNote('Muncher + almost anything', 'More Munchers', 'Eats pixels, multiplies when full, starves when hungry');
guideNote('Void + anything', 'Nothing', 'Swallows everything except Wall');
guideNote('Clone + anything', 'Copies', 'Copies whatever touches it first, forever');
guideNote('Virus + almost anything', 'Virus', 'Spreads, then dies out. Glass, Wall and Obsidian are immune');
react('virus', 'bleach', 0.3, 'empty', null, { note: 'Bleach disinfects' });
guideNote('Muncher + Fire / Lava', 'More Munchers', 'All munchers are fireproof and happily eat fire and lava, but acid still dissolves them');
guideNote('Picky Muncher + its chosen food', 'More Picky Munchers', 'Ignores everything except the one material you pick');
guideNote('Picky Muncher (eats Fire or Lava)', 'Hungry', 'Starves twice as fast between meals');
guideNote('Starving Muncher', 'Dead Muncher', 'Munchers leave a body when they starve. Only a Picky Muncher set to eat Dead Munchers will eat it, and those leave no body');
guideNote('Reverse Picky + anything but its safe material', 'More Reverse Pickies', 'Eats everything except what you pick');

// Extras
react('sugar', 'water', 0.03, 'empty', null, { note: 'Sugar dissolves' });
react('sugar', 'fire', 0.1, 'caramel', null, { note: 'Heat melts sugar into caramel' });
react('sugar', 'lava', 0.2, 'caramel', null);
react('clay', 'fire', 0.05, 'brick', null, { note: 'Clay bakes into brick' });
react('clay', 'lava', 0.1, 'brick', null);
react('chocobar', 'fire', 0.1, 'chocolate', null, { note: 'Chocolate melts, then sets again as it cools' });
react('chocobar', 'lava', 0.3, 'chocolate', null);
react('crystal', 'saltwater', 0.01, null, 'crystal', { note: 'Salt crystals grow' });
react('oxygen', 'fire', 0.5, 'fire', null, { note: 'Fire roars in oxygen' });
react('ant', 'fire', 0.3, 'ash', null);
react('ant', 'lava', 0.5, 'ash', null);
react('fish', 'lava', 0.5, 'ash', null);
guideNote('Sponge + Water', 'Wet Sponge', 'Soaks it up. Heat squeezes it back out as steam');
guideNote('Fire + Fuse', 'A slow burn', 'Burns along the fuse: great for lighting gunpowder from far away');
guideNote('Electricity / explosion + C4', 'HUGE BOOM', 'Fire alone won\'t set it off');
guideNote('Bomb', 'BOOM', 'Explodes 4 seconds after you place it (or right away in fire)');
guideNote('Fish + Water', 'More Fish', 'Fish swim and slowly breed. Out of water they die');
guideNote('Ant + Dirt / Sand', 'Anthills', 'Ants dig tunnels and pile the dirt up outside');
guideNote('Moss + damp Stone', 'Moss', 'Moss spreads over wet stone, brick, gravel and wood');
guideNote('Tree Seed + Dirt / Mud', 'Tree', 'Grows a trunk, branches and leaves');
guideNote('Storm Cloud', 'Rain + Lightning', 'Lightning strikes whatever is underneath');

// Heat, cold & falling solids
guideNote('Heat tool + Stone, Metal, Glass...', 'Lava', 'Get anything hot enough and it melts. Sand melts into glass, clay bakes into brick');
guideNote('Heat tool + Water / Ice', 'Steam / Water', 'Ice melts at 0°, water boils at 100°');
guideNote('Cool tool + Water / Lava', 'Ice / Stone', 'Freeze water solid, or cool lava back into rock');
guideNote('Heat tool + Wood, Oil, Gunpowder...', 'Fire', 'Flammable things catch fire once they get hot enough');
guideNote('Falling solid + a hard landing', 'Rubble', 'Big, heavy or fast-falling lumps crack apart. Stone breaks into gravel, glass into sand, wood into sawdust');

// Acid dissolves things (generic)
for (const m of MATS) {
  if (m.dissolve > 0) react('acid', m.key, m.dissolve, ['acid', 'acid', 'empty'], ['empty', 'empty', 'smoke']);
}
guideNote('Acid + almost anything', 'Smoke', 'Dissolves it. Glass and wall are safe');

// ---------------------------------------------------------------- performance
// Give every material object exactly the same properties in the same order. The simulation reads
// these objects for every pixel every frame, and JavaScript engines are much faster when all the
// objects they read have the same "shape".
{
  const keys = new Set();
  for (const m of MATS) for (const k of Object.keys(m)) keys.add(k);
  for (let i = 0; i < MATS.length; i++) {
    const old = MATS[i], m = {};
    for (const k of keys) m[k] = old[k] === undefined ? null : old[k];
    MATS[i] = m;
  }
}
