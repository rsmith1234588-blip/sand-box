# Sand Box

A 2D falling-sand chemistry sandbox for the browser. Paint materials into the world and watch them
fall, flow, burn, freeze, dissolve and explode, with reactions loosely based on real chemistry.

## Play

Open `index.html` in a browser. No build step or install needed.

- **Left-click / touch**: draw the selected material
- **Right-click**: erase
- **Wind tool**: hold to blast everything away from the cursor. Bigger brush = wider, stronger wind
- **Breeze** slider: a steady wind that pushes gases, fire, snow and ash
- **Tab**: switch brush size between 1, 5 and 20
- **`[` / `]`**: brush size
- **Speed** slider: slow motion (⅛×) to fast forward (8×). Keys: **`-`** slower, **`=`** faster
- **Space**: pause, **`.`**: step one frame
- **Reactions** button: in-game guide to every reaction
- **Heat / Cool** tools (next to the Eraser): hold to warm things up or chill them. Hover over anything to see its
  temperature
- **Settings** tab (top of the side panel): turn **Falling solids** and **Fall through the floor** on or off

## Materials

| Group        | Materials |
|--------------|-----------|
| Powders      | Sand, Salt, Snow, Ash, Dirt, Mud, Sugar, Coal, Sawdust, Gravel, Glitter, Clay |
| Liquids      | Water, Salt Water, Oil, Lava, Honey, Mercury, Cement, Slime, Chocolate |
| Solids       | Wall, Stone, Wood, Plant, Metal, Rust, Glass, Ice, Obsidian, Brick, Gold, Sponge, Crystal, Chocolate Bar |
| Energy       | Fire, Gunpowder, Smoke, Steam, Thermite, Fireworks, Torch, Napalm, Fuse, C4, Bomb, Volcano |
| Electric     | Copper, Spark, Battery, Lamp, Neon, Switch, Pressure Plate, Diodes, Heating Coil, Cooling Coil, Electromagnet, Magnet, Iron Filings, Tesla Coil, Electric Fan, Solar Panel, Thermo Generator, Lightning |
| Chemicals    | Acid, Lye, Bleach, Sodium, Liquid Nitrogen, Soap, Hydrogen, Chlorine, Baking Soda, Vinegar, Nitroglycerin, CO₂, Methane, Oxygen, Helium |
| Physics      | Wind (tool), Blue Portal, Orange Portal, Fan, Black Hole |
| Life & Weird | Person, Muncher, Picky Muncher, Reverse Picky, Void, Virus, Clone, Seed, Cloud, Fish, Ant, Moss, Tree Seed, Storm Cloud |

Some things to try:

- **Little people** walk around, climb steps, swim, dig out of sand and turn back at danger. They ride portals and
  fans, get blown by wind, and are flung by explosions. Fire, lava, acid, electricity, munchers and black holes are
  bad news. Liquid nitrogen turns them into ice statues.
- **Portals**: anything that falls, flows, drifts or walks into a blue portal comes out of an orange one (and back)
- **Fans** blow an updraft; **Black Holes** pull everything in
- **Temperature**: heat stone, metal or glass until it glows and melts into lava; boil water into steam, melt ice and
  chocolate, bake clay into brick, set wood alight. Cool lava back into stone, freeze water into ice, snuff out fires.
  Heat spreads slowly through touching things and everything drifts back to its normal temperature. Wall has no temperature.
- **Falling solids**: solids you draw in mid-air hang there until you let go, then fall as one piece. Each thing you
  draw is its own piece (drawing onto another piece joins them), so a block that lands on a ledge stays a block and
  **tips over** if it hangs too far off the edge. Tall things topple. Wood and ice float on water; stone and metal
  sink. Land (or topple) too hard, or be too heavy, and they crack: stone into gravel, glass into sand, wood into
  sawdust, ice into snow. Wall never moves, and anything you draw onto a wall stays stuck to it
- **Fall through the floor** (setting): everything that reaches the bottom drops out of the world, people included
- **Liquids level out**: pour water into one side of a U-shaped pipe and it rises up the other side to the same height

- **Muncher** eats pixels! It tunnels through anything, splits in two when it's eaten enough, and starves when food runs out. All munchers are fireproof (they even eat fire and lava), but acid still kills them.
- **Picky Muncher**: double-click its button to choose what it eats (single click just selects it). It only eats that material (a sand-eater leaves glass
  alone), sniffs out its food, and duplicates with every pixel it eats. Its babies are just as picky. Fire and lava eaters starve twice
  as fast. **Reverse Picky** is the opposite: it eats everything *except* the material you pick.
- Munchers that starve leave a **Dead Muncher** body behind. Only a Picky Muncher set to eat Dead Munchers will eat it,
  and those body-eaters leave no body of their own when they die.
- **Void** swallows anything that touches it (except Wall), and **Clone** copies the first thing that touches it
- **Virus** spreads through everything it touches, then dies out. Bleach and fire stop it.
- Drop **Seeds** on mud and they grow into flowers; **Tree Seeds** on dirt grow whole trees
- **Fish** swim and breed in water, **Ants** dig dirt and build anthills, **Moss** creeps over damp stone
- **Storm Clouds** rain and throw lightning; **Volcanoes** leak lava and erupt
- Light a **Fuse** to set off gunpowder from a distance; **C4** only goes off with electricity; **Bombs** have a timer
- **Sponges** soak up water, **Crystals** grow in salt water, **Chocolate** sets into a bar and melts again, **Clay** bakes into **Brick**
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
- `src/solids.js`: falling solids (pieces that fall, tip over and break)
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
