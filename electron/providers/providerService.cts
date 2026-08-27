import type { ProviderConnectionResult, ProviderProfile } from './models.cjs';
import { ProviderAdapter, ProviderRequestError } from './providerAdapter.cjs';
import { ProviderSettingsStore } from './providerSettings.cjs';
import { modelsEndpoint } from './urlPolicy.cjs';
import { closestModelNames } from './kouriCompatibility.cjs';

const friendlyError = (error: unknown): ProviderConnectionResult => {
  if (error instanceof ProviderRequestError) return { status: 'error', message: error.message, errorCode: error.code };
  return { status: 'error', message: error instanceof Error ? error.message : '连接测试失败。', errorCode: 'network' };
};

export class ProviderService {
  readonly settings: ProviderSettingsStore;

  constructor(settings: ProviderSettingsStore) { this.settings = settings; }

  #adapter(profile: ProviderProfile, apiKey: string) {
    return new ProviderAdapter(profile, apiKey, {
      getKouriReasoningCapability: (model, protocol) => this.settings.getKouriReasoningCapability(profile.profileId, model, protocol),
      saveKouriReasoningCapability: (capability) => this.settings.saveKouriReasoningCapability(profile.profileId, capability),
    });
  }

  async listModels(profileId: string) {
    const profile = this.settings.getProfile(profileId);
    const apiKey = this.settings.getApiKey(profileId);
    if (!profile || !apiKey) throw new Error('请先保存此服务的 API Key。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(modelsEndpoint(profile.baseUrl), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`读取模型列表失败（HTTP ${response.status}）：${body.slice(0, 500)}`);
      const parsed = JSON.parse(body) as { data?: readonly { id?: unknown }[] };
      return (parsed.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string').sort();
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(profileId: string): Promise<ProviderConnectionResult> {
    const profile = this.settings.getProfile(profileId);
    const apiKey = this.settings.getApiKey(profileId);
    if (!profile) return { status: 'error', message: '模型服务配置不存在。', errorCode: 'bad-request' };
    if (!apiKey) return { status: 'error', message: '请先保存 API Key。', errorCode: 'authentication' };
    if (profile.kind === 'kouri' || profile.kind === 'command-code') {
      try {
        const available = await this.listModels(profileId);
        if (available.length > 0 && !available.includes(profile.model)) {
          const suggestions = closestModelNames(profile.model, available);
          const providerName = profile.kind === 'command-code' ? 'Command Code' : 'Kouri';
          return {
            status: 'error',
            message: `${providerName} 当前模型列表中不存在“${profile.model}”。${suggestions.length ? `相近可用名称：${suggestions.join('、')}。` : '请点击“从服务读取模型列表”选择准确名称。'}`,
            errorCode: 'model-not-found',
          };
        }
      } catch {
        // 有些兼容服务不开放 /models；继续用最小请求验证实际端点。
      }
    }
    const testProfile: ProviderProfile = { ...profile, maxRetries: 0, maxOutputTokens: Math.min(profile.maxOutputTokens, 1_024) };
    const started = Date.now();
    try {
      const response = await this.#adapter(testProfile, apiKey).request({
        system: 'You are a connection checker. Follow the requested output exactly.',
        user: 'Reply with only: OK',
        maxOutputTokens: testProfile.maxOutputTokens,
        temperature: 0,
        reasoningEffort: profile.reasoningEffort,
      });
      const protocolCorrected = profile.kind === 'kouri' && response.protocolUsed !== profile.protocol;
      if (protocolCorrected) this.settings.saveProfile({ ...profile, protocol: response.protocolUsed });
      return {
        status: 'connected',
        message: response.text === 'OK'
          ? `连接成功，服务返回正常。${profile.kind === 'command-code' ? `当前模型已自动使用 ${response.protocolUsed === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Chat Completions'}。` : ''}${protocolCorrected ? `已把此配置自动修正为 ${response.protocolUsed === 'responses' ? 'Responses' : 'Chat Completions'} 协议。` : ''}${response.reasoningStatus === 'verified' ? `显式思考已验证（${response.reasoningEffortUsed}）。` : response.reasoningStatus === 'default-only' ? '显式思考参数不可用，已验证可使用模型默认推理。' : ''}`
          : `连接成功，服务返回：${response.text.slice(0, 80)}`,
        latencyMs: Date.now() - started,
        protocol: response.protocolUsed,
        model: profile.model,
        reasoningStatus: response.reasoningStatus,
        reasoningEffort: response.reasoningEffortUsed,
      };
    } catch (error) {
      return friendlyError(error);
    }
  }

  async diagnose(profileId: string) {
    const profile = this.settings.getProfile(profileId);
    if (!profile) throw new Error('模型服务配置不存在。');
    let models: readonly string[] = [];
    let modelsError: string | null = null;
    try { models = await this.listModels(profileId); }
    catch (error) { modelsError = error instanceof Error ? error.message : '模型列表读取失败。'; }
    const connection = await this.testConnection(profileId);
    let reasoningProbe: {
      readonly status: 'verified' | 'default-only' | 'skipped' | 'error';
      readonly requestedEffort?: 'high';
      readonly effectiveEffort?: ProviderProfile['reasoningEffort'];
      readonly protocol?: ProviderProfile['protocol'];
      readonly message: string;
    };
    const reasoningApiKey = this.settings.getApiKey(profileId);
    const supportsReasoningProbe = profile.kind === 'kouri';
    if (!supportsReasoningProbe || !reasoningApiKey) {
      reasoningProbe = {
        status: 'skipped',
        message: !reasoningApiKey
          ? '没有保存 API Key。'
          : profile.kind === 'command-code'
            ? 'Command Code 已禁用显式思考参数与能力探测，使用上游模型默认模式。'
            : '只对 Kouri 模型执行显式思考探测。',
      };
    } else {
      try {
        const probeProfile: ProviderProfile = { ...profile, maxRetries: 0, maxOutputTokens: Math.min(profile.maxOutputTokens, 1_024) };
        const response = await this.#adapter(probeProfile, reasoningApiKey).request({
          system: 'You are a reasoning capability checker. Follow the requested output exactly.',
          user: 'Reply with only: OK', maxOutputTokens: probeProfile.maxOutputTokens,
          temperature: 0, reasoningEffort: 'high',
        });
        reasoningProbe = {
          status: response.reasoningStatus ?? 'default-only', requestedEffort: 'high',
          effectiveEffort: response.reasoningEffortUsed ?? 'none', protocol: response.protocolUsed,
          message: response.reasoningStatus === 'verified'
            ? `已验证 high 请求，实际使用 ${response.reasoningEffortUsed}。`
            : '显式思考参数被服务拒绝，只能使用模型默认推理。',
        };
      } catch (error) {
        reasoningProbe = { status: 'error', requestedEffort: 'high', message: error instanceof Error ? error.message : '显式思考上限探测失败。' };
      }
    }
    let jsonOutput: { readonly status: 'valid' | 'invalid' | 'error'; readonly protocol?: ProviderProfile['protocol']; readonly message: string };
    const apiKey = this.settings.getApiKey(profileId);
    if (!apiKey) {
      jsonOutput = { status: 'error', message: '没有保存 API Key。' };
    } else {
      try {
        const testProfile: ProviderProfile = { ...profile, maxRetries: 0, maxOutputTokens: 128, reasoningEffort: 'none' };
        const response = await this.#adapter(testProfile, apiKey).request({
          system: 'Return exactly one valid JSON object and no Markdown.',
          user: 'Return this object: {"status":"OK"}',
          responseFormat: 'json',
          temperature: 0,
          maxOutputTokens: 128,
        });
        const candidate = response.text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
        try {
          JSON.parse(candidate);
          jsonOutput = { status: 'valid', protocol: response.protocolUsed, message: 'JSON 输出可解析。' };
        } catch {
          jsonOutput = { status: 'invalid', protocol: response.protocolUsed, message: '接口请求成功，但模型正文不是有效 JSON。' };
        }
      } catch (error) {
        jsonOutput = { status: 'error', message: error instanceof Error ? error.message : 'JSON 诊断失败。' };
      }
    }
    return {
      profile: {
        profileId: profile.profileId,
        kind: profile.kind,
        baseUrl: profile.baseUrl,
        configuredProtocol: profile.protocol,
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
      },
      models: {
        count: models.length,
        configuredModelPresent: models.includes(profile.model),
        suggestions: closestModelNames(profile.model, models),
        error: modelsError,
      },
      connection,
      reasoningProbe,
      reasoningCapabilities: profile.kind === 'kouri'
        ? this.settings.getProfile(profileId)?.kouriReasoningCapabilities ?? []
        : [],
      jsonOutput,
    };
  }
}
