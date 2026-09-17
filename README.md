# Go Fish

A small, mobile-first Go Fish game you can play against computer players in the
browser. No build step, no dependencies, no bundler — plain HTML, CSS and ES
modules, so the repository can be served as-is from GitHub Pages.

## Play locally

Any static file server works. ES modules need HTTP, so opening `index.html`
straight off the filesystem will not work.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

Pages has to be switched on once by hand either way — a workflow's token is
not allowed to do it. Pick one option in **Settings → Pages**:

- **GitHub Actions** — set **Source** to **GitHub Actions**. The included
  `.github/workflows/pages.yml` then deploys on every push to `main`. Re-run
  the latest workflow once after switching, since runs before Pages existed
  will have failed.
- **Deploy from a branch** — set **Source** to **Deploy from a branch** and
  pick `main` / `/ (root)`. This needs no workflow at all; the site is plain
  static files at the repository root. If you go this way you can delete
  `.github/workflows/pages.yml`.

Either way the site lands at `https://playfulbacon.github.io/go-fish/`.

## How it plays

Pick how many computer players you want on the title screen and start. On your
turn, tap a player and then tap a card in your hand to ask them for that rank
(tapping in the other order works too). If they have it they hand every copy
over and you go again; if not, they say *go fish* and you tap the pond to draw.
Four of a kind is a book. When all thirteen books are made, the most books
wins.

## Rule variants

The whole point of the layout is that the rules live apart from the game.

- `src/rules/` — one file per variant, plus `index.js` listing them.
- `src/engine.js` — the game, driven entirely by whichever variant it is
  handed. It reads the variant's settings and never hard-codes a rule.
- `src/ui.js` — rendering and input; it reads state from the engine.
- `src/ai.js` — what computer players are allowed to know, rebuilt from the
  public event log so they cannot see anyone's hand.

To add a variant, copy `src/rules/classic.js`, change what you want, and add it
to the array in `src/rules/index.js`. It then shows up as a choice on the title
screen. Existing variants are never edited, so every version stays playable
exactly as it was.

A variant is a plain object:

```js
export const myVariant = {
  id: 'my-variant',
  name: 'My Variant',
  tagline: 'One line for the title screen.',
  bookSize: 4,                                   // cards that make a book
  handSize: (playerCount) => playerCount <= 3 ? 7 : 5,
  buildDeck: standardDeck,                       // () => cards
  mustHoldRank: true,                            // only ask for ranks you hold
  goAgainOnSuccess: true,                        // a hit keeps your turn
  goAgainOnLuckyDraw: true,                      // fishing your rank keeps it
  refillEmptyHand: true,                         // empty hand draws on your turn
  howToPlay: ['Shown in the rules sheet.'],
};
```
