import { describe, expect, it } from 'vitest';
import { closestModelNames, kouriProtocolOrder, kouriReasoningEffortOrder, shouldTryAlternateKouriProtocol } from './kouriCompatibility.cjs';

describe('Kouri compatibility policy', () => {
  it('tries the configured protocol first and only falls back for protocol-shaped failures', () => {
    expect(kouriProtocolOrder('chat-completions')).toEqual(['chat-completions', 'responses']);
    expect(kouriProtocolOrder('responses')).toEqual(['responses', 'chat-completions']);
    expect(shouldTryAlternateKouriProtocol('bad-request')).toBe(true);
    expect(shouldTryAlternateKouriProtocol('server')).toBe(true);
    expect(shouldTryAlternateKouriProtocol('authentication')).toBe(false);
  });

  it('suggests names that share the configured model family tokens', () => {
    expect(closestModelNames('deepseek-v4-flash-0731', [
      'gpt-5.2-pro', 'deepseek-v4', 'deepseek-v4-flash', 'gemini-3-flash',
    ])).toEqual(['deepseek-v4-flash', 'deepseek-v4']);
  });

  it('tries explicit reasoning from the requested ceiling down to a valid effort', () => {
    expect(kouriReasoningEffortOrder('max')).toEqual(['high', 'medium', 'low']);
    expect(kouriReasoningEffortOrder('medium')).toEqual(['medium', 'low']);
    expect(kouriReasoningEffortOrder('high', {
      model: 'm', protocol: 'responses', status: 'default-only', requestedEffort: 'high', effectiveEffort: 'none',
      checkedAt: '2026-08-27T00:00:00.000Z', message: 'unsupported',
    })).toEqual([]);
  });
});
