export type ProviderKind = 'deepseek' | 'kouri' | 'command-code' | 'openai-compatible';
export type ProviderProtocol = 'chat-completions' | 'responses' | 'anthropic-messages';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max';
export type KouriReasoningStatus = 'verified' | 'default-only';

export interface KouriReasoningCapability {
  readonly model: string;
  readonly protocol: ProviderProtocol;
  readonly status: KouriReasoningStatus;
  readonly requestedEffort: ReasoningEffort;
  readonly effectiveEffort: ReasoningEffort;
  readonly checkedAt: string;
  readonly message: string;
}

export interface ProviderProfile {
  readonly profileId: string;
  readonly name: string;
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  readonly protocol: ProviderProtocol;
  readonly model: string;
  readonly reviewModel: string;
  readonly preReadModel: string;
  readonly agentModel?: string;
  readonly temperature: number;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly timeoutSeconds: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
  readonly reasoningEffort: ReasoningEffort;
  readonly agentReasoningEffort?: ReasoningEffort;
  readonly kouriReasoningCapabilities?: readonly KouriReasoningCapability[];
  readonly zeroDataRetention?: boolean;
  readonly customInstructions: string;
}

export interface ProviderProfileSummary extends ProviderProfile {
  readonly hasApiKey: boolean;
  readonly apiKeyHint: string | null;
}

export interface ProviderSettingsSnapshot {
  readonly profiles: readonly ProviderProfileSummary[];
  readonly activeProfileId: string;
  readonly encryptionAvailable: boolean;
}

export interface SaveProviderProfileInput extends ProviderProfile { readonly apiKey?: string; }

export interface ProviderConnectionResult {
  readonly status: 'connected' | 'error';
  readonly message: string;
  readonly latencyMs?: number;
  readonly protocol?: ProviderProtocol;
  readonly model?: string;
  readonly reasoningStatus?: KouriReasoningStatus;
  readonly reasoningEffort?: ReasoningEffort;
  readonly errorCode?: string;
}

export type ProviderOperationResult<T> = { readonly status: 'ok'; readonly data: T } | { readonly status: 'error'; readonly message: string };

export interface ProviderDesktopApi {
  readonly get: () => Promise<ProviderSettingsSnapshot>;
  readonly save: (input: SaveProviderProfileInput) => Promise<ProviderOperationResult<ProviderSettingsSnapshot>>;
  readonly setActive: (profileId: string) => Promise<ProviderOperationResult<ProviderSettingsSnapshot>>;
  readonly clearApiKey: (profileId: string) => Promise<ProviderOperationResult<ProviderSettingsSnapshot>>;
  readonly delete: (profileId: string) => Promise<ProviderOperationResult<ProviderSettingsSnapshot>>;
  readonly listModels: (profileId: string) => Promise<ProviderOperationResult<readonly string[]>>;
  readonly test: (profileId: string) => Promise<ProviderConnectionResult>;
}
