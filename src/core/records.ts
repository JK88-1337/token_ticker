/** The five token classes Anthropic prices separately. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/** One billable assistant turn, lifted out of a transcript line. */
export interface UsageRecord {
  /**
   * Identifies the API call. The same call is written to more than one
   * transcript when a session is resumed or branched, so this is what
   * deduplication keys on.
   */
  requestId: string;
  timestamp: string;
  model: string;
  sessionId: string;
  /** The `cwd` of the session — how usage is attributed to a project. */
  projectPath: string;
  gitBranch: string | null;
  /** True for turns run by a subagent rather than the main loop. */
  isSidechain: boolean;
  speed: string;
  serviceTier: string;
  tokens: TokenCounts;
}

/** Placeholder model id Claude Code writes for locally-generated turns. */
const SYNTHETIC_MODEL = '<synthetic>';

const ZERO: TokenCounts = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Settles the one way the same directory is spelled two ways.
 *
 * Transcripts record `cwd` with either drive-letter case depending on how the
 * session was started. Windows paths are case-insensitive, so leaving both
 * spellings intact splits one project's usage across two entries.
 */
function normalisePath(path: string): string {
  return /^[a-z]:/.test(path) ? path[0]!.toUpperCase() + path.slice(1) : path;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Reads the token counts out of one `usage`-shaped object. */
function countsOf(usage: any): TokenCounts {
  const creation = usage?.cache_creation;
  // `cache_creation` splits the write total across TTLs, which are priced
  // differently. When it is absent, everything falls back to the 5m default.
  const write5m = creation ? num(creation.ephemeral_5m_input_tokens) : num(usage?.cache_creation_input_tokens);
  const write1h = creation ? num(creation.ephemeral_1h_input_tokens) : 0;

  return {
    input: num(usage?.input_tokens),
    output: num(usage?.output_tokens),
    cacheRead: num(usage?.cache_read_input_tokens),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
  };
}

function add(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

/**
 * Every inference the API ran for this turn.
 *
 * When a request is refused and served by a fallback model, the response
 * carries an `iterations` array with one entry per inference — and the
 * top-level `usage` block mirrors only the *last* one. Both attempts are
 * billed, so the array is the truth whenever it is present.
 */
function billableCounts(usage: any): TokenCounts {
  const iterations = usage?.iterations;
  if (Array.isArray(iterations) && iterations.length > 0) {
    return iterations.map(countsOf).reduce(add, ZERO);
  }
  return countsOf(usage);
}

/**
 * Turns a single line of a Claude Code transcript into a {@link UsageRecord},
 * or `null` when the line carries nothing billable.
 */
export function parseTranscriptLine(line: string): UsageRecord | null {
  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Transcripts are appended to live; a torn final line is normal.
    return null;
  }

  const message = parsed?.message;
  if (!message?.usage) return null;

  // Failures — a 429, an expired token — are written as assistant lines with
  // a zeroed usage block. They are turns that never ran.
  if (parsed.isApiErrorMessage === true) return null;

  // Claude Code records some turns it generated itself — cancellations, local
  // errors — under a placeholder model. They cost nothing.
  if (message.model === SYNTHETIC_MODEL) return null;

  const requestId = str(parsed.requestId) ?? str(message.id);
  if (requestId === null) return null;

  return {
    requestId,
    timestamp: str(parsed.timestamp) ?? '',
    model: str(message.model) ?? 'unknown',
    sessionId: str(parsed.sessionId) ?? '',
    projectPath: normalisePath(str(parsed.cwd) ?? ''),
    gitBranch: str(parsed.gitBranch),
    isSidechain: parsed.isSidechain === true,
    speed: str(message.usage.speed) ?? 'standard',
    serviceTier: str(message.usage.service_tier) ?? 'standard',
    tokens: billableCounts(message.usage),
  };
}
