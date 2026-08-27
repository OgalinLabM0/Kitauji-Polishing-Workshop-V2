import type {
  GlossaryEntry,
  GlossaryOccurrence,
  GlossaryReviewBlocker,
  GlossaryReviewReadiness,
} from './models';

export const GLOSSARY_HUMAN_REVIEW_POLICY = Object.freeze({
  requireJapaneseContext: true,
  requireTranslatedChineseContext: true,
  requireRenderedChineseForm: true,
  requireEveryReferencedEvidence: true,
  forbidWordOnlyApproval: true,
});

/**
 * 人工批准或锁定术语前，逐条核对条目引用的代表性证据。审核者必须能同时看到
 * 日文原文、译后中文和该术语在句中的实际中文呈现；词条级映射本身不算充分证据。
 */
export function assessGlossaryReviewReadiness(
  entry: GlossaryEntry,
  occurrences: readonly GlossaryOccurrence[],
  selectedChineseCandidate: string,
): GlossaryReviewReadiness {
  const blockers: GlossaryReviewBlocker[] = [];
  const occurrenceById = new Map(
    occurrences
      .filter((occurrence) => occurrence.entryId === entry.entryId)
      .map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );

  if (selectedChineseCandidate.trim() === '') {
    blockers.push({ code: 'EMPTY_CHINESE_CANDIDATE' });
  }
  if (entry.evidenceIds.length === 0) {
    blockers.push({ code: 'MISSING_ENTRY_EVIDENCE' });
  }

  let pairedContextCount = 0;
  for (const evidenceId of entry.evidenceIds) {
    const occurrence = occurrenceById.get(evidenceId);
    if (occurrence === undefined) {
      blockers.push({ code: 'EVIDENCE_OCCURRENCE_MISSING', evidenceId });
      continue;
    }

    const japanese = occurrence.japaneseExcerpt.trim();
    const translatedChinese = occurrence.translatedChineseExcerpt?.trim() ?? '';
    const renderedChineseForm = occurrence.renderedChineseForm?.trim() ?? '';
    let contextIsPaired = true;

    if (japanese === '') {
      blockers.push({ code: 'MISSING_JAPANESE_CONTEXT', evidenceId });
      contextIsPaired = false;
    } else if (
      occurrence.sourceForm.trim() === '' ||
      !japanese.includes(occurrence.sourceForm)
    ) {
      blockers.push({ code: 'SOURCE_FORM_NOT_VISIBLE', evidenceId });
      contextIsPaired = false;
    }

    if (occurrence.translationStatus === 'not-generated' || translatedChinese === '') {
      blockers.push({ code: 'MISSING_TRANSLATED_CONTEXT', evidenceId });
      contextIsPaired = false;
    }
    if (renderedChineseForm === '') {
      blockers.push({ code: 'MISSING_RENDERED_CHINESE_FORM', evidenceId });
      contextIsPaired = false;
    }

    if (contextIsPaired) pairedContextCount += 1;
  }

  return {
    readyForHumanDecision: blockers.length === 0 && pairedContextCount > 0,
    requiredEvidenceCount: entry.evidenceIds.length,
    pairedContextCount,
    blockers,
  };
}
