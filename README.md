# Sand Box

A 2D falling-sand chemistry sandbox for the browser. Paint materials into the world and watch them
fall, flow, burn, freeze, dissolve and explode, with reactions loosely based on real chemistry.

## Play

Open `index.html` in a browser. No build step or install needed.

- **Left-click / touch**: draw the selected material
- **Right-click**: erase
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
| Electric     | Copper, Spark, Battery |
| Chemicals    | Acid, Lye, Bleach, Sodium, Liquid Nitrogen, Soap, Hydrogen, Chlorine, Baking Soda, Vinegar, Nitroglycerin, CO₂, Methane |
| Life & Weird | Muncher, Void, Virus, Clone, Seed, Cloud |

Some things to try:

- **Muncher** eats pixels! It tunnels through anything, splits in two when it's eaten enough, and starves when food runs out. Fire, lava and acid kill it.
- **Void** swallows anything that touches it (except Wall), and **Clone** copies the first thing that touches it
- **Virus** spreads through everything it touches, then dies out. Bleach and fire stop it.
- Drop **Seeds** on mud and they grow into flowers
- Connect a **Battery** to a copper wire: electricity flows, sets wood alight, and splits water into hydrogen (salt water gives chlorine too)
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
- `src/main.js`: UI, input and the game loop

### Adding a material

```js
material('mud', { state: STATE.POWDER, density: 2.5, color: '#5a4630', category: 'Powders',
  desc: 'Wet dirt.' });
```

Give it `tick: 'name'` and add a `name(sim, x, y, i)` function to `BEHAVIORS` in `src/behaviors.js` for custom
behavior.

### Adding a reaction

```js
// a + b -> ra + rb, with probability p per contact per frame (null = unchanged)
react('mud', 'lava', 0.05, 'stone', null, { note: 'Bakes into stone' });
```
