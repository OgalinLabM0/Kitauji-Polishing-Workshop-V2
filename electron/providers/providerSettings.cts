import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ProviderKind,
  KouriReasoningCapability,
  ProviderProfile,
  ProviderProfileSummary,
  ProviderProtocol,
  ProviderSettingsSnapshot,
  ReasoningEffort,
  SaveProviderProfileInput,
} from './models.cjs';
import { normalizeProviderBaseUrl } from './urlPolicy.cjs';
import { COMMAND_CODE_BASE_URL, normalizeCommandCodeBaseUrl } from './commandCodeCompatibility.cjs';

interface EncryptionProvider {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface PersistedProviderSettings {
  readonly version: 5;
  readonly activeProfileId: string;
  readonly profiles: readonly ProviderProfile[];
}

interface PersistedProviderSecrets {
  readonly version: 1;
  readonly keys: Readonly<Record<string, string>>;
}

const SETTINGS_FILE = 'provider-settings.json';
const SECRETS_FILE = 'provider-secrets.bin';

const defaultProfiles = (): readonly ProviderProfile[] => [
  {
    profileId: 'deepseek-official', name: 'DeepSeek 官方', kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com', protocol: 'chat-completions', model: 'deepseek-v4-flash',
    reviewModel: 'deepseek-v4-flash', preReadModel: 'deepseek-v4-flash', agentModel: 'deepseek-v4-flash',
    temperature: 0.1, batchSize: 8, concurrency: 2, timeoutSeconds: 300, maxRetries: 3, maxOutputTokens: 8_192,
    reasoningEffort: 'high', agentReasoningEffort: 'low',
    zeroDataRetention: false,
    customInstructions: '',
  },
  {
    profileId: 'kouri-openai', name: 'Kouri API', kind: 'kouri',
    baseUrl: 'https://api.kourichat.com/v1', protocol: 'chat-completions', model: 'deepseek-v4-flash',
    reviewModel: 'deepseek-v4-flash', preReadModel: 'deepseek-v4-flash', agentModel: 'deepseek-v4-flash',
    temperature: 0.1, batchSize: 8, concurrency: 2, timeoutSeconds: 600, maxRetries: 3, maxOutputTokens: 8_192,
    reasoningEffort: 'high', agentReasoningEffort: 'high',
    zeroDataRetention: false,
    customInstructions: '',
  },
  {
    profileId: 'command-code-goat', name: 'Command Code GOAT', kind: 'command-code',
    baseUrl: COMMAND_CODE_BASE_URL, protocol: 'chat-completions', model: 'deepseek/deepseek-v4-flash',
    reviewModel: 'deepseek/deepseek-v4-flash', preReadModel: 'deepseek/deepseek-v4-flash', agentModel: 'deepseek/deepseek-v4-flash',
    temperature: 0.1, batchSize: 8, concurrency: 2, timeoutSeconds: 600, maxRetries: 3, maxOutputTokens: 18_432,
    reasoningEffort: 'none', agentReasoningEffort: 'none',
    zeroDataRetention: false,
    customInstructions: '',
  },
];

const defaultSettings = (): PersistedProviderSettings => ({
  version: 5,
  activeProfileId: 'deepseek-official',
  profiles: defaultProfiles(),
});

const isKind = (value: unknown): value is ProviderKind => ['deepseek', 'kouri', 'command-code', 'openai-compatible'].includes(String(value));
const isProtocol = (value: unknown): value is ProviderProtocol => ['chat-completions', 'responses', 'anthropic-messages'].includes(String(value));
const isReasoning = (value: unknown): value is ReasoningEffort => ['none', 'low', 'medium', 'high', 'max'].includes(String(value));
const isReasoningStatus = (value: unknown) => value === 'verified' || value === 'default-only';
const validText = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
const validInteger = (value: unknown, minimum: number, maximum: number) => Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
const validNumber = (value: unknown, minimum: number, maximum: number) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

export const validateProviderProfile = (input: SaveProviderProfileInput): ProviderProfile => {
  if (!validText(input.profileId, 80) || !/^[a-z0-9][a-z0-9_-]*$/iu.test(input.profileId)) throw new Error('配置标识只能使用字母、数字、连字符和下划线。');
  if (!validText(input.name, 80)) throw new Error('配置名称不能为空或过长。');
  if (!isKind(input.kind) || !isProtocol(input.protocol) || !isReasoning(input.reasoningEffort)) throw new Error('接口类型或推理设置无效。');
  if (input.protocol === 'anthropic-messages' && input.kind !== 'command-code') throw new Error('Anthropic Messages 目前只由 Command Code 自动分流使用。');
  if (!validText(input.model, 160) || !validText(input.reviewModel, 160) || !validText(input.preReadModel, 160)) throw new Error('模型名称不能为空或过长。');
  if (!validNumber(input.temperature, 0, 2)) throw new Error('温度必须在 0–2 之间。');
  if (!validInteger(input.batchSize, 1, 40) || !validInteger(input.concurrency, 1, 16)) throw new Error('批量大小或并发数超出允许范围。');
  if (!validInteger(input.timeoutSeconds, 15, 1_800) || !validInteger(input.maxRetries, 0, 8)) throw new Error('超时或重试次数超出允许范围。');
  if (!validInteger(input.maxOutputTokens, 128, 393_216)) throw new Error('最大输出 Token 超出允许范围。');
  const normalizedBaseUrl = normalizeProviderBaseUrl(input.baseUrl);
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  const baseUrl = input.kind === 'command-code'
    ? normalizeCommandCodeBaseUrl(normalizedBaseUrl)
    : input.kind === 'kouri' && parsedBaseUrl.hostname.toLowerCase() === 'api.kourichat.com' && ['', '/'].includes(parsedBaseUrl.pathname)
      ? `${normalizedBaseUrl}/v1`
      : normalizedBaseUrl;
  const protocol: ProviderProtocol = input.kind === 'command-code' ? 'chat-completions' : input.protocol;
  const agentModel = typeof input.agentModel === 'string' && input.agentModel.trim() ? input.agentModel.trim() : input.reviewModel.trim();
  const reasoningEffort = input.kind === 'command-code' ? 'none' : input.reasoningEffort;
  const agentReasoningEffort = input.kind === 'command-code'
    ? 'none'
    : isReasoning(input.agentReasoningEffort) ? input.agentReasoningEffort : 'low';
  const kouriReasoningCapabilities = Array.isArray(input.kouriReasoningCapabilities)
    ? input.kouriReasoningCapabilities.flatMap((item): KouriReasoningCapability[] => {
        if (!item || !validText(item.model, 160) || !isProtocol(item.protocol) || item.protocol === 'anthropic-messages' || !isReasoningStatus(item.status)
          || !isReasoning(item.requestedEffort) || !isReasoning(item.effectiveEffort)
          || !validText(item.checkedAt, 80) || typeof item.message !== 'string') return [];
        return [{
          model: item.model.trim(), protocol: item.protocol, status: item.status,
          requestedEffort: item.requestedEffort, effectiveEffort: item.effectiveEffort,
          checkedAt: item.checkedAt, message: item.message.slice(0, 500),
        }];
      }).slice(-100)
    : [];
  return {
    profileId: input.profileId.trim(), name: input.name.trim(), kind: input.kind,
    baseUrl, protocol,
    model: input.model.trim(), reviewModel: input.reviewModel.trim(), preReadModel: input.preReadModel.trim(),
    agentModel,
    temperature: input.temperature, batchSize: input.batchSize, concurrency: input.concurrency,
    timeoutSeconds: input.timeoutSeconds, maxRetries: input.maxRetries,
    maxOutputTokens: input.maxOutputTokens, reasoningEffort,
    agentReasoningEffort,
    kouriReasoningCapabilities,
    zeroDataRetention: Boolean(input.zeroDataRetention),
    customInstructions: typeof input.customInstructions === 'string' ? input.customInstructions.slice(0, 20_000) : '',
  };
};

const parseSettings = (text: string): PersistedProviderSettings => {
  const value = JSON.parse(text) as {
    readonly version?: unknown;
    readonly activeProfileId?: unknown;
    readonly profiles?: readonly ProviderProfile[];
  };
  const storedVersion = Number(value?.version);
  if (!value || ![1, 2, 3, 4, 5].includes(storedVersion) || !Array.isArray(value.profiles) || value.profiles.length === 0) throw new Error('模型服务设置版本无效。');
  const profiles = value.profiles.map((profile) => validateProviderProfile(profile));
  if (storedVersion === 1 && !profiles.some((profile) => profile.kind === 'command-code')) {
    profiles.push(validateProviderProfile(defaultProfiles().find((profile) => profile.kind === 'command-code')!));
  }
  if (storedVersion < 4) {
    const commandCodeIndex = profiles.findIndex((profile) => profile.profileId === 'command-code-goat' && profile.kind === 'command-code');
    const commandCode = profiles[commandCodeIndex];
    if (commandCodeIndex >= 0 && commandCode?.maxOutputTokens === 8_192) {
      profiles[commandCodeIndex] = { ...commandCode, maxOutputTokens: 18_432 };
    }
  }
  const activeProfileId = profiles.some((profile) => profile.profileId === value.activeProfileId)
    ? String(value.activeProfileId)
    : profiles[0].profileId;
  return { version: 5, activeProfileId, profiles };
};

const apiKeyHint = (key: string | undefined) => key ? `••••${key.slice(-4)}` : null;

export class ProviderSettingsStore {
  readonly #settingsPath: string;
  readonly #secretsPath: string;
  readonly #encryption: EncryptionProvider;
  #settings: PersistedProviderSettings;
  #keys: Record<string, string> = {};

  constructor(userDataDirectory: string, encryption: EncryptionProvider) {
    mkdirSync(userDataDirectory, { recursive: true });
    this.#settingsPath = path.join(userDataDirectory, SETTINGS_FILE);
    this.#secretsPath = path.join(userDataDirectory, SECRETS_FILE);
    for (const filePath of [this.#settingsPath, this.#secretsPath]) {
      const backupPath = `${filePath}.bak`;
      if (!existsSync(filePath) && existsSync(backupPath)) renameSync(backupPath, filePath);
    }
    this.#encryption = encryption;
    let rewriteMigratedSettings = false;
    try {
      if (existsSync(this.#settingsPath)) {
        const storedText = readFileSync(this.#settingsPath, 'utf8');
        this.#settings = parseSettings(storedText);
        rewriteMigratedSettings = Number((JSON.parse(storedText) as { version?: unknown }).version) !== 5;
      } else {
        this.#settings = defaultSettings();
      }
    } catch {
      this.#settings = defaultSettings();
    }
    this.#loadKeys();
    if (rewriteMigratedSettings) {
      try { this.#saveSettings(); } catch { /* in-memory migrated settings remain usable */ }
    }
  }

  #loadKeys() {
    if (!existsSync(this.#secretsPath) || !this.#encryption.isEncryptionAvailable()) return;
    try {
      const text = this.#encryption.decryptString(readFileSync(this.#secretsPath));
      const value = JSON.parse(text) as PersistedProviderSecrets;
      if (value?.version !== 1 || !value.keys || typeof value.keys !== 'object') return;
      this.#keys = Object.fromEntries(Object.entries(value.keys).filter(([id, key]) => validText(id, 80) && validText(key, 8_192)));
    } catch {
      this.#keys = {};
    }
  }

  #atomicWrite(filePath: string, data: string | Buffer) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const backupPath = `${filePath}.bak`;
    writeFileSync(temporaryPath, data, { flag: 'wx' });
    rmSync(backupPath, { force: true });
    if (existsSync(filePath)) renameSync(filePath, backupPath);
    try {
      renameSync(temporaryPath, filePath);
      rmSync(backupPath, { force: true });
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      if (!existsSync(filePath) && existsSync(backupPath)) renameSync(backupPath, filePath);
      throw error;
    }
  }

  #saveSettings() {
    this.#atomicWrite(this.#settingsPath, `${JSON.stringify(this.#settings, null, 2)}\n`);
  }

  #saveKeys() {
    if (!this.#encryption.isEncryptionAvailable()) throw new Error('当前系统无法提供安全密钥加密，已拒绝保存 API Key。');
    const encrypted = this.#encryption.encryptString(JSON.stringify({ version: 1, keys: this.#keys } satisfies PersistedProviderSecrets));
    this.#atomicWrite(this.#secretsPath, encrypted);
  }

  get encryptionAvailable() { return this.#encryption.isEncryptionAvailable(); }

  snapshot(): ProviderSettingsSnapshot {
    const profiles: ProviderProfileSummary[] = this.#settings.profiles.map((profile) => ({
      ...profile,
      hasApiKey: Boolean(this.#keys[profile.profileId]),
      apiKeyHint: apiKeyHint(this.#keys[profile.profileId]),
    }));
    return { profiles, activeProfileId: this.#settings.activeProfileId, encryptionAvailable: this.encryptionAvailable };
  }

  getProfile(profileId: string) {
    return this.#settings.profiles.find((profile) => profile.profileId === profileId) ?? null;
  }

  getApiKey(profileId: string) { return this.#keys[profileId] ?? null; }

  getKouriReasoningCapability(profileId: string, model: string, protocol: ProviderProtocol) {
    const profile = this.getProfile(profileId);
    return profile?.kouriReasoningCapabilities?.find((item) => item.model === model && item.protocol === protocol) ?? null;
  }

  saveKouriReasoningCapability(profileId: string, capability: KouriReasoningCapability) {
    const profile = this.getProfile(profileId);
    if (!profile || profile.kind !== 'kouri') return;
    const capabilities = [...(profile.kouriReasoningCapabilities ?? [])
      .filter((item) => !(item.model === capability.model && item.protocol === capability.protocol)), capability].slice(-100);
    const profiles = this.#settings.profiles.map((item) => item.profileId === profileId
      ? { ...item, kouriReasoningCapabilities: capabilities }
      : item);
    this.#settings = { ...this.#settings, profiles };
    this.#saveSettings();
  }

  saveProfile(input: SaveProviderProfileInput) {
    const existing = this.#settings.profiles.find((item) => item.profileId === input.profileId);
    const profile = validateProviderProfile({
      ...input,
      kouriReasoningCapabilities: input.kouriReasoningCapabilities
        ?? (existing?.baseUrl === normalizeProviderBaseUrl(input.baseUrl) ? existing.kouriReasoningCapabilities : []),
    });
    const existingIndex = this.#settings.profiles.findIndex((item) => item.profileId === profile.profileId);
    const profiles = [...this.#settings.profiles];
    if (existingIndex >= 0) profiles[existingIndex] = profile;
    else profiles.push(profile);
    this.#settings = { ...this.#settings, profiles };
    this.#saveSettings();
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      this.#keys[profile.profileId] = input.apiKey.trim();
      this.#saveKeys();
    }
    return this.snapshot();
  }

  setActive(profileId: string) {
    if (!this.getProfile(profileId)) throw new Error('要启用的模型服务不存在。');
    this.#settings = { ...this.#settings, activeProfileId: profileId };
    this.#saveSettings();
    return this.snapshot();
  }

  clearApiKey(profileId: string) {
    if (!this.getProfile(profileId)) throw new Error('模型服务不存在。');
    delete this.#keys[profileId];
    if (existsSync(this.#secretsPath) || Object.keys(this.#keys).length > 0) this.#saveKeys();
    return this.snapshot();
  }

  deleteProfile(profileId: string) {
    if (this.#settings.profiles.length <= 1) throw new Error('至少保留一个模型服务配置。');
    const profiles = this.#settings.profiles.filter((profile) => profile.profileId !== profileId);
    if (profiles.length === this.#settings.profiles.length) throw new Error('模型服务不存在。');
    this.#settings = {
      version: 5,
      profiles,
      activeProfileId: this.#settings.activeProfileId === profileId ? profiles[0].profileId : this.#settings.activeProfileId,
    };
    delete this.#keys[profileId];
    this.#saveSettings();
    if (existsSync(this.#secretsPath)) this.#saveKeys();
    return this.snapshot();
  }
}

export const providerSettingsConstantsForTest = { SETTINGS_FILE, SECRETS_FILE, defaultProfiles } as const;
