'use strict';
// UI, input and the game loop. Depends on materials.js, sim.js, behaviors.js and people.js.

const W = 320, H = 180;
const sim = new Sim(W, H);
installPeopleHooks(sim);

// Tools that aren't materials
const TOOL_PERSON = 1000, TOOL_WIND = 1001;
const EXTRA_TOOLS = [
  { id: TOOL_PERSON, name: 'Person', color: '#f1c27d', category: 'Life & Weird',
    desc: 'Little people! They walk, climb, swim, ride portals and fans, and run from danger (mostly).' },
  { id: TOOL_WIND, name: 'Wind', color: 'linear-gradient(90deg, #cfe8ff, #6fa8dc)', category: 'Physics',
    desc: 'Hold to blast everything away from the cursor. Bigger brush = wider, stronger wind!' },
];

const canvas = document.getElementById('world');
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d');
const image = ctx.createImageData(W, H);
const buf = new Uint32Array(image.data.buffer);

const ui = {
  palette: document.getElementById('palette'),
  info: document.getElementById('info'),
  hud: document.getElementById('hud'),
  brush: document.getElementById('brush'),
  brushVal: document.getElementById('brushVal'),
  pause: document.getElementById('pause'),
  step: document.getElementById('step'),
  clear: document.getElementById('clear'),
  guideBtn: document.getElementById('guideBtn'),
  guide: document.getElementById('guide'),
  guideList: document.getElementById('guideList'),
  stage: document.querySelector('.stage'),
  breeze: document.getElementById('breeze'),
  picker: document.getElementById('picker'),
  pickerGrid: document.getElementById('pickerGrid'),
  breezeVal: document.getElementById('breezeVal'),
};

const state = {
  selected: ID.sand,
  brush: 4,
  paused: false,
  stepOnce: false,
  drawing: false,
  erasing: false,
  last: null,     // last grid position while drawing
  hover: null,    // current grid position under the pointer
  heldFrames: 0,
  pickyTarget: ID.sand,       // what the Picky Muncher eats
};

// ------------------------------------------------------------ palette
function buildPalette() {
  const groups = {};
  for (const m of MATS) {
    if (!m.category) continue;
    (groups[m.category] ||= []).push(m);
  }
  for (const t of EXTRA_TOOLS) (groups[t.category] ||= []).unshift(t);
  const order = ['Powders', 'Liquids', 'Solids', 'Energy', 'Electric', 'Chemicals', 'Physics', 'Life & Weird'];
  for (const g of order) {
    if (!groups[g]) continue;
    const section = document.createElement('section');
    section.innerHTML = `<h2>${g}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'mats';
    for (const m of groups[g]) grid.appendChild(matButton(m.id, m.name, m.color, m.desc));
    section.appendChild(grid);
    ui.palette.appendChild(section);
  }
  const tools = document.createElement('section');
  tools.innerHTML = '<h2>Tools</h2>';
  const grid = document.createElement('div');
  grid.className = 'mats';
  grid.appendChild(matButton(ID.empty, 'Eraser', 'transparent', 'Removes anything, including walls. (Right-click also erases.)'));
  tools.appendChild(grid);
  ui.palette.appendChild(tools);
  select(state.selected);
}

function matButton(id, name, color, desc) {
  const b = document.createElement('button');
  b.className = 'mat';
  b.dataset.id = id;
  b.title = desc;
  b.innerHTML = `<span class="swatch${id === ID.empty ? ' eraser' : ''}" style="background:${color}"></span>${name}`;
  b.addEventListener('click', () => (id === ID.picky ? openPicker() : select(id)));
  return b;
}

// ------------------------------------------------------------ picky muncher target picker
function pickyLabel() {
  const food = MATS[state.pickyTarget];
  return `<span class="swatch" style="background:${MATS[ID.picky].color}"></span>Picky: ${food.name}`;
}

function buildPicker() {
  // anything placeable, except other munchers, hot stuff and one-shot tools
  const skip = new Set([ID.picky, ID.muncher, ID.fire, ID.lava, ID.torch, ID.lightning, ID.blackhole, ID.spark]);
  for (const m of MATS) {
    if (!m.category || skip.has(m.id)) continue;
    const b = document.createElement('button');
    b.className = 'mat';
    b.dataset.food = m.id;
    b.innerHTML = `<span class="swatch" style="background:${m.color}"></span>${m.name}`;
    b.addEventListener('click', () => {
      state.pickyTarget = m.id;
      ui.picker.close();
      const pb = ui.palette.querySelector(`.mat[data-id="${ID.picky}"]`);
      if (pb) pb.innerHTML = pickyLabel();
      select(ID.picky);
    });
    ui.pickerGrid.appendChild(b);
  }
}

function openPicker() {
  for (const b of ui.pickerGrid.querySelectorAll('.mat')) b.classList.toggle('active', +b.dataset.food === state.pickyTarget);
  ui.picker.showModal();
}


function select(id) {
  state.selected = id;
  for (const b of ui.palette.querySelectorAll('.mat')) b.classList.toggle('active', +b.dataset.id === id);
  const m = EXTRA_TOOLS.find(t => t.id === id) || MATS[id];
  if (id === ID.empty) ui.info.innerHTML = '<b>Eraser</b>: removes anything, including walls and people.';
  else if (id === ID.picky) {
    ui.info.innerHTML = `<b>Picky Muncher</b>: only eats <b>${MATS[state.pickyTarget].name}</b> and leaves everything ` +
      'else alone. Click its button again to pick a different food.';
  } else ui.info.innerHTML = `<b>${m.name}</b>: ${m.desc}`;
}

function buildGuide() {
  ui.guideList.innerHTML = REACTION_GUIDE.map(r =>
    `<li><span class="in">${r.inputs}</span><span class="arrow">→</span><span class="out">${r.products}</span>` +
    `<span class="note">${r.note}</span></li>`).join('');
}

// ------------------------------------------------------------ layout
function fit() {
  const r = ui.stage.getBoundingClientRect();
  const scale = Math.max(1, Math.min(r.width / W, r.height / H));
  canvas.style.width = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
}
window.addEventListener('resize', fit);

// ------------------------------------------------------------ input
function gridPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - r.left) / r.width) * W),
    y: Math.floor(((e.clientY - r.top) / r.height) * H),
  };
}

function toolRadius() {
  return currentTool() === TOOL_WIND ? state.brush * 2 + 3 : state.brush - 1;
}

// Click a switch with the Switch tool to flip the whole connected switch.
function toggleSwitchAt(p) {
  const r = Math.max(1, state.brush - 1);
  const isSwitch = i => {
    const t = sim.type[i];
    return t === ID.switchOff || t === ID.switchOn || (t === ID.charge && sim.aux[i] === ID.switchOn);
  };
  let start = -1;
  for (let dy = -r; dy <= r && start < 0; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || dx * dx + dy * dy > r * r) continue;
      if (isSwitch(y * W + x)) { start = y * W + x; break; }
    }
  }
  if (start < 0) return false;
  const turnOn = sim.type[start] === ID.switchOff;
  const seen = new Set([start]), stack = [start];
  while (stack.length) {
    const i = stack.pop();
    sim.set(i, turnOn ? ID.switchOn : ID.switchOff);
    const x = i % W;
    for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
      if (j >= 0 && j < W * H && !seen.has(j) && isSwitch(j)) { seen.add(j); stack.push(j); }
    }
  }
  return true;
}

// Apply the current tool from a to b. `held` = pointer is being held still.
function applyTool(a, b, held) {
  const t = currentTool();
  if (t === TOOL_WIND) return;   // wind is applied every frame in the loop
  if (MATS[t]?.single) {         // one at a time: lightning, black holes
    if ((!held || state.heldFrames % 20 === 0) && b.x >= 0 && b.y >= 0 && b.x < W && b.y < H) {
      const i = b.y * W + b.x;
      if (sim.type[i] === 0) sim.set(i, t);
    }
    return;
  }
  if (t === TOOL_PERSON) {
    if (!held || state.heldFrames % 8 === 0) {
      const r = state.brush - 1;
      spawnPerson(sim, b.x + randInt(-r, r), b.y);
    }
    return;
  }
  paintLine(a, b, t);
  if (t === ID.empty) erasePeople(sim, b.x, b.y, state.brush + 1);
}

// Wind blasts outward from the cursor. Brush 1 is a puff, brush 20 is a hurricane.
function applyWind() {
  const p = state.last;
  const r = toolRadius();
  const strength = 1 + state.brush * 0.45;
  sim.blowOut(p.x, p.y, r, strength);
  pushPeopleOut(sim, p.x, p.y, r, 0.15 + state.brush * 0.06);
}

function paintLine(a, b, t) {
  const r = state.brush - 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, r / 2)));
  for (let s = 0; s <= steps; s++) {
    sim.paint(Math.round(a.x + (dx * s) / steps), Math.round(a.y + (dy * s) / steps), r, t,
      t === ID.picky ? state.pickyTarget : undefined);
  }
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  state.drawing = true;
  state.erasing = e.button === 2;
  state.last = gridPos(e);
  state.hover = state.last;
  state.heldFrames = 0;
  if (!state.erasing && state.selected === ID.switchOff && toggleSwitchAt(state.last)) {
    state.drawing = false;   // flipped a switch; don't paint
    return;
  }
  applyTool(state.last, state.last, false);
});
canvas.addEventListener('pointermove', e => {
  const p = gridPos(e);
  state.hover = p;
  if (state.drawing) {
    const t = currentTool();
    if (t !== TOOL_PERSON && !MATS[t]?.single) applyTool(state.last, p, false);
    state.last = p;
  }
});
const stopDrawing = () => { state.drawing = false; state.last = null; };
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('pointerleave', () => { if (!state.drawing) state.hover = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function currentTool() { return state.erasing ? ID.empty : state.selected; }

function setBrush(v) {
  state.brush = Math.max(1, Math.min(20, v));
  ui.brush.value = state.brush;
  ui.brushVal.textContent = state.brush;
}
ui.brush.addEventListener('input', () => setBrush(+ui.brush.value));

function togglePause() {
  state.paused = !state.paused;
  ui.pause.textContent = state.paused ? 'Play' : 'Pause';
  ui.pause.classList.toggle('active', state.paused);
}
ui.pause.addEventListener('click', togglePause);
ui.step.addEventListener('click', () => { state.stepOnce = true; });
ui.clear.addEventListener('click', () => sim.clear());

function setBreeze(v) {
  sim.wind = v;
  ui.breeze.value = v;
  ui.breezeVal.textContent = v === 0 ? 'off' : v < 0 ? '←'.repeat(-v) : '→'.repeat(v);
}
ui.breeze.addEventListener('input', () => setBreeze(+ui.breeze.value));
ui.guideBtn.addEventListener('click', () => ui.guide.showModal());
ui.guide.addEventListener('click', e => { if (e.target === ui.guide || e.target.closest('.close')) ui.guide.close(); });
ui.picker.addEventListener('click', e => { if (e.target === ui.picker || e.target.closest('.close')) ui.picker.close(); });

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.key === '[') setBrush(state.brush - 1);
  else if (e.key === ']') setBrush(state.brush + 1);
  else if (e.key === '.') state.stepOnce = true;
});

// ------------------------------------------------------------ loop
const BRUSH_RING = ((200 << 24) | (255 << 16) | (255 << 8) | 255) >>> 0;
function drawBrush() {
  const p = state.hover;
  if (!p) return;
  const r = toolRadius();
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2;
    const x = Math.round(p.x + Math.cos(ang) * (r + 0.5)), y = Math.round(p.y + Math.sin(ang) * (r + 0.5));
    if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = BRUSH_RING;
  }
}

let frames = 0, fps = 0, lastFpsTime = performance.now(), particles = 0;
function updateHud() {
  const p = state.hover;
  let under = '';
  if (p && p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) {
    const t = sim.type[p.y * W + p.x];
    if (personAt(sim, p.x, p.y)) under = 'Person · ';
    else if (t) under = MATS[t].name + ' · ';
  }
  const people = sim.people.length ? ` · ${sim.people.length} people` : '';
  ui.hud.textContent = `${under}${particles.toLocaleString()} particles${people} · ${fps} fps${state.paused ? ' · paused' : ''}`;
}

function frame(now) {
  // keep emitting while the pointer is held still
  if (state.drawing && state.last && !state.paused) {
    state.heldFrames++;
    if (currentTool() === TOOL_WIND) applyWind();
    else applyTool(state.last, state.last, true);
  }
  if (!state.paused || state.stepOnce) {
    sim.step();
    updatePeople(sim);
    state.stepOnce = false;
  }
  sim.render(buf);
  drawPeople(sim, buf);
  drawBrush();
  ctx.putImageData(image, 0, 0);

  frames++;
  if (now - lastFpsTime > 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsTime));
    frames = 0;
    lastFpsTime = now;
    particles = sim.count();
  }
  updateHud();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ start
function demoScene() {
  // a little starter scene: ground, a pond, some wood and a lava pocket
  for (let x = 0; x < W; x++) for (let y = H - 6; y < H; y++) sim.set(y * W + x, ID.stone);
  for (let x = 40; x < 120; x++) for (let y = H - 22; y < H - 6; y++) sim.set(y * W + x, ID.water);
  for (let y = H - 30; y < H - 6; y++) { sim.set(y * W + 38, ID.glass); sim.set(y * W + 39, ID.glass); sim.set(y * W + 120, ID.glass); sim.set(y * W + 121, ID.glass); }
  for (let x = 200; x < 206; x++) for (let y = H - 40; y < H - 6; y++) sim.set(y * W + x, ID.wood);
  for (let x = 250; x < 300; x++) for (let y = H - 14; y < H - 6; y++) sim.set(y * W + x, ID.lava);
  for (let x = 140; x < 180; x++) for (let y = H - 9; y < H - 6; y++) sim.set(y * W + x, ID.plant);
  // a pair of portals: walk into the blue one on the left, pop out of the orange one up high
  for (let y = H - 16; y < H - 6; y++) { sim.set(y * W + 8, ID.portalA); sim.set(y * W + 9, ID.portalA); }
  for (let x = 225; x < 240; x++) sim.set((H - 60) * W + x, ID.portalB);
  for (let k = 0; k < 3; k++) spawnPerson(sim, 16 + k * 8, H - 7);
  for (let k = 0; k < 3; k++) spawnPerson(sim, 135 + k * 20, H - 7);
}

buildPalette();
buildPicker();
buildGuide();
{ const pb = ui.palette.querySelector(`.mat[data-id="${ID.picky}"]`); if (pb) pb.innerHTML = pickyLabel(); }
setBrush(state.brush);
demoScene();
fit();
requestAnimationFrame(frame);

window.game = { sim, state };   // handy for debugging in the console
