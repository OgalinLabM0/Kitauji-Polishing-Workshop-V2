export type TranslationMode = 'polish-bilingual' | 'translate-japanese';
export type ExportMode = 'chinese-only' | 'japanese-chinese';

export type Confidence = 'confirmed' | 'high' | 'medium' | 'low' | 'unknown';

export interface EvidenceRef {
  readonly evidenceId: string;
  readonly chapterId: string;
  readonly paragraphId: string;
  readonly japaneseExcerpt: string;
  readonly confidence: Confidence;
}

export interface CharacterProfile {
  readonly characterId: string;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly gender: 'male' | 'female' | 'nonbinary' | 'unknown';
  readonly number: 'singular' | 'plural' | 'collective' | 'unknown';
  readonly speechStyle: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly lockedFields: readonly string[];
}

export interface RelationshipSnapshot {
  readonly fromCharacterId: string;
  readonly toCharacterId: string;
  readonly stageId: string;
  readonly relationTypes: readonly string[];
  readonly closeness: number;
  readonly respect: number;
  readonly fear: number;
  readonly formality: number;
  readonly hostility: number;
  readonly validFromParagraphId: string;
  readonly validToParagraphId?: string;
  readonly evidenceIds: readonly string[];
}

export interface SceneSnapshot {
  readonly sceneId: string;
  readonly chapterId: string;
  readonly paragraphIds: readonly string[];
  readonly location?: string;
  readonly time?: string;
  readonly atmosphere: readonly string[];
  readonly presentCharacterIds: readonly string[];
  readonly speakerCandidates: readonly string[];
  readonly addresseeCandidates: readonly string[];
  readonly unresolvedQuestions: readonly string[];
}

export interface KnowledgeBoundary {
  readonly translatorKnownFactIds: readonly string[];
  readonly readerKnownFactIds: readonly string[];
  readonly characterKnownFactIds: Readonly<Record<string, readonly string[]>>;
  readonly unresolvedMysteryIds: readonly string[];
}

export interface SourceParagraph {
  readonly paragraphId: string;
  readonly chapterId: string;
  readonly sourceNodeId: string;
  readonly japanese: string;
  readonly existingChinese?: string;
  readonly sourceHash: string;
}

export interface TranslationCandidate {
  readonly candidateId: string;
  readonly paragraphId: string;
  readonly roleId: AiWorkstationId;
  readonly chinese: string;
  readonly sourceCoverageEvidenceIds: readonly string[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
}

export type AiWorkstationId =
  | 'book-pre-reader'
  | 'term-extractor'
  | 'term-translation-proposer'
  | 'scene-analyst'
  | 'faithful-translator'
  | 'chinese-editor'
  | 'fidelity-reviewer'
  | 'relationship-reviewer'
  | 'glossary-auditor'
  | 'trajectory-reviewer';

export type WorkflowStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'paused'
  | 'review-required'
  | 'failed'
  | 'completed'
  | 'cancelled';

export interface WorkflowTask {
  readonly taskId: string;
  readonly bookId: string;
  readonly roleId: AiWorkstationId;
  readonly status: WorkflowStatus;
  readonly attempt: number;
  readonly dependsOn: readonly string[];
  readonly paragraphIds: readonly string[];
}
