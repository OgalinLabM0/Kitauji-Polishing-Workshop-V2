import { describe, expect, it } from 'vitest';
import { ProviderRequestError } from '../providers/providerAdapter.cjs';
import { canSplitTruncatedPreReadPiece, decidePreReadRecovery, summarizePreReadCheckpoint } from './preReadRecovery.cjs';

describe('pre-read recovery policy', () => {
  it('retries truncated and malformed model output but not configuration errors', () => {
    expect(decidePreReadRecovery(new ProviderRequestError('truncated-response', '达到输出上限'))).toMatchObject({
      recoverable: true, maxAttempts: 3, category: 'model-output',
    });
    expect(decidePreReadRecovery(new Error('模型没有返回可解析的 JSON 结构。'))).toMatchObject({
      recoverable: true, maxAttempts: 3,
    });
    expect(decidePreReadRecovery(new ProviderRequestError('authentication', '密钥错误'))).toMatchObject({
      recoverable: false, maxAttempts: 1,
    });
  });

  it('allows a second adaptive split below the former 500-character floor', () => {
    expect(canSplitTruncatedPreReadPiece(300)).toBe(true);
    expect(canSplitTruncatedPreReadPiece(220)).toBe(false);
  });

  it('reports the knowledge retained inside a chapter checkpoint', () => {
    expect(summarizePreReadCheckpoint({
      pieceCount: 6,
      nextPieceIndex: 3,
      aggregate: { entities: [{}, {}], glossary: [{}], facts: [{}, {}, {}], events: [{}, {}] },
    })).toEqual({
      completedPieces: 3,
      pieceCount: 6,
      entityCount: 2,
      glossaryCount: 1,
      factCount: 3,
      eventCount: 2,
    });
  });
});
