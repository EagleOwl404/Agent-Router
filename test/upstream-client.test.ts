import { describe, expect, it } from 'vitest';
import { buildCodexCall, buildUpstreamCall, isRetryableStatus, parseUsage } from '@agent-router/backend-services/router';

describe('UpstreamClient', () => {
  it('builds OpenAI bearer calls', () => {
    const call = buildUpstreamCall('OPENAI', null, '/chat/completions', 'sk-x', { model: 'gpt-4o' });
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer sk-x');
  });

  it('builds Anthropic x-api-key calls', () => {
    const call = buildUpstreamCall('ANTHROPIC', null, '/v1/messages', 'sk-ant', { model: 'claude-3-5-sonnet-20241022' });
    expect(call.headers['x-api-key']).toBe('sk-ant');
    expect(call.headers['anthropic-version']).toBeDefined();
  });

  it('builds Gemini key-query calls', () => {
    const call = buildUpstreamCall('GEMINI', null, '/v1beta/models/gemini-2.0-flash:generateContent', 'g-key', {});
    expect(call.url).toContain('key=g-key');
    expect(call.headers.authorization).toBeUndefined();
  });

  it('builds Codex calls against the Codex backend, mapping legacy platform urls', () => {
    expect(buildCodexCall(null, '/responses', 'at-1', 'acc-1', {}).url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(buildCodexCall('https://api.openai.com/v1', '/responses', 'at-1', null, {}).url).toBe(
      'https://chatgpt.com/backend-api/codex/responses',
    );
    expect(buildCodexCall(null, '/responses', 'at-1', 'acc-1', {}).headers['ChatGPT-Account-Id']).toBe('acc-1');
  });

  it('parses usage per kind', () => {
    expect(parseUsage('OPENAI', { usage: { prompt_tokens: 5, completion_tokens: 7 } })).toMatchObject({ promptTokens: 5, completionTokens: 7, estimated: false });
    expect(parseUsage('ANTHROPIC', { usage: { input_tokens: 4, output_tokens: 6 } })).toMatchObject({ promptTokens: 4, completionTokens: 6 });
    expect(parseUsage('OPENAI', {})).toMatchObject({ estimated: true });
  });

  it('classifies retryable statuses', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });
});
