import { describe, expect, it } from 'vitest';
import { parseTranscriptLine } from '../src/core/records.js';
import { assistantLine, userLine } from './fixtures.js';

describe('parseTranscriptLine', () => {
  it('reads the four token classes off an assistant line', () => {
    const record = parseTranscriptLine(
      assistantLine({ input: 2, output: 295, cacheRead: 17332, cacheWrite1h: 10541 }),
    );

    expect(record?.tokens).toEqual({
      input: 2,
      output: 295,
      cacheRead: 17332,
      cacheWrite5m: 0,
      cacheWrite1h: 10541,
    });
  });

  it('bills every iteration when a refusal fell back to another model', () => {
    // The top-level usage block mirrors only the *last* iteration, so a naive
    // read silently drops the tokens spent on the attempt that was refused.
    const record = parseTranscriptLine(
      assistantLine({
        input: 2,
        output: 2417,
        cacheRead: 404768,
        iterations: [
          {
            type: 'message',
            input_tokens: 2,
            output_tokens: 653,
            cache_read_input_tokens: 440516,
            cache_creation_input_tokens: 1221,
            cache_creation: {
              ephemeral_5m_input_tokens: 1221,
              ephemeral_1h_input_tokens: 0,
            },
          },
          {
            type: 'fallback_message',
            input_tokens: 2,
            output_tokens: 2417,
            cache_read_input_tokens: 404768,
            cache_creation_input_tokens: 0,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 0,
            },
          },
        ],
      }),
    );

    expect(record?.tokens).toEqual({
      input: 4,
      output: 3070,
      cacheRead: 845284,
      cacheWrite5m: 1221,
      cacheWrite1h: 0,
    });
  });

  it('carries the identity and slicing fields off the line', () => {
    const record = parseTranscriptLine(
      assistantLine({
        requestId: 'req_abc',
        model: 'claude-opus-5',
        timestamp: '2026-07-15T10:24:37.187Z',
        cwd: 'C:\\projects\\demo',
        gitBranch: 'feat/x',
        sessionId: 'session-9',
        isSidechain: true,
        speed: 'fast',
        serviceTier: 'batch',
      }),
    );

    expect(record).toMatchObject({
      requestId: 'req_abc',
      model: 'claude-opus-5',
      timestamp: '2026-07-15T10:24:37.187Z',
      projectPath: 'C:\\projects\\demo',
      gitBranch: 'feat/x',
      sessionId: 'session-9',
      isSidechain: true,
      speed: 'fast',
      serviceTier: 'batch',
    });
  });

  it('normalises the drive letter so one project is not counted as two', () => {
    // Real transcripts record the same directory as both `C:\...` and `c:\...`
    // depending on how the session was started. Windows paths are
    // case-insensitive, so leaving it alone splits a project's usage in half.
    const upper = parseTranscriptLine(assistantLine({ cwd: 'C:\\projects\\demo' }));
    const lower = parseTranscriptLine(assistantLine({ cwd: 'c:\\projects\\demo' }));

    expect(lower?.projectPath).toBe(upper?.projectPath);
  });

  it('falls back to the message id when a line has no requestId', () => {
    const record = parseTranscriptLine(assistantLine({ requestId: null }));
    expect(record?.requestId).toBe('msg_0001');
  });

  it('ignores lines that carry no usage block', () => {
    expect(parseTranscriptLine(userLine())).toBeNull();
  });

  it('ignores synthetic turns, which never reached the API', () => {
    expect(parseTranscriptLine(assistantLine({ model: '<synthetic>' }))).toBeNull();
  });

  it('ignores turns that only report an API error', () => {
    // A 429 or a failed auth is written as an assistant line with a zeroed
    // usage block. Counting it would inflate the turn count with turns that
    // never ran.
    const line = JSON.parse(assistantLine({ requestId: 'req_x' })) as Record<string, unknown>;
    line['isApiErrorMessage'] = true;
    line['apiErrorStatus'] = 429;

    expect(parseTranscriptLine(JSON.stringify(line))).toBeNull();
  });

  it('ignores malformed lines rather than throwing', () => {
    expect(parseTranscriptLine('{ not json')).toBeNull();
    expect(parseTranscriptLine('')).toBeNull();
  });
});
