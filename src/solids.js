'use strict';
// Falling solids: each connected piece of solid falls as one lump, sinks or floats in liquids, tips over
// when it hangs off an edge, and cracks apart when it lands (or topples) too hard.
// Wall never moves. Depends on materials.js and sim.js.
//
// Every solid cell carries a piece id (sim.bid). Touching cells with the same id are one piece, so a
// block that lands on the floor stays a separate block (and can still tip off it). Cells with id 0
// (made by reactions, freezing, growing plants...) join whatever piece they touch.

const M_DYN = Uint8Array.from(MATS, m => (m.dynamic ? 1 : 0));
const M_TOUGH = Float32Array.from(MATS, m => m.toughness);
const M_DEBRIS = Uint8Array.from(MATS, m => (m.debris ? ID[m.debris] : 0));
const MAX_FALL_ROWS = 6;      // fastest a falling solid can go (rows per step)
const BREAK_FORCE = 28;       // how hard a landing it takes to crack a solid of toughness 1
const MAX_TIP_CELLS = 5000;   // bigger pieces don't rotate (too slow to redraw every step)
const MAX_SPINNERS = 40;      // pieces that can be tipping over at once
const TIP_START = 0.02;       // radians per step when a piece starts to tip
const TIP_GRAVITY = 0.15;     // angular acceleration = TIP_GRAVITY / length, so tall things topple slower
const TIP_MAX = 0.15;         // fastest rotation (radians per step), so it never skips through things
const NEAR8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

Object.assign(Sim.prototype, {
  newBid() { return this.nextBid++; },

  // A new solid cell (frozen, grown, set...) joins a piece it touches, or starts a new one.
  adoptBid(i) {
    const { w, h, bid } = this, x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of NEAR8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (bid[j] && this.isDynamic(j)) return bid[j];
    }
    return this.newBid();
  },

  // Is cell i part of a solid that can fall? (Electricity flowing through a wire counts as the wire.)
  isDynamic(i) {
    const t = this.type[i];
    return M_DYN[t] === 1 || (t === ID.charge && M_DYN[this.aux[i]] === 1);
  },

  solidType(i) { return this.type[i] === ID.charge ? this.aux[i] : this.type[i]; },

  // ---------------------------------------------------------------- drawing
  beginStroke() {
    this.activeStroke = this.newBid();
    return this.activeStroke;
  },

  // The player let go: the piece they drew sticks to any solid it was drawn onto, then everything
  // gets a fresh look (the piece was hanging in place while being drawn, so it may need to fall).
  endStroke() {
    const id = this.activeStroke;
    this.activeStroke = 0;
    if (!id) return;
    const { w, h, bid } = this, n = w * h;
    const touched = new Set();
    for (let i = 0; i < n; i++) {
      if (bid[i] !== id) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of NEAR8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx, b = bid[j];
        if (b && b !== id && this.isDynamic(j) && !this.spinning(b)) touched.add(b);
      }
    }
    if (touched.size) for (let i = 0; i < n; i++) if (touched.has(bid[i])) bid[i] = id;
    // drawn onto a wall (or onto something already stuck to one): it stays stuck there
    let glued = [...touched].some(b => this.glued.has(b));
    for (let i = 0; i < n && !glued; i++) {
      if (bid[i] !== id) continue;
      const x = i % w, y = (i / w) | 0;
      glued = (y > 0 && this.type[i - w] === ID.wall) || (x > 0 && this.type[i - 1] === ID.wall) ||
        (x < w - 1 && this.type[i + 1] === ID.wall);
    }
    if (glued) this.glued.add(id);
    this.wakeAll();
  },

  spinning(b) { return this.spinners.some(sp => sp.bid === b); },

  setFallingSolids(on) {
    this.fallingSolids = on;
    if (!on) { this.vel.fill(0); this.spinners.length = 0; }
    this.wakeAll();
  },

  // ---------------------------------------------------------------- every step
  updateBodies() {
    const { w, h, awake, cw } = this;
    if (this.bodyGen > 0xf0000000) { this.bodyMark.fill(0); this.bodyGen = 0; }
    this.frameGen = this.bodyGen;
    // pieces that are tipping over turn a little more
    for (let k = this.spinners.length - 1; k >= 0; k--) {
      const sp = this.spinners[k];
      if (this.stepSpinner(sp)) continue;
      this.spinners.splice(k, 1);
      for (const g of sp.placed) this.wake(g);   // done turning: look at it again (it may fall now)
    }
    for (let y = h - 1; y >= 0; y--) {   // bottom first, so a stack falls together
      const chunkRow = (y >> CHUNK_BITS) * cw;
      for (let x = 0; x < w; x++) {
        if (!awake[chunkRow + (x >> CHUNK_BITS)]) { x |= CHUNK - 1; continue; }
        const i = y * w + x;
        if (this.bodyMark[i] > this.frameGen || !this.isDynamic(i)) continue;
        this.fallBody(i);
      }
    }
  },

  // Find the whole piece around `seed` and let it fall, land, or tip over.
  fallBody(seed) {
    const { w, h, type, vel, bid, bodyMark: mark, bodyCells: cells } = this;
    const WALL = ID.wall, frameGen = this.frameGen;
    let gen = ++this.bodyGen;
    let id = bid[seed];
    let n = 0, stuck = false, mass = 0, tough = 0, v = 0, sumX = 0;
    cells[n++] = seed;
    mark[seed] = gen;
    for (let q = 0; q < n; q++) {
      const c = cells[q];
      const cy = (c / w) | 0, cx = c - cy * w;
      const d = M_DENSITY[this.solidType(c)];
      mass += d;
      sumX += (cx + 0.5) * d;
      tough += M_TOUGH[this.solidType(c)];
      if (vel[c] > v) v = vel[c];
      for (let k = 0; k < 8; k++) {
        const dx = NEAR8[k][0], dy = NEAR8[k][1];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mark[j] === gen) continue;
        if (this.isDynamic(j)) {
          if (mark[j] > frameGen) continue;   // already moved this step as part of another piece
          const b = bid[j];
          if (b === id || b === 0) { bid[j] = id; mark[j] = gen; cells[n++] = j; }
          else if (id === 0) {                // this piece had no id yet: it joins that one
            id = b;
            for (let m = 0; m < n; m++) bid[cells[m]] = id;
            mark[j] = gen;
            cells[n++] = j;
          }
        } else if (type[j] === WALL && dy <= 0 && (dx === 0 || dy === 0)) {
          stuck = true;   // touching the side of (or hanging from) a wall
        }
      }
    }
    if (this.activeStroke && id === this.activeStroke) {   // still being drawn: hang in place
      if (v) for (let k = 0; k < n; k++) vel[cells[k]] = 0;
      return;
    }
    if (stuck && this.glued.has(id)) {   // drawn stuck to a wall: stays there
      if (v) for (let k = 0; k < n; k++) vel[cells[k]] = 0;
      return;
    }
    const density = mass / n;
    const rows = Math.min(MAX_FALL_ROWS, 1 + (v >> 3));
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
      // it just landed. Only the part that was falling takes the hit (not what it landed on).
      gen = ++this.bodyGen;
      let m = 0;
      tough = 0;
      for (let k = 0; k < n; k++) {
        const c = cells[k];
        if (!vel[c]) continue;
        vel[c] = 0;
        mark[c] = gen;
        cells[m++] = c;
        tough += M_TOUGH[this.solidType(c)];
      }
      this.impact(cells, m, gen, v, tough / m, id);
    } else if (n <= MAX_TIP_CELLS && this.spinners.length < MAX_SPINNERS) {
      this.tryTip(cells, n, gen, sumX / mass, density, id);
    }
  },

  // Is the cell below c holding the piece (cells marked `gen`) up?
  supports(c, gen, density) {
    if (c >= this.w * (this.h - 1)) return !this.floorOpen;
    const j = c + this.w;
    if (this.bodyMark[j] === gen) return false;
    const tt = this.type[j];
    if (tt === 0) return false;
    const st = M_STATE[tt];
    if (st === STATE.GAS || st === STATE.FIRE) return false;
    if (st === STATE.LIQUID) return density <= M_DENSITY[tt];   // floats on heavier liquids
    return true;
  },

  // Can the piece move down one row? It falls through air, gas and fire and sinks through lighter liquids.
  canFall(cells, n, gen, density) {
    for (let k = 0; k < n; k++) if (this.supports(cells[k], gen, density)) return false;
    return true;
  },

  // Move every cell of the piece (sorted top to bottom) down one row; whatever was below rises
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
  },

  // ---------------------------------------------------------------- breaking
  // A piece hit something at speed v (in "steps spent falling"). Too fast or too heavy, and it cracks:
  // crack lines turn into rubble (or gaps) and each piece left over carries on by itself.
  impact(cells, n, gen, v, toughness, id) {
    if (!n) return;
    const { w, h, bodyMark: mark } = this;
    const force = v * (1 + Math.sqrt(n) / 12);
    const limit = BREAK_FORCE * toughness;
    if (force < limit) return;
    const cracks = Math.min(40, Math.ceil((force / limit) ** 2 * (1 + n / 120)));
    const crack = j => {
      if (mark[j] !== gen) return false;   // left the piece
      if (this.isDynamic(j)) { this.set(j, M_DEBRIS[this.solidType(j)]); this.moved[j] = 1; }
      return true;
    };
    for (let c = 0; c < cracks; c++) {
      const o = cells[(Math.random() * n) | 0];
      const oy = (o / w) | 0, ox = o - oy * w;
      const a = Math.random() * Math.PI;
      const dx = Math.cos(a), dy = Math.sin(a);
      for (const dir of [1, -1]) {
        let px = ox, py = oy;
        for (let s = dir === 1 ? 0 : 1; s < 400; s++) {
          const x = Math.round(ox + dx * s * dir), y = Math.round(oy + dy * s * dir);
          if (x < 0 || y < 0 || x >= w || y >= h) break;
          // diagonal step: crack the corner too, so the pieces on each side really come apart
          if (x !== px && y !== py && !crack(py * w + x)) break;
          if (!crack(y * w + x)) break;
          px = x; py = y;
        }
      }
    }
    // every chunk left over becomes its own piece
    const left = [];
    for (let k = 0; k < n; k++) if (this.isDynamic(cells[k])) left.push(cells[k]);
    const seen = ++this.bodyGen;
    for (const start of left) {
      if (mark[start] === seen) continue;
      const nid = this.newBid(), stack = [start];
      mark[start] = seen;
      while (stack.length) {
        const c = stack.pop();
        this.bid[c] = nid;
        const cx = c % w, cy = (c / w) | 0;
        for (const [ddx, ddy] of NEAR8) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mark[j] === gen && this.isDynamic(j)) { mark[j] = seen; stack.push(j); }
        }
      }
    }
  },

  // ---------------------------------------------------------------- tipping over
  // A resting piece whose center of weight hangs past the edge of what holds it up starts to tip,
  // rotating around that edge.
  tryTip(cells, n, gen, comX, density, id) {
    const w = this.w;
    let minX = Infinity, maxX = -Infinity, minC = -1, maxC = -1;
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      if (!this.supports(c, gen, density)) continue;
      const x = c % w;
      if (x < minX || (x === minX && c > minC)) { minX = x; minC = c; }
      if (x > maxX || (x === maxX && c > maxC)) { maxX = x; maxC = c; }
    }
    if (minC < 0) return;
    let dir, px, py;
    if (comX > maxX + 1.3) { dir = 1; px = maxX + 1; py = ((maxC / w) | 0) + 1; }
    else if (comX < minX - 0.3) { dir = -1; px = minX; py = ((minC / w) | 0) + 1; }
    else return;   // balanced

    // remember the piece's shape, relative to the corner it pivots on
    const nid = id || this.newBid();
    if (this.glued.has(nid)) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, reach = 1;
    const src = [];
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      const rx = (c % w) - px, ry = ((c / w) | 0) - py;
      x0 = Math.min(x0, rx); y0 = Math.min(y0, ry); x1 = Math.max(x1, rx); y1 = Math.max(y1, ry);
      reach = Math.max(reach, Math.hypot(rx + 0.5, ry + 0.5));
      this.bid[c] = nid;
      src.push(this.saveCell(c, rx, ry));
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const lookup = new Int32Array(bw * bh).fill(-1);
    for (let k = 0; k < src.length; k++) lookup[(src[k].ry - y0) * bw + (src[k].rx - x0)] = k;
    const sp = {
      bid: nid, px, py, dir, angle: 0, spin: TIP_START, accel: TIP_GRAVITY / reach, reach,
      src, lookup, x0, y0, bw, bh, placed: cells.slice(0, n), placedSrc: src.map((_, k) => k),
    };
    // only start tipping if there's room to turn
    if (this.stepSpinner(sp)) this.spinners.push(sp);
  },

  saveCell(c, rx, ry) {
    return {
      rx, ry, t: this.type[c], aux: this.aux[c], life: this.life[c], shade: this.shade[c],
      temp: this.temp[c], extra: this.extra[c], alive: true,
    };
  },

  // Turn a tipping piece a little further. Returns false once it's done (and its cells are left in place).
  stepSpinner(sp) {
    const { w, h, type, bid, bodyMark: mark } = this;
    const gen = ++this.bodyGen;
    // which of its cells are still there? (things can burn, melt or get eaten mid-tip)
    let alive = 0;
    for (let k = 0; k < sp.placed.length; k++) {
      const g = sp.placed[k], s = sp.src[sp.placedSrc[k]];
      if (bid[g] === sp.bid && this.isDynamic(g)) {
        mark[g] = gen;
        Object.assign(s, { t: type[g], aux: this.aux[g], life: this.life[g], temp: this.temp[g], extra: this.extra[g] });
        alive++;
      } else s.alive = false;
    }
    if (!alive || Math.abs(sp.angle) >= Math.PI / 2) return this.endSpin(sp, gen, 0);

    // draw the shape at the new angle (each target cell looks up which original cell lands there)
    const angle = sp.angle + sp.dir * sp.spin;
    const cs = Math.cos(angle), sn = Math.sin(angle);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [cx, cy] of [[sp.x0, sp.y0], [sp.x0 + sp.bw, sp.y0], [sp.x0, sp.y0 + sp.bh], [sp.x0 + sp.bw, sp.y0 + sp.bh]]) {
      const x = cx * cs - cy * sn, y = cx * sn + cy * cs;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const targets = [], targetSrc = [];
    for (let ty = Math.floor(minY + sp.py); ty < Math.ceil(maxY + sp.py); ty++) {
      for (let tx = Math.floor(minX + sp.px); tx < Math.ceil(maxX + sp.px); tx++) {
        const ox = tx + 0.5 - sp.px, oy = ty + 0.5 - sp.py;
        const sx = Math.floor(ox * cs + oy * sn) - sp.x0, sy = Math.floor(-ox * sn + oy * cs) - sp.y0;
        if (sx < 0 || sy < 0 || sx >= sp.bw || sy >= sp.bh) continue;
        const k = sp.lookup[sy * sp.bw + sx];
        if (k < 0 || !sp.src[k].alive) continue;
        // how fast this bit of the piece is coming down (only a downward hit can smash it)
        const hitSpeed = sp.dir * ox > 0 ? Math.abs(ox) * sp.spin : 0;
        if (tx < 0 || tx >= w || ty < 0) return this.endSpin(sp, gen, 0);   // hit the edge of the world
        if (ty >= h) {
          if (this.floorOpen) continue;   // that bit fell out of the world
          return this.endSpin(sp, gen, hitSpeed);
        }
        const j = ty * w + tx, t = type[j];
        if (t !== 0 && mark[j] !== gen) {
          const st = M_STATE[t];
          if (st !== STATE.GAS && st !== STATE.FIRE) return this.endSpin(sp, gen, hitSpeed);   // bumped into something
        }
        targets.push(j);
        targetSrc.push(k);
      }
    }
    // there's room: lift the piece out and put it back down at the new angle
    for (let k = 0; k < sp.placed.length; k++) if (mark[sp.placed[k]] === gen) this.set(sp.placed[k], 0);
    const placedGen = ++this.bodyGen;
    for (let k = 0; k < targets.length; k++) {
      const j = targets[k], s = sp.src[targetSrc[k]];
      this.set(j, 0);
      this.type[j] = s.t; this.aux[j] = s.aux; this.life[j] = s.life; this.shade[j] = s.shade;
      this.temp[j] = s.temp; this.extra[j] = s.extra; this.bid[j] = sp.bid;
      this.moved[j] = 1;
      mark[j] = placedGen;
    }
    sp.placed = targets;
    sp.placedSrc = targetSrc;
    sp.angle = angle;
    sp.spin = Math.min(TIP_MAX, sp.spin + sp.accel);
    return true;
  },

  // Stop tipping. If it slammed down onto something fast enough, it can break like a hard landing.
  // `speed`: how fast the part that hit was coming down (pixels per step).
  endSpin(sp, gen, speed) {
    if (sp.angle === 0 || !sp.placed.length) return false;   // never got going
    const v = Math.round((speed - 1) * 8);   // same scale as falling
    if (v <= 0) return false;
    const cells = this.bodyCells;
    let n = 0, tough = 0;
    for (const g of sp.placed) {
      if (this.bodyMark[g] !== gen) continue;
      cells[n++] = g;
      tough += M_TOUGH[this.solidType(g)];
    }
    if (n) this.impact(cells, n, gen, v, tough / n, sp.bid);
    return false;
  },
});
