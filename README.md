# token_ticker

A local-first dashboard for your Claude Code token consumption — part monitor, part game.

> **Unofficial.** Not affiliated with, endorsed by, or supported by Anthropic.

## Status

Early development. Nothing is usable yet.

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

## About the cost figures

If you are on a Claude Pro or Max subscription, the dollar amounts shown are the
**equivalent pay-as-you-go API value** of your usage — not what you were
actually billed. Your subscription price is fixed. Treat the number as a measure
of how much compute you extracted, not as an invoice.

## License

MIT — see [LICENSE](LICENSE).
