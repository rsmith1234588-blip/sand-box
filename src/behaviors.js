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

// Effects of electricity on the neighbours of (x, y). `dirs` limits which way it goes (diodes).
function electrify(sim, x, y, dirs = DIRS4) {
  const { w, type, life } = sim;
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(sim, nx, ny)) continue;
    const j = ny * w + nx, t = type[j];
    if (!t) continue;
    const m = MATS[t];
    if (m.conduct) {
      // diodes only accept current flowing in their direction
      if (life[j] === 0 && (m.diode === undefined || (dy === 0 && dx === m.diode))) chargeCell(sim, j, t);
    } else if (m.burn) {
      if (Math.random() < 0.3) sim.ignite(nx, ny, j);
    } else if (t === ID.water) {
      if (Math.random() < 0.04) { sim.set(j, ID.hydrogen); sim.moved[j] = 1; }          // electrolysis
    } else if (t === ID.saltwater) {
      if (Math.random() < 0.04) { sim.set(j, Math.random() < 0.5 ? ID.chlorine : ID.hydrogen); sim.moved[j] = 1; }
    }
  }
}

// Push fresh current into any touching conductors (batteries, generators, plates).
function powerNeighbors(sim, x, y) {
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(sim, nx, ny)) continue;
    const j = ny * sim.w + nx, t = sim.type[j];
    const m = MATS[t];
    if (t && m.conduct && sim.life[j] === 0 && (m.diode === undefined || (dy === 0 && dx === m.diode))) {
      chargeCell(sim, j, t);
    }
  }
}

// A crackling arc that wanders out from (x, y) and zaps whatever it hits.
function shootArc(sim, x, y, len) {
  const { w, type } = sim;
  let a = Math.random() * Math.PI * 2;
  let cx = x, cy = y;
  for (let k = 0; k < len; k++) {
    a += (Math.random() - 0.5) * 1.2;
    const nx = cx + Math.round(Math.cos(a)), ny = cy + Math.round(Math.sin(a));
    if (!inBounds(sim, nx, ny)) return;
    const j = ny * w + nx, t = type[j];
    if (t === 0 || (MATS[t].state === STATE.GAS && !MATS[t].conduct)) {
      sim.set(j, ID.arc);
      sim.moved[j] = 1;
      cx = nx; cy = ny;
    } else if (t !== ID.arc) {
      zap(sim, nx, ny, j);
      return;
    }
  }
}

// Something got hit by an arc or lightning.
function zap(sim, x, y, j) {
  const t = sim.type[j], m = MATS[t];
  if (m.conduct) { if (sim.life[j] === 0) chargeCell(sim, j, t); }
  else if (m.burn) sim.ignite(x, y, j);
  else if (t === ID.water) { sim.set(j, ID.hydrogen); sim.moved[j] = 1; }
  else if (t === ID.saltwater) { sim.set(j, Math.random() < 0.5 ? ID.chlorine : ID.hydrogen); sim.moved[j] = 1; }
  else if (t === ID.sand && Math.random() < 0.5) { sim.set(j, ID.glass); sim.moved[j] = 1; }
}

// Things touching a powered coil
function coilEffect(sim, x, y, table) {
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(sim, nx, ny)) continue;
    const j = ny * sim.w + nx, t = sim.type[j];
    if (!t) continue;
    const rule = table[t];
    if (rule) {
      if (Math.random() < rule[0]) { sim.set(j, rule[1]); sim.moved[j] = 1; }
    } else if (table.burns && MATS[t].burn && Math.random() < 0.08) {
      sim.ignite(nx, ny, j);
    }
  }
}
let HEATER_RULES = null, COOLER_RULES = null;
function coilRules() {
  if (HEATER_RULES) return;
  HEATER_RULES = { burns: true };
  HEATER_RULES[ID.water] = [0.08, ID.steam];
  HEATER_RULES[ID.saltwater] = [0.08, ID.salt];
  HEATER_RULES[ID.ice] = [0.15, ID.water];
  HEATER_RULES[ID.snow] = [0.2, ID.water];
  HEATER_RULES[ID.cryo] = [0.3, ID.empty];
  HEATER_RULES[ID.mud] = [0.05, ID.dirt];
  COOLER_RULES = {};
  COOLER_RULES[ID.water] = [0.06, ID.ice];
  COOLER_RULES[ID.saltwater] = [0.02, ID.ice];
  COOLER_RULES[ID.steam] = [0.2, ID.snow];
  COOLER_RULES[ID.lava] = [0.1, ID.obsidian];
  COOLER_RULES[ID.fire] = [0.4, ID.empty];
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
      if (t && t !== ID.void && t !== ID.wall && t !== ID.charge && t !== ID.picky && t !== ID.antipicky) aux[i] = t;
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
    const orig = sim.aux[i], om = MATS[orig];
    if (sim.life[i] > 0) {
      sim.life[i]--;
      electrify(sim, x, y, om.diode ? [[om.diode, 0]] : DIRS4);
    } else {
      sim.type[i] = orig;          // back to plain metal...
      sim.aux[i] = 255;
      sim.life[i] = om.hold ?? 6;  // ...that can't be re-charged for a few frames (and counts as "powered")
    }
    return true;
  },

  battery(sim, x, y) {
    if (Math.random() < 0.25) powerNeighbors(sim, x, y);
    return true;
  },
};

// ---------------------------------------------------------------- physics toys
// Which side of a portal a cell has to be on to fall/flow/drift into it.
function headingInto(m, dy) {
  if (m.state === STATE.GAS && !m.sink) return dy >= 0;           // rising gas enters from below or the side
  if (m.state === STATE.FIRE) return dy >= 0;
  return dy <= 0;                                                  // falling things enter from above or the side
}

Object.assign(BEHAVIORS, {
  portal(sim, x, y, i) {
    const dest = sim.portals[1 - MATS[sim.type[i]].portal];
    if (!dest.length) return true;
    const { w, type, moved } = sim;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * w + nx, t = type[j];
      if (!t || moved[j] || Math.random() < 0.4) continue;
      const m = MATS[t];
      const loose = m.state !== STATE.SOLID || t === ID.muncher;
      if (!loose || !headingInto(m, dy)) continue;
      // come out the far side of a random cell of the other portal, still moving the same way
      for (let tries = 0; tries < 3; tries++) {
        const d = dest[(Math.random() * dest.length) | 0];
        const ex = (d % w) - dx, ey = ((d / w) | 0) - dy;
        if (!inBounds(sim, ex, ey) || type[ey * w + ex] !== 0) continue;
        sim.swap(j, ey * w + ex);
        break;
      }
    }
    return true;
  },

  fan(sim, x, y) {
    const { w, type } = sim;
    // find how far the updraft reaches (stops at the first solid)
    let top = y;
    while (top > 0 && y - top < 18) {
      const t = type[(top - 1) * w + x];
      if (t && MATS[t].state === STATE.SOLID) break;
      top--;
    }
    for (let pass = 0; pass < 2; pass++) {   // two passes: stronger than gravity, so things shoot up
      for (let yy = top + 1; yy < y; yy++) {   // top-down, so the whole column lifts together
        const j = yy * w + x, t = type[j];
        if (!t || type[j - w] !== 0 || Math.random() < 0.15) continue;
        sim.swap(j, j - w);
      }
    }
    return true;
  },

  blackhole(sim, x, y) {
    const { w, type } = sim;
    const R = 32;
    for (let k = 0; k < 40; k++) {
      const ox = randInt(-R, R), oy = randInt(-R, R);
      if ((!ox && !oy) || ox * ox + oy * oy > R * R) continue;
      const sx = x + ox, sy = y + oy;
      if (!inBounds(sim, sx, sy)) continue;
      const j = sy * w + sx, t = type[j];
      if (!t) continue;
      const m = MATS[t];
      if (m.indestructible) continue;
      if (m.state === STATE.SOLID && Math.random() > 0.08) continue;   // solids are ripped loose slowly
      // pull one or two steps toward the center
      let cj = j, cx = sx, cy = sy;
      for (let s = 0; s < 2; s++) {
        const tx = cx - Math.sign(cx - x), ty = cy - Math.sign(cy - y);
        const tj = ty * w + tx;
        if (type[tj] === ID.blackhole) { sim.set(cj, 0); break; }
        if (type[tj] !== 0) break;
        sim.swap(cj, tj);
        cj = tj; cx = tx; cy = ty;
      }
    }
    for (const [dx, dy] of DIRS8) {   // swallow whatever touches it
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * w + nx, t = type[j];
      if (t && !MATS[t].indestructible) sim.set(j, 0);
    }
    return true;
  },
});

// ---------------------------------------------------------------- electric gadgets
Object.assign(BEHAVIORS, {
  arc(sim, x, y) {
    electrify(sim, x, y);
    return true;
  },

  lightning(sim, x, y, i) {
    const { w, h, type } = sim;
    sim.set(i, 0);
    // a jagged bolt from the sky, aimed at the click, then on down to whatever it hits
    let bx = Math.max(0, Math.min(w - 1, x + randInt(-12, 12)));
    for (let by = 0; by < h; by++) {
      if (by < y) bx += Math.sign(x - bx) * (Math.random() < 0.4 ? 1 : 0) + randInt(-1, 1);
      else bx += randInt(-1, 1);
      bx = Math.max(0, Math.min(w - 1, bx));
      const j = by * w + bx, t = type[j];
      if (t === 0 || (MATS[t].state === STATE.GAS && !MATS[t].conduct) || t === ID.arc) {
        sim.set(j, ID.arc);
        sim.life[j] = randInt(4, 9);
        sim.moved[j] = 1;
        if (Math.random() < 0.08) shootArc(sim, bx, by, randInt(3, 8));   // little side branches
        continue;
      }
      // impact!
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = bx + dx, ny = by + dy;
          if (!inBounds(sim, nx, ny) || dx * dx + dy * dy > 5) continue;
          const k = ny * w + nx;
          if (type[k]) zap(sim, nx, ny, k);
          else if (Math.random() < 0.3) { sim.setFire(k, randInt(5, 15), true, OUT_RANDOM); sim.moved[k] = 1; }
        }
      }
      if (sim.onExplode) sim.onExplode(bx, by, 3);
      break;
    }
    return true;
  },

  plate(sim, x, y, i) {
    const { w, type, life } = sim;
    let pressed = false;
    if (y > 0) {
      const t = type[i - w];
      pressed = sim.personMap[i - w] === 1 || (t !== 0 && t !== ID.plate && MATS[t].state !== STATE.GAS);
    }
    let v = 0;
    if (pressed) v = 80;
    else {
      // a press spreads through the whole plate (and lingers for a moment after you step off)
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(sim, nx, ny) && type[ny * w + nx] === ID.plate) v = Math.max(v, life[ny * w + nx]);
      }
      v = Math.max(0, Math.max(v, life[i]) - 1);
    }
    life[i] = v;
    if (v > 0 && Math.random() < 0.3) powerNeighbors(sim, x, y);
    return true;
  },

  solar(sim, x, y) {
    if (Math.random() > 0.3) return true;
    const { w, type } = sim;
    for (let yy = y - 1; yy >= 0; yy--) {
      const t = type[yy * w + x];
      if (t && MATS[t].state !== STATE.GAS) return true;   // shaded
    }
    powerNeighbors(sim, x, y);
    return true;
  },

  // Heat makes power. The whole generator block warms up when any part of it touches fire or lava.
  thermo(sim, x, y, i) {
    const { w, type, life } = sim;
    let heat = 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * w + nx, t = type[j];
      if (t === ID.fire || MATS[t].hot || (t === ID.heater && life[j] > 0)) { heat = 20; break; }
      if (t === ID.thermo) heat = Math.max(heat, life[j] - 1);   // warmth spreads through the block
    }
    life[i] = Math.max(heat, life[i] > 0 ? life[i] - 1 : 0);
    if (life[i] > 0 && Math.random() < 0.3) powerNeighbors(sim, x, y);
    return true;
  },

  heater(sim, x, y, i) {
    if (sim.life[i] > 0) { coilRules(); coilEffect(sim, x, y, HEATER_RULES); }
    return true;
  },

  cooler(sim, x, y, i) {
    if (sim.life[i] > 0) { coilRules(); coilEffect(sim, x, y, COOLER_RULES); }
    return true;
  },

  tesla(sim, x, y, i) {
    if (sim.life[i] > 0 && Math.random() < 0.12) shootArc(sim, x, y, randInt(6, 22));
    return true;
  },

  efan(sim, x, y, i) {
    if (sim.life[i] > 0) BEHAVIORS.fan(sim, x, y, i);
    return true;
  },

  // Iron filings fly toward the nearest magnet in range, and stick to it.
  iron(sim, x, y, i) {
    const mags = sim.magnets;
    if (!mags.length) return false;
    const { w, type } = sim;
    const R2 = 40 * 40;
    const stride = Math.ceil(mags.length / 32);
    let bestDx = 0, bestDy = 0, bd = R2 + 1;
    for (let n = (Math.random() * stride) | 0; n < mags.length; n += stride) {
      const mi = mags[n];
      const dx = (mi % w) - x, dy = ((mi / w) | 0) - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; bestDx = dx; bestDy = dy; }
    }
    if (bd > R2) return false;                 // no magnet nearby: fall like normal
    if (bd <= 2) return true;                  // stuck on
    const sx = Math.sign(bestDx), sy = Math.sign(bestDy);
    for (const [ox, oy] of [[sx, sy], [sx, 0], [0, sy]]) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * w + nx, t = type[j];
      if (t === 0 || MATS[t].state === STATE.GAS || MATS[t].state === STATE.LIQUID) { sim.swap(i, j); break; }
    }
    return true;
  },
});

// ---------------------------------------------------------------- picky munchers
// Picky Muncher: only eats one material (stored in aux).
// Reverse Picky: eats everything *except* that material.
// extra = 128 | meals eaten (bit 7 marks "initialized").
function pickyCanPass(t) {
  // it can only move through open space and fluids; everything else is in the way
  if (t === 0) return true;
  const s = MATS[t].state;
  return s === STATE.GAS || s === STATE.LIQUID;
}

// Does something deadly touch this picky muncher? Eating a hazard makes it immune to it, and
// fire- or lava-eaters are immune to both. Returns the hazard's id, or 0.
const PICKY_HAZARDS = () => [[ID.fire, 0.2], [ID.lava, 0.5], [ID.acid, 0.3]];
function pickyHazard(sim, x, y, food, fiery) {
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(sim, nx, ny)) continue;
    const t = sim.type[ny * sim.w + nx];
    for (const [hz, p] of PICKY_HAZARDS()) {
      if (t !== hz || t === food) continue;
      if (fiery && (hz === ID.fire || hz === ID.lava)) continue;
      if (Math.random() < p) return hz;
    }
  }
  return 0;
}

Object.assign(BEHAVIORS, {
  picky(sim, x, y, i) {
    const { w, h, type, life, aux, extra } = sim;
    const kind = type[i];
    const reverse = !!MATS[kind].reverse;
    const food = aux[i];
    if (!MATS[food] || food === 0) { sim.set(i, ID.muncher); return true; }   // no target: becomes a normal muncher
    if (!(extra[i] & 128)) { extra[i] = 128; life[i] = 255; }                 // newborn
    const fiery = !reverse && (food === ID.fire || !!MATS[food].hot);

    if (!reverse) {   // (reverse pickies get hurt through the normal reaction table)
      const hz = pickyHazard(sim, x, y, food, fiery);
      if (hz) { sim.set(i, hz === ID.acid ? 0 : ID.ash); return true; }
    }
    if (Math.random() < 0.35) return true;
    if (life[i] === 0) { sim.set(i, ID.ash); return true; }   // starved
    life[i] = fiery ? Math.max(0, life[i] - 2) : life[i] - 1;   // fire & lava eaters starve twice as fast

    const edible = t => {
      if (!t) return false;
      if (!reverse) return t === food;
      const m = MATS[t];
      return t !== food && !m.inedible && !m.hot && m.state !== STATE.FIRE;
    };

    // eat a neighbour if it's the right food
    const start = (Math.random() * 8) | 0;
    for (let k = 0; k < 8; k++) {
      const [dx, dy] = DIRS8[(start + k) & 7];
      const nx = x + dx, ny = y + dy;
      if (!inBounds(sim, nx, ny)) continue;
      const j = ny * w + nx;
      if (!edible(type[j])) continue;
      const fed = (extra[i] & 127) + 1;
      sim.set(j, 0);
      sim.swap(i, j);
      life[j] = 255;
      if (fed >= MUNCH_TO_SPLIT) {
        extra[j] = 128;
        sim.set(i, kind);              // a baby with the same taste
        aux[i] = food;
        extra[i] = 128;
        life[i] = 255;
        sim.moved[i] = 1;
      } else {
        extra[j] = 128 | fed;
      }
      return true;
    }

    // sniff around for food and head toward it
    for (let k = 0; k < 10; k++) {
      const ox = randInt(-10, 10), oy = randInt(-10, 10);
      const sx = x + ox, sy = y + oy;
      if (!inBounds(sim, sx, sy) || !edible(type[sy * w + sx])) continue;
      const mx = Math.sign(ox), my = Math.sign(oy);
      for (const [ax, ay] of [[mx, my], [mx, 0], [0, my]]) {
        if (!ax && !ay) continue;
        const nx = x + ax, ny = y + ay;
        if (!inBounds(sim, nx, ny)) continue;
        const j = ny * w + nx;
        if (pickyCanPass(type[j])) { sim.swap(i, j); return true; }
      }
      break;
    }

    // nothing in sight: fall (sinking through liquids and gases), or wander
    if (y + 1 < h && pickyCanPass(type[i + w])) { sim.swap(i, i + w); return true; }
    for (let k = 0; k < 8; k++) {
      const [dx, dy] = DIRS8[(start + k) & 7];
      const nx = x + dx, ny = y + dy;
      if (inBounds(sim, nx, ny) && type[ny * w + nx] === 0) { sim.swap(i, ny * w + nx); break; }
    }
    return true;
  },
});
