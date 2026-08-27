import type {
  KouriReasoningCapability,
  ModelRequest,
  ModelResponse,
  ProviderErrorCode,
  ProviderProfile,
} from './models.cjs';
import { endpointForProtocol } from './urlPolicy.cjs';
import {
  isKouriReasoningRejection,
  kouriProtocolOrder,
  kouriReasoningEffortOrder,
  shouldTryAlternateKouriProtocol,
} from './kouriCompatibility.cjs';
import {
  commandCodeProtocolForModel,
  isCommandCodeDeepSeekModel,
  isCommandCodeJsonFormatRejection,
} from './commandCodeCompatibility.cjs';

const MAX_ERROR_BODY = 8_000;

export class ProviderRequestError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly responseMeta: {
    readonly finishReason?: string | null;
    readonly inputTokens?: number | null;
    readonly outputTokens?: number | null;
    readonly protocol?: ProviderProfile['protocol'];
  } | null;

  constructor(
    code: ProviderErrorCode,
    message: string,
    status: number | null = null,
    retryAfterMs: number | null = null,
    responseMeta: ProviderRequestError['responseMeta'] = null,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.responseMeta = responseMeta;
  }
}

const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    const record = asRecord(item);
    if (!record) return '';
    return typeof record.text === 'string' ? record.text : typeof record.output_text === 'string' ? record.output_text : '';
  }).join('');
};

export const parseChatCompletion = (value: unknown): ModelResponse => {
  const root = asRecord(value);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const usage = asRecord(root?.usage);
  const promptDetails = asRecord(usage?.prompt_tokens_details);
  const completionDetails = asRecord(usage?.completion_tokens_details);
  let text = textFromContent(message?.content).trim();
  if (!text) {
    const reasoning = typeof message?.reasoning_content === 'string'
      ? message.reasoning_content.trim()
      : typeof message?.reasoning === 'string'
        ? message.reasoning.trim()
        : typeof choice?.text === 'string'
          ? choice.text.trim()
          : '';
    if (reasoning) {
      text = reasoning;
    }
  }
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  if (finishReason === 'length') {
    const outputTokens = finiteNumber(usage?.completion_tokens);
    throw new ProviderRequestError(
      'truncated-response',
      `模型输出达到长度上限（finish_reason=length${outputTokens === null ? '' : `，已输出 ${outputTokens} Token`}），结果未写入。`,
      null,
      null,
      {
        finishReason,
        inputTokens: finiteNumber(usage?.prompt_tokens),
        outputTokens,
        protocol: 'chat-completions',
      },
    );
  }
  if (!text) throw new ProviderRequestError('empty-response', '服务返回成功，但没有可用正文。');
  return {
    text,
    finishReason,
    responseId: typeof root?.id === 'string' ? root.id : null,
    inputTokens: finiteNumber(usage?.prompt_tokens),
    outputTokens: finiteNumber(usage?.completion_tokens),
    cachedInputTokens: finiteNumber(promptDetails?.cached_tokens) ?? finiteNumber(usage?.prompt_cache_hit_tokens),
    reasoningTokens: finiteNumber(completionDetails?.reasoning_tokens),
    rawStatus: null,
    protocolUsed: 'chat-completions',
  };
};

export const parseResponsesApi = (value: unknown): ModelResponse => {
  const root = asRecord(value);
  const output = Array.isArray(root?.output) ? root.output : [];
  const text = typeof root?.output_text === 'string'
    ? root.output_text.trim()
    : output.map((item) => textFromContent(asRecord(item)?.content)).join('').trim();
  const usage = asRecord(root?.usage);
  const inputDetails = asRecord(usage?.input_tokens_details);
  const outputDetails = asRecord(usage?.output_tokens_details);
  const status = typeof root?.status === 'string' ? root.status : null;
  const incomplete = asRecord(root?.incomplete_details);
  if (status === 'incomplete') {
    const reason = typeof incomplete?.reason === 'string' ? `：${incomplete.reason}` : '';
    throw new ProviderRequestError(
      'truncated-response',
      `Responses 输出不完整${reason}，结果未写入。`,
      null,
      null,
      {
        finishReason: typeof incomplete?.reason === 'string' ? incomplete.reason : status,
        inputTokens: finiteNumber(usage?.input_tokens),
        outputTokens: finiteNumber(usage?.output_tokens),
        protocol: 'responses',
      },
    );
  }
  if (!text) throw new ProviderRequestError('empty-response', 'Responses 接口返回成功，但没有可用正文。');
  return {
    text,
    finishReason: status,
    responseId: typeof root?.id === 'string' ? root.id : null,
    inputTokens: finiteNumber(usage?.input_tokens),
    outputTokens: finiteNumber(usage?.output_tokens),
    cachedInputTokens: finiteNumber(inputDetails?.cached_tokens),
    reasoningTokens: finiteNumber(outputDetails?.reasoning_tokens),
    rawStatus: status,
    protocolUsed: 'responses',
  };
};

export const parseAnthropicMessages = (value: unknown): ModelResponse => {
  const root = asRecord(value);
  const usage = asRecord(root?.usage);
  const text = textFromContent(root?.content).trim();
  const stopReason = typeof root?.stop_reason === 'string' ? root.stop_reason : null;
  if (stopReason === 'max_tokens') {
    throw new ProviderRequestError(
      'truncated-response',
      `Anthropic Messages 输出达到长度上限${finiteNumber(usage?.output_tokens) === null ? '' : `（已输出 ${finiteNumber(usage?.output_tokens)} Token）`}，结果未写入。`,
      null,
      null,
      {
        finishReason: stopReason,
        inputTokens: finiteNumber(usage?.input_tokens),
        outputTokens: finiteNumber(usage?.output_tokens),
        protocol: 'anthropic-messages',
      },
    );
  }
  if (!text) throw new ProviderRequestError('empty-response', 'Anthropic Messages 接口返回成功，但没有可用正文。');
  return {
    text,
    finishReason: stopReason,
    responseId: typeof root?.id === 'string' ? root.id : null,
    inputTokens: finiteNumber(usage?.input_tokens),
    outputTokens: finiteNumber(usage?.output_tokens),
    cachedInputTokens: finiteNumber(usage?.cache_read_input_tokens),
    reasoningTokens: null,
    rawStatus: stopReason,
    protocolUsed: 'anthropic-messages',
  };
};

const parseRetryAfter = (value: string | null) => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
};

const classifyStatus = (status: number, body: string): ProviderErrorCode => {
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission';
  if ((status === 400 || status === 404) && /unsupported_model|model[^\n]{0,80}(?:not found|unknown|unsupported)|模型/iu.test(body)) return 'model-not-found';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'bad-request';
};

const extractErrorMessage = (body: string, status: number) => {
  try {
    const parsed = asRecord(JSON.parse(body));
    const error = asRecord(parsed?.error);
    const message = error?.message ?? parsed?.message;
    if (typeof message === 'string' && message.trim()) {
      const parameter = typeof error?.param === 'string' && error.param.trim() ? `（参数：${error.param.trim()}）` : '';
      const code = typeof error?.code === 'string' && error.code.trim() ? `（代码：${error.code.trim()}）` : '';
      return `${message.trim()}${parameter}${code}`;
    }
  } catch {
    // Plain-text or HTML gateway response
  }

  // 优雅解析 HTML 格式网关错误（如 Nginx / Cloudflare / Kouri 代理层返回的 502 Bad Gateway）
  if (/<(?:!doctype|html|head|body|title)/iu.test(body)) {
    const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/iu);
    const errorLiMatch = body.match(/<li[^>]*>([^<]+)<\/li>/iu);
    const detailMatch = body.match(/<span>([^<]*(?:Connection Failed|remote host|network|down|timeout)[^<]*)<\/span>/iu);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const detail = detailMatch ? detailMatch[1].trim() : errorLiMatch ? errorLiMatch[1].trim() : '';

    if (title || detail) {
      return `服务网关异常 (HTTP ${status} ${title}): ${detail || '上游服务暂时连接失败或不可达，请检查网络或稍后重试。'}`;
    }
  }

  const compact = body.replace(/\s+/gu, ' ').trim().slice(0, MAX_ERROR_BODY);
  return compact || `服务返回 HTTP ${status}。`;
};

const sleep = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  const cancel = () => {
    clearTimeout(timer);
    reject(new ProviderRequestError('cancelled', '请求已取消。'));
  };
  if (signal?.aborted) return cancel();
  signal?.addEventListener('abort', cancel, { once: true });
});

const requestBody = (
  profile: ProviderProfile,
  request: ModelRequest,
  protocol = profile.protocol,
  explicitKouriReasoningEffort: Exclude<ProviderProfile['reasoningEffort'], 'none' | 'max'> | null = null,
  allowCommandCodeJsonOutput = false,
) => {
  const model = request.model?.trim() || profile.model;
  const maxOutputTokens = request.maxOutputTokens ?? profile.maxOutputTokens;
  const temperature = request.temperature ?? profile.temperature;
  const targetEffort = request.reasoningEffort ?? profile.reasoningEffort;
  const effort = profile.kind === 'deepseek' && profile.protocol === 'chat-completions' && targetEffort === 'medium'
    ? 'high'
    : targetEffort === 'max' && profile.kind !== 'deepseek'
      ? 'high'
      : targetEffort;

  if (protocol === 'anthropic-messages') {
    return {
      model,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      max_tokens: maxOutputTokens,
      temperature: Math.min(1, temperature),
      stream: false,
    };
  }

  if (protocol === 'responses') {
    return {
      model,
      instructions: request.system,
      input: request.user,
      max_output_tokens: maxOutputTokens,
      stream: false,
      ...(profile.kind === 'kouri' ? {} : { temperature }),
      ...(profile.kind === 'kouri' && explicitKouriReasoningEffort ? { reasoning: { effort: explicitKouriReasoningEffort } } : {}),
      ...(profile.kind !== 'kouri' && effort !== 'none' ? { reasoning: { effort } } : {}),
      ...(profile.kind !== 'kouri' && request.responseFormat === 'json' ? { text: { format: { type: 'json_object' } } } : {}),
    };
  }

  // DeepSeek 官方保留专属 thinking 参数；Kouri 与 Command Code 使用兼容载荷。
  // Command Code 永不接收显式思考字段，具体推理模式完全交给它的上游模型。
  const thinkingPayload = profile.kind === 'deepseek'
    ? (effort !== 'none'
        ? { thinking: { type: 'enabled' }, reasoning_effort: effort }
        : { thinking: { type: 'disabled' } })
    : (profile.kind !== 'kouri' && profile.kind !== 'command-code' && effort !== 'none'
        ? { reasoning_effort: effort }
        : {});

  return {
    model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    max_tokens: maxOutputTokens,
    temperature,
    stream: false,
    ...(profile.kind !== 'kouri'
      && (profile.kind !== 'command-code' || allowCommandCodeJsonOutput)
      && request.responseFormat === 'json'
      ? { response_format: { type: 'json_object' } }
      : {}),
    ...thinkingPayload,
  };
};

export interface ProviderAdapterOptions {
  readonly getKouriReasoningCapability?: (model: string, protocol: ProviderProfile['protocol']) => KouriReasoningCapability | null;
  readonly saveKouriReasoningCapability?: (capability: KouriReasoningCapability) => void;
}

export interface ProviderRequestDescriptor {
  readonly providerName: string;
  readonly providerKind: ProviderProfile['kind'];
  readonly model: string;
  readonly protocol: ProviderProfile['protocol'];
  readonly reasoningEffort: ProviderProfile['reasoningEffort'];
  readonly maxOutputTokens: number;
  readonly timeoutSeconds: number;
  readonly maxRetries: number;
  readonly jsonHandling: 'native' | 'prompt-only' | 'text';
}

const parseJsonOrSse = (text: string) => {
  const trimmed = text.replace(/^\uFEFF/u, '').trim();
  if (!trimmed) throw new ProviderRequestError('empty-response', '服务没有返回响应正文。');
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const payloads = trimmed.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:') && line !== 'data: [DONE]')
      .map((line) => line.slice(5).trim());
    if (payloads.length === 1) {
      try { return JSON.parse(payloads[0]) as unknown; } catch { /* handled below */ }
    }
    throw new ProviderRequestError('invalid-response', '服务返回的内容不是有效 JSON；请检查接口协议选择。');
  }
};

export class ProviderAdapter {
  readonly #profile: ProviderProfile;
  readonly #apiKey: string;
  readonly #options: ProviderAdapterOptions;
  #preferredKouriProtocol: ProviderProfile['protocol'];
  readonly #commandCodeJsonPromptOnly = new Set<string>();

  constructor(profile: ProviderProfile, apiKey: string, options: ProviderAdapterOptions = {}) {
    this.#profile = profile;
    this.#apiKey = apiKey;
    this.#options = options;
    this.#preferredKouriProtocol = profile.protocol;
  }

  async request(request: ModelRequest): Promise<ModelResponse> {
    const attempts = this.#profile.maxRetries + 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.#requestOnce(request);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ProviderRequestError && [
          'rate-limit', 'server', 'network', 'timeout', 'empty-response'
        ].includes(error.code);
        if (!retryable || attempt + 1 >= attempts || request.signal?.aborted) throw error;
        const delay = error.retryAfterMs ?? Math.min(30_000, 700 * (2 ** attempt) + Math.floor(Math.random() * 350));
        request.onProgress?.({
          kind: 'retry',
          code: error.code,
          attempt: attempt + 1,
          maxAttempts: attempts,
          delayMs: delay,
          message: `第 ${attempt + 1}/${attempts} 次调用因 ${error.code} 失败：${error.message}；${(delay / 1000).toFixed(1)} 秒后重试。`,
        });
        await sleep(delay, request.signal);
      }
    }
    throw lastError;
  }

  describeRequest(request: ModelRequest): ProviderRequestDescriptor {
    const model = request.model?.trim() || this.#profile.model;
    const protocol = this.#profile.kind === 'command-code'
      ? commandCodeProtocolForModel(model)
      : this.#profile.kind === 'kouri'
        ? this.#preferredKouriProtocol
        : this.#profile.protocol;
    const wantsJson = request.responseFormat === 'json';
    const commandCodeNativeJson = this.#profile.kind === 'command-code'
      && isCommandCodeDeepSeekModel(model)
      && !this.#commandCodeJsonPromptOnly.has(model);
    const nativeJson = wantsJson && this.#profile.kind !== 'kouri'
      && (this.#profile.kind !== 'command-code' || commandCodeNativeJson);
    return {
      providerName: this.#profile.name,
      providerKind: this.#profile.kind,
      model,
      protocol,
      reasoningEffort: this.#profile.kind === 'command-code' ? 'none' : request.reasoningEffort ?? this.#profile.reasoningEffort,
      maxOutputTokens: request.maxOutputTokens ?? this.#profile.maxOutputTokens,
      timeoutSeconds: this.#profile.timeoutSeconds,
      maxRetries: this.#profile.maxRetries,
      jsonHandling: !wantsJson ? 'text' : nativeJson ? 'native' : 'prompt-only',
    };
  }

  async #requestOnce(request: ModelRequest): Promise<ModelResponse> {
    if (this.#profile.kind === 'command-code') {
      const model = request.model?.trim() || this.#profile.model;
      const protocol = commandCodeProtocolForModel(model);
      return protocol === 'chat-completions' && isCommandCodeDeepSeekModel(model)
        ? this.#requestCommandCodeDeepSeekWithJsonFallback(request, model, protocol)
        : this.#requestOnceWithProtocol(request, protocol);
    }
    if (this.#profile.kind !== 'kouri') return this.#requestOnceWithProtocol(request, this.#profile.protocol);
    const protocols = kouriProtocolOrder(this.#preferredKouriProtocol);
    let firstError: ProviderRequestError | null = null;
    for (const protocol of protocols) {
      try {
        const response = await this.#requestKouriWithProtocol(request, protocol);
        this.#preferredKouriProtocol = protocol;
        return response;
      } catch (error) {
        if (!(error instanceof ProviderRequestError)) throw error;
        if (!firstError) firstError = error;
        const isLast = protocol === protocols.at(-1);
        if (isLast || !shouldTryAlternateKouriProtocol(error.code)) {
          if (!firstError || firstError === error) throw error;
          throw new ProviderRequestError(
            firstError.code,
            `Kouri 的 ${this.#profile.protocol === 'responses' ? 'Responses' : 'Chat Completions'} 与备用协议均未成功。首次错误：${firstError.message}；备用协议错误：${error.message}`,
            firstError.status,
            firstError.retryAfterMs,
          );
        }
        request.onProgress?.({
          kind: 'compatibility-fallback',
          code: error.code,
          message: `Kouri 的 ${protocol} 调用失败（${error.message}），正在切换备用协议。`,
        });
      }
    }
    throw firstError ?? new ProviderRequestError('server', 'Kouri 未返回可用结果。');
  }

  async #requestKouriWithProtocol(request: ModelRequest, protocol: ProviderProfile['protocol']): Promise<ModelResponse> {
    const model = request.model?.trim() || this.#profile.model;
    const requestedEffort = request.reasoningEffort ?? this.#profile.reasoningEffort;
    const cached = this.#options.getKouriReasoningCapability?.(model, protocol) ?? null;
    if (protocol !== 'responses' || requestedEffort === 'none') {
      const response = await this.#requestOnceWithProtocol(request, protocol, null);
      if (requestedEffort === 'none') return response;
      const capability: KouriReasoningCapability = cached?.status === 'default-only'
        ? cached
        : {
            model, protocol, status: 'default-only', requestedEffort, effectiveEffort: 'none',
            checkedAt: new Date().toISOString(), message: '该调用协议不支持软件显式指定 reasoning effort，使用服务或模型默认推理。',
          };
      this.#options.saveKouriReasoningCapability?.(capability);
      return { ...response, reasoningStatus: capability.status, reasoningEffortUsed: capability.effectiveEffort };
    }

    const efforts = kouriReasoningEffortOrder(requestedEffort, cached);
    let lastReasoningError: ProviderRequestError | null = null;
    for (const effort of efforts) {
      try {
        const response = await this.#requestOnceWithProtocol(request, protocol, effort);
        const capability: KouriReasoningCapability = cached?.status === 'verified'
          && cached.requestedEffort === requestedEffort
          && cached.effectiveEffort === effort
          ? cached
          : {
              model, protocol, status: 'verified', requestedEffort, effectiveEffort: effort,
              checkedAt: new Date().toISOString(),
              message: effort === (requestedEffort === 'max' ? 'high' : requestedEffort)
                ? `已验证支持显式 ${effort} 思考。`
                : `所选档位不可用，已验证自动降为 ${effort}。`,
            };
        if (capability !== cached) this.#options.saveKouriReasoningCapability?.(capability);
        return { ...response, reasoningStatus: capability.status, reasoningEffortUsed: capability.effectiveEffort };
      } catch (error) {
        if (!(error instanceof ProviderRequestError)
          || !isKouriReasoningRejection(error.code, error.status, error.message)) throw error;
        lastReasoningError = error;
        request.onProgress?.({
          kind: 'compatibility-fallback',
          code: error.code,
          message: `Kouri 拒绝显式 ${effort} 思考参数，正在尝试更低档位或默认推理。`,
        });
      }
    }

    const response = await this.#requestOnceWithProtocol(request, protocol, null);
    const capability: KouriReasoningCapability = {
      model, protocol, status: 'default-only', requestedEffort, effectiveEffort: 'none',
      checkedAt: new Date().toISOString(),
      message: lastReasoningError
        ? `显式 reasoning 参数被服务拒绝（${lastReasoningError.message.slice(0, 240)}），已验证无参数调用可用。`
        : '已验证此模型只能使用服务或模型默认推理。',
    };
    this.#options.saveKouriReasoningCapability?.(capability);
    return { ...response, reasoningStatus: capability.status, reasoningEffortUsed: capability.effectiveEffort };
  }

  async #requestCommandCodeDeepSeekWithJsonFallback(
    request: ModelRequest,
    model: string,
    protocol: ProviderProfile['protocol'],
  ) {
    const useNativeJson = request.responseFormat === 'json' && !this.#commandCodeJsonPromptOnly.has(model);
    try {
      return await this.#requestOnceWithProtocol(request, protocol, null, useNativeJson);
    } catch (error) {
      if (!(error instanceof ProviderRequestError)
        || !useNativeJson
        || !isCommandCodeJsonFormatRejection(error.code, error.status, error.message)) throw error;
      this.#commandCodeJsonPromptOnly.add(model);
      request.onProgress?.({
        kind: 'compatibility-fallback',
        code: error.code,
        message: 'Command Code 上游拒绝原生 JSON 输出参数；已自动去掉 response_format，并继续使用严格提示与本地 JSON 校验。',
      });
      return this.#requestOnceWithProtocol(request, protocol, null, false);
    }
  }

  async #requestOnceWithProtocol(
    request: ModelRequest,
    protocol: ProviderProfile['protocol'],
    explicitKouriReasoningEffort: 'low' | 'medium' | 'high' | null = null,
    allowCommandCodeJsonOutput = false,
  ): Promise<ModelResponse> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.#profile.timeoutSeconds * 1_000);
    const forwardAbort = () => timeoutController.abort();
    request.signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      let response: Response;
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${this.#apiKey}`,
        };
        if (this.#profile.kind === 'command-code' && this.#profile.zeroDataRetention) headers['x-cmd-zdr'] = '1';
        response = await fetch(endpointForProtocol(this.#profile.baseUrl, protocol), {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody(
            this.#profile,
            request,
            protocol,
            explicitKouriReasoningEffort,
            allowCommandCodeJsonOutput,
          )),
          signal: timeoutController.signal,
        });
      } catch (error) {
        if (request.signal?.aborted) throw new ProviderRequestError('cancelled', '请求已取消。');
        if (timeoutController.signal.aborted) throw new ProviderRequestError('timeout', `请求超过 ${this.#profile.timeoutSeconds} 秒。`);
        throw new ProviderRequestError('network', error instanceof Error ? `无法连接模型服务：${error.message}` : '无法连接模型服务。');
      }
      const body = await response.text();
      if (!response.ok) {
        const code = classifyStatus(response.status, body);
        const upstreamMessage = extractErrorMessage(body, response.status);
        const message = this.#profile.kind === 'command-code' && response.status === 403
          ? `Command Code 拒绝了 API 权限：Go 套餐不支持 API；GOAT 及以上套餐应可使用。服务详情：${upstreamMessage}`
          : this.#profile.kind === 'command-code' && response.status === 422 && /cmd_zdr_no_providers/iu.test(body)
            ? `当前模型没有可用的零数据保留（ZDR）上游。请关闭 ZDR 或更换模型。服务详情：${upstreamMessage}`
            : upstreamMessage;
        throw new ProviderRequestError(
          code,
          message,
          response.status,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      const parsed = parseJsonOrSse(body);
      return protocol === 'responses'
        ? parseResponsesApi(parsed)
        : protocol === 'anthropic-messages'
          ? parseAnthropicMessages(parsed)
          : parseChatCompletion(parsed);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
