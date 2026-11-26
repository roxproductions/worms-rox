# Worm Island (working title)
Single-file browser FPS. Open `dist/index.html` (needs no server) or host it anywhere static.

Controls: WASD move · Space jump · Shift sprint · Mouse look · LMB fire/swing · RMB aim · 1/2/3/wheel bat/uzi/shotgun · R reload · Tab scoreboard

Rebuild after editing `src/`: `python3 build.py` (inlines three.js r128 + postprocessing from `lib/`).
Test hook: `dist/index.html?demo=go` skips pointer lock and exposes `window.WI`.
