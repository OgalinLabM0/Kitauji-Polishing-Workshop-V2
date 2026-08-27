export type ToneFidelityAxis =
  | 'detail'
  | 'explicitness'
  | 'vulgarity'
  | 'aggression'
  | 'offensiveness'
  | 'taboo-directness'
  | 'emotional-intensity';

export type ToneLevel = 0 | 1 | 2 | 3 | 4 | 'unknown';

export interface ToneAxisAssessment {
  readonly axis: ToneFidelityAxis;
  readonly sourceLevel: ToneLevel;
  readonly translationLevel: ToneLevel;
  readonly sourceEvidenceIds: readonly string[];
  readonly note?: string;
}

export type ToneFidelityFindingCode =
  | 'TONE_WEAKENED'
  | 'TONE_INTENSIFIED'
  | 'TONE_ASSESSMENT_MISSING'
  | 'TONE_ASSESSMENT_UNKNOWN'
  | 'TONE_EVIDENCE_MISSING';

export interface ToneFidelityFinding {
  readonly axis: ToneFidelityAxis;
  readonly code: ToneFidelityFindingCode;
  readonly blocksExport: true;
}

export interface ContentToneFidelityPolicy {
  readonly preserveSourceDetail: true;
  readonly preserveSourceIntensity: true;
  readonly forbidSanitization: true;
  readonly forbidEuphemization: true;
  readonly forbidBeautification: true;
  readonly forbidAvoidance: true;
  readonly forbidUnjustifiedIntensification: true;
  readonly auditedAxes: readonly ToneFidelityAxis[];
}

const AUDITED_TONE_AXES = Object.freeze([
  'detail',
  'explicitness',
  'vulgarity',
  'aggression',
  'offensiveness',
  'taboo-directness',
  'emotional-intensity',
] satisfies ToneFidelityAxis[]);

export const CONTENT_TONE_FIDELITY_POLICY: ContentToneFidelityPolicy = Object.freeze({
  preserveSourceDetail: true,
  preserveSourceIntensity: true,
  forbidSanitization: true,
  forbidEuphemization: true,
  forbidBeautification: true,
  forbidAvoidance: true,
  forbidUnjustifiedIntensification: true,
  auditedAxes: AUDITED_TONE_AXES,
});

export const CONTENT_TONE_FIDELITY_PROMPT_CONTRACT = `
【最高规则：内容尺度与语气忠实】
1. 原作中的细节、粗俗、激烈、露骨、冒犯、禁忌或令人不适的表达，必须以中文等值保留。
2. 不得因为内容“不雅”“过激”或可能令人不适而净化、弱化、美化、委婉化、概括、回避或善意改写。
3. 不得反向添油加醋，不得把原文写得更粗俗、更露骨、更激烈或更冒犯；尺度和力度仍以当前日文原文为唯一边界。
4. 可以为自然中文调整语序和表达，但不能改变细节数量、情绪强度、措辞层级、角色态度或叙述距离。
`.trim();

/**
 * 比较已经由模型或人工标注的尺度等级。它不是关键词过滤器，也不会假装能仅靠
 * 字符串规则判断文学语气；未知等级或缺少原文证据都必须进入阻断式复核。
 */
export function auditContentToneFidelity(
  assessments: readonly ToneAxisAssessment[],
): readonly ToneFidelityFinding[] {
  const findings: ToneFidelityFinding[] = [];
  const assessmentByAxis = new Map(assessments.map((assessment) => [assessment.axis, assessment]));

  for (const axis of CONTENT_TONE_FIDELITY_POLICY.auditedAxes) {
    const assessment = assessmentByAxis.get(axis);
    if (assessment === undefined) {
      findings.push({
        axis,
        code: 'TONE_ASSESSMENT_MISSING',
        blocksExport: true,
      });
      continue;
    }
    if (assessment.sourceEvidenceIds.length === 0) {
      findings.push({
        axis: assessment.axis,
        code: 'TONE_EVIDENCE_MISSING',
        blocksExport: true,
      });
      continue;
    }

    if (assessment.sourceLevel === 'unknown' || assessment.translationLevel === 'unknown') {
      findings.push({
        axis: assessment.axis,
        code: 'TONE_ASSESSMENT_UNKNOWN',
        blocksExport: true,
      });
      continue;
    }

    if (assessment.translationLevel < assessment.sourceLevel) {
      findings.push({
        axis: assessment.axis,
        code: 'TONE_WEAKENED',
        blocksExport: true,
      });
    } else if (assessment.translationLevel > assessment.sourceLevel) {
      findings.push({
        axis: assessment.axis,
        code: 'TONE_INTENSIFIED',
        blocksExport: true,
      });
    }
  }

  return findings;
}
