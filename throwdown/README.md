# Throwdown Deck Lab

An unofficial deck-building helper for the mobile card game *Animation Throwdown: The Quest for Cards*.
It runs entirely in the browser on a phone: no account, no server.

- **Build**: recommends a deck for offense or defense, from every card or from your own collection,
  with an optional battleground effect (BGE) switched on.
- **Collection**: record the cards you own and their levels (saved on the device, with text backup).
- **Combos**: pick a character or item and see everything it combines into, strongest first.
- **Effects**: enter the current battleground effect once and reuse it.

## Run it

```bash
npm install
```

```bash
npm run build
```

`dist/index.html` is a standalone installable web app (works offline after the first visit). Serve the
`dist/` folder from any static host. `dist/artifact.html` is the same page as a bare fragment.

```bash
npm test
```

## Load your own account (optional)

`throwdown-export.mjs` is a single-file script for a computer with [Node.js](https://nodejs.org) 18 or newer.
It signs in to the game with your own login, downloads the current card data and the cards you own, and
writes `deck-lab-export.json`. Load that file in the app under Collection → "Load my game export".

```bash
node throwdown-export.mjs
```

It asks for your `user_id` and `password` value. Find them in the web version of the game: open the
browser's developer tools, go to the Network tab, filter for `api.php`, and look at any request. The
`user_id` is in the address; `password` is in the form data.

- The script is read-only: it sends the two requests the game sends at start-up and nothing else.
- Your login details are not saved anywhere. Treat the password value like a password and never share it.
- This uses the game's private interface, which is likely against its terms of service. Use it at your own risk.
- It has only been tested against a stand-in server, not the live game. If the format has changed it
  stops and saves the raw game data (no login details) so the script can be fixed.

## How recommendations are made

1. Every card gets a quick rating from its stats and skills, and every character + item pair is turned
   into its combo. The strongest cards and pairs are shortlisted.
2. A first deck is drafted from the shortlist, along with six varied sparring decks from the same cards.
3. The draft is improved by trying card swaps and keeping the ones that win more simulated battles.
4. The reported win rate comes from a final, larger set of battles against the sparring decks.

Offense: your deck moves first and is played with one-move lookahead. Defense: your deck moves second
and is played the way the computer plays (random card, combine when possible).

## Limits to know about

- **Card data** is a community mirror of the game's data, current to February 2026
  (`app/data/cards.json`). Loading your own game export (above) replaces it with current data.
- **The simulator is an approximation** rebuilt from in-game skill descriptions. Assumed: 5 cards in
  hand, 5 slots, one play per turn, a one-turn wait before attacking, 50-round limit, max-level heroes,
  no combo mastery. These live in `RULES` in `app/js/engine.js`.
- **Win rates compare decks with each other.** They are not a prediction of real arena results.
- Battleground effects are entered by hand; there is no feed of the current one.

## Credits

- Card and combo data layout: [YuHChen/atkit](https://github.com/YuHChen/atkit).
- Combo stat formula: [cartoon-battle](https://github.com/cartoon-battle/cartoon-battle.github.io) (MIT).

Game content belongs to its owners. This project is not affiliated with or endorsed by them.
