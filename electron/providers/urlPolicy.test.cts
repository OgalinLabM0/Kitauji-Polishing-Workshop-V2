import { describe, expect, it } from 'vitest';
import { endpointForProtocol, modelsEndpoint, normalizeProviderBaseUrl } from './urlPolicy.cjs';

describe('provider URL policy', () => {
  it('normalizes full Kouri endpoints back to the service root', () => {
    expect(normalizeProviderBaseUrl('https://api.kourichat.com/v1/chat/completions')).toBe('https://api.kourichat.com/v1');
    expect(endpointForProtocol('https://api.kourichat.com/v1/responses', 'chat-completions')).toBe('https://api.kourichat.com/v1/chat/completions');
    expect(modelsEndpoint('https://api.kourichat.com/v1/')).toBe('https://api.kourichat.com/v1/models');
  });

  it('keeps DeepSeek official root without inventing v1', () => {
    expect(endpointForProtocol('https://api.deepseek.com', 'responses')).toBe('https://api.deepseek.com/responses');
  });

  it('normalizes and builds Anthropic Messages endpoints', () => {
    expect(normalizeProviderBaseUrl('https://api.commandcode.ai/provider/v1/messages')).toBe('https://api.commandcode.ai/provider/v1');
    expect(endpointForProtocol('https://api.commandcode.ai/provider/v1', 'anthropic-messages'))
      .toBe('https://api.commandcode.ai/provider/v1/messages');
  });

  it('rejects credentials, query strings and remote plain HTTP', () => {
    expect(() => normalizeProviderBaseUrl('https://key@example.com/v1')).toThrow();
    expect(() => normalizeProviderBaseUrl('https://example.com/v1?token=x')).toThrow();
    expect(() => normalizeProviderBaseUrl('http://example.com/v1')).toThrow();
    expect(normalizeProviderBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
  });
});
