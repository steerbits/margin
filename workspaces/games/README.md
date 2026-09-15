# Clover’s Little Picnic

A tiny bunny, six strawberries, and three friends who saved you a spot. No timer, scores, or losing.

## Play

Open **`index.html`** directly in a modern browser. No installation, build step, server, or internet connection is needed.

Or serve this folder:

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

Visit **http://127.0.0.1:4178**.

- **Click or tap** the meadow or a strawberry to hop there.
- **Arrow keys / WASD** move Clover while the meadow is focused.
- Gather **six strawberries**, then visit the **picnic basket**.
- Click a friend for a little conversation.
- **Tab + Enter** can complete the entire game without directional movement.
- Sound is **off by default**; the speaker button enables gentle synthesized chimes.
- Stay after the picnic, or start another lovely afternoon.

## Files

- `index.html` — interface, original SVG illustrations, and dialogs.
- `style.css` — responsive meadow, character animations, and reduced-motion support.
- `game.js` — movement, collection, friends, sound, and replay.
- `tests/game.test.mjs` — automated browser checks with their own temporary local server.

Everything visual is drawn in SVG/CSS. There are no external images, fonts, analytics, runtime dependencies, or network requests. Progress is intentionally ephemeral; refreshing starts a new afternoon. Change berry positions, friend dialogue, and movement speed in the constants near the top of `game.js`.

## Verify

Node.js and Playwright are needed only for development tests:

```sh
npm install
npx playwright install chromium
npm test
```

Checks cover mouse, keyboard, and emulated touch play; six unique pickups; the basket requirement; replay and staying; friend dialogue; instructions and focus; sound-toggle state; reduced motion; 320px/390px and short landscape layouts; direct `file://` use; and browser errors. The game needs no npm packages to run.

### Verification notes

- Automated checks run in headless Chromium, including a complete round with each input method.
- Desktop, portrait-phone, and landscape-celebration screenshots were visually self-reviewed.
- Sound initialization/toggle was checked programmatically, not assessed by listening.
- Real devices, screen-reader narration, Firefox, and Safari have not been tested. The game uses modern SVG, native `<dialog>`, CSS animations, and optional Web Audio.
