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
figure rather than snapping to it — with a rate in tokens per second, the day's
equivalent value, turns, combo, level and streak beside it.

**The quotes** — every line of the day against the last day you actually
worked, which is named on the board rather than assumed to be yesterday: total,
cache reads, cache writes, fresh input, reply, thinking, turns and value, each
with a real move. Models carry a share instead of an arrow, because the
transcripts do not record a model per day and a move it cannot know is a move
it will not claim.

**Session window** — what the current five-hour allowance window holds, against
a ceiling measured from the window you were actually cut off in, plus a
breakdown of what those tokens were.

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
worked, not because time passed. Wheat is an afternoon; goldgrain is a heavy
week. Harvest pays coins, coins buy better seed, and every ten million tokens
mints one spin of the wheel.

**You cannot play yourself into a corner**, and that is enforced in code rather
than in the copy — see `src/farm/economy.ts`, and the tests that hold it:

- The wheel costs a spin, never coins, and every wedge on it pays. A turn can
  only leave you better off.
- Wheat is free forever, so there is always something to plant and something
  to harvest.
- No move that would take coins below zero happens at all.
- Spins are minted by tokens you have already spent, so the only way to run
  out is to stop working — and the only way to earn more is to start again.

The outcome of every spin is fixed by the save's own seed the moment the save
exists, so reloading mid-spin lands on the same wedge. There is no reroll to
scum for.

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
