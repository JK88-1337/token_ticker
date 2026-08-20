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

**Tokens today**, to every digit, rolling toward the real figure rather than
snapping to it — with a rate in tokens per second, a line of the day's running
total, and a meter tracking your best day on record.

**Combo** — how many turns have arrived back to back with no pause longer than
two minutes. It decays on its own the moment you stop, which is what makes it
worth watching.

**Session window** — what the current five-hour allowance window holds, against
a ceiling measured from the window you were actually cut off in, plus a
breakdown of what those tokens were: cache reads and writes, fresh input,
thinking, reply.

Underneath: spend per day, and shares by model and by project.

Updates are pushed from a filesystem watcher, not polled. A turn reaches the
screen about as fast as Claude Code can write it — measured on a working
session, roughly every three to six seconds, because every tool call is its own
API response with its own usage block.

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
```

Aggregation happens before the snapshot crosses that boundary, so the payload
stays small no matter how much history there is, and the renderer cannot tell
which transport it is on.

Everything under `src/core/` is pure and tested. Tests use hand-written fixtures
rather than captured transcripts, and must keep doing so — see
[tests/fixtures.ts](tests/fixtures.ts).

## License

MIT — see [LICENSE](LICENSE).
