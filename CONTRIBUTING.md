# Contributing to Worms Rox!

Thanks for wanting to help! The whole game is one HTML file, so it is easy to get started.

## Run it
```bash
npm install
npm run serve        # http://localhost:8080 (edit src/worms.html, reload)
npm run build        # rebuilds index.html (game + PeerJS + three.js in one file)
npm test             # smoke test
```
- Game code lives in **`src/worms.html`**. Do not edit `index.html` by hand; it is generated.
- CI rebuilds `index.html` and fails if it differs, so run `npm run build` and commit the result.
- Test multiplayer by opening several tabs in the same browser, enter the same room code and press **Join room**.

## Good first things to add
- A new **weapon** (bazooka-style projectile, a melee, a utility)
- A new **map theme** or landmark
- New **voice lines** (`npm run voices:lines` lists the current ones)
- A new **mini-game** (every team plays at once, loser's worm dies; see `MGK` in the source)
- Bug fixes, balance, and translations

See the issues labelled **good first issue**.

## Pull requests
1. Fork, create a branch, make a small focused change.
2. Run `npm run build && npm test`.
3. Open a PR describing what changed and add a screenshot or short clip for visual changes.

By contributing you agree your work is released under the MIT license.
