# Hit Zero

An idle game about taking a cheer team from Rec to International.

Open `index.html` in a browser to play. There is no build step and nothing to install.

## How it plays

- **Spirit** is the currency. Press **Drill** to earn it by hand; **Program** upgrades earn it every second, including while the game is closed (up to 8 hours).
- Each division has a **scoresheet** with six categories: jumps, tumbling, stunts, pyramid, tosses and dance. A new team has no skills. Spend Spirit to learn a skill and train it to level 10.
- The **routine score** (out of 100) is the total of all six categories, so the team has to progress several skills to win, not just one.
- Each division has three **competitions** (score 30, 60, then 90 to win). A win pays a trophy and a Spirit prize. Winning the third one, the division championship, moves the team up.
- Divisions: Rec, Club, Junior Varsity, Varsity, All Star, International.
- **Gear** is bought once and boosts drills, all Spirit, or training costs.

## Files

| File | What it holds |
|---|---|
| `js/data.js` | All content and numbers: divisions, skills, competitions, program upgrades, gear, tuning constants. Start here to change the game. |
| `js/game.js` | The rules (income, costs, scoring, competitions, saving). No browser code. |
| `js/ui.js` | Drawing, input, the game clock and saving to the browser. |
| `styles.css` | Look and layout, light and dark. |
| `tools/simulate.mjs` | A bot that plays the game and prints how long each competition takes. |
| `tools/build-single.mjs` | Bundles everything into one file at `dist/hit-zero.html`. |

## Checking the pacing

After changing numbers in `js/data.js`, run from the repo root:

```bash
node cheer-idle/tools/simulate.mjs      # an active player, 3 drills a second
node cheer-idle/tools/simulate.mjs 0    # a player who only checks in to spend
```
