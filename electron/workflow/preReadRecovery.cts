import { ProviderRequestError } from '../providers/providerAdapter.cjs';

export interface PreReadCheckpointSummary {
  readonly completedPieces: number;
  readonly pieceCount: number;
  readonly entityCount: number;
  readonly glossaryCount: number;
  readonly factCount: number;
  readonly eventCount: number;
}

export interface PreReadRecoveryDecision {
  readonly recoverable: boolean;
  readonly maxAttempts: number;
  readonly category: 'transport' | 'model-output' | 'non-recoverable';
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const arrayLength = (value: unknown) => Array.isArray(value) ? value.length : 0;

export const summarizePreReadCheckpoint = (value: unknown): PreReadCheckpointSummary | null => {
  const root = asRecord(value);
  const aggregate = asRecord(root?.aggregate);
  if (!root || !aggregate) return null;
  const pieceCount = Math.max(0, Math.floor(Number(root.pieceCount) || 0));
  const completedPieces = Math.max(0, Math.min(pieceCount, Math.floor(Number(root.nextPieceIndex) || 0)));
  return {
    completedPieces,
    pieceCount,
    entityCount: arrayLength(aggregate.entities),
    glossaryCount: arrayLength(aggregate.glossary),
    factCount: arrayLength(aggregate.facts),
    eventCount: arrayLength(aggregate.events),
  };
};

const recoverableProviderCodes = new Set([
  'rate-limit',
  'server',
  'network',
  'timeout',
  'empty-response',
  'invalid-response',
  'truncated-response',
]);

const modelOutputFailure = /(JSON|可解析|预读结果|实体修复结果|实体覆盖仍不完整|引用缺口|返回.*不完整)/i;

export const decidePreReadRecovery = (error: unknown): PreReadRecoveryDecision => {
  if (error instanceof ProviderRequestError) {
    if (!recoverableProviderCodes.has(error.code)) {
      return { recoverable: false, maxAttempts: 1, category: 'non-recoverable' };
    }
    const modelOutput = ['invalid-response', 'truncated-response', 'empty-response'].includes(error.code);
    return {
      recoverable: true,
      maxAttempts: modelOutput ? 3 : 2,
      category: modelOutput ? 'model-output' : 'transport',
    };
  }
  if (error instanceof Error && modelOutputFailure.test(error.message)) {
    return { recoverable: true, maxAttempts: 3, category: 'model-output' };
  }
  return { recoverable: false, maxAttempts: 1, category: 'non-recoverable' };
};

export const canSplitTruncatedPreReadPiece = (length: number) => length > 220;
