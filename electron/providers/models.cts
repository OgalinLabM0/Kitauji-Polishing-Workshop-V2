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

export interface SaveProviderProfileInput extends ProviderProfile {
  readonly apiKey?: string;
}

export interface ModelRequest {
  readonly model?: string;
  readonly system: string;
  readonly user: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly responseFormat?: 'text' | 'json';
  readonly onProgress?: (event: ModelRequestProgressEvent) => void;
  readonly signal?: AbortSignal;
}

export interface ModelRequestProgressEvent {
  readonly kind: 'retry' | 'compatibility-fallback';
  readonly message: string;
  readonly code?: ProviderErrorCode;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
}

export interface ModelResponse {
  readonly text: string;
  readonly finishReason: string | null;
  readonly responseId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly rawStatus: string | null;
  readonly protocolUsed: ProviderProtocol;
  readonly reasoningStatus?: KouriReasoningStatus;
  readonly reasoningEffortUsed?: ReasoningEffort;
}

export type ProviderErrorCode =
  | 'authentication'
  | 'permission'
  | 'rate-limit'
  | 'bad-request'
  | 'model-not-found'
  | 'timeout'
  | 'network'
  | 'server'
  | 'empty-response'
  | 'truncated-response'
  | 'invalid-response'
  | 'cancelled';

export interface ProviderConnectionResult {
  readonly status: 'connected' | 'error';
  readonly message: string;
  readonly latencyMs?: number;
  readonly protocol?: ProviderProtocol;
  readonly model?: string;
  readonly reasoningStatus?: KouriReasoningStatus;
  readonly reasoningEffort?: ReasoningEffort;
  readonly errorCode?: ProviderErrorCode;
}
