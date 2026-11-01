'use strict';
// Special per-material behaviors. A material with `tick: 'name'` runs BEHAVIORS.name every frame.
// Return true to skip the normal heat/movement step for that cell.
// Depends on materials.js and sim.js.

const DIRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const MUNCH_TO_SPLIT = 40;   // pixels a muncher must eat before it splits in two

function inBounds(sim, x, y) { return x >= 0 && y >= 0 && x < sim.w && y < sim.h; }
function isOpen(t) { return t === 0 || MATS[t].state === STATE.GAS; }

// ---------------------------------------------------------------- electricity
function chargeCell(sim, j, original) {
  sim.type[j] = ID.charge;
  sim.aux[j] = original;   // remember what the conductor was
  sim.life[j] = 2;
  sim.moved[j] = 1;
}

// Effects of electricity on the four neighbours of (x, y).
function electrify(sim, x, y) {
  const { w, type, life } = sim;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(sim, nx, ny)) continue;
    const j = ny * w + nx, t = type[j];
    if (!t) continue;
    const m = MATS[t];
    if (m.conduct) {
      if (life[j] === 0) chargeCell(sim, j, t);
    } else if (m.burn) {
      if (Math.random() < 0.3) sim.ignite(nx, ny, j);
    } else if (t === ID.water) {
      if (Math.random() < 0.04) { sim.set(j, ID.hydrogen); sim.moved[j] = 1; }          // electrolysis
    } else if (t === ID.saltwater) {
      if (Math.random() < 0.04) { sim.set(j, Math.random() < 0.5 ? ID.chlorine : ID.hydrogen); sim.moved[j] = 1; }
    }
  }
}

// ---------------------------------------------------------------- flowers
function bloom(sim, x, y) {
  const color = (Math.random() * 4) | 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 4) continue;
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * sim.w + nx;
      if (!(dx === 0 && dy === 0) && !isOpen(sim.type[j])) continue;
      sim.set(j, ID.flower);
      sim.shade[j] = dx === 0 && dy === 0 ? 3 : color;   // pale center
      sim.moved[j] = 1;
    }
  }
}

// ---------------------------------------------------------------- fireworks
function burst(sim, x, y) {
  const r = randInt(6, 9);
  const hue = (Math.random() * 4) | 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * sim.w + nx;
      const center = dx === 0 && dy === 0;
      if (!center && !isOpen(sim.type[j])) continue;
      if (!center && Math.random() > 0.3) continue;
      sim.set(j, ID.sparkle);
      sim.shade[j] = Math.random() < 0.75 ? hue : (Math.random() * 4) | 0;
      sim.moved[j] = 1;
    }
  }
}

// ---------------------------------------------------------------- behaviors
const BEHAVIORS = {
  // Eats any neighbouring pixel, moving into the hole it makes. Splits when full, starves when hungry.
  muncher(sim, x, y, i) {
    const { w, h, type, life, aux } = sim;
    if (aux[i] === 255) { aux[i] = 0; life[i] = 255; }   // newborn
    if (Math.random() < 0.35) return true;               // munchers take little breaks
    if (life[i] === 0) { sim.set(i, ID.ash); return true; }   // starved
    life[i]--;

    const start = (Math.random() * 8) | 0;
    for (let k = 0; k < 8; k++) {
      const [dx, dy] = DIRS8[(start + k) & 7];
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * w + nx, t = type[j];
      if (!t) continue;
      const m = MATS[t];
      if (m.inedible || m.hot || m.state === STATE.FIRE) continue;
      const fed = aux[i] + 1;
      sim.set(j, 0);
      sim.swap(i, j);          // step into the bite
      life[j] = 255;           // no longer hungry
      if (fed >= MUNCH_TO_SPLIT) {
        aux[j] = 0;
        sim.set(i, ID.muncher);   // leave a baby behind
        aux[i] = 0;
        life[i] = 255;
        sim.moved[i] = 1;
      } else {
        aux[j] = fed;
      }
      return true;
    }
    // nothing to eat: fall, or wander
    if (y + 1 < h && isOpen(type[i + w])) { sim.swap(i, i + w); return true; }
    for (let k = 0; k < 8; k++) {
      const [dx, dy] = DIRS8[(start + k) & 7];
      const nx = x + dx, ny = y + dy;
      if (inBounds(sim, nx, ny) && type[ny * w + nx] === 0) { sim.swap(i, ny * w + nx); break; }
    }
    return true;
  },

  void(sim, x, y) {
    const { w, type } = sim;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * w + nx, t = type[j];
      if (t && t !== ID.void && t !== ID.wall && Math.random() < 0.5) sim.set(j, 0);
    }
    return true;
  },

  clone(sim, x, y, i) {
    const { w, type, aux } = sim;
    const d = DIRS4[(Math.random() * 4) | 0];
    const nx = x + d[0], ny = y + d[1];
    if (!inBounds(sim, nx, ny)) return true;
    const j = ny * w + nx, t = type[j];
    if (t === ID.clone) {
      // clone blocks share what they've learned, so the whole block copies together
      if (aux[i] === 255 && aux[j] !== 255) aux[i] = aux[j];
    } else if (aux[i] === 255) {
      // not cloning anything yet: learn from the first visitor
      if (t && t !== ID.void && t !== ID.wall && t !== ID.charge) aux[i] = t;
    } else if (t === 0 && Math.random() < 0.3) {
      sim.set(j, aux[i]);
      sim.moved[j] = 1;
    }
    return true;
  },

  virus(sim, x, y) {
    if (Math.random() > 0.2) return true;
    const d = DIRS4[(Math.random() * 4) | 0];
    const nx = x + d[0], ny = y + d[1];
    if (!inBounds(sim, nx, ny)) return true;
    const j = ny * sim.w + nx, t = sim.type[j];
    if (!t) return true;
    const m = MATS[t];
    if (!m.immune && !m.hot && m.state !== STATE.FIRE) { sim.set(j, ID.virus); sim.moved[j] = 1; }
    return true;
  },

  cloud(sim, x, y, i) {
    if (y + 1 < sim.h && sim.type[i + sim.w] === 0 && Math.random() < 0.01) {
      sim.set(i + sim.w, ID.water);
      sim.moved[i + sim.w] = 1;
    }
    return true;
  },

  torch(sim, x, y, i) {
    if (y > 0 && sim.type[i - sim.w] === 0 && Math.random() < 0.35) {
      sim.setFire(i - sim.w, randInt(8, 20), true, OUT_RANDOM);
      sim.moved[i - sim.w] = 1;
    }
    return false;   // still heats its neighbours
  },

  seed(sim, x, y, i) {
    if (y + 1 >= sim.h) return false;
    const below = sim.type[i + sim.w];
    if ((below === ID.mud && Math.random() < 0.02) || (below === ID.dirt && Math.random() < 0.004)) {
      sim.set(i, ID.stem);
      sim.aux[i] = randInt(10, 30);   // how tall it will grow
      sim.moved[i] = 1;
      return true;
    }
    return false;   // otherwise falls like a powder
  },

  stem(sim, x, y, i) {
    const { w, type, aux } = sim;
    if (aux[i] === 255) aux[i] = randInt(10, 30);
    if (Math.random() > 0.12) return true;
    const left = aux[i];
    const nx = x + (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0);
    if (left === 0 || y === 0 || nx < 0 || nx >= w || !isOpen(type[(y - 1) * w + nx])) {
      bloom(sim, x, y);
      return true;
    }
    const j = (y - 1) * w + nx;
    sim.set(j, ID.stem);
    aux[j] = left - 1;
    sim.moved[j] = 1;
    sim.set(i, ID.plant);
    if (Math.random() < 0.25) {   // sprout a leaf
      const s = Math.random() < 0.5 ? -1 : 1;
      if (x + s >= 0 && x + s < w && type[i + s] === 0) sim.set(i + s, ID.plant);
    }
    return true;
  },

  rocket(sim, x, y, i) {
    const { w, h, type, life } = sim;
    for (let n = 0; n < 2; n++) {   // rockets are fast
      if (y + 1 < h && type[i + w] === 0 && Math.random() < 0.5) sim.setFire(i + w, randInt(3, 8), true, OUT_RANDOM);
      if (life[i] === 0 || y === 0) { burst(sim, x, y); return true; }
      life[i]--;
      const nx = x + (Math.random() < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      if (nx < 0 || nx >= w) { burst(sim, x, y); return true; }
      const j = (y - 1) * w + nx, t = type[j];
      if (!isOpen(t) && MATS[t].state !== STATE.FIRE) { burst(sim, x, y); return true; }
      sim.swap(i, j);
      i = j; x = nx; y = y - 1;
    }
    return true;
  },

  spark(sim, x, y, i) {
    electrify(sim, x, y);
    if (sim.type[i] !== ID.spark) return true;
    if (y + 1 < sim.h) {   // zig-zag downward like lightning
      const nx = x + ((Math.random() * 3) | 0) - 1;
      if (nx >= 0 && nx < sim.w && sim.type[(y + 1) * sim.w + nx] === 0) sim.swap(i, (y + 1) * sim.w + nx);
    }
    return true;
  },

  charge(sim, x, y, i) {
    if (sim.life[i] > 0) {
      sim.life[i]--;
      electrify(sim, x, y);
    } else {
      sim.type[i] = sim.aux[i];   // back to plain metal...
      sim.aux[i] = 255;
      sim.life[i] = 6;            // ...that can't be re-charged for a few frames
    }
    return true;
  },

  battery(sim, x, y) {
    if (Math.random() > 0.1) return true;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * sim.w + nx, t = sim.type[j];
      if (t && MATS[t].conduct && sim.life[j] === 0) chargeCell(sim, j, t);
    }
    return true;
  },
};
