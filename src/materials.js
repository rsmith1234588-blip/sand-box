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
  desc: 'Rusts in water (faster in salt water). Lava melts it.' });
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

// Hidden helpers
material('bubbles', { state: STATE.GAS, density: 0.1, life: [20, 60], expire: { into: 'water', p: 0.5 },
  color: '#e8f6ff', vary: 0.04 });

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
react('cryo', 'lava', 0.5, 'empty', 'stone', { note: 'Instantly cools lava' });
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

// Acid dissolves things (generic)
for (const m of MATS) {
  if (m.dissolve > 0) react('acid', m.key, m.dissolve, ['acid', 'acid', 'empty'], ['empty', 'empty', 'smoke']);
}
guideNote('Acid + almost anything', 'Smoke', 'Dissolves it. Glass and wall are safe');
