import type { Confidence } from '../domain/models';

export type GlossaryCategory =
  | 'character'
  | 'animal'
  | 'place'
  | 'organization'
  | 'event'
  | 'title'
  | 'item'
  | 'ability'
  | 'species'
  | 'concept'
  | 'other';

export type GlossaryReviewStatus =
  | 'candidate'
  | 'review'
  | 'approved'
  | 'locked'
  | 'conflict'
  | 'rejected';

export type GlossaryOrigin = 'ai-extracted' | 'manual' | 'imported';

export type GlossaryReferentKind =
  | 'person'
  | 'animal'
  | 'place'
  | 'organization'
  | 'event'
  | 'object'
  | 'ability'
  | 'species'
  | 'concept'
  | 'title'
  | 'other';

export type GlossaryGenderValue = 'male' | 'female' | 'nonbinary' | 'unknown' | 'not-applicable';

export interface GlossaryGenderInference {
  readonly value: GlossaryGenderValue;
  readonly confidence: Confidence;
  readonly evidenceIds: readonly string[];
  readonly readerKnownFromParagraphId?: string;
  readonly note?: string;
}

export interface GlossaryEntry {
  readonly entryId: string;
  readonly sourceTerm: string;
  readonly sourceAliases: readonly string[];
  readonly canonicalChinese: string;
  readonly category: GlossaryCategory;
  readonly referentKind: GlossaryReferentKind;
  readonly gender: GlossaryGenderInference;
  readonly senseSummary: string;
  readonly pronunciation?: string;
  readonly status: GlossaryReviewStatus;
  readonly origin: GlossaryOrigin;
  readonly occurrenceCount: number;
  readonly firstSeenParagraphId: string;
  readonly lastSeenParagraphId?: string;
  readonly confidence: Confidence;
  readonly evidenceIds: readonly string[];
  readonly exactMatch: boolean;
}

export type GlossaryVariantKind =
  | 'alias'
  | 'nickname'
  | 'teasing-name'
  | 'honorific'
  | 'title'
  | 'temporary-name'
  | 'identity-mask'
  | 'phonetic-wordplay';

export interface GlossaryWordplayHypothesis {
  readonly hypothesisId: string;
  readonly entryId: string;
  readonly kind: 'homophone' | 'near-homophone' | 'double-reading' | 'kanji-reading' | 'semantic-pun';
  readonly sourceForm: string;
  readonly heardOrAlternateForm: string;
  readonly sourceReading?: string;
  readonly alternateReading?: string;
  readonly narrativeMeaning: string;
  readonly evidenceIds: readonly string[];
  readonly counterEvidenceIds: readonly string[];
  readonly proposedChineseRenderings: readonly string[];
  readonly annotationRecommended: boolean;
  readonly readerKnowledgeStatus: 'safe' | 'needs-review' | 'spoiler';
  readonly confidence: Confidence;
  readonly status: GlossaryReviewStatus;
}

export interface GlossaryVariantScope {
  readonly speakerIds?: readonly string[];
  readonly targetIds?: readonly string[];
  readonly sceneIds?: readonly string[];
  readonly relationshipStageIds?: readonly string[];
  readonly atmosphereTags?: readonly string[];
  readonly validFromParagraphId?: string;
  readonly validToParagraphId?: string;
}

export interface GlossaryVariant {
  readonly variantId: string;
  readonly entryId: string;
  readonly sourceForm: string;
  readonly chineseForm: string;
  readonly kind: GlossaryVariantKind;
  readonly scope: GlossaryVariantScope;
  readonly status: GlossaryReviewStatus;
  readonly evidenceIds: readonly string[];
  readonly confidence: Confidence;
  readonly annotationDraftId?: string;
}

export interface GlossaryOccurrence {
  readonly occurrenceId: string;
  readonly entryId: string;
  readonly chapterId: string;
  readonly paragraphId: string;
  readonly sourceForm: string;
  readonly japaneseExcerpt: string;
  readonly translatedChineseExcerpt?: string;
  readonly renderedChineseForm?: string;
  readonly translationStatus: 'not-generated' | 'machine-draft' | 'human-edited' | 'approved';
  readonly translationCandidateId?: string;
  readonly speakerId?: string;
  readonly targetId?: string;
  readonly sceneId?: string;
  readonly relationshipStageId?: string;
  readonly atmosphereTags: readonly string[];
  readonly matchedVariantId?: string;
  readonly confidence: Confidence;
}

export type GlossaryReviewBlockerCode =
  | 'EMPTY_CHINESE_CANDIDATE'
  | 'MISSING_ENTRY_EVIDENCE'
  | 'EVIDENCE_OCCURRENCE_MISSING'
  | 'MISSING_JAPANESE_CONTEXT'
  | 'SOURCE_FORM_NOT_VISIBLE'
  | 'MISSING_TRANSLATED_CONTEXT'
  | 'MISSING_RENDERED_CHINESE_FORM';

export interface GlossaryReviewBlocker {
  readonly code: GlossaryReviewBlockerCode;
  readonly evidenceId?: string;
}

export interface GlossaryReviewReadiness {
  readonly readyForHumanDecision: boolean;
  readonly requiredEvidenceCount: number;
  readonly pairedContextCount: number;
  readonly blockers: readonly GlossaryReviewBlocker[];
}

export type EpubAnnotationKind =
  | 'nickname'
  | 'wordplay'
  | 'pun'
  | 'title'
  | 'cultural-note'
  | 'translator-note';

export type AnnotationPlacement = 'first-meaningful' | 'every-approved-occurrence' | 'endnote-only';

export interface EpubAnnotationDraft {
  readonly annotationId: string;
  readonly entryId: string;
  readonly occurrenceId: string;
  readonly sourceForm: string;
  readonly chineseAnchor: string;
  readonly kind: EpubAnnotationKind;
  readonly note: string;
  readonly placement: AnnotationPlacement;
  readonly status: GlossaryReviewStatus;
  readonly evidenceIds: readonly string[];
  readonly readerKnowledgeStatus: 'safe' | 'needs-review' | 'spoiler';
}

export interface GlossaryResolutionContext {
  readonly japanese: string;
  readonly paragraphId: string;
  readonly speakerId?: string;
  readonly targetId?: string;
  readonly sceneId?: string;
  readonly relationshipStageId?: string;
  readonly atmosphereTags: readonly string[];
}

export interface GlossaryResolution {
  readonly decision: 'use-base' | 'use-variant' | 'review' | 'skip';
  readonly sourceForm?: string;
  readonly chineseForm?: string;
  readonly entryId: string;
  readonly variantId?: string;
  readonly reason: string;
}

export interface AnnotationExportDecision {
  readonly exportable: boolean;
  readonly reason: string;
}
