'use strict';
// UI, input and the game loop. Depends on materials.js and sim.js.

const W = 320, H = 180;
const sim = new Sim(W, H);

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
};

// ------------------------------------------------------------ palette
function cssColor(m) { return m.color; }

function buildPalette() {
  const groups = {};
  for (const m of MATS) {
    if (!m.category) continue;
    (groups[m.category] ||= []).push(m);
  }
  const order = ['Powders', 'Liquids', 'Solids', 'Energy', 'Electric', 'Chemicals', 'Life & Weird'];
  for (const g of order) {
    if (!groups[g]) continue;
    const section = document.createElement('section');
    section.innerHTML = `<h2>${g}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'mats';
    for (const m of groups[g]) grid.appendChild(matButton(m.id, m.name, cssColor(m), m.desc));
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
  b.addEventListener('click', () => select(id));
  return b;
}

function select(id) {
  state.selected = id;
  for (const b of ui.palette.querySelectorAll('.mat')) b.classList.toggle('active', +b.dataset.id === id);
  const m = MATS[id];
  ui.info.innerHTML = id === ID.empty
    ? '<b>Eraser</b>: removes anything, including walls.'
    : `<b>${m.name}</b>: ${m.desc}`;
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

function paintLine(a, b, t) {
  const r = state.brush - 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, r / 2)));
  for (let s = 0; s <= steps; s++) {
    sim.paint(Math.round(a.x + (dx * s) / steps), Math.round(a.y + (dy * s) / steps), r, t);
  }
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  state.drawing = true;
  state.erasing = e.button === 2;
  state.last = gridPos(e);
  state.hover = state.last;
  paintLine(state.last, state.last, currentTool());
});
canvas.addEventListener('pointermove', e => {
  const p = gridPos(e);
  state.hover = p;
  if (state.drawing) {
    paintLine(state.last, p, currentTool());
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
ui.guideBtn.addEventListener('click', () => ui.guide.showModal());
ui.guide.addEventListener('click', e => { if (e.target === ui.guide || e.target.closest('.close')) ui.guide.close(); });

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
  const r = state.brush - 1;
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
    if (t) under = MATS[t].name + ' · ';
  }
  ui.hud.textContent = `${under}${particles.toLocaleString()} particles · ${fps} fps${state.paused ? ' · paused' : ''}`;
}

function frame(now) {
  // keep emitting while the pointer is held still
  if (state.drawing && state.last && !state.paused) paintLine(state.last, state.last, currentTool());
  if (!state.paused || state.stepOnce) { sim.step(); state.stepOnce = false; }
  sim.render(buf);
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
}

buildPalette();
buildGuide();
setBrush(state.brush);
demoScene();
fit();
requestAnimationFrame(frame);

window.game = { sim, state };   // handy for debugging in the console
