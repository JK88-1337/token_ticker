/**
 * Hand-written transcript lines mirroring the shape Claude Code writes to
 * `~/.claude/projects/**\/*.jsonl`.
 *
 * These are synthetic on purpose: real transcripts contain conversations,
 * source code, and absolute paths, none of which belong in a public repo.
 */

import type { PricingTable } from '../src/core/pricing.js';
import type { TokenCounts, UsageRecord } from '../src/core/records.js';

interface LineOverrides {
  requestId?: string | null;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  thinking?: number;
  iterations?: unknown;
  speed?: string | null;
  serviceTier?: string | null;
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
}

/** An assistant line carrying a `usage` block — the unit we bill against. */
export function assistantLine(o: LineOverrides = {}): string {
  const cacheWrite5m = o.cacheWrite5m ?? 0;
  const cacheWrite1h = o.cacheWrite1h ?? 0;
  const line: Record<string, unknown> = {
    type: 'assistant',
    uuid: 'uuid-0001',
    requestId: o.requestId === undefined ? 'req_0001' : o.requestId,
    timestamp: o.timestamp ?? '2026-07-15T10:24:37.187Z',
    cwd: o.cwd ?? 'C:\\projects\\demo',
    sessionId: o.sessionId ?? 'session-0001',
    gitBranch: o.gitBranch ?? 'main',
    isSidechain: o.isSidechain ?? false,
    version: '2.1.210',
    entrypoint: 'claude-vscode',
    message: {
      id: 'msg_0001',
      type: 'message',
      role: 'assistant',
      model: o.model ?? 'claude-opus-4-8',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: o.input ?? 0,
        output_tokens: o.output ?? 0,
        output_tokens_details: { thinking_tokens: o.thinking ?? 0 },
        cache_read_input_tokens: o.cacheRead ?? 0,
        cache_creation_input_tokens: cacheWrite5m + cacheWrite1h,
        cache_creation: {
          ephemeral_5m_input_tokens: cacheWrite5m,
          ephemeral_1h_input_tokens: cacheWrite1h,
        },
        service_tier: o.serviceTier === undefined ? 'standard' : o.serviceTier,
        speed: o.speed === undefined ? 'standard' : o.speed,
        iterations: o.iterations ?? null,
      },
    },
  };
  if (o.requestId === null) delete line['requestId'];
  return JSON.stringify(line);
}

/**
 * A pricing table with round numbers, so arithmetic under test is obvious and
 * assertions do not move every time a real price does.
 */
export const testPricingTable: PricingTable = {
  cacheMultipliers: { read: 0.1, write5m: 1.25, write1h: 2 },
  batchMultiplier: 0.5,
  models: {
    'test-model': { input: 10, output: 50, fast: { input: 20, output: 100 } },
    'no-fast-model': { input: 10, output: 50 },
    'intro-model': {
      input: 10,
      output: 50,
      introductory: { untilExclusive: '2026-09-01T00:00:00Z', input: 2, output: 10 },
    },
  },
};

/** A already-parsed record, for tests that operate on records rather than lines. */
export function usageRecord(
  tokens: Partial<TokenCounts> = {},
  rest: Partial<UsageRecord> = {},
): UsageRecord {
  return {
    requestId: 'req_1',
    timestamp: '2026-07-15T10:24:37.187Z',
    model: 'test-model',
    sessionId: 'session-1',
    projectPath: 'C:\\projects\\demo',
    gitBranch: 'main',
    isSidechain: false,
    speed: 'standard',
    serviceTier: 'standard',
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      thinking: 0,
      ...tokens,
    },
    ...rest,
  };
}

/**
 * An assistant line reporting an API failure — how Claude Code records a 429
 * or an expired token. The usage block is present but zeroed.
 */
export function apiErrorLine(o: { status?: number; error?: string; text?: string; timestamp?: string } = {}): string {
  const line = JSON.parse(assistantLine({ timestamp: o.timestamp })) as Record<string, any>;
  line['isApiErrorMessage'] = true;
  line['apiErrorStatus'] = o.status ?? 429;
  line['error'] = o.error ?? 'rate_limit';
  line['message'].content = [
    { type: 'text', text: o.text ?? "You've hit your session limit · resets 10:30pm (Australia/Sydney)" },
  ];
  return JSON.stringify(line);
}

/** A user line — no `usage`, must never be billed. */
export function userLine(): string {
  return JSON.stringify({
    type: 'user',
    uuid: 'uuid-0002',
    timestamp: '2026-07-15T10:24:30.000Z',
    cwd: 'C:\\projects\\demo',
    sessionId: 'session-0001',
    message: { role: 'user', content: 'hello' },
  });
}
