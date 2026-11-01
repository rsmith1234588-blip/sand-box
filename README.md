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

| Group     | Materials |
|-----------|-----------|
| Powders   | Sand, Salt, Snow, Ash |
| Liquids   | Water, Salt Water, Oil, Lava |
| Solids    | Wall, Stone, Wood, Plant, Metal, Rust, Glass, Ice |
| Energy    | Fire, Gunpowder, Smoke, Steam |
| Chemicals | Acid, Lye (base), Bleach, Sodium, Liquid Nitrogen, Soap, Hydrogen, Chlorine |

Some reactions to try:

- Sodium + Water → lye + hydrogen (and sometimes it explodes)
- Acid + Bleach → toxic chlorine gas, which sinks and kills plants
- Acid + Lye → neutralizes into salt water
- Lye + Oil → soap; Soap + Water → bubbles
- Metal rusts in water, and much faster in salt water
- Liquid nitrogen flash-freezes water and turns steam into snow
- Burning hydrogen makes steam, which condenses back into water

## Code layout

- `src/materials.js`: material definitions (physics properties, colors) and the reaction table
- `src/sim.js`: the cellular-automaton simulation (movement, reactions, fire, explosions, rendering)
- `src/main.js`: UI, input and the game loop

### Adding a material

```js
material('mud', { state: STATE.POWDER, density: 2.5, color: '#5a4630', category: 'Powders',
  desc: 'Wet dirt.' });
```

### Adding a reaction

```js
// a + b -> ra + rb, with probability p per contact per frame (null = unchanged)
react('mud', 'lava', 0.05, 'stone', null, { note: 'Bakes into stone' });
```
