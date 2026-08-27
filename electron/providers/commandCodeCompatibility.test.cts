import { describe, expect, it } from 'vitest';
import {
  COMMAND_CODE_BASE_URL,
  commandCodeProtocolForModel,
  isCommandCodeDeepSeekModel,
  isCommandCodeJsonFormatRejection,
  normalizeCommandCodeBaseUrl,
} from './commandCodeCompatibility.cjs';

describe('Command Code compatibility policy', () => {
  it('routes Claude models to Anthropic Messages and all other models to OpenAI Chat', () => {
    expect(commandCodeProtocolForModel('claude-sonnet-4-6')).toBe('anthropic-messages');
    expect(commandCodeProtocolForModel('anthropic/claude-opus-4-6')).toBe('anthropic-messages');
    expect(commandCodeProtocolForModel('deepseek/deepseek-v4-flash')).toBe('chat-completions');
    expect(commandCodeProtocolForModel('google/gemini-3.7-flash')).toBe('chat-completions');
    expect(isCommandCodeDeepSeekModel('deepseek/deepseek-v4-flash')).toBe(true);
    expect(isCommandCodeDeepSeekModel('deepseek-v3.2')).toBe(false);
  });

  it('normalizes known public and API roots to the documented provider root', () => {
    expect(normalizeCommandCodeBaseUrl('https://commandcode.ai')).toBe(COMMAND_CODE_BASE_URL);
    expect(normalizeCommandCodeBaseUrl('https://api.commandcode.ai/provider')).toBe(COMMAND_CODE_BASE_URL);
    expect(normalizeCommandCodeBaseUrl(COMMAND_CODE_BASE_URL)).toBe(COMMAND_CODE_BASE_URL);
    expect(() => normalizeCommandCodeBaseUrl('https://example.com/v1')).toThrow('官方');
  });

  it('recognizes only the retained JSON-format compatibility fallback', () => {
    const message = 'unsupported response_format parameter（参数：response_format）';
    expect(isCommandCodeJsonFormatRejection('bad-request', 400, message)).toBe(true);
  });
});
