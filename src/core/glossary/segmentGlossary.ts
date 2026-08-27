import type {
  GlossaryEntry,
  GlossaryResolution,
  GlossaryResolutionContext,
  GlossaryVariant,
} from './models';
import { resolveGlossaryTerm } from './glossaryPolicy';

export interface SegmentGlossaryMapping {
  readonly entryId: string;
  readonly variantId?: string;
  readonly sourceForm: string;
  readonly chineseForm: string;
  readonly instruction: string;
}

export interface SegmentGlossaryPack {
  readonly mappings: readonly SegmentGlossaryMapping[];
  readonly reviewRequired: readonly GlossaryResolution[];
  readonly skipped: readonly GlossaryResolution[];
}

export const buildSegmentGlossaryPack = (
  entries: readonly GlossaryEntry[],
  variants: readonly GlossaryVariant[],
  context: GlossaryResolutionContext,
): SegmentGlossaryPack => {
  const resolutions = entries.map((entry) => resolveGlossaryTerm(entry, variants, context));
  const applicable = resolutions.filter((resolution) =>
    resolution.decision === 'use-base' || resolution.decision === 'use-variant');
  const ambiguousSourceForms = new Set<string>();

  for (const resolution of applicable) {
    if (!resolution.sourceForm || !resolution.chineseForm) continue;
    const translations = applicable
      .filter((candidate) => candidate.sourceForm === resolution.sourceForm)
      .map((candidate) => candidate.chineseForm);
    if (new Set(translations).size > 1) ambiguousSourceForms.add(resolution.sourceForm);
  }

  const mappings = applicable
    .filter((resolution) =>
      resolution.sourceForm
      && resolution.chineseForm
      && !ambiguousSourceForms.has(resolution.sourceForm))
    .map((resolution) => ({
      entryId: resolution.entryId,
      variantId: resolution.variantId,
      sourceForm: resolution.sourceForm as string,
      chineseForm: resolution.chineseForm as string,
      instruction: '只翻译当前日文实际出现的该形式；不得据此添加姓名、称呼、性别、人数或其他原文不存在的信息。',
    }));

  const homographReviews: GlossaryResolution[] = applicable
    .filter((resolution) => resolution.sourceForm && ambiguousSourceForms.has(resolution.sourceForm))
    .map((resolution) => ({
      decision: 'review',
      entryId: resolution.entryId,
      sourceForm: resolution.sourceForm,
      reason: '同一日文表面词在当前分段命中多个不同译名，需要先判断语义身份。',
    }));

  return {
    mappings,
    reviewRequired: [
      ...resolutions.filter((resolution) => resolution.decision === 'review'),
      ...homographReviews,
    ],
    skipped: resolutions.filter((resolution) => resolution.decision === 'skip'),
  };
};
