export type ReviewIssueCategory =
  | 'source-fidelity'
  | 'structure'
  | 'formatting'
  | 'terminology'
  | 'pronoun'
  | 'plurality'
  | 'character-voice'
  | 'narrative-context'
  | 'wordplay';

export type ReviewIssueClass = 'hard-rule' | 'semantic' | 'creative';
export type ReviewRepairMode = 'deterministic' | 'model-assisted' | 'not-repairable';

export type HumanOnlyReason =
  | 'multiple-literary-solutions'
  | 'reader-knowledge-risk'
  | 'locked-user-rule-conflict'
  | 'unresolved-model-disagreement'
  | 'identity-concealment';

export interface ReviewIssue {
  readonly issueId: string;
  readonly category: ReviewIssueCategory;
  readonly issueClass: ReviewIssueClass;
  readonly repairMode: ReviewRepairMode;
  readonly message: string;
  readonly evidenceIds: readonly string[];
  readonly humanOnlyReason?: HumanOnlyReason;
}

export interface IndependentReviewVote {
  readonly reviewerId: string;
  readonly decision: 'pass' | 'repair' | 'uncertain';
  readonly confidence: 'low' | 'medium' | 'high' | 'confirmed';
  readonly evidenceIds: readonly string[];
}

export interface TranslationReviewCase {
  readonly caseId: string;
  readonly deterministicChecksComplete: boolean;
  readonly issues: readonly ReviewIssue[];
  readonly independentVotes: readonly IndependentReviewVote[];
  readonly adjudicationAttempts: number;
  readonly maxAdjudicationAttempts: number;
}

export type ReviewDisposition =
  | 'auto-pass'
  | 'auto-repair'
  | 'specialist-review'
  | 'human-required'
  | 'blocked';

export interface ReviewRouteDecision {
  readonly disposition: ReviewDisposition;
  readonly reason: string;
  readonly humanReason?: HumanOnlyReason;
  readonly mustRevalidateAfterRepair: boolean;
}
