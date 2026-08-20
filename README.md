# token_ticker

A local-first dashboard for your Claude Code token consumption — part monitor, part game.

> **Unofficial.** Not affiliated with, endorsed by, or supported by Anthropic.

## Status

Early development. The dashboard runs locally with `npm run dev`; it is not yet
packaged as a desktop app.

## What it does

`token_ticker` reads the transcript files Claude Code already writes to
`~/.claude/projects/**/*.jsonl` and turns them into a dashboard: how many tokens
you burned, on what, and when — sliced by project, model, git branch, and session.

## Privacy

Those transcripts contain your conversations, your code, and your file paths.
So:

- Everything runs **locally**. No account, no server, no telemetry.
- Nothing leaves your machine unless you explicitly opt in to a feature that
  says it will, and such features only ever transmit aggregate numbers.

## About the ceiling

The allowance itself is not in the transcripts and is not cached anywhere on
disk — Claude Code asks its server for it. `token_ticker` does not go looking
for it: it never reads your credentials and never calls an undocumented
endpoint.

What the transcripts *do* record is the moment a turn was refused. So the
ceiling here is measured, not declared: the session gauge compares the current
five-hour window against what the window held when you were actually cut off.
Before that has ever happened it falls back to your own busiest window, and
says so.

Token counts for the gauge exclude cache reads. They run to hundreds of
millions against a few hundred thousand of everything else, and they are the
cheapest thing billed, so including them would make the reading swing with
context size rather than with effort.

## About the cost figures

If you are on a Claude Pro or Max subscription, the dollar amounts shown are the
**equivalent pay-as-you-go API value** of your usage — not what you were
actually billed. Your subscription price is fixed. Treat the number as a measure
of how much compute you extracted, not as an invoice.

## Development

Requires Node 20 or newer.

```bash
npm install
npm run dev          # the dashboard, at http://localhost:5273

npm run test:watch   # the loop you keep open while writing code
npm test             # run the suite once
npm run typecheck    # tsc --noEmit
npm run scan         # run the parser over your own ~/.claude/projects
npm run scan -- --by-project
```

`scan` is a development tool, not the app. It prints what the core parser makes
of your real transcripts — file and line counts, how many duplicate sightings
were dropped, and cost and token totals broken down by model — so the numbers
can be checked against reality.

Rates live in [src/core/pricing-table.json](src/core/pricing-table.json).
Correcting a price or adding a model is a data edit, not a code change. The
table records where its numbers came from and when they were last checked;
verify against that source before trusting a total.

For breakpoints, VS Code launch configurations are checked in: **Debug tests**,
**Debug current test file**, and **Debug scan (real transcripts)**.

Tests use hand-written fixtures rather than captured transcripts, and they must
keep doing so — see [tests/fixtures.ts](tests/fixtures.ts).

## License

MIT — see [LICENSE](LICENSE).
