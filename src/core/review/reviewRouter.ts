import type {
  HumanOnlyReason,
  IndependentReviewVote,
  ReviewRouteDecision,
  TranslationReviewCase,
} from './models';

const confidenceRank = {
  low: 0,
  medium: 1,
  high: 2,
  confirmed: 3,
} as const;

const humanReasonLabel: Record<HumanOnlyReason, string> = {
  'multiple-literary-solutions': '存在多个都忠实但文学效果不同的方案',
  'reader-knowledge-risk': '处理方式可能提前泄露读者尚未知的信息',
  'locked-user-rule-conflict': '候选与用户锁定规则冲突，软件无权自行覆盖',
  'unresolved-model-disagreement': '独立复核仍无法形成一致结论',
  'identity-concealment': '作者正在隐藏身份或性别，显化程度需要人工决定',
};

const decisiveVotes = (votes: readonly IndependentReviewVote[]) =>
  votes.filter((vote) => confidenceRank[vote.confidence] >= confidenceRank.high && vote.decision !== 'uncertain');

/**
 * 复核路由只决定下一站，不直接修改译文。硬性忠实/结构问题不能被任何 Judge 特赦；
 * 人工队列只接收机器无法安全决定的文学选择或用户权力边界。
 */
export function routeTranslationReview(reviewCase: TranslationReviewCase): ReviewRouteDecision {
  if (!reviewCase.deterministicChecksComplete) {
    return {
      disposition: 'blocked',
      reason: '确定性检查没有完整运行，不能交给模型或人工跳过。',
      mustRevalidateAfterRepair: false,
    };
  }

  const explicitHumanIssue = reviewCase.issues.find((issue) => issue.humanOnlyReason !== undefined);
  if (explicitHumanIssue?.humanOnlyReason) {
    return {
      disposition: 'human-required',
      reason: humanReasonLabel[explicitHumanIssue.humanOnlyReason],
      humanReason: explicitHumanIssue.humanOnlyReason,
      mustRevalidateAfterRepair: false,
    };
  }

  const hardIssues = reviewCase.issues.filter((issue) => issue.issueClass === 'hard-rule');
  if (hardIssues.some((issue) => issue.repairMode === 'not-repairable')) {
    return {
      disposition: 'blocked',
      reason: '存在不可自动修复的忠实或结构错误，当前候选不得进入成品。',
      mustRevalidateAfterRepair: false,
    };
  }
  if (hardIssues.length > 0) {
    return {
      disposition: 'auto-repair',
      reason: '硬规则已定位到具体问题，自动修复后必须重新跑完全部硬检查。',
      mustRevalidateAfterRepair: true,
    };
  }

  if (reviewCase.issues.length === 0) {
    return {
      disposition: 'auto-pass',
      reason: '未发现需要处理的问题。',
      mustRevalidateAfterRepair: false,
    };
  }

  const votes = decisiveVotes(reviewCase.independentVotes);
  const passVotes = votes.filter((vote) => vote.decision === 'pass').length;
  const repairVotes = votes.filter((vote) => vote.decision === 'repair').length;

  if (passVotes >= 2 && repairVotes === 0) {
    return {
      disposition: 'auto-pass',
      reason: '两次独立复核均以高置信度确认当前译法。',
      mustRevalidateAfterRepair: false,
    };
  }
  if (repairVotes >= 2 && passVotes === 0) {
    return {
      disposition: 'auto-repair',
      reason: '两次独立复核一致要求修正；修正稿仍须通过硬规则和独立复核。',
      mustRevalidateAfterRepair: true,
    };
  }

  if (reviewCase.adjudicationAttempts < reviewCase.maxAdjudicationAttempts) {
    return {
      disposition: 'specialist-review',
      reason: '现有证据或复核票不足，交给对应专长工位补证据，不占用人工队列。',
      mustRevalidateAfterRepair: false,
    };
  }

  return {
    disposition: 'human-required',
    reason: humanReasonLabel['unresolved-model-disagreement'],
    humanReason: 'unresolved-model-disagreement',
    mustRevalidateAfterRepair: false,
  };
}
