'use strict';
// Little people: tiny characters that live on top of the grid. They walk, climb, fall, swim,
// ride portals and fans, get blown around by wind, and meet unfortunate ends.
// Depends on materials.js, sim.js and behaviors.js.

const MAX_PEOPLE = 300;
const HEIGHT = 4;   // pixels tall: head, shirt, shirt, legs
const toColors = list => list.map(h => packRGB(...hexToRgb(h)));
const SKIN = toColors(['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524']);
const SHIRTS = toColors(['#e63946', '#f4a261', '#2a9d8f', '#4f8fd6', '#9b5de5', '#f15bb5', '#fee440', '#00bbf9', '#00f5d4', '#ffffff']);
const PANTS = toColors(['#264653', '#3d405b', '#1d3557', '#5c4033', '#222222']);

function pickOne(arr) { return arr[(Math.random() * arr.length) | 0]; }

function cellAt(sim, x, y) {
  if (x < 0 || x >= sim.w || y >= sim.h) return ID.wall;
  if (y < 0) return 0;
  return sim.type[y * sim.w + x];
}
function blocksPerson(t) {
  if (!t) return false;
  const s = MATS[t].state;
  return s === STATE.SOLID || s === STATE.POWDER;
}
// Is there room for a person whose feet are at (x, y)?
function fits(sim, x, y) {
  if (x < 0 || x >= sim.w || y >= sim.h || y - (HEIGHT - 1) < 0) return false;
  for (let k = 0; k < HEIGHT; k++) if (blocksPerson(sim.type[(y - k) * sim.w + x])) return false;
  return true;
}

function spawnPerson(sim, x, y) {
  if (sim.people.length >= MAX_PEOPLE) return false;
  for (let yy = Math.min(y, sim.h - 1); yy >= HEIGHT - 1 && yy > y - 12; yy--) {
    if (!fits(sim, x, yy)) continue;
    sim.people.push({
      x, y: yy, vx: 0, vy: 0, ax: 0, ay: 0,
      dir: Math.random() < 0.5 ? -1 : 1,
      skin: pickOne(SKIN), shirt: pickOne(SHIRTS), pants: pickOne(PANTS),
      step: 0, walkT: (Math.random() * 3) | 0, cool: 0, stuck: 0, airborne: false,
    });
    return true;
  }
  return false;
}

function erasePeople(sim, x, y, r) {
  sim.people = sim.people.filter(p => (p.x - x) ** 2 + (p.y - 2 - y) ** 2 > r * r);
}

// Wind tool: blow people away from (x, y), harder near the middle.
function pushPeopleOut(sim, x, y, r, force) {
  for (const p of sim.people) {
    const dx = p.x - x, dy = p.y - 2 - y;
    const d = Math.hypot(dx, dy);
    if (d > r) continue;
    const f = force * (1 - 0.7 * d / (r + 1));
    const ux = d > 0.5 ? dx / d : (Math.random() < 0.5 ? -1 : 1), uy = d > 0.5 ? dy / d : 0;
    p.vx = Math.max(-4, Math.min(4, p.vx + ux * f));
    p.vy = Math.max(-4, Math.min(4, p.vy + uy * f - 0.05));
  }
}

function placeIfEmpty(sim, x, y, t) {
  if (x < 0 || y < 0 || x >= sim.w || y >= sim.h) return;
  const i = y * sim.w + x;
  if (sim.type[i] === 0 || MATS[sim.type[i]].state === STATE.GAS) sim.set(i, t);
}

// Leave something behind depending on what got them. Returns false (= remove person).
function die(sim, p, cause) {
  const { x, y } = p;
  if (cause === ID.cryo) {
    for (let k = 0; k < HEIGHT; k++) placeIfEmpty(sim, x, y - k, ID.ice);   // frozen statue
  } else if (cause === ID.fire || cause === ID.lava || cause === ID.charge || cause === ID.spark) {
    placeIfEmpty(sim, x, y, ID.ash);
    placeIfEmpty(sim, x, y - 1, ID.ash);
    placeIfEmpty(sim, x, y - 3, ID.smoke);
  } else if (cause === ID.acid || cause === ID.chlorine || cause === ID.virus) {
    placeIfEmpty(sim, x, y - 2, ID.smoke);
    placeIfEmpty(sim, x, y - 3, ID.smoke);
  }
  // munchers, voids and black holes leave nothing at all
  return false;
}

function teleport(sim, p, color) {
  const dest = sim.portals[1 - color];
  if (!dest.length) return false;
  const w = sim.w;
  for (let tries = 0; tries < 8; tries++) {
    const d = dest[(Math.random() * dest.length) | 0];
    const dx = d % w, dy = (d / w) | 0;
    const spots = p.vy > 0.5
      ? [[dx, dy + HEIGHT], [dx + p.dir, dy + 1], [dx - p.dir, dy + 1]]
      : [[dx + p.dir, dy + 1], [dx + p.dir, dy], [dx - p.dir, dy + 1], [dx, dy + HEIGHT], [dx, dy - 1]];
    for (const [sx, sy] of spots) {
      if (!fits(sim, sx, sy)) continue;
      if (sx !== dx) p.dir = Math.sign(sx - dx);   // keep walking away from the portal
      p.x = sx;
      p.y = sy;
      p.cool = 30;
      return true;
    }
  }
  return false;
}

function fanBelow(sim, p) {
  for (let yy = p.y + 1; yy < sim.h && yy <= p.y + 18; yy++) {
    const t = cellAt(sim, p.x, yy);
    if (t === ID.fan || (t === ID.efan && sim.life[yy * sim.w + p.x] > 0)) return true;
    if (blocksPerson(t)) return false;
  }
  return false;
}

function walk(sim, p) {
  const nx = p.x + p.dir;
  // look before you leap: turn around at danger
  for (const yy of [p.y, p.y + 1, p.y - 1]) {
    const t = cellAt(sim, nx, yy);
    if (t && MATS[t].deadly && Math.random() < 0.9) { p.dir = -p.dir; return; }
  }
  if (fits(sim, nx, p.y)) { p.x = nx; p.step++; }
  else if (fits(sim, nx, p.y - 1) && fits(sim, p.x, p.y - 1)) { p.x = nx; p.y--; p.step++; }   // climb a step
  else p.dir = -p.dir;
}

// Returns false if the person died.
function updatePerson(sim, p) {
  if (p.cool > 0) p.cool--;

  // touch check: hazards and portals around the body and under the feet
  let portal = -1, wet = 0;
  for (let k = -1; k < HEIGHT; k++) {
    const y = p.y - k;
    for (let ox = -1; ox <= 1; ox++) {
      if (k === -1 && ox !== 0) continue;
      const t = cellAt(sim, p.x + ox, y);
      if (!t) continue;
      const m = MATS[t];
      if (m.deadly) return die(sim, p, t);
      if (m.portal !== undefined && p.cool === 0) portal = m.portal;
      if (ox === 0 && k >= 0 && m.state === STATE.LIQUID) wet++;
    }
  }
  if (portal >= 0 && teleport(sim, p, portal)) return true;

  // buried: climb out (digging up through loose powder), otherwise get crushed eventually
  if (!fits(sim, p.x, p.y)) {
    const above = cellAt(sim, p.x, p.y - HEIGHT);
    if (fits(sim, p.x, p.y - 1)) p.y--;
    else if (p.y - HEIGHT >= 0 && (!above || MATS[above].state !== STATE.SOLID)) {
      if (++p.stuck % 4 === 0) p.y--;   // dig upward
    } else if (++p.stuck > 150) return die(sim, p, ID.sand);
    if (p.stuck > 600) return die(sim, p, ID.sand);
    return true;
  }
  p.stuck = 0;

  const onGround = !fits(sim, p.x, p.y + 1);

  // forces
  if (sim.holes.length) {
    const stride = Math.ceil(sim.holes.length / 24);
    for (let n = 0; n < sim.holes.length; n += stride) {
      const hi = sim.holes[n];
      const dx = (hi % sim.w) - p.x, dy = ((hi / sim.w) | 0) - (p.y - 2);
      const d2 = dx * dx + dy * dy;
      if (d2 > 40 * 40 || d2 === 0) continue;
      const d = Math.sqrt(d2), f = 0.12 * stride * (1 - d / 40);
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
    }
  }
  if (fanBelow(sim, p)) p.vy -= 0.45;
  if (wet >= 3) p.vy = Math.max(p.vy - 0.08, -0.5);        // float up
  else if (wet > 0) p.vy = p.vy * 0.6 + 0.03;               // bob at the surface
  else if (!onGround) { p.vy = Math.min(p.vy + 0.2, 4); p.vx += sim.wind * 0.01; }
  else { if (p.vy > 0) p.vy = 0; p.vx *= 0.6; }
  if (wet) p.vx *= 0.9;
  p.vx = Math.max(-4, Math.min(4, p.vx));
  p.vy = Math.max(-4, Math.min(4, p.vy));

  // move, one cell at a time so nobody clips through walls
  p.ax += p.vx;
  p.ay += p.vy;
  while (p.ax >= 1 || p.ax <= -1) {
    const s = Math.sign(p.ax);
    p.ax -= s;
    if (fits(sim, p.x + s, p.y)) p.x += s;
    else if (fits(sim, p.x + s, p.y - 1)) { p.x += s; p.y--; }
    else { p.vx = 0; p.ax = 0; break; }
  }
  while (p.ay >= 1 || p.ay <= -1) {
    const s = Math.sign(p.ay);
    p.ay -= s;
    if (fits(sim, p.x, p.y + s)) p.y += s;
    else { p.vy = 0; p.ay = 0; break; }
  }
  p.airborne = !wet && fits(sim, p.x, p.y + 1);

  // walk (or swim)
  if ((onGround || wet) && Math.abs(p.vx) < 0.3) {
    if (Math.random() < 0.004) p.dir = -p.dir;
    if (++p.walkT % (wet ? 6 : 3) === 0) walk(sim, p);
  }
  return true;
}

function updatePeople(sim) {
  sim.people = sim.people.filter(p => updatePerson(sim, p));
  // remember where everyone's feet are, for pressure plates
  sim.personMap.fill(0);
  for (const p of sim.people) if (p.y >= 0 && p.y < sim.h) sim.personMap[p.y * sim.w + p.x] = 1;
}

function drawPeople(sim, buf) {
  const { w, h } = sim;
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] = c; };
  for (const p of sim.people) {
    put(p.x, p.y - 3, p.skin);
    put(p.x, p.y - 2, p.shirt);
    put(p.x, p.y - 1, p.shirt);
    put(p.x, p.y, p.pants);
    if (p.airborne) {                       // flailing arms
      put(p.x - 1, p.y - 3, p.skin);
      put(p.x + 1, p.y - 3, p.skin);
    } else if (p.step & 2) {                // walking stride
      put(p.x - p.dir, p.y, p.pants);
    }
  }
}

function personAt(sim, x, y) {
  return sim.people.some(p => p.x === x && y <= p.y && y >= p.y - (HEIGHT - 1));
}

// Explosions fling people
function installPeopleHooks(sim) {
  sim.onExplode = (x, y, r) => {
    for (const p of sim.people) {
      const dx = p.x - x, dy = p.y - 2 - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > r * 4) continue;
      const f = 4 * (1 - d / (r * 4));
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f - f / 2;
    }
  };
}
