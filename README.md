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

## The games

Pick a game and the number of computer players on the title screen.

### Go Fish: Classic

On your turn, tap a player and then tap a card in your hand to ask them for
that rank (tapping in the other order works too). If they have it they hand
every copy over and you go again; if not, they say *go fish* and you tap the
pond to draw. Four of a kind is a book. When all thirteen books are made, the
most books wins.

### Go Fish: Tide Pool

Go Fish in clear water. Four cards lie **face up in a pool**, and when told to
go fish you pick the one you want — or draw blind from the pile instead, which
is the only way to win another turn. Everyone also keeps **one card face up**
in front of them, so part of every hand is public and can be asked for by
name. Lose your face-up card and you choose a replacement from your hand, then
draw back up to five.

#### Rules that were filled in

- **A card you could already see never wins you another turn.** A blind draw
  that finds your rank does, and prising a hidden card out of someone does,
  but taking from the open pool does not, and nor does helping yourself to a
  face-up card. Without that last part the table is a shopping list: at six
  players, farming visible cards ran turns of a dozen asks and handed the late
  seats a 27-point win-rate edge. With it, seats finish within 4.4 points and
  turns run the length they do in Classic.
- **The face-up card counts as yours** for asking, for being asked, and for
  books. Otherwise a fourth card stuck on show would be a book you could never
  complete.
- **Hands are five**, and the draw back up to five happens when you replace
  your face-up card, as specified.

### Cast & Boat

A different game, not a Go Fish variant, with its own engine and table.

On your turn you are the **caster**: play one card face up into the pond.
Everyone else answers with a card face down, and all the answers flip at once.
Any answer matching your cast card's suit or rank earns that player **luck**.
You may then **boat** one answer — it goes face up in front of you — and the
rest are discarded. Three cards in your boat scores: three of a rank, three of
a suit, or a run of three. Then the boat empties, set or not, so the third card
is the whole gamble.

Boating is never compulsory. With two cards already in your boat, a third that
makes no set clears it for nothing, so **taking nothing** and keeping the pair
is often better than filling the boat — at the cost of a turn.

Luck buys three special actions, all at the same price:

- **Call** — name the rank *or* the suit of the card you cast. Everyone holding
  it must answer with it.
- **Boat another** — take a second answer this turn.
- **Swap boats** — exchange any two boated cards belonging to different
  players. Neither has to be yours, so you can trade your dud for someone's
  good card, or just break up two rivals.

Everyone refills to five and the next player casts. First to the target score
wins.

#### Rules that were filled in

The game was specified in prose, so these were decided to make it playable and
are all tunable in one place, `src/cast/rules.js`:

- **The pond answers a short table.** The caster choosing one answer is the
  whole game, and at two players there is only one answer — no decision at all.
  Simulated over full games, that left a **1% set rate**, and matches that
  effectively never ended. So when fewer than `minAnswers` (3) cards reach the
  table, the pond deals face-down cards to make up the difference. Pond cards
  earn nobody luck. That took two players to a 34% set rate, in line with three
  and four. Set `minAnswers: 0` to play it straight.
- **Scoring.** Run 3, flush 3, three of a kind 5, straight flush 8, paying only
  the best match. A run is three consecutive ranks in any suits; aces run low
  (A-2-3) or high (Q-K-A) but do not wrap.
- **Target score** scales with the table — 12/12/14/18/22 for 2–6 players —
  because more players means more answers, so boats land more often. Tuned by
  simulation so every table runs about the same length in total turns (49–57),
  which is what a player actually sits through, since you act on every turn
  whether you are casting or answering.
- **Luck** is 1 per matching answer, capped at 6, and every action costs 2. The
  cap matters: uncapped, players sat on 8 of 10 and luck stopped being a
  decision. So does the flat price — an earlier build priced the actions 3/3/1,
  and the cheap one got spammed 66 times per 100 casts, starving the extra boat
  that actually scores. Levelling every action to 2 nearly doubled extra boats
  and took the set rate from 20% to 30%.
- **Calling a suit is more reliable than calling a rank**, since a suit is
  thirteen cards to a rank's four. It is priced the same on purpose: the rank
  call chases three of a kind for 5, the suit call chases a flush for 3.
- **The caster boats from the answers only**, not from their own cast card.
  Taking your own cast back would be a guaranteed free boat every turn, which
  removes the reason to cast anything.
- **A call names the card you cast** — its rank or its suit, depending on which
  button you armed — so calling is one tap rather than a separate picker.
- **A boat swap happens during your cast**, before you play a card, and the two
  cards must belong to different players. Boat sizes never change, so a swap
  can never complete a boat on its own.
- **Computer players hold out, but not forever.** Simulated with perfect
  patience, a player protecting a good pair could wait on a card that never
  came, and a few games per thousand never ended. They now take the card anyway
  a quarter of the time, which is both more human and what makes the game
  certain to finish.

## Adding versions

Every playable version is listed in `src/games.js`, and the title screen is
built from that list. Versions never reach into each other, so old ones stay
playable exactly as they were.

    src/games.js          the menu: every playable version
    src/cards.js          shared card primitives
    src/rules/            Go Fish rule variants (classic.js, tidepool.js)
    src/engine.js         Go Fish game logic, driven by a variant
    src/ai.js  src/ui.js  Go Fish computer players and table
    src/cast/             Cast & Boat: rules, engine, ai, ui

**A Go Fish rule tweak** is a new file in `src/rules/` added to the array in
`src/rules/index.js`. The Go Fish engine is driven entirely by the variant it
is handed and hard-codes no rule, so it needs no changes, and each variant
appears in the menu on its own.

**A different game** gets its own folder, its own `<section class="screen">` in
`index.html`, and an entry in `src/games.js` providing `createView()` and
`start(view, aiCount)`. Cast & Boat is the worked example.

Computer players in both games read only from what is public — the event log in
Go Fish, the cast card and face-up boats in Cast & Boat. Neither ever looks at
a hand.

Tide Pool is the worked example of how far a variant can go without a new
engine: it adds a face-up pool and a face-up card per player purely through
`poolSize` and `showingCard`, which the engine treats as off for any variant
that does not set them. Classic's behaviour is identical before and after,
checked by simulating 2000 games of it against the same move counts.

A Go Fish variant is a plain object:

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
