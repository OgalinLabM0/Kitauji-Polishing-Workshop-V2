import type {
  GlossaryEntry,
  GlossaryReferentKind,
  GlossaryWordplayHypothesis,
} from './models';

const genderCapableReferents = new Set<GlossaryReferentKind>(['person', 'animal']);

export interface EntityProfileFinding {
  readonly code:
    | 'NON_APPLICABLE_GENDER_REQUIRED'
    | 'GENDER_CAPABLE_REFERENT_CANNOT_BE_NOT_APPLICABLE'
    | 'GENDER_EVIDENCE_REQUIRED'
    | 'GENDER_CONFIDENCE_TOO_LOW';
  readonly message: string;
}

export function validateGlossaryEntityProfile(entry: GlossaryEntry): readonly EntityProfileFinding[] {
  const findings: EntityProfileFinding[] = [];
  const canHaveGender = genderCapableReferents.has(entry.referentKind);

  if (!canHaveGender && entry.gender.value !== 'not-applicable') {
    findings.push({
      code: 'NON_APPLICABLE_GENDER_REQUIRED',
      message: '地点、组织、活动、物品和概念不应被推断人物性别。',
    });
  }
  if (canHaveGender && entry.gender.value === 'not-applicable') {
    findings.push({
      code: 'GENDER_CAPABLE_REFERENT_CANNOT_BE_NOT_APPLICABLE',
      message: '人物或动物应记录已知性别或“未知”，不能写成不适用。',
    });
  }
  if (
    canHaveGender
    && !['unknown', 'not-applicable'].includes(entry.gender.value)
    && entry.gender.evidenceIds.length === 0
  ) {
    findings.push({
      code: 'GENDER_EVIDENCE_REQUIRED',
      message: '姓名、立绘印象或刻板印象不能单独作为性别结论；必须引用全书原文证据。',
    });
  }
  if (
    canHaveGender
    && !['unknown', 'not-applicable'].includes(entry.gender.value)
    && !['high', 'confirmed'].includes(entry.gender.confidence)
  ) {
    findings.push({
      code: 'GENDER_CONFIDENCE_TOO_LOW',
      message: '低置信度性别推断只能保留为候选，不能成为人物事实。',
    });
  }

  return findings;
}

export type WordplayRoute = 'auto-accept' | 'specialist-review' | 'human-required' | 'blocked';

export interface WordplayAssessment {
  readonly route: WordplayRoute;
  readonly reason: string;
}

/**
 * 姓名谐音不是靠首次出现猜测。预读工位先建立读音与剧情线索假设，再由独立工位检查
 * 触发台词、后续回收和反证。只有中文存在多个文学效果不同的落地方案时才强制人工。
 */
export function assessWordplayHypothesis(hypothesis: GlossaryWordplayHypothesis): WordplayAssessment {
  if (
    hypothesis.sourceForm.trim() === ''
    || hypothesis.heardOrAlternateForm.trim() === ''
    || hypothesis.evidenceIds.length < 2
  ) {
    return {
      route: 'specialist-review',
      reason: '读音联系或跨段落证据不足，继续由谐音工位检索全书，不提交人工。',
    };
  }
  if (hypothesis.proposedChineseRenderings.length === 0) {
    return {
      route: 'blocked',
      reason: '已识别谐音但没有可执行的中文方案，不能在翻译中静默丢失。',
    };
  }
  if (hypothesis.readerKnowledgeStatus !== 'safe') {
    return {
      route: 'human-required',
      reason: '处理方式可能提前泄露后文回收或角色关系，需要人工确定显化程度。',
    };
  }
  if (hypothesis.proposedChineseRenderings.length > 1) {
    return {
      route: 'human-required',
      reason: '模型已定位谐音，但存在多个都忠实且阅读效果不同的中文方案。',
    };
  }
  return {
    route: 'auto-accept',
    reason: '读音、触发台词和后续回收相互印证，且只有一个安全的中文方案。',
  };
}
