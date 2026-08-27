import type { KouriReasoningCapability, ProviderErrorCode, ProviderProtocol, ReasoningEffort } from './models.cjs';

export const kouriProtocolOrder = (configured: ProviderProtocol): readonly ProviderProtocol[] => (
  configured === 'responses'
    ? ['responses', 'chat-completions']
    : ['chat-completions', 'responses']
);

export const shouldTryAlternateKouriProtocol = (code: ProviderErrorCode) => [
  'bad-request',
  'model-not-found',
  'server',
  'invalid-response',
  'empty-response',
].includes(code);

const effortRank: Readonly<Record<ReasoningEffort, number>> = {
  none: 0, low: 1, medium: 2, high: 3, max: 4,
};

export const kouriReasoningEffortOrder = (
  requested: ReasoningEffort,
  cached?: KouriReasoningCapability | null,
): readonly ('low' | 'medium' | 'high')[] => {
  if (requested === 'none' || cached?.status === 'default-only') return [];
  const normalized = requested === 'max' ? 'high' : requested;
  const cachedEffort = cached?.status === 'verified' && cached.effectiveEffort !== 'none'
    && effortRank[cached.requestedEffort] >= effortRank[normalized]
    ? cached.effectiveEffort
    : normalized;
  const ceiling = Math.min(effortRank[normalized], effortRank[cachedEffort]);
  return (['high', 'medium', 'low'] as const).filter((effort) => effortRank[effort] <= ceiling);
};

export const isKouriReasoningRejection = (code: ProviderErrorCode, status: number | null, message: string) => (
  code === 'bad-request' && [400, 422, null].includes(status) &&
  /reasoning|effort|unsupported|unknown parameter|invalid parameter|不支持|参数|推理/iu.test(message)
);

export const findKouriReasoningCapability = (
  capabilities: readonly KouriReasoningCapability[] | undefined,
  model: string,
  protocol: ProviderProtocol,
) => capabilities?.find((item) => item.model === model && item.protocol === protocol) ?? null;

const tokens = (model: string) => model.toLowerCase().split(/[-_.:/]+/u).filter((token) => token.length > 1);

export const closestModelNames = (configuredModel: string, availableModels: readonly string[], limit = 8) => {
  const configuredList = tokens(configuredModel);
  const configuredTokens = new Set(configuredList);
  const configuredFamily = configuredList[0] ?? '';
  return availableModels
    .map((model) => {
      const modelTokens = tokens(model);
      const shared = modelTokens.filter((token) => configuredTokens.has(token)).length;
      const contains = model.toLowerCase().includes(configuredModel.toLowerCase()) || configuredModel.toLowerCase().includes(model.toLowerCase());
      const sameFamily = Boolean(configuredFamily && modelTokens[0] === configuredFamily);
      return { model, score: shared * 3 + (contains ? 5 : 0), sameFamily };
    })
    .filter((item) => item.sameFamily || item.score >= 5)
    .sort((left, right) => right.score - left.score || left.model.localeCompare(right.model))
    .slice(0, limit)
    .map((item) => item.model);
};
