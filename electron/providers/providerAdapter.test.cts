import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KouriReasoningCapability, ProviderProfile } from './models.cjs';
import { ProviderAdapter, ProviderRequestError, parseAnthropicMessages, parseChatCompletion, parseResponsesApi } from './providerAdapter.cjs';

afterEach(() => vi.unstubAllGlobals());

describe('provider response adapters', () => {
  it('parses Chat Completions usage and content', () => {
    expect(parseChatCompletion({
      id: 'chat-1',
      choices: [{ message: { content: '译文' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 4, prompt_cache_hit_tokens: 8 },
    })).toMatchObject({ text: '译文', inputTokens: 11, outputTokens: 4, cachedInputTokens: 8 });
  });

  it('parses Responses output items when output_text is absent', () => {
    expect(parseResponsesApi({
      id: 'resp-1', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
      usage: { input_tokens: 9, output_tokens: 3 },
    })).toMatchObject({ text: '完成', rawStatus: 'completed' });
  });

  it('blocks truncated and empty success bodies', () => {
    expect(() => parseChatCompletion({ choices: [{ message: { content: '半截' }, finish_reason: 'length' }] })).toThrow(ProviderRequestError);
    expect(() => parseResponsesApi({ status: 'completed', output: [] })).toThrow('没有可用正文');
  });

  it('parses Anthropic Messages content and usage', () => {
    expect(parseAnthropicMessages({
      id: 'msg-1', type: 'message', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '译文' }],
      usage: { input_tokens: 18, output_tokens: 5, cache_read_input_tokens: 9 },
    })).toMatchObject({
      text: '译文', inputTokens: 18, outputTokens: 5, cachedInputTokens: 9,
      protocolUsed: 'anthropic-messages',
    });
    expect(() => parseAnthropicMessages({ content: [{ type: 'text', text: '半截' }], stop_reason: 'max_tokens' }))
      .toThrow('长度上限');
  });

  it('automatically routes mixed Command Code models and sends only native request fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/messages')) {
        return new Response(JSON.stringify({
          id: 'msg-1', type: 'message', stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'CLAUDE_OK' }], usage: { input_tokens: 3, output_tokens: 2 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'chat-1', choices: [{ message: { content: 'CHAT_OK' }, finish_reason: 'stop' }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const profile: ProviderProfile = {
      profileId: 'command-code-test', name: 'Command Code', kind: 'command-code',
      baseUrl: 'https://api.commandcode.ai/provider/v1', protocol: 'chat-completions',
      model: 'deepseek/deepseek-v4-flash', reviewModel: 'claude-sonnet-4-6',
      preReadModel: 'deepseek/deepseek-v4-flash', temperature: 0.1, batchSize: 1, concurrency: 1,
      timeoutSeconds: 30, maxRetries: 0, maxOutputTokens: 128, reasoningEffort: 'high',
      zeroDataRetention: true, customInstructions: '',
    };
    const adapter = new ProviderAdapter(profile, 'cmd-secret');
    const chat = await adapter.request({
      model: 'deepseek/deepseek-v4-flash', system: 'system', user: 'user', responseFormat: 'json', reasoningEffort: 'high',
    });
    const claude = await adapter.request({ model: 'claude-sonnet-4-6', system: 'system', user: 'user' });
    const gemini = await adapter.request({ model: 'google/gemini-3.7-flash', system: 'system', user: 'user', reasoningEffort: 'max' });
    expect(chat).toMatchObject({ text: 'CHAT_OK', protocolUsed: 'chat-completions' });
    expect(chat).not.toHaveProperty('reasoningStatus');
    expect(claude).toMatchObject({ text: 'CLAUDE_OK', protocolUsed: 'anthropic-messages' });
    expect(gemini).toMatchObject({ text: 'CHAT_OK', protocolUsed: 'chat-completions' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.commandcode.ai/provider/v1/chat/completions');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.commandcode.ai/provider/v1/messages');
    const chatBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    const messagesBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as Record<string, unknown>;
    expect(chatBody).not.toHaveProperty('thinking');
    expect(chatBody).not.toHaveProperty('reasoning_effort');
    expect(chatBody).not.toHaveProperty('reasoning');
    expect(chatBody).toMatchObject({ response_format: { type: 'json_object' } });
    expect(messagesBody).toMatchObject({ model: 'claude-sonnet-4-6', system: 'system', max_tokens: 128 });
    expect(messagesBody).not.toHaveProperty('reasoning_effort');
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('x-cmd-zdr')).toBe('1');
    const geminiBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body)) as Record<string, unknown>;
    expect(geminiBody).not.toHaveProperty('thinking');
    expect(geminiBody).not.toHaveProperty('reasoning_effort');
  });

  it('falls back once when a Command Code upstream rejects native JSON mode and remembers prompt-only mode', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.response_format) {
        return new Response(JSON.stringify({ error: { message: 'unsupported response_format parameter', param: 'response_format' } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const progress: string[] = [];
    const profile: ProviderProfile = {
      profileId: 'command-code-test', name: 'Command Code', kind: 'command-code',
      baseUrl: 'https://api.commandcode.ai/provider/v1', protocol: 'chat-completions',
      model: 'deepseek/deepseek-v4-flash', reviewModel: 'deepseek/deepseek-v4-flash',
      preReadModel: 'deepseek/deepseek-v4-flash', temperature: 0.1, batchSize: 1, concurrency: 1,
      timeoutSeconds: 30, maxRetries: 0, maxOutputTokens: 18_432, reasoningEffort: 'none', customInstructions: '',
    };
    const adapter = new ProviderAdapter(profile, 'cmd-secret');
    const request = { system: 'JSON system', user: 'user', responseFormat: 'json' as const, onProgress: (event: { message: string }) => progress.push(event.message) };
    await adapter.request(request);
    await adapter.request(request);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toHaveProperty('response_format');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).not.toHaveProperty('response_format');
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).not.toHaveProperty('response_format');
    expect(progress).toContainEqual(expect.stringContaining('原生 JSON 输出参数'));
    expect(adapter.describeRequest(request)).toMatchObject({ maxOutputTokens: 18_432, jsonHandling: 'prompt-only' });
  });

  it('does not blindly retry a deterministic output-length truncation', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"half":' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1234, completion_tokens: 8192 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const profile: ProviderProfile = {
      profileId: 'command-code-test', name: 'Command Code', kind: 'command-code',
      baseUrl: 'https://api.commandcode.ai/provider/v1', protocol: 'chat-completions',
      model: 'deepseek/deepseek-v4-flash', reviewModel: 'deepseek/deepseek-v4-flash',
      preReadModel: 'deepseek/deepseek-v4-flash', temperature: 0.1, batchSize: 1, concurrency: 1,
      timeoutSeconds: 30, maxRetries: 3, maxOutputTokens: 8192, reasoningEffort: 'none', customInstructions: '',
    };
    await expect(new ProviderAdapter(profile, 'cmd-secret').request({ system: 'system', user: 'user' }))
      .rejects.toMatchObject({
        code: 'truncated-response',
        responseMeta: { finishReason: 'length', inputTokens: 1234, outputTokens: 8192 },
      });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains Command Code plan and ZDR permission failures', async () => {
    const profile: ProviderProfile = {
      profileId: 'command-code-test', name: 'Command Code', kind: 'command-code',
      baseUrl: 'https://api.commandcode.ai/provider/v1', protocol: 'chat-completions',
      model: 'deepseek/deepseek-v4-flash', reviewModel: 'deepseek/deepseek-v4-flash',
      preReadModel: 'deepseek/deepseek-v4-flash', temperature: 0.1, batchSize: 1, concurrency: 1,
      timeoutSeconds: 30, maxRetries: 0, maxOutputTokens: 128, reasoningEffort: 'none',
      zeroDataRetention: true, customInstructions: '',
    };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: { code: 'cmd_zdr_no_providers', message: 'No ZDR providers available' },
    }), { status: 422 })));
    await expect(new ProviderAdapter(profile, 'cmd-secret').request({ system: 'system', user: 'user' }))
      .rejects.toMatchObject({ code: 'bad-request', status: 422, message: expect.stringContaining('关闭 ZDR') });

    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: { code: 'upgrade_required', message: 'Upgrade required' },
    }), { status: 403 })));
    await expect(new ProviderAdapter({ ...profile, zeroDataRetention: false }, 'cmd-secret').request({ system: 'system', user: 'user' }))
      .rejects.toMatchObject({ code: 'permission', status: 403, message: expect.stringContaining('GOAT') });
  });

  it('maps unsupported DeepSeek Chat Completions medium effort to high', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: 'chat-1', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const profile: ProviderProfile = {
      profileId: 'deepseek-test', name: 'DeepSeek', kind: 'deepseek', baseUrl: 'https://api.deepseek.com',
      protocol: 'chat-completions', model: 'deepseek-v4-flash', reviewModel: 'deepseek-v4-flash',
      preReadModel: 'deepseek-v4-flash', temperature: 0.1, batchSize: 1, concurrency: 1,
      timeoutSeconds: 30, maxRetries: 0, maxOutputTokens: 128, reasoningEffort: 'medium', customInstructions: '',
    };
    await new ProviderAdapter(profile, 'sk-test').request({ system: 'system', user: 'user' });
    const init = fetchMock.mock.calls[0][1];
    if (!init) throw new Error('fetch request options were not captured');
    expect(JSON.parse(String(init.body))).toMatchObject({
      reasoning_effort: 'high', thinking: { type: 'enabled' },
    });
  });

  it('falls back from Kouri Chat to Responses and verifies explicit reasoning', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) return new Response(JSON.stringify({ error: { message: 'upstream gateway error' } }), { status: 502 });
      return new Response(JSON.stringify({ id: 'resp-kouri', status: 'completed', output_text: '{"status":"OK"}' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const profile: ProviderProfile = {
      profileId: 'kouri-test', name: 'Kouri', kind: 'kouri', baseUrl: 'https://api.kourichat.com/v1',
      protocol: 'chat-completions', model: 'reasoning-model', reviewModel: 'reasoning-model',
      preReadModel: 'reasoning-model', temperature: 0.1, batchSize: 1, concurrency: 1,
      timeoutSeconds: 30, maxRetries: 0, maxOutputTokens: 128, reasoningEffort: 'high', customInstructions: '',
    };
    const response = await new ProviderAdapter(profile, 'sk-test').request({
      system: 'system', user: 'user', responseFormat: 'json', reasoningEffort: 'high',
    });
    expect(response.text).toBe('{"status":"OK"}');
    expect(response).toMatchObject({ reasoningStatus: 'verified', reasoningEffortUsed: 'high' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/responses');
    const chatBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    const responsesBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as Record<string, unknown>;
    expect(chatBody).not.toHaveProperty('thinking');
    expect(chatBody).not.toHaveProperty('reasoning_effort');
    expect(chatBody).not.toHaveProperty('response_format');
    expect(responsesBody).toMatchObject({ reasoning: { effort: 'high' } });
    expect(responsesBody).not.toHaveProperty('text');
  });

  it('downgrades rejected Kouri reasoning efforts and finally verifies default-only mode', async () => {
    const capabilities: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.reasoning) return new Response(JSON.stringify({ error: { message: 'unsupported reasoning effort parameter' } }), { status: 400 });
      return new Response(JSON.stringify({ id: 'resp-kouri', status: 'completed', output_text: 'OK' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const profile: ProviderProfile = {
      profileId: 'kouri-test', name: 'Kouri', kind: 'kouri', baseUrl: 'https://api.kourichat.com/v1',
      protocol: 'responses', model: 'reasoning-model', reviewModel: 'reasoning-model', preReadModel: 'reasoning-model',
      temperature: 0.1, batchSize: 1, concurrency: 1, timeoutSeconds: 30, maxRetries: 0,
      maxOutputTokens: 128, reasoningEffort: 'high', customInstructions: '',
    };
    const response = await new ProviderAdapter(profile, 'sk-test', {
      saveKouriReasoningCapability: (capability) => capabilities.push(capability),
    }).request({ system: 'system', user: 'user', reasoningEffort: 'high' });
    expect(response).toMatchObject({ text: 'OK', reasoningStatus: 'default-only', reasoningEffortUsed: 'none' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.slice(0, 3).map((call) => (JSON.parse(String(call[1]?.body)) as { reasoning: { effort: string } }).reasoning.effort))
      .toEqual(['high', 'medium', 'low']);
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).not.toHaveProperty('reasoning');
    expect(capabilities.at(-1)).toMatchObject({ status: 'default-only', effectiveEffort: 'none' });
  });
});
