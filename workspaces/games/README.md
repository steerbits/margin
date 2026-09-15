# Clover’s Little Picnic

A tiny bunny, two little adventures, and three friends who saved you a spot. No timer, scores, or losing.

## Play

Open **`index.html`** directly in a modern browser. No installation, build step, server, or internet connection is needed.

Or serve this folder:

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

Visit **http://127.0.0.1:4178**.

- **Click or tap** the meadow or a collectible to hop there.
- **Arrow keys / WASD** move Clover while the meadow is focused.
- **Level 1 — The strawberry picnic:** gather **six strawberries**, then visit the **picnic basket**.
- Choose **“Level 2: a little starlight”** on the celebration card or the toolbar after staying.
- **Level 2 — A little starlight:** explore the twilight meadow, gather **six fallen stars**, then light the **lantern**.
- Click a friend for a little conversation.
- **Tab + Enter** can complete the entire game without directional movement.
- Sound is **off by default**; the speaker button enables gentle synthesized chimes.
- Stay after either level. After the final celebration, **“Play both levels again”** restarts at level 1.

## Files

- `index.html` — interface, original SVG illustrations, and dialogs.
- `style.css` — responsive meadow, character animations, and reduced-motion support.
- `game.js` — two-level progression, movement, collection, friends, sound, and replay.
- `tests/game.test.mjs` — automated browser checks with their own temporary local server.

Everything visual is drawn in SVG/CSS. There are no external images, fonts, analytics, runtime dependencies, or network requests. Progress is intentionally ephemeral; refreshing starts again at level 1. Change level objectives, collectible positions, and evening dialogue in `LEVELS`, and daytime friend dialogue and movement speed in the other constants near the top of `game.js`.

## Verify

Node.js and Playwright are needed only for development tests:

```sh
npm install
npx playwright install chromium
npm test
```

The 17 checks cover mouse, keyboard, and emulated touch play through both levels; six unique pickups per level; basket and lantern delivery requirements; both routes into level 2; stage-specific art, labels, dialogue, and instructions; replay and staying; sound preference across levels; focus; reduced motion; 320px/390px and short landscape layouts; direct `file://` use; and browser errors. The game needs no npm packages to run.

### Verification notes

- Automated checks run in headless Chromium, including both complete levels with each input method.
- Desktop and portrait-phone twilight scenes, both celebration cards, and the lit lantern were visually self-reviewed. The short-landscape dialog remains covered by browser checks.
- Sound initialization/toggle was checked programmatically, not assessed by listening.
- Real devices, screen-reader narration, Firefox, and Safari have not been tested. The game uses modern SVG, native `<dialog>`, CSS animations, and optional Web Audio.
