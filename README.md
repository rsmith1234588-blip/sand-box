# Sand Box

A 2D falling-sand chemistry sandbox for the browser. Paint materials into the world and watch them
fall, flow, burn, freeze, dissolve and explode, with reactions loosely based on real chemistry.

## Play

Open `index.html` in a browser. No build step or install needed.

- **Left-click / touch**: draw the selected material
- **Right-click**: erase
- **Wind tool**: hold to blast everything away from the cursor. Bigger brush = wider, stronger wind
- **Breeze** slider: a steady wind that pushes gases, fire, snow and ash
- **`[` / `]`**: brush size
- **Space**: pause, **`.`**: step one frame
- **Reactions** button: in-game guide to every reaction

## Materials

| Group        | Materials |
|--------------|-----------|
| Powders      | Sand, Salt, Snow, Ash, Dirt, Mud |
| Liquids      | Water, Salt Water, Oil, Lava, Honey, Mercury, Cement |
| Solids       | Wall, Stone, Wood, Plant, Metal, Rust, Glass, Ice, Obsidian |
| Energy       | Fire, Gunpowder, Smoke, Steam, Thermite, Fireworks, Torch |
| Electric     | Copper, Spark, Battery, Lamp, Neon, Switch, Pressure Plate, Diodes, Heating Coil, Cooling Coil, Electromagnet, Magnet, Iron Filings, Tesla Coil, Electric Fan, Solar Panel, Thermo Generator, Lightning |
| Chemicals    | Acid, Lye, Bleach, Sodium, Liquid Nitrogen, Soap, Hydrogen, Chlorine, Baking Soda, Vinegar, Nitroglycerin, CO₂, Methane |
| Physics      | Wind (tool), Blue Portal, Orange Portal, Fan, Black Hole |
| Life & Weird | Person, Muncher, Picky Muncher, Reverse Picky, Void, Virus, Clone, Seed, Cloud |

Some things to try:

- **Little people** walk around, climb steps, swim, dig out of sand and turn back at danger. They ride portals and
  fans, get blown by wind, and are flung by explosions. Fire, lava, acid, electricity, munchers and black holes are
  bad news. Liquid nitrogen turns them into ice statues.
- **Portals**: anything that falls, flows, drifts or walks into a blue portal comes out of an orange one (and back)
- **Fans** blow an updraft; **Black Holes** pull everything in

- **Muncher** eats pixels! It tunnels through anything, splits in two when it's eaten enough, and starves when food runs out. Fire, lava and acid kill it.
- **Picky Muncher**: click its button to choose what it eats. It only eats that material (a sand-eater leaves glass
  alone), sniffs out its food, and duplicates with every pixel it eats. Its babies are just as picky. Fire and lava eaters are fireproof but starve twice
  as fast. **Reverse Picky** is the opposite: it eats everything *except* the material you pick.
- Munchers that starve leave a **Dead Muncher** body behind. Only a Picky Muncher set to eat Dead Munchers will eat it,
  and those body-eaters leave no body of their own when they die.
- **Void** swallows anything that touches it (except Wall), and **Clone** copies the first thing that touches it
- **Virus** spreads through everything it touches, then dies out. Bleach and fire stop it.
- Drop **Seeds** on mud and they grow into flowers
- **Electricity**: connect a power source (Battery, Solar Panel, Thermo Generator or Pressure Plate) to a wire
  (Copper, Metal, Mercury, Iron). Current pulses along it, lights Lamps and Neon, heats or freezes with coils, runs
  Electric Fans and Electromagnets, makes Tesla Coils throw arcs, sets wood alight, and splits water into hydrogen.
  Click a **Switch** (with the Switch tool) to flip it. **Diodes** only let current go one way. **Lightning** strikes
  where you click.
- Baking soda + vinegar = volcano. The CO₂ it makes smothers fire.
- Light **Fireworks**, **Thermite** or (carefully) **Nitroglycerin**
- Sodium + water → lye + hydrogen (and sometimes it explodes)
- Acid + bleach → toxic chlorine gas, which sinks and kills plants
- Lye + oil → soap; soap + water → bubbles
- Liquid nitrogen flash-freezes water and turns lava into obsidian

## Code layout

- `src/materials.js`: material definitions (physics properties, colors) and the reaction table
- `src/sim.js`: the cellular-automaton simulation (movement, reactions, fire, explosions, rendering)
- `src/behaviors.js`: special behaviors (munchers, electricity, clone, void, virus, seeds, fireworks...)
- `src/people.js`: the little people (agents that live on top of the grid)
- `src/main.js`: UI, input and the game loop

### Adding a material

```js
material('clay', { state: STATE.POWDER, density: 2.5, color: '#b5651d', category: 'Powders',
  desc: 'Bakes hard in heat.' });
```

Give it `tick: 'name'` and add a `name(sim, x, y, i)` function to `BEHAVIORS` in `src/behaviors.js` for custom
behavior.

### Adding a reaction

```js
// a + b -> ra + rb, with probability p per contact per frame (null = unchanged)
react('clay', 'lava', 0.05, 'stone', null, { note: 'Bakes into stone' });
```
