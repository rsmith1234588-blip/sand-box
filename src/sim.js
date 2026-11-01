'use strict';
// Cellular-automaton simulation. Depends on materials.js.

const DIRS4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
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
  }

  set(i, t) {
    const m = MATS[t];
    this.type[i] = t;
    this.shade[i] = (Math.random() * 4) | 0;
    this.aux[i] = FREE_FLAG | OUT_RANDOM;
    this.extra[i] = 0;
    this.life[i] = m.life ? randInt(m.life[0], m.life[1]) : 0;
  }

  setFire(i, life, free, out) {
    this.type[i] = ID.fire;
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
    const { w, h, type, moved } = this;
    moved.fill(0);
    this.frame++;
    this.indexSpecials();
    for (let y = h - 1; y >= 0; y--) {
      const ltr = ((y + this.frame) & 1) === 0;   // alternate scan direction to avoid bias
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = y * w + x;
        if (type[i] === 0 || moved[i]) continue;
        this.update(x, y, i);
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
      const list = REACTIONS.get((t << 8) | tb);
      if (!list) continue;
      for (const r of list) {
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
    const mm = MATS[tt];
    if (mm.state === STATE.GAS || mm.state === STATE.FIRE) return !(mm.sink && mm.density >= m.density);
    if (mm.state === STATE.LIQUID && mm.density < m.density) return Math.random() < 0.5;
    return false;
  }

  movePowder(x, y, i, m) {
    const { w, h, type } = this;
    if (y + 1 >= h) return;
    const below = i + w;
    if (this.wind && m.density < 2.3 && type[below] === 0 && Math.random() < Math.abs(this.wind) * 0.2) {
      // light powders drift in the breeze as they fall
      const s = Math.sign(this.wind);
      if (x + s >= 0 && x + s < w && type[below + s] === 0) { this.swap(i, below + s); return; }
    }
    if (this.canSink(m, below)) { this.swap(i, below); return; }
    const dx = Math.random() < 0.5 ? -1 : 1;
    for (const s of [dx, -dx]) {
      const nx = x + s;
      if (nx < 0 || nx >= w) continue;
      const j = below + s;
      if (this.canSink(m, j)) { this.swap(i, j); return; }
    }
  }

  moveLiquid(x, y, i, m) {
    const { w, h, type } = this;
    if (m.moveChance < 1 && Math.random() > m.moveChance) return;
    if (y + 1 < h) {
      const below = i + w;
      if (this.canSink(m, below)) { this.swap(i, below); return; }
    }
    const dx = Math.random() < 0.5 ? -1 : 1;
    if (y + 1 < h) {
      for (const s of [dx, -dx]) {
        const nx = x + s;
        if (nx < 0 || nx >= w) continue;
        const j = i + w + s;
        if (this.canSink(m, j)) { this.swap(i, j); return; }
      }
    }
    // spread sideways
    for (const s of [dx, -dx]) {
      let best = -1;
      for (let k = 1; k <= m.flow; k++) {
        const nx = x + s * k;
        if (nx < 0 || nx >= w) break;
        const j = y * w + nx;
        const tt = type[j];
        if (tt !== 0 && MATS[tt].state !== STATE.GAS) {
          // occasionally slip sideways past a lighter liquid so layers settle cleanly
          const mm = MATS[tt];
          if (k === 1 && mm.state === STATE.LIQUID && mm.density < m.density && Math.random() < 0.1) best = j;
          break;
        }
        best = j;
        if (y + 1 < h && type[j + w] === 0) break;   // found a drop-off
      }
      if (best >= 0) { this.swap(i, best); return; }
    }
  }

  // Can gas m move into cell j? vertical = moving in its preferred direction
  gasCanEnter(m, j, vertical) {
    const tt = this.type[j];
    if (tt === 0) return true;
    if (!vertical) return false;
    const mm = MATS[tt];
    if (mm.state === STATE.GAS && tt !== m.id) return m.sink ? mm.density < m.density : mm.density > m.density;
    if (mm.state === STATE.LIQUID && !m.sink) return Math.random() < 0.5;   // bubble up through liquid
    return false;
  }

  moveGas(x, y, i, m) {
    const { w, h } = this;
    const dy = m.sink ? 1 : -1;
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
    const opts = Math.random() < 0.4
      ? [[dx, dy], [0, dy], [-dx, dy], [dx, 0], [-dx, 0]]
      : [[0, dy], [dx, dy], [-dx, dy], [dx, 0], [-dx, 0]];
    for (const [ox, oy] of opts) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (this.gasCanEnter(m, j, oy !== 0)) { this.swap(i, j); return; }
    }
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
    const FIRE = ID.fire, CHARGE = ID.charge, PICKY = ID.picky;
    for (let i = 0, n = type.length; i < n; i++) {
      const t = type[i];
      if (t === 0) { buf[i] = BG_COLOR; continue; }
      if (t === FIRE) { buf[i] = FIRE_COLORS[Math.min(255, life[i] + shade[i] * 4)]; continue; }
      const m = MATS[t];
      if (t === PICKY) {
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
