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

// The world is split into chunks. A chunk that had nothing happen in it (or next to it) last
// frame is asleep and skipped entirely, so calm lakes and settled sand piles cost almost nothing.
const CHUNK_BITS = 4;                 // 16 x 16 pixel chunks
const CHUNK = 1 << CHUNK_BITS;

// Liquid equalization tuning
const EQ_SEARCHES_PER_STEP = 6;   // how many liquid bodies can be checked each step
const EQ_SEARCH_LIMIT = 4000;     // max cells explored per check
const EQ_RECHECK_FRAMES = 30;     // a level body isn't re-checked for this long

const HOLE_CORE = packRGB(0, 0, 0);
const HOLE_RING = [packRGB(168, 85, 247), packRGB(91, 33, 182)];
const FREE_FLAG = 128;     // aux bit: fire that drifts (not attached to fuel)
const OUT_RANDOM = 127;    // aux burnout code: random smoke / empty

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
    this.people.length = 0;
    this.personMap.fill(0);
    this.wakeAll();
  }

  wakeAll() {
    this.awake.fill(1);
    this.awakeNext.fill(1);
  }

  // Something changed at cell i: make sure its chunk (and the chunk next door, if it's on an edge)
  // gets updated next frame.
  wake(i) {
    const x = i % this.w, y = (i / this.w) | 0;
    const cx = x >> CHUNK_BITS, cy = y >> CHUNK_BITS, cw = this.cw, a = this.awakeNext;
    const lx = x & (CHUNK - 1), ly = y & (CHUNK - 1);
    const x0 = lx === 0 && cx > 0 ? cx - 1 : cx, x1 = lx === CHUNK - 1 && cx < cw - 1 ? cx + 1 : cx;
    const y0 = ly === 0 && cy > 0 ? cy - 1 : cy, y1 = ly === CHUNK - 1 && cy < this.ch - 1 ? cy + 1 : cy;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) a[yy * cw + xx] = 1;
  }

  set(i, t) {
    const m = MATS[t];
    this.type[i] = t;
    this.levelAt[i] = 0;
    this.wake(i);
    this.shade[i] = (Math.random() * 4) | 0;
    this.aux[i] = FREE_FLAG | OUT_RANDOM;
    this.extra[i] = 0;
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
    const { type, life, shade, aux, extra, moved } = this;
    let t = type[i]; type[i] = type[j]; type[j] = t;
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
  }

  // Remember where portals and black holes are, so they can find each other quickly.
  indexSpecials() {
    const { type } = this;
    const [blue, orange] = this.portals;
    blue.length = 0;
    orange.length = 0;
    this.holes.length = 0;
    this.magnets.length = 0;
    const { life, aux } = this;
    const A = ID.portalA, B = ID.portalB, BH = ID.blackhole, MG = ID.magnet, EM = ID.emagnet, CH = ID.charge;
    for (let i = 0, n = type.length; i < n; i++) {
      const t = type[i];
      if (!t) continue;
      if (t === A) blue.push(i);
      else if (t === B) orange.push(i);
      else if (t === BH) this.holes.push(i);
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
    if (st === STATE.GAS || st === STATE.FIRE) return !(M_SINK[tt] && M_DENSITY[tt] >= m.density);
    if (st === STATE.LIQUID && M_DENSITY[tt] < m.density) {
      if (Math.random() < 0.5) return true;
      this.pending = true;
    }
    return false;
  }

  movePowder(x, y, i, m) {
    const { w, h, type } = this;
    if (y + 1 >= h) return;
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
    if (y + 1 < h) {
      const below = i + w;
      if (this.canSink(m, below)) { this.swap(i, below); return; }
      if (x + dx >= 0 && x + dx < w && this.canSink(m, below + dx)) { this.swap(i, below + dx); return; }
      if (x - dx >= 0 && x - dx < w && this.canSink(m, below - dx)) { this.swap(i, below - dx); return; }
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
        if (k === 1 && M_STATE[tt] === STATE.LIQUID && M_DENSITY[tt] < m.density) {
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
    if (st === STATE.GAS && tt !== m.id) return m.sink ? M_DENSITY[tt] < m.density : M_DENSITY[tt] > m.density;
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
    const { type, shade, life, aux } = this;
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
