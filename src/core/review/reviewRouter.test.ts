import { describe, expect, it } from 'vitest';
import type { TranslationReviewCase } from './models';
import { routeTranslationReview } from './reviewRouter';

const baseCase = (override: Partial<TranslationReviewCase> = {}): TranslationReviewCase => ({
  caseId: 'case-1',
  deterministicChecksComplete: true,
  issues: [],
  independentVotes: [],
  adjudicationAttempts: 0,
  maxAdjudicationAttempts: 2,
  ...override,
});

describe('routeTranslationReview', () => {
  it('自动通过没有问题的候选', () => {
    expect(routeTranslationReview(baseCase()).disposition).toBe('auto-pass');
  });

  it('硬规则问题自动修复且必须重新校验，不允许 Judge 特赦', () => {
    const result = routeTranslationReview(baseCase({
      issues: [{
        issueId: 'i-1',
        category: 'source-fidelity',
        issueClass: 'hard-rule',
        repairMode: 'model-assisted',
        message: '漏译',
        evidenceIds: ['p-1'],
      }],
    }));
    expect(result.disposition).toBe('auto-repair');
    expect(result.mustRevalidateAfterRepair).toBe(true);
  });

  it('不可修复的结构错误直接阻断而不是扔给人工放行', () => {
    const result = routeTranslationReview(baseCase({
      issues: [{
        issueId: 'i-2',
        category: 'structure',
        issueClass: 'hard-rule',
        repairMode: 'not-repairable',
        message: '源节点无法对应',
        evidenceIds: ['node-1'],
      }],
    }));
    expect(result.disposition).toBe('blocked');
  });

  it('两个高置信独立复核一致时自动处理语义问题', () => {
    const result = routeTranslationReview(baseCase({
      issues: [{
        issueId: 'i-3',
        category: 'terminology',
        issueClass: 'semantic',
        repairMode: 'model-assisted',
        message: '多义词',
        evidenceIds: ['p-2'],
      }],
      independentVotes: [
        { reviewerId: 'semantic-a', decision: 'pass', confidence: 'high', evidenceIds: ['p-2'] },
        { reviewerId: 'semantic-b', decision: 'pass', confidence: 'confirmed', evidenceIds: ['p-2'] },
      ],
    }));
    expect(result.disposition).toBe('auto-pass');
  });

  it('有多个文学可行方案时才要求人工选择', () => {
    const result = routeTranslationReview(baseCase({
      issues: [{
        issueId: 'i-4',
        category: 'wordplay',
        issueClass: 'creative',
        repairMode: 'model-assisted',
        message: '姓名谐音有两种保留方式',
        evidenceIds: ['p-3', 'p-4'],
        humanOnlyReason: 'multiple-literary-solutions',
      }],
    }));
    expect(result.disposition).toBe('human-required');
    expect(result.humanReason).toBe('multiple-literary-solutions');
  });

  it('独立复核分歧先继续专长复核，耗尽后才进人工队列', () => {
    const conflicted = baseCase({
      issues: [{
        issueId: 'i-5',
        category: 'narrative-context',
        issueClass: 'semantic',
        repairMode: 'model-assisted',
        message: '指代分歧',
        evidenceIds: ['p-5'],
      }],
      independentVotes: [
        { reviewerId: 'context-a', decision: 'pass', confidence: 'high', evidenceIds: ['p-5'] },
        { reviewerId: 'context-b', decision: 'repair', confidence: 'high', evidenceIds: ['p-5'] },
      ],
    });
    expect(routeTranslationReview(conflicted).disposition).toBe('specialist-review');
    expect(routeTranslationReview({ ...conflicted, adjudicationAttempts: 2 }).disposition).toBe('human-required');
  });
});
