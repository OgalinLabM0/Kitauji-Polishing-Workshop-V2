import type {
  AnnotationExportDecision,
  EpubAnnotationDraft,
  GlossaryEntry,
  GlossaryResolution,
  GlossaryResolutionContext,
  GlossaryReviewStatus,
  GlossaryVariant,
  GlossaryVariantScope,
} from './models';

const APPLICABLE_STATUSES: ReadonlySet<GlossaryReviewStatus> = new Set(['approved', 'locked']);

export const GLOSSARY_POLICY = Object.freeze({
  aiMayProposeButCannotLock: true,
  onlyInjectWhenSourceAppears: true,
  canonicalEntriesAreProperNounsOrDomainTerms: true,
  addressFormsMustUseContextualVariants: true,
  forbidGlobalTextReplacement: true,
  annotationsRequireHumanApproval: true,
  annotationsMustRespectReaderKnowledge: true,
  memoryCannotAuthorizeAbsentWords: true,
});

const includesAny = (values: readonly string[] | undefined, value: string | undefined) =>
  values === undefined || (value !== undefined && values.includes(value));

const paragraphWithinRange = (scope: GlossaryVariantScope, paragraphId: string) => {
  if (scope.validFromParagraphId && paragraphId < scope.validFromParagraphId) return false;
  if (scope.validToParagraphId && paragraphId > scope.validToParagraphId) return false;
  return true;
};

const matchesScope = (scope: GlossaryVariantScope, context: GlossaryResolutionContext) =>
  includesAny(scope.speakerIds, context.speakerId)
  && includesAny(scope.targetIds, context.targetId)
  && includesAny(scope.sceneIds, context.sceneId)
  && includesAny(scope.relationshipStageIds, context.relationshipStageId)
  && (scope.atmosphereTags === undefined
    || scope.atmosphereTags.every((tag) => context.atmosphereTags.includes(tag)))
  && paragraphWithinRange(scope, context.paragraphId);

const scopeSpecificity = (scope: GlossaryVariantScope) => [
  scope.speakerIds,
  scope.targetIds,
  scope.sceneIds,
  scope.relationshipStageIds,
  scope.atmosphereTags,
  scope.validFromParagraphId,
  scope.validToParagraphId,
].filter(Boolean).length;

const sourceFormsFor = (entry: GlossaryEntry) => [entry.sourceTerm, ...entry.sourceAliases]
  .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
  .sort((left, right) => right.length - left.length);

export const resolveGlossaryTerm = (
  entry: GlossaryEntry,
  variants: readonly GlossaryVariant[],
  context: GlossaryResolutionContext,
): GlossaryResolution => {
  const entryForms = sourceFormsFor(entry);
  const matchedBaseForm = entryForms.find((form) => context.japanese.includes(form));
  const entryVariants = variants.filter((variant) => variant.entryId === entry.entryId);
  const mentionedVariants = entryVariants.filter((variant) =>
    variant.sourceForm.length > 0 && context.japanese.includes(variant.sourceForm));

  if (!matchedBaseForm && mentionedVariants.length === 0) {
    return {
      decision: 'skip',
      entryId: entry.entryId,
      reason: '当前日文没有出现该术语或其已登记变体。',
    };
  }

  if (entry.status === 'conflict') {
    return {
      decision: 'review',
      entryId: entry.entryId,
      reason: '基础译名存在未解决冲突，禁止自动注入。',
    };
  }

  if (!APPLICABLE_STATUSES.has(entry.status)) {
    return {
      decision: 'skip',
      entryId: entry.entryId,
      reason: '候选术语尚未由用户批准或锁定。',
    };
  }

  const eligibleVariants = mentionedVariants
    .filter((variant) => APPLICABLE_STATUSES.has(variant.status) && matchesScope(variant.scope, context))
    .sort((left, right) => scopeSpecificity(right.scope) - scopeSpecificity(left.scope));

  if (eligibleVariants.length > 0) {
    const topSpecificity = scopeSpecificity(eligibleVariants[0].scope);
    const equallySpecific = eligibleVariants.filter(
      (variant) => scopeSpecificity(variant.scope) === topSpecificity,
    );
    const translations = new Set(equallySpecific.map((variant) => variant.chineseForm));

    if (translations.size > 1) {
      return {
        decision: 'review',
        entryId: entry.entryId,
        reason: '同等具体的场景变体给出了不同译法，需要人工判断。',
      };
    }

    const selected = eligibleVariants[0];
    return {
      decision: 'use-variant',
      entryId: entry.entryId,
      variantId: selected.variantId,
      sourceForm: selected.sourceForm,
      chineseForm: selected.chineseForm,
      reason: '原文变体、说话方向、关系阶段与场景范围均命中。',
    };
  }

  if (mentionedVariants.length > 0) {
    return {
      decision: 'review',
      entryId: entry.entryId,
      reason: '原文出现已登记的称呼或别名，但当前场景不满足任何已批准变体。',
    };
  }

  if (!matchedBaseForm || entry.canonicalChinese.trim().length === 0) {
    return {
      decision: 'review',
      entryId: entry.entryId,
      reason: '原文命中但基础译名为空或无法确定具体源形式。',
    };
  }

  return {
    decision: 'use-base',
    entryId: entry.entryId,
    sourceForm: matchedBaseForm,
    chineseForm: entry.canonicalChinese,
    reason: '当前日文命中已批准的基础专名。',
  };
};

export const decideAnnotationExport = (
  annotation: EpubAnnotationDraft,
  meaningfulOccurrenceOrdinal: number,
): AnnotationExportDecision => {
  if (!APPLICABLE_STATUSES.has(annotation.status)) {
    return { exportable: false, reason: '注释尚未由用户批准。' };
  }
  if (annotation.readerKnowledgeStatus !== 'safe') {
    return { exportable: false, reason: '注释可能越过当前读者知情边界。' };
  }
  if (annotation.evidenceIds.length === 0 || annotation.note.trim().length === 0) {
    return { exportable: false, reason: '注释缺少原文证据或正文。' };
  }
  if (annotation.placement === 'first-meaningful' && meaningfulOccurrenceOrdinal !== 1) {
    return { exportable: false, reason: '该注释只在首次有意义的出现位置导出。' };
  }
  return { exportable: true, reason: '注释已批准、无剧透并具有原文证据。' };
};
