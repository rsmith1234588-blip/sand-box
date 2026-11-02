'use strict';
// Cellular-automaton simulation. Depends on materials.js.

const DIRS4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// Flat lookup tables: much faster than going through objects/Maps in the hot loops.
const M_STATE = Uint8Array.from(MATS, m => m.state);
const M_DENSITY = Float32Array.from(MATS, m => m.density);
const M_SINK = Uint8Array.from(MATS, m => (m.sink ? 1 : 0));
const RX = new Array(1 << 16).fill(null);   // RX[(a << 8) | b] -> list of reactions
for (const [key, list] of REACTIONS) RX[key] = list;
// Materials that must be updated every frame even when nothing around them moves
const M_RESTLESS = Uint8Array.from(MATS, m =>
  (m.life || m.decay || m.tick || m.glow || m.hot || m.state === STATE.FIRE) ? 1 : 0);

// Temperature (see materials.js)
const M_TBASE = Float32Array.from(MATS, m => m.temp);
const M_NOHEAT = Uint8Array.from(MATS, m => (m.noHeat ? 1 : 0));
// how readily heat flows between touching cells. Things with their own temperature (lava, ice,
// steam...) don't pass it on, so a lava pool can't slowly melt the whole floor.
const M_HEATK = Float32Array.from(MATS, m =>
  (m.noHeat || m.temp !== AMBIENT ? 0 : m.state === STATE.GAS ? 0.01 : 0.035));
const M_MELT_AT = Float32Array.from(MATS, m => (m.melt ? m.melt.at : Infinity));
const M_FREEZE_AT = Float32Array.from(MATS, m => (m.freeze ? m.freeze.at : -Infinity));
const M_IGNITE = Float32Array.from(MATS, m => m.ignite ?? Infinity);
const toIds = r => (Array.isArray(r) ? r : [r]).map(k => ID[k]);
const M_MELT_INTO = MATS.map(m => (m.melt ? toIds(m.melt.into) : null));
const M_FREEZE_INTO = MATS.map(m => (m.freeze ? toIds(m.freeze.into) : null));
const M_HEATCAP = Float32Array.from(MATS, m => m.heatCap);
const MIN_TEMP = -273, MAX_TEMP = 3000;
// Falling solids
const M_DYN = Uint8Array.from(MATS, m => (m.dynamic ? 1 : 0));
const M_TOUGH = Float32Array.from(MATS, m => m.toughness);
const M_DEBRIS = Uint8Array.from(MATS, m => (m.debris ? ID[m.debris] : 0));
const MAX_FALL_ROWS = 6;      // fastest a falling solid can go (rows per step)
const BREAK_FORCE = 28;       // how hard a landing it takes to crack a solid of toughness 1

// The world is split into chunks. A chunk that had nothing happen in it (or next to it) last
// frame is asleep and skipped entirely, so calm lakes and settled sand piles cost almost nothing.
const CHUNK_BITS = 4;                 // 16 x 16 pixel chunks
const CHUNK = 1 << CHUNK_BITS;

const DIAG_LEFT_FIRST = [-1, 1], DIAG_RIGHT_FIRST = [1, -1];

// Liquid equalization tuning
const EQ_SEARCHES_PER_STEP = 6;   // how many liquid bodies can be checked each step
const EQ_SEARCH_LIMIT = 4000;     // max cells explored per check
const EQ_RECHECK_FRAMES = 30;     // a level body isn't re-checked for this long

const HOLE_CORE = packRGB(0, 0, 0);
const HOLE_RING = [packRGB(168, 85, 247), packRGB(91, 33, 182)];
const FREE_FLAG = 128;     // aux bit: fire that drifts (not attached to fuel)
const OUT_RANDOM = 127;    // aux burnout code: random smoke / empty

// Hot things glow red, then orange, then yellow-white. Cold things frost over blue.
function tintByTemp(c, dev) {
  const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
  let a, tr, tg, tb;
  if (dev > 0) {
    const k = Math.min(1, (dev - 60) / 900);
    a = Math.min(0.9, (dev - 60) / 300);
    tr = 255; tg = 40 + 200 * k; tb = 20 + 160 * k * k;
  } else {
    a = Math.min(0.65, (-dev - 12) / 100);
    tr = 175; tg = 225; tb = 255;
  }
  return packRGB((r + (tr - r) * a) | 0, (g + (tg - g) * a) | 0, (b + (tb - b) * a) | 0);
}

function randInt(a, b) { return a + ((Math.random() * (b - a + 1)) | 0); }
function pick(arr) { return arr.length === 1 ? arr[0] : arr[(Math.random() * arr.length) | 0]; }

class Sim {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.type = new Uint8Array(n);
    this.life = new Uint8Array(n);
    this.shade = new Uint8Array(n);
    this.aux = new Uint8Array(n);
    this.extra = new Uint8Array(n);   // spare per-cell byte for behaviors (e.g. picky muncher's meal count)
    this.moved = new Uint8Array(n);
    this.temp = new Float32Array(n).fill(AMBIENT);   // temperature of each cell
    this.vel = new Uint8Array(n);       // how long a falling solid has been falling
    this.bodyMark = new Uint32Array(n); // which solid body last claimed this cell (falling solids)
    this.bodyGen = 0;
    this.bodyCells = new Int32Array(n);
    this.stroke = new Uint32Array(n);   // paint stroke that made this cell
    this.activeStroke = 0;              // solids from the stroke being drawn right now hang in place
    this.fallingSolids = true;          // setting: solids fall and break
    this.floorOpen = false;             // setting: things fall out of the bottom of the world
    this.frame = 0;
    this.cw = Math.ceil(w / CHUNK);
    this.ch = Math.ceil(h / CHUNK);
    this.awake = new Uint8Array(this.cw * this.ch).fill(1);      // chunks to update this frame
    this.awakeNext = new Uint8Array(this.cw * this.ch).fill(1);  // chunks to update next frame
    this.pending = false;          // set when a cell could still do something, so its chunk stays awake
    // liquid equalization (connected liquid levels out, like a U-tube)
    this.eqQueue = new Int32Array(n);
    this.eqSeen = new Uint32Array(n);    // search generation that last visited each cell
    this.eqGen = 0;
    this.levelAt = new Uint32Array(n);   // frame when this cell's liquid body was last found level
    this.eqBudget = 0;                   // searches allowed per step
    this.wind = 0;                 // global breeze, -3 (left) .. 3 (right)
    this.portals = [[], []];       // cell indices of blue / orange portals (rebuilt each step)
    this.holes = [];               // cell indices of black holes
    this.magnets = [];             // cell indices of active magnets
    this.personMap = new Uint8Array(n);   // 1 where a person's feet are (see people.js)
    this.people = [];              // little people (see people.js)
    this.onExplode = null;         // hook: (x, y, r) => void
  }

  clear() {
    this.type.fill(0);
    this.life.fill(0);
    this.aux.fill(0);
    this.vel.fill(0);
    this.temp.fill(AMBIENT);
    this.people.length = 0;
    this.personMap.fill(0);
    this.wakeAll();
  }

  wakeAll() {
    this.awake.fill(1);
    this.awakeNext.fill(1);
  }

  // Something changed at cell i: make sure its chunk (and the chunk next door, if it's on an edge)
  // gets updated.
  wake(i) {
    const x = i % this.w, y = (i / this.w) | 0;
    const cx = x >> CHUNK_BITS, cy = y >> CHUNK_BITS, cw = this.cw, a = this.awakeNext, now = this.awake;
    const lx = x & (CHUNK - 1), ly = y & (CHUNK - 1);
    const x0 = lx === 0 && cx > 0 ? cx - 1 : cx, x1 = lx === CHUNK - 1 && cx < cw - 1 ? cx + 1 : cx;
    const y0 = ly === 0 && cy > 0 ? cy - 1 : cy, y1 = ly === CHUNK - 1 && cy < this.ch - 1 ? cy + 1 : cy;
    // wake for next frame, and also for the rest of this frame (rows above haven't been processed yet,
    // so things like a rising bubble don't stall at chunk edges)
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { a[yy * cw + xx] = 1; now[yy * cw + xx] = 1; }
  }

  set(i, t) {
    const m = MATS[t];
    this.type[i] = t;
    this.levelAt[i] = 0;
    this.wake(i);
    this.shade[i] = (Math.random() * 4) | 0;
    this.aux[i] = FREE_FLAG | OUT_RANDOM;
    this.extra[i] = 0;
    this.temp[i] = m.temp;
    this.vel[i] = 0;
    this.stroke[i] = 0;
    this.life[i] = m.life ? randInt(m.life[0], m.life[1]) : 0;
  }

  setFire(i, life, free, out) {
    this.type[i] = ID.fire;
    this.wake(i);
    this.life[i] = life;
    this.aux[i] = (free ? FREE_FLAG : 0) | out;
    this.shade[i] = (Math.random() * 4) | 0;
  }

  swap(i, j) {
    const { type, life, shade, aux, extra, moved, temp, vel } = this;
    let t = type[i]; type[i] = type[j]; type[j] = t;
    t = temp[i]; temp[i] = temp[j]; temp[j] = t;
    t = vel[i]; vel[i] = vel[j]; vel[j] = t;
    t = extra[i]; extra[i] = extra[j]; extra[j] = t;
    t = life[i]; life[i] = life[j]; life[j] = t;
    t = shade[i]; shade[i] = shade[j]; shade[j] = t;
    t = aux[i]; aux[i] = aux[j]; aux[j] = t;
    moved[i] = 1;
    moved[j] = 1;
    this.levelAt[i] = 0;   // things changed here: the liquid may need re-leveling
    this.levelAt[j] = 0;
    this.wake(i);
    this.wake(j);
  }

  // Paint a filled circle of material t (ID.empty erases).
  paint(cx, cy, r, t, auxValue) {
    const { w, h, type } = this;
    const m = MATS[t];
    const density = m.paint ?? (m.state === STATE.SOLID ? 1 : m.state === STATE.FIRE ? 0.4 : 0.55);
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (t === ID.empty) { this.set(i, 0); continue; }
        if (type[i] !== 0) continue;
        if (r > 0 && Math.random() > density) continue;
        this.set(i, t);
        if (auxValue !== undefined) this.aux[i] = auxValue;
        if (this.activeStroke && M_DYN[t]) this.stroke[i] = this.activeStroke;
      }
    }
  }

  step() {
    const { w, h, type, moved, cw } = this;
    moved.fill(0);
    this.frame++;
    this.eqBudget = EQ_SEARCHES_PER_STEP;
    this.indexSpecials();
    // this frame's work list is whatever got woken last frame
    const awake = this.awakeNext;
    this.awakeNext = this.awake;
    this.awake = awake;
    this.awakeNext.fill(0);
    for (let y = h - 1; y >= 0; y--) {
      const ltr = ((y + this.frame) & 1) === 0;   // alternate scan direction to avoid bias
      const chunkRow = (y >> CHUNK_BITS) * cw;
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = y * w + x;
        if (type[i] === 0 || moved[i] || !awake[chunkRow + (x >> CHUNK_BITS)]) continue;
        this.pending = false;
        this.update(x, y, i);
        if (this.pending || M_RESTLESS[type[i]] || (this.life[i] > 0 && MATS[type[i]].conduct)) this.wake(i);
      }
    }
    if (this.fallingSolids) this.updateBodies();
  }

  // ------------------------------------------------------------ temperature
  // Heat / Cool tools: warm up or chill everything in a circle.
  heatArea(cx, cy, r, delta) {
    const { w, h, type, temp } = this;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x, t = type[i];
        if (t === 0) continue;
        if (t === ID.fire) {   // cold snuffs out flames
          if (delta < 0 && Math.random() < 0.15) this.set(i, Math.random() < 0.3 ? ID.smoke : 0);
          continue;
        }
        if (M_NOHEAT[t]) continue;   // wall & co. have no temperature
        temp[i] = Math.max(MIN_TEMP, Math.min(MAX_TEMP, temp[i] + delta / M_HEATCAP[t]));
        this.wake(i);
      }
    }
  }

  // A cell that isn't at its natural temperature: share heat with its neighbours, drift back toward
  // its natural temperature, and melt / freeze / catch fire. Returns true if the cell changed.
  thermal(x, y, i, t) {
    const { w, h, type, temp } = this;
    const k = M_HEATK[t], base = M_TBASE[t];
    let T = temp[i], open = 0;
    for (let d = 0; d < 4; d++) {
      let j;
      if (d === 0) { if (y === 0) { open++; continue; } j = i - w; }
      else if (d === 1) { if (x === w - 1) continue; j = i + 1; }
      else if (d === 2) { if (y === h - 1) continue; j = i + w; }
      else { if (x === 0) continue; j = i - 1; }
      const nt = type[j];
      if (nt === 0) { open++; continue; }
      const kk = Math.min(k, M_HEATK[nt]);
      if (kk === 0 || M_NOHEAT[nt]) continue;
      const flow = (T - temp[j]) * kk;
      if (flow > -0.5 && flow < 0.5) continue;
      T -= flow;
      temp[j] += flow;
      this.wake(j);
    }
    // cool off (or warm up) toward its natural temperature, faster out in the open air
    T += (base - T) * (0.004 + open * 0.004);
    if (T - base < 1 && T - base > -1) T = base;
    else this.pending = true;
    temp[i] = T;
    if (T >= M_MELT_AT[t]) return this.changePhase(i, M_MELT_INTO[t], T);
    if (T <= M_FREEZE_AT[t]) return this.changePhase(i, M_FREEZE_INTO[t], T);
    if (T >= M_IGNITE[t]) {
      this.ignite(x, y, i);
      this.moved[i] = 1;
      return true;
    }
    return false;
  }

  // Melt / boil / freeze into one of `into`, keeping the heat (nudged so it doesn't flip straight back).
  changePhase(i, into, T) {
    const t = pick(into);
    this.set(i, t);
    this.moved[i] = 1;
    if (!t) return true;
    if (T <= M_FREEZE_AT[t]) T = M_FREEZE_AT[t] + 20;
    if (T >= M_MELT_AT[t]) T = M_MELT_AT[t] - 20;
    this.temp[i] = T;
    return true;
  }

  // ------------------------------------------------------------ falling solids
  // Is cell i part of a solid that can fall? (Electricity flowing through a wire counts as the wire.)
  isDynamic(i) {
    const t = this.type[i];
    return M_DYN[t] === 1 || (t === ID.charge && M_DYN[this.aux[i]] === 1);
  }

  // Look for solids in the busy parts of the world and let any unsupported ones fall.
  updateBodies() {
    const { w, h, awake, cw } = this;
    if (this.bodyGen > 0xf0000000) { this.bodyMark.fill(0); this.bodyGen = 0; }
    const startGen = this.bodyGen;
    for (let y = h - 1; y >= 0; y--) {   // bottom first, so a stack falls together
      const chunkRow = (y >> CHUNK_BITS) * cw;
      for (let x = 0; x < w; x++) {
        if (!awake[chunkRow + (x >> CHUNK_BITS)]) { x |= CHUNK - 1; continue; }
        const i = y * w + x;
        if (this.bodyMark[i] > startGen || !this.isDynamic(i)) continue;
        this.fallBody(i);
      }
    }
  }

  // Find the whole connected lump of solid around `seed` and drop it if nothing holds it up.
  fallBody(seed) {
    const { w, h, type, aux, vel, bodyMark: mark, bodyCells: cells } = this;
    let gen = ++this.bodyGen;
    let n = 0, held = false, stuck = false, mass = 0, tough = 0, v = 0;
    cells[n++] = seed;
    mark[seed] = gen;
    const WALL = ID.wall, stroke = this.activeStroke;
    for (let q = 0; q < n; q++) {
      const c = cells[q];
      const cy = (c / w) | 0, cx = c - cy * w;
      const t = type[c] === ID.charge ? aux[c] : type[c];
      mass += M_DENSITY[t];
      tough += M_TOUGH[t];
      if (vel[c] > v) v = vel[c];
      if (stroke && this.stroke[c] === stroke) held = true;   // still being drawn
      for (let d = 0; d < 4; d++) {
        let j;
        if (d === 0) { if (cy === 0) continue; j = c - w; }
        else if (d === 1) { if (cx === w - 1) continue; j = c + 1; }
        else if (d === 2) { if (cy === h - 1) continue; j = c + w; }
        else { if (cx === 0) continue; j = c - 1; }
        if (mark[j] === gen) continue;
        if (this.isDynamic(j)) { mark[j] = gen; cells[n++] = j; }
        else if (type[j] === WALL) stuck = true;   // stuck to (or landed on) a wall
      }
    }
    if (held) {
      if (v) for (let k = 0; k < n; k++) vel[cells[k]] = 0;
      return;
    }
    const density = mass / n;
    const rows = stuck ? 0 : Math.min(MAX_FALL_ROWS, 1 + (v >> 3));
    let fell = 0;
    for (let r = 0; r < rows && n > 0; r++) {
      if (!this.canFall(cells, n, gen, density)) break;
      if (r === 0) cells.subarray(0, n).sort();   // move the bottom of each column first
      n = this.shiftDown(cells, n);
      gen = ++this.bodyGen;
      for (let k = 0; k < n; k++) mark[cells[k]] = gen;
      fell++;
    }
    if (fell) {
      const nv = Math.min(250, v + 1);
      for (let k = 0; k < n; k++) vel[cells[k]] = nv;
    } else if (v) {
      // it just landed. Only the part that was falling takes the hit (not the floor it landed on).
      gen = ++this.bodyGen;
      let m = 0;
      tough = 0;
      for (let k = 0; k < n; k++) {
        const c = cells[k];
        if (!vel[c]) continue;
        vel[c] = 0;
        mark[c] = gen;
        cells[m++] = c;
        tough += M_TOUGH[type[c] === ID.charge ? aux[c] : type[c]];
      }
      this.impact(cells, m, gen, v, tough / m);
    }
  }

  // Can the body (cells marked `gen`) move down one row? It falls through air, gas and fire,
  // sinks through lighter liquids and floats on heavier ones.
  canFall(cells, n, gen, density) {
    const { w, type, bodyMark: mark } = this;
    const last = w * (this.h - 1);
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      if (c >= last) { if (this.floorOpen) continue; return false; }
      const j = c + w;
      if (mark[j] === gen) continue;
      const tt = type[j];
      if (tt === 0) continue;
      const st = M_STATE[tt];
      if (st === STATE.GAS || st === STATE.FIRE) continue;
      if (st === STATE.LIQUID && density > M_DENSITY[tt]) continue;
      return false;
    }
    return true;
  }

  // Move every cell of the body (sorted top to bottom) down one row; whatever was below rises
  // up through it. Cells on the bottom row fall out of the world. Returns the new cell count.
  shiftDown(cells, n) {
    const w = this.w, last = w * (this.h - 1);
    let out = 0;
    for (let k = n - 1; k >= 0; k--) {
      const c = cells[k];
      if (c >= last) { this.set(c, 0); cells[k] = -1; out++; }
      else { this.swap(c, c + w); cells[k] = c + w; }
    }
    if (!out) return n;
    let m = 0;
    for (let k = 0; k < n; k++) if (cells[k] >= 0) cells[m++] = cells[k];
    return m;
  }

  // A falling solid hit something. Too fast or too heavy, and it cracks into pieces:
  // crack lines turn into rubble (or gaps) and each piece carries on by itself.
  impact(cells, n, gen, v, toughness) {
    const { w, h, type, aux, bodyMark: mark } = this;
    const force = v * (1 + Math.sqrt(n) / 12);
    const limit = BREAK_FORCE * toughness;
    if (force < limit) return;
    const cracks = Math.min(40, Math.ceil((force / limit) ** 2 * (1 + n / 120)));
    for (let c = 0; c < cracks; c++) {
      const o = cells[(Math.random() * n) | 0];
      const oy = (o / w) | 0, ox = o - oy * w;
      const a = Math.random() * Math.PI;
      const dx = Math.cos(a), dy = Math.sin(a);
      for (const dir of [1, -1]) {
        for (let s = dir === 1 ? 0 : 1; s < 400; s++) {
          const x = Math.round(ox + dx * s * dir), y = Math.round(oy + dy * s * dir);
          if (x < 0 || y < 0 || x >= w || y >= h) break;
          const j = y * w + x;
          if (mark[j] !== gen) break;   // left the body
          if (!this.isDynamic(j)) continue;   // already cracked
          const t = type[j] === ID.charge ? aux[j] : type[j];
          this.set(j, M_DEBRIS[t]);
          this.moved[j] = 1;
          mark[j] = gen;   // keep the crack line going through cracked cells
        }
      }
    }
  }

  // Remember where portals and black holes are, so they can find each other quickly.
  indexSpecials() {
    const { type } = this;
    const [blue, orange] = this.portals;
    blue.length = 0;
    orange.length = 0;
    this.holes.length = 0;
    this.magnets.length = 0;
    this.fishCount = 0;
    const { life, aux } = this;
    const FISH = ID.fish, A = ID.portalA, B = ID.portalB, BH = ID.blackhole, MG = ID.magnet, EM = ID.emagnet, CH = ID.charge;
    for (let i = 0, n = type.length; i < n; i++) {
      const t = type[i];
      if (!t) continue;
      if (t === A) blue.push(i);
      else if (t === B) orange.push(i);
      else if (t === BH) this.holes.push(i);
      else if (t === FISH) this.fishCount++;
      else if (t === MG || (t === EM && life[i] > 0) || (t === CH && aux[i] === EM)) this.magnets.push(i);
    }
  }

  // Wind tool: blast loose cells within radius r away from (cx, cy).
  // Strongest near the center, fading toward the edge.
  blowOut(cx, cy, r, strength) {
    const { w, h, type } = this;
    const cells = [];
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const d2 = ox * ox + oy * oy;
        if (d2 > r * r) continue;
        const x = cx + ox, y = cy + oy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const t = type[y * w + x];
        if (!t) continue;
        const s = MATS[t].state;
        if (s === STATE.SOLID || s === STATE.EMPTY) continue;
        cells.push([x, y, Math.sqrt(d2)]);
      }
    }
    cells.sort((a, b) => b[2] - a[2]);   // move the outer edge first so cells don't block each other
    for (const [x, y, d] of cells) {
      let j = y * w + x;
      if (!type[j]) continue;
      let ux, uy;
      if (d < 0.5) { const a = Math.random() * Math.PI * 2; ux = Math.cos(a); uy = Math.sin(a); }
      else { ux = (x - cx) / d; uy = (y - cy) / d; }
      const falloff = 1 - 0.7 * (d / (r + 1));
      const steps = Math.max(1, Math.round(strength * falloff * (0.5 + Math.random())));
      let px = x, py = y, fx = x + 0.5, fy = y + 0.5;
      for (let s = 0; s < steps; s++) {
        // try straight on, then slip around obstacles at +/-45 degrees
        const turn = Math.random() < 0.5 ? 1 : -1;
        let moved = false;
        for (const a of [0, turn * 0.8, -turn * 0.8]) {
          const c = Math.cos(a), sn = Math.sin(a);
          const vx = ux * c - uy * sn, vy = ux * sn + uy * c;
          const nfx = fx + vx + (Math.random() - 0.5) * 0.4, nfy = fy + vy + (Math.random() - 0.5) * 0.4;
          const nx = Math.floor(nfx), ny = Math.floor(nfy);
          if (nx === px && ny === py) { fx = nfx; fy = nfy; moved = true; break; }
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (type[k] !== 0) continue;
          this.swap(j, k);
          j = k; px = nx; py = ny; fx = nfx; fy = nfy;
          moved = true;
          break;
        }
        if (!moved) break;
      }
    }
  }

  update(x, y, i) {
    const { type, life, moved } = this;
    const t = type[i];
    const m = MATS[t];

    if (m.decay && Math.random() < m.decay.p) {
      this.set(i, ID[m.decay.into]);
      moved[i] = 1;
      return;
    }
    if (m.life) {
      if (life[i] > 0) life[i]--;
      else { this.expire(i, m); moved[i] = 1; return; }
    }
    if (m.conduct && life[i] > 0) life[i]--;   // cooling down after carrying a charge
    if (m.glow && Math.random() < 0.05) this.shade[i] = (Math.random() * 4) | 0;
    if (this.temp[i] !== M_TBASE[t] && !M_NOHEAT[t] && this.thermal(x, y, i, t)) return;

    if (m.reacts && this.react(x, y, i, t)) return;
    if (m.tick && (BEHAVIORS[m.tick](this, x, y, i) || type[i] !== t)) return;

    if (m.state === STATE.FIRE || m.hot) {
      this.heat(x, y, i, m);
      if (type[i] !== t) return;
    }

    switch (m.state) {
      case STATE.POWDER: this.movePowder(x, y, i, m); break;
      case STATE.LIQUID: this.moveLiquid(x, y, i, m); break;
      case STATE.GAS: this.moveGas(x, y, i, m); break;
      case STATE.FIRE: this.moveFire(x, y, i); break;
    }
  }

  expire(i, m) {
    if (m.state === STATE.FIRE) {
      const out = this.aux[i] & OUT_RANDOM;
      if (out === OUT_RANDOM) this.set(i, Math.random() < 0.3 ? ID.smoke : 0);
      else this.set(i, out);
    } else if (m.expire && Math.random() < m.expire.p) {
      this.set(i, ID[m.expire.into]);
    } else {
      this.set(i, 0);
    }
  }

  react(x, y, i, t) {
    const { w, h, type } = this;
    const start = (Math.random() * 4) | 0;
    for (let k = 0; k < 4; k++) {
      const d = DIRS4[(start + k) & 3];
      const nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const tb = type[j];
      if (tb === 0) continue;
      const list = RX[(t << 8) | tb];
      if (list === null) continue;
      this.pending = true;   // could react later, stay awake
      for (let n = 0; n < list.length; n++) {
        const r = list[n];
        if (Math.random() >= r.p) continue;
        if (r.fx === 'explode') {
          this.explode(x, y, r.r);
        } else {
          if (r.ra) this.set(i, pick(r.ra));
          if (r.rb) this.set(j, pick(r.rb));
        }
        this.moved[i] = 1;
        this.moved[j] = 1;
        return true;
      }
    }
    return false;
  }

  // Fire and hot things ignite flammable neighbours.
  heat(x, y, i, m) {
    const { w, h, type } = this;
    const power = m.state === STATE.FIRE ? 1 : m.hot;
    for (const d of DIRS4) {
      const nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const mm = MATS[type[j]];
      if (mm.burn && Math.random() < mm.burn.chance * power) {
        this.ignite(nx, ny, j);
        if (type[i] !== m.id) return;
      }
    }
    if (y > 0 && type[i - w] === 0) {
      if (m.state === STATE.FIRE && !(this.aux[i] & FREE_FLAG) && Math.random() < 0.04) this.set(i - w, ID.smoke);
      else if (m.hot && Math.random() < 0.0015) this.setFire(i - w, randInt(5, 15), true, OUT_RANDOM);
    }
  }

  ignite(x, y, j) {
    const m = MATS[this.type[j]];
    if (m.explode) { this.explode(x, y, m.explode); return; }
    if (m.rocket) {
      this.set(j, ID.rocket);
      this.life[j] = randInt(30, 60);
      this.moved[j] = 1;
      return;
    }
    const b = m.burn;
    let out = OUT_RANDOM;
    if (b.into && Math.random() < (b.intoChance ?? 1)) out = ID[Array.isArray(b.into) ? pick(b.into) : b.into];
    this.setFire(j, randInt(b.life[0], b.life[1]), !!b.free, out);
    this.moved[j] = 1;
  }

  explode(cx, cy, r) {
    const { w, h, type } = this;
    if (this.onExplode) this.onExplode(cx, cy, r);
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const j = y * w + x;
        const t = type[j];
        const m = MATS[t];
        const f = Math.sqrt(d2) / r;
        if (m.indestructible || m.hot || m.state === STATE.FIRE) continue;
        if (t === 0) {
          if (Math.random() < 0.7 * (1 - f) + 0.1) this.setFire(j, randInt(6, 18), true, OUT_RANDOM);
        } else if (m.explode) {
          this.setFire(j, randInt(2, 6), false, OUT_RANDOM);   // chain reaction, slightly delayed
        } else if (m.state === STATE.SOLID) {
          if (Math.random() < (1 - f) * m.blast) this.set(j, Math.random() < 0.3 ? ID.fire : 0);
        } else if (t === ID.water || t === ID.saltwater) {
          this.set(j, ID.steam);
        } else {
          this.set(j, Math.random() < 0.5 ? ID.fire : 0);
        }
        this.moved[j] = 1;
      }
    }
  }

  // ------------------------------------------------------------ movement
  // Can a falling powder/liquid of material m move into cell j?
  canSink(m, j) {
    const tt = this.type[j];
    if (tt === 0) return true;
    const st = M_STATE[tt];
    const d = M_DENSITY[m.id];   // compare float32 to float32 (2.05 isn't exact in float32!)
    if (st === STATE.GAS || st === STATE.FIRE) return !(M_SINK[tt] && M_DENSITY[tt] >= d);
    if (st === STATE.LIQUID && M_DENSITY[tt] < d) {
      if (Math.random() < 0.5) return true;
      this.pending = true;
    }
    return false;
  }

  movePowder(x, y, i, m) {
    const { w, h, type } = this;
    if (y + 1 >= h) { if (this.floorOpen) this.set(i, 0); return; }
    const below = i + w;
    if (this.wind && m.density < 2.3) this.pending = true;   // drifting in the breeze
    if (this.wind && m.density < 2.3 && type[below] === 0 && Math.random() < Math.abs(this.wind) * 0.2) {
      // light powders drift in the breeze as they fall
      const s = Math.sign(this.wind);
      if (x + s >= 0 && x + s < w && type[below + s] === 0) { this.swap(i, below + s); return; }
    }
    if (this.canSink(m, below)) { this.swap(i, below); return; }
    const dx = Math.random() < 0.5 ? -1 : 1;
    if (x + dx >= 0 && x + dx < w && this.canSink(m, below + dx)) { this.swap(i, below + dx); return; }
    if (x - dx >= 0 && x - dx < w && this.canSink(m, below - dx)) { this.swap(i, below - dx); return; }
  }

  moveLiquid(x, y, i, m) {
    const { w, h, type } = this;
    if (m.moveChance < 1 && Math.random() > m.moveChance) { this.pending = true; return; }
    const dx = Math.random() < 0.5 ? -1 : 1;
    const t = m.id;
    if (y + 1 >= h && this.floorOpen) { this.set(i, 0); return; }
    if (y + 1 < h) {
      const below = i + w;
      // Liquid resting on the same liquid often just "rests" this step. Without this, a gap next to a
      // pool gets filled in a chain reaction that races across a whole row in one step (stripes);
      // with it, liquid fills gaps mostly by falling in, and holes rise like real air bubbles.
      if (type[below] === t) {
        if (Math.random() < 0.5) return this.restLiquid(x, y, i);
      } else if (this.canSink(m, below)) { this.swap(i, below); return; }
      for (const s of dx < 0 ? DIAG_LEFT_FIRST : DIAG_RIGHT_FIRST) {
        const nx = x + s;
        if (nx < 0 || nx >= w) continue;
        const j = below + s;
        if (type[j] === t) { if (Math.random() < 0.5) return this.restLiquid(x, y, i); }
        else if (this.canSink(m, j)) { this.swap(i, j); return; }
      }
    }
    // spread sideways
    if (this.spread(x, y, i, m, dx)) return;
    if (this.spread(x, y, i, m, -dx)) return;
    // stuck at the surface: let connected liquid level out (U-tubes, pipes, siphons...)
    if (y > 0 && type[i - w] === 0 && this.frame - this.levelAt[i] > EQ_RECHECK_FRAMES) {
      if (this.eqBudget > 0) { this.eqBudget--; this.equalize(i); }
      else this.pending = true;   // try again next step
    }
  }

  // Search the body of liquid connected to cell i. If its highest surface pixel is above the lowest
  // open spot on its surface, move that pixel there (pressure pushes liquid through
  // the pipe). Otherwise remember the body as level so it can rest.
  equalize(i) {
    const { w, h, type, eqQueue: q, eqSeen: seen } = this;
    const t = type[i];
    if (++this.eqGen === 0xffffffff) { seen.fill(0); this.eqGen = 1; }
    const gen = this.eqGen;
    let head = 0, tail = 0;
    q[tail++] = i;
    seen[i] = gen;
    let hi = -1, hiY = h, slot = -1, slotY = -1;
    while (head < tail) {
      const c = q[head++];
      const cy = (c / w) | 0, cx = c - cy * w;
      if (cy > 0 && type[c - w] === 0) {           // a surface pixel
        if (cy < hiY) { hiY = cy; hi = c; }
        if (cy - 1 > slotY) { slotY = cy - 1; slot = c - w; }
      }
      if (tail >= EQ_SEARCH_LIMIT) continue;       // stop growing, but finish what's queued
      let j;
      if (cy + 1 < h && type[j = c + w] === t && seen[j] !== gen) { seen[j] = gen; q[tail++] = j; }
      if (cx > 0 && type[j = c - 1] === t && seen[j] !== gen) { seen[j] = gen; q[tail++] = j; }
      if (cx < w - 1 && type[j = c + 1] === t && seen[j] !== gen) { seen[j] = gen; q[tail++] = j; }
      if (cy > 0 && type[j = c - w] === t && seen[j] !== gen) { seen[j] = gen; q[tail++] = j; }
    }
    if (hi >= 0 && slotY > hiY) {   // strictly lower, so pixels only ever move down (no sloshing forever)
      this.swap(hi, slot);   // the high pixel pops out at the low spot
      return true;
    }
    for (let k = 0; k < tail; k++) this.levelAt[q[k]] = this.frame;   // whole body is level: let it rest
    return false;
  }

  // A liquid pixel skipped its turn. Keep its chunk awake only if it could actually still move.
  restLiquid(x, y, i) {
    const { w, h, type } = this;
    if ((x > 0 && type[i - 1] === 0) || (x < w - 1 && type[i + 1] === 0) ||
        (y + 1 < h && ((x > 0 && type[i + w - 1] === 0) || (x < w - 1 && type[i + w + 1] === 0))) ||
        (y > 0 && type[i - w] === 0 && this.frame - this.levelAt[i] > EQ_RECHECK_FRAMES)) {   // may need leveling
      this.pending = true;
    }
  }

  // Slide a liquid up to m.flow cells sideways in direction s. Returns true if it moved.
  spread(x, y, i, m, s) {
    const { w, h, type } = this;
    let best = -1;
    const row = y * w;
    for (let k = 1; k <= m.flow; k++) {
      const nx = x + s * k;
      if (nx < 0 || nx >= w) break;
      const j = row + nx;
      const tt = type[j];
      if (tt !== 0 && M_STATE[tt] !== STATE.GAS) {
        // occasionally slip sideways past a lighter liquid so layers settle cleanly
        if (k === 1 && M_STATE[tt] === STATE.LIQUID && M_DENSITY[tt] < M_DENSITY[m.id]) {
          if (Math.random() < 0.1) best = j;
          else this.pending = true;
        }
        break;
      }
      best = j;
      if (y + 1 < h && type[j + w] === 0) break;   // found a drop-off
    }
    if (best < 0) return false;
    this.swap(i, best);
    return true;
  }

  // Can gas m move into cell j? vertical = moving in its preferred direction
  gasCanEnter(m, j, vertical) {
    const tt = this.type[j];
    if (tt === 0) return true;
    if (!vertical) return false;
    const st = M_STATE[tt];
    const d = M_DENSITY[m.id];
    if (st === STATE.GAS && tt !== m.id) return m.sink ? M_DENSITY[tt] < d : M_DENSITY[tt] > d;
    if (st === STATE.LIQUID && !m.sink) {   // bubble up through liquid
      if (Math.random() < 0.5) return true;
      this.pending = true;
    }
    return false;
  }

  // Try to move gas at i by (ox, oy). Returns true if it moved.
  gasTry(x, y, i, m, ox, oy) {
    const nx = x + ox, ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) return false;
    const j = ny * this.w + nx;
    if (!this.gasCanEnter(m, j, oy !== 0)) return false;
    this.swap(i, j);
    return true;
  }

  moveGas(x, y, i, m) {
    const { w } = this;
    const dy = m.sink ? 1 : -1;
    if (m.sink && y + 1 >= this.h && this.floorOpen) { this.set(i, 0); return; }
    this.pending = true;   // gases keep drifting around, so keep them awake
    if (this.wind && Math.random() < Math.abs(this.wind) * 0.2) {
      const s = Math.sign(this.wind);
      if (x + s >= 0 && x + s < w && this.type[i + s] === 0) { this.swap(i, i + s); return; }
    }
    if (m.sink && Math.random() < 0.5) {
      // heavy gas drifts lazily
      const s = Math.random() < 0.5 ? -1 : 1;
      const nx = x + s;
      if (nx >= 0 && nx < w && this.type[i + s] === 0) this.swap(i, i + s);
      return;
    }
    const dx = Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.4) {
      if (this.gasTry(x, y, i, m, dx, dy) || this.gasTry(x, y, i, m, 0, dy)) return;
    } else if (this.gasTry(x, y, i, m, 0, dy) || this.gasTry(x, y, i, m, dx, dy)) return;
    if (this.gasTry(x, y, i, m, -dx, dy) || this.gasTry(x, y, i, m, dx, 0)) return;
    this.gasTry(x, y, i, m, -dx, 0);
  }

  moveFire(x, y, i) {
    if (!(this.aux[i] & FREE_FLAG) || Math.random() < 0.5 || y === 0) return;
    let nx = x + ((Math.random() * 3) | 0) - 1;
    if (this.wind && Math.random() < Math.abs(this.wind) * 0.2) nx = x + Math.sign(this.wind);
    if (nx < 0 || nx >= this.w) return;
    const j = (y - 1) * this.w + nx;
    if (this.type[j] === 0) this.swap(i, j);
  }

  // ------------------------------------------------------------ render
  render(buf) {
    const { type, shade, life, aux, temp } = this;
    const halos = [];
    const FIRE = ID.fire, CHARGE = ID.charge, PICKY = ID.picky, ANTI = ID.antipicky;
    for (let i = 0, n = type.length; i < n; i++) {
      const t = type[i];
      if (t === 0) { buf[i] = BG_COLOR; continue; }
      if (t === FIRE) { buf[i] = FIRE_COLORS[Math.min(255, life[i] + shade[i] * 4)]; continue; }
      const m = MATS[t];
      if (t === PICKY || t === ANTI) {
        const food = MATS[aux[i]];
        buf[i] = (shade[i] & 2) && food ? food.colors[1] : m.colors[shade[i]];
      } else if (t === CHARGE) {
        const om = MATS[aux[i]];
        if (om && om.lit) { buf[i] = om.lit[1]; if (om.halo) halos.push(i); }
        else buf[i] = m.colors[shade[i]];
      } else if (m.lit && life[i] > 0) {
        buf[i] = m.lit[shade[i] & 1];
        if (m.halo) halos.push(i);
      } else {
        buf[i] = m.colors[shade[i]];
      }
      const dev = temp[i] - M_TBASE[t];
      if (dev > 60 || dev < -12) buf[i] = tintByTemp(buf[i], dev);
    }
    this.renderHalos(buf, halos);
    this.renderHoles(buf);
  }

  // A soft glow in the empty space around lit lamps.
  renderHalos(buf, halos) {
    const { w, h, type } = this;
    const n = Math.min(halos.length, 600);
    for (let k = 0; k < n; k++) {
      const hi = halos[k], hx = hi % w, hy = (hi / w) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const x = hx + dx, y = hy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const j = y * w + x;
          if (type[j] === 0) buf[j] = HALO_COLOR;
        }
      }
    }
  }

  // Black holes get a dark core and a swirling ring so they're visible.
  renderHoles(buf) {
    const { w, h } = this;
    const spin = this.frame * 0.15;
    const n = Math.min(this.holes.length, 200);
    for (let k = 0; k < n; k++) {
      const hi = this.holes[k], hx = hi % w, hy = (hi / w) | 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d2 = dx * dx + dy * dy, x = hx + dx, y = hy + dy;
          if (d2 > 10 || x < 0 || y < 0 || x >= w || y >= h) continue;
          if (d2 <= 2) buf[y * w + x] = HOLE_CORE;
          else if (((Math.atan2(dy, dx) * 2 + spin) | 0) & 1) buf[y * w + x] = HOLE_RING[d2 > 5 ? 1 : 0];
        }
      }
    }
  }

  count() {
    let c = 0;
    for (let i = 0; i < this.type.length; i++) if (this.type[i]) c++;
    return c;
  }
}
