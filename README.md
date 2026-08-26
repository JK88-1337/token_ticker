# token_ticker

A local-first dashboard for your Claude Code token usage — part monitor, part
scoreboard. It reads the transcripts Claude Code already writes and turns them
into a live count that climbs while you work.

> **Unofficial.** Not affiliated with, endorsed by, or supported by Anthropic.

## Install

Grab the latest build from [Releases](../../releases):

| File | What it is |
|---|---|
| `token_ticker-<version>-x64.exe` | Windows installer |
| `token_ticker-<version>-x64.exe` (portable) | Single file, no install |

Nothing to configure. It finds `~/.claude/projects` on its own and starts
counting. If Claude Code has never run on the machine, it will say so.

## What it shows

It opens on **the ticker**, and always will.

**Tokens today** on a split-flap board, to every digit, rolling toward the real
figure rather than snapping to it.

**The combo**, beside it and deliberately the loudest thing on the board: the
run of turns you are on, what it is called, and the gap draining away — a
combo is the one figure here that can be lost in the next two minutes, so it
is drawn as the clock it actually is. **Level** sits next to it in the same
shape but quieter, because it is banked and only ever goes up. Then the
smaller figures: a rate in **tokens per minute** — turns arrive seconds apart
and carry thousands of tokens each, so per second reads as zeroes and spikes —
the day's equivalent value, turns, and streak.

**The quotes** — every line of the day against the last day you actually
worked, which is named on the board rather than assumed to be yesterday: total,
cache reads, cache writes, fresh input, reply, thinking, turns and value, each
with a real move. Models carry a share instead of an arrow, because the
transcripts do not record a model per day and a move it cannot know is a move
it will not claim.

**Session window** — what the current five-hour allowance window holds, against
a ceiling measured from the window you were actually cut off in, plus a
breakdown of what those tokens were.

**Candles** — open, high, low and close on **the pace the work is going at**,
in tokens a minute, over one minute (the view it opens on), an hour, or a day.

A rate is used rather than the size of a turn because it is the only figure
here that behaves like a price: it carries from the close of one period into
the open of the next, so green means the pace picked up over that period and
red means it eased off, and it cannot run away upwards — stop working and it
falls back on its own. A dashed line marks your typical pace so fast and slow
are read against a normal, and a tag on the right shows where the pace stands
now. Only periods with turns in them are drawn, so a gap is a gap rather than a
flat line the chart invented, and the strip underneath stays what the period
actually spent.

The pace is sampled **every five seconds**, not once per turn. Sampled at the
turns alone a one-minute candle would hold one or two readings and its open,
high, low and close would all be the same number — a chart of dashes. On a
clock the same minute holds a dozen, the wick is the real peak and trough the
pace passed through, and each candle opens exactly where the one before it
closed. Sampling stops whenever the trailing window empties and resumes at the
next turn, so an idle hour costs nothing and invents nothing.

Underneath: spend per day, and shares by model and by project. Along the
bottom, the crawl.

Updates are pushed from a filesystem watcher, not polled. A turn reaches the
screen about as fast as Claude Code can write it — measured on a working
session, roughly every three to six seconds, because every tool call is its own
API response with its own usage block.

## The farm

Behind the second tab is a game played with the same numbers, and it is a
second tab on purpose: a measuring tool that opens on a game is not a
measuring tool.

Eight plots. Crops ripen on **work tokens** — every class except cache reads,
the same measure the allowance gauge uses — so a field grows because you
worked, not because time passed. One plot of wheat is an afternoon; one of
goldgrain is a heavy week.

**The field shares the work.** Each batch of tokens is dealt out in equal
whole shares between the plots that are actually in the ground, so sowing a
second plot halves the speed of the first — filling the field spreads the same
effort thinner rather than multiplying it, and what will not divide is carried
to the next deal rather than rounded away. Work done while the plots are bare
is banked nowhere: empty earth is a cost. Harvest pays coins, coins buy better seed, and every ten million tokens
mints one spin of a European single-zero wheel: 0 to 36, eighteen red and
eighteen black, seated in the order a real wheel head runs rather than in
counting order. The felt takes what a real one takes — red or black, odd or
even, 1–18 or 19–36 at even money, a dozen or a column at 2 to 1, and a single
number at 35 to 1.

**You cannot play yourself into a corner**, and that is enforced in code rather
than in the copy — see `src/farm/economy.ts`, and the tests that hold it:

- Wheat is free forever, so there is always something to plant and something
  to harvest, even after a lost bet.
- No move that would take coins below zero happens at all. A stake you cannot
  cover is refused.
- Spins are minted by tokens you have already spent. The wheel is a table,
  not a mint: every wager on it loses one pocket in thirty-seven to the green
  zero, whatever it pays. A turn can leave you poorer. Coins come from the
  field.

The outcome of every spin is fixed by the save's own seed the moment the save
exists, so reloading mid-spin lands on the same pocket. There is no reroll to
scum for.

### Where the save lives

In this machine's app data, under the key `token-ticker.farm.v1` — the
packaged app keeps its own partition (`%APPDATA%/token_ticker` on Windows,
`~/Library/Application Support/token_ticker` on macOS), so closing the window,
rebooting and updating the app all leave it where it was. It is written every
time the farm changes, not on quit, so a crash costs nothing.

Three rules keep it from going quietly (`src/farm/storage.ts`):

- **A save that cannot be read is never written over.** It is moved to
  `token-ticker.farm.broken` first, so a bad write or a migration that goes
  wrong leaves something to recover from instead of an empty field.
- **The save being replaced is kept**, one deep, under
  `token-ticker.farm.backup`. If the current one will not load, that one is
  tried before starting fresh.
- **A store that refuses to write does not stop the game.** Full, disabled, or
  a private window: the farm still plays for the session.

What none of that survives is clearing the browser's data, renaming the app, or
a new laptop — the save is scoped to the app's own storage, and the dev server
on `localhost` is a different scope again from the packaged build. So **the
save is also offered as text**, under "The save" beneath the field: copy it
somewhere safe, paste it back anywhere. A pasted save is adopted onto whatever
token count the machine it lands on has, so it carries on growing from where it
was rather than ripening the whole field at once on arrival.

## What is honest about the numbers

This is a measuring tool, so it is worth being exact about what is measured and
what is not.

**Nothing on screen is invented.** The counters ease toward real figures and
only ever close from below, so the count shown is never ahead of what actually
happened. The combo is a real run of turns. The rate is real tokens over a real
sliding window, which is why it falls while you watch it.

**The ceiling is measured, not looked up.** Your allowance is not in the
transcripts and is not cached anywhere on disk — Claude Code asks its server
for it. `token_ticker` does not go looking: it never reads your credentials and
never calls an undocumented endpoint. What the transcripts *do* record is the
moment a turn was refused, so the gauge compares the current window against
what the window held when you were last cut off. Until that has happened it
falls back to your own busiest window, and says so.

**Thinking tokens are counted, once.** The API reports thinking as part of the
output count, not on top of it, so adding the two would count the same tokens
twice. Thinking is shown as a share of output and never summed into a total.

**Dollar figures are equivalent value, not a bill.** On a Pro or Max
subscription your price is fixed; the amount shown is what the same usage would
have cost pay-as-you-go. Treat it as a measure of compute extracted. Rates come
from [`src/core/pricing-table.json`](src/core/pricing-table.json), which records
where its numbers came from and when they were last checked — verify against
that source before trusting a total.

**Coins are not a measurement.** Everything on the ticker traces back to a
transcript. Coins, crops and trinkets do not — they are a game, they are worth
nothing, and no figure the ticker reports is affected by anything bought or
won. The farm's save is the only thing this app writes anywhere; delete it and
the measuring side is untouched.

**Duplicates are removed.** Resuming or branching a session copies earlier turns
into a new transcript, so the same API call is recorded more than once. On a
real transcript tree roughly half of all billable lines were repeats; summing
them raw overstates usage by about 1.8×.

## Privacy

Transcripts contain your conversations, your code, and your file paths.

- Everything runs **locally**. No account, no server, no telemetry, no network
  calls of any kind.
- The window is sandboxed with context isolation and no Node access — the page
  is handed aggregate numbers and nothing else.
- Nothing leaves your machine.

## Development

Requires Node 20 or newer.

```bash
npm install
npm run dev          # dashboard in the browser at http://localhost:5273

npm test             # run the suite once
npm run test:watch   # the loop to keep open while writing code
npm run typecheck    # tsc --noEmit
npm run scan         # run the parser over your own transcripts and print totals
npm run package      # build the desktop app into release/
```

`scan` is a development tool, not the app. It prints what the core makes of your
real transcripts — line counts, duplicates dropped, cost and token totals by
model — so the numbers can be checked against reality.

For breakpoints, VS Code launch configurations are checked in: **Debug tests**,
**Debug current test file**, and **Debug scan (real transcripts)**.

### How it fits together

```
~/.claude/projects/**/*.jsonl
  → src/node/transcripts.ts   find files, read only what was appended
  → src/core/records.ts       one line → one UsageRecord
  → src/core/ledger.ts        drop repeat sightings of the same call
  → src/core/pricing.ts       five token classes, each at its own rate
  → src/core/summary.ts       totals and buckets
  → src/core/snapshot.ts      UsageSnapshot — the whole contract
  → renderer                  over IPC when packaged, SSE in development
       src/ticker/            the default skin: flaps, quotes, crawl
       src/farm/              the game, on the same snapshot
```

Aggregation happens before the snapshot crosses that boundary, so the payload
stays small no matter how much history there is, and the renderer cannot tell
which transport it is on.

Everything under `src/core/` is pure and tested. Tests use hand-written fixtures
rather than captured transcripts, and must keep doing so — see
[tests/fixtures.ts](tests/fixtures.ts).

## License

MIT — see [LICENSE](LICENSE).
