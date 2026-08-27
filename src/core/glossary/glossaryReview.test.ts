import { describe, expect, it } from 'vitest';
import type { GlossaryEntry, GlossaryOccurrence } from './models';
import {
  assessGlossaryReviewReadiness,
  GLOSSARY_HUMAN_REVIEW_POLICY,
} from './glossaryReview';

const entry: GlossaryEntry = {
  entryId: 'character-seki',
  sourceTerm: '関',
  sourceAliases: [],
  canonicalChinese: '关',
  category: 'character',
  referentKind: 'person',
  gender: { value: 'unknown', confidence: 'high', evidenceIds: [] },
  senseSummary: '角色姓名',
  status: 'review',
  origin: 'ai-extracted',
  occurrenceCount: 3,
  firstSeenParagraphId: 'chapter-1:p-1',
  confidence: 'high',
  evidenceIds: ['occurrence-1'],
  exactMatch: true,
};

const occurrence = (
  overrides: Partial<GlossaryOccurrence> = {},
): GlossaryOccurrence => ({
  occurrenceId: 'occurrence-1',
  entryId: entry.entryId,
  chapterId: 'chapter-1',
  paragraphId: 'chapter-1:p-1',
  sourceForm: '関さん',
  japaneseExcerpt: '「関さん、こちらへどうぞ」',
  translatedChineseExcerpt: '“关同学，请到这边来。”',
  renderedChineseForm: '关同学',
  translationStatus: 'machine-draft',
  translationCandidateId: 'translation-1',
  speakerId: 'character-a',
  targetId: 'character-seki',
  sceneId: 'scene-1',
  relationshipStageId: 'newly-met',
  atmosphereTags: ['formal'],
  matchedVariantId: 'seki-san',
  confidence: 'high',
  ...overrides,
});

describe('glossary human review readiness', () => {
  it('只有完整日中对照和句中实际译法才能进入人工决定', () => {
    const result = assessGlossaryReviewReadiness(entry, [occurrence()], '关');

    expect(result.readyForHumanDecision).toBe(true);
    expect(result.pairedContextCount).toBe(1);
    expect(result.blockers).toEqual([]);
    expect(GLOSSARY_HUMAN_REVIEW_POLICY.forbidWordOnlyApproval).toBe(true);
  });

  it('只有日文原文、没有译后中文时禁止批准', () => {
    const result = assessGlossaryReviewReadiness(
      entry,
      [
        occurrence({
          translatedChineseExcerpt: undefined,
          renderedChineseForm: undefined,
          translationStatus: 'not-generated',
        }),
      ],
      '关',
    );

    expect(result.readyForHumanDecision).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'MISSING_TRANSLATED_CONTEXT',
      'MISSING_RENDERED_CHINESE_FORM',
    ]);
  });

  it('条目引用的证据必须能定位到同一条目的出现记录', () => {
    const result = assessGlossaryReviewReadiness(
      entry,
      [occurrence({ entryId: 'another-entry' })],
      '关',
    );

    expect(result.blockers).toContainEqual({
      code: 'EVIDENCE_OCCURRENCE_MISSING',
      evidenceId: 'occurrence-1',
    });
  });

  it('日文证据中必须看得到本次审核的原文形式', () => {
    const result = assessGlossaryReviewReadiness(
      entry,
      [occurrence({ japaneseExcerpt: '「こちらへどうぞ」' })],
      '关',
    );

    expect(result.blockers).toContainEqual({
      code: 'SOURCE_FORM_NOT_VISIBLE',
      evidenceId: 'occurrence-1',
    });
  });

  it('空白中文候选不能通过日中语境审核', () => {
    const result = assessGlossaryReviewReadiness(entry, [occurrence()], '   ');

    expect(result.blockers).toContainEqual({ code: 'EMPTY_CHINESE_CANDIDATE' });
    expect(result.readyForHumanDecision).toBe(false);
  });
});
