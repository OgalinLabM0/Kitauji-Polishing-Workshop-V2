export interface NarrativeAliasInput {
  readonly sourceForm: string;
  readonly translatedForm: string;
  readonly aliasKind: 'canonical' | 'family-name' | 'given-name' | 'title' | 'nickname' | 'codename' | 'old-name' | 'misnomer' | 'other';
  readonly validFromChapter: number;
  readonly validFromSegment: number | null;
  readonly validFromOffset: number | null;
  readonly validToChapter: number | null;
  readonly validToSegment: number | null;
  readonly validToOffset: number | null;
  readonly readerVisibleFrom: number;
  readonly readerVisibleFromSegment: number | null;
  readonly readerVisibleFromOffset: number | null;
  readonly evidenceSegment: number | null;
  readonly evidenceStartOffset: number | null;
  readonly evidenceExcerpt: string;
  readonly confidence: number;
}

export interface NarrativeAttributeInput {
  readonly predicate: 'gender' | 'number' | 'age' | 'appearance' | 'occupation' | 'affiliation' | 'injury' | 'identity' | 'other';
  readonly value: unknown;
  readonly worldlineKey: string;
  readonly sceneKey: string;
  readonly validFromChapter: number;
  readonly validFromSegment: number | null;
  readonly validFromOffset: number | null;
  readonly validToChapter: number | null;
  readonly validToSegment: number | null;
  readonly validToOffset: number | null;
  readonly readerVisibleFrom: number;
  readonly readerVisibleFromSegment: number | null;
  readonly readerVisibleFromOffset: number | null;
  readonly evidenceSegment: number | null;
  readonly evidenceStartOffset: number | null;
  readonly evidenceExcerpt: string;
  readonly confidence: number;
}

export interface NarrativeEntityInput {
  readonly sourceName: string;
  readonly canonicalSourceName: string;
  readonly translatedName: string;
  readonly reading: string;
  readonly kind: string;
  readonly gender: string;
  readonly number: string;
  readonly confidence: number;
  readonly notes: string;
  readonly evidence: readonly { readonly excerpt: string; readonly kind: string }[];
  readonly aliases: readonly NarrativeAliasInput[];
  readonly attributes: readonly NarrativeAttributeInput[];
}

export interface NarrativeFactInput {
  readonly kind: string;
  readonly predicate: string;
  readonly subjectKey: string;
  readonly objectKey: string;
  readonly worldlineKey: string;
  readonly sceneKey: string;
  readonly value: unknown;
  readonly statement: string;
  readonly chapterStart: number;
  readonly chapterStartSegment: number | null;
  readonly chapterStartOffset: number | null;
  readonly chapterEnd: number | null;
  readonly chapterEndSegment: number | null;
  readonly chapterEndOffset: number | null;
  readonly readerVisibleFrom: number;
  readonly readerVisibleFromSegment: number | null;
  readonly readerVisibleFromOffset: number | null;
  readonly characterKnowledge: Readonly<Record<string, unknown>>;
  readonly evidenceExcerpt: string;
  readonly evidenceSegment: number | null;
  readonly evidenceStartOffset: number | null;
  readonly memoryClass: MemoryClass;
  readonly importance: number;
  readonly retrievalScope: MemoryScope;
  readonly confidence: number;
}

export interface NarrativeEventInput {
  readonly eventType: string;
  readonly predicate: string;
  readonly agentKey: string;
  readonly patientKey: string;
  readonly recipientKey: string;
  readonly worldlineKey: string;
  readonly sceneKey: string;
  readonly statement: string;
  readonly directionStatus: 'verified' | 'ambiguous' | 'unresolved';
  readonly chapterStart: number;
  readonly chapterStartSegment: number | null;
  readonly chapterStartOffset: number | null;
  readonly chapterEnd: number | null;
  readonly chapterEndSegment: number | null;
  readonly chapterEndOffset: number | null;
  readonly readerVisibleFrom: number;
  readonly readerVisibleFromSegment: number | null;
  readonly readerVisibleFromOffset: number | null;
  readonly characterKnowledge: Readonly<Record<string, unknown>>;
  readonly evidenceExcerpt: string;
  readonly evidenceSegment: number | null;
  readonly evidenceStartOffset: number | null;
  readonly memoryClass: MemoryClass;
  readonly importance: number;
  readonly retrievalScope: MemoryScope;
  readonly confidence: number;
}

export interface NarrativeContextFrameInput {
  readonly frameKey: string;
  readonly parentFrameKey: string;
  readonly frameKind: 'main' | 'flashback' | 'flashforward' | 'dream' | 'hypothetical' | 'fiction-within-fiction' | 'unreliable' | 'unknown';
  readonly worldlineKey: string;
  readonly storyTimeKey: string;
  readonly sceneKey: string;
  readonly locationKey: string;
  readonly viewpointKey: string;
  readonly narratorKey: string;
  readonly participantKeys: readonly string[];
  readonly nestingDepth: number;
  readonly discourseMode: 'narration' | 'direct-quote' | 'indirect-quote' | 'free-indirect' | 'monologue' | 'unknown';
  readonly quoteLevel: number;
  readonly speakerKey: string;
  readonly addresseeKey: string;
  readonly validFromChapter: number;
  readonly validFromSegment: number;
  readonly validFromOffset: number | null;
  readonly validToChapter: number | null;
  readonly validToSegment: number | null;
  readonly validToOffset: number | null;
  readonly evidenceExcerpt: string;
  readonly evidenceSegment: number;
  readonly evidenceStartOffset: number | null;
  readonly confidence: number;
}

export interface NormalizedPreReadResult {
  readonly chapterSummary: string;
  readonly entities: NarrativeEntityInput[];
  readonly glossary: Array<Record<string, unknown>>;
  readonly facts: NarrativeFactInput[];
  readonly events: NarrativeEventInput[];
  readonly frames: NarrativeContextFrameInput[];
  readonly styleDecisions: NarrativeStyleDecisionInput[];
  readonly ambiguities: NarrativeAmbiguityInput[];
}

export type MemoryClass = 'canon' | 'character' | 'relationship' | 'event' | 'state' | 'episode-detail';
export type MemoryScope = 'series' | 'volume' | 'chapter' | 'scene';

export interface NarrativeStyleDecisionInput {
  readonly ownerType: 'series' | 'narrator' | 'character' | 'relationship' | 'scene';
  readonly ownerKey: string;
  readonly decisionKind: 'register' | 'pronoun' | 'address' | 'syntax' | 'rhythm' | 'punctuation' | 'dialect' | 'catchphrase' | 'profanity' | 'ambiguity-policy';
  readonly sourcePattern: string;
  readonly targetStrategy: string;
  readonly rationale: string;
  readonly validFromChapter: number;
  readonly validFromSegment: number | null;
  readonly validFromOffset: number | null;
  readonly validToChapter: number | null;
  readonly validToSegment: number | null;
  readonly validToOffset: number | null;
  readonly evidenceExcerpt: string;
  readonly evidenceSegment: number | null;
  readonly evidenceStartOffset: number | null;
  readonly confidence: number;
}

export interface NarrativeAmbiguityInput {
  readonly ambiguityKind: 'pun' | 'identity' | 'referent' | 'scope' | 'role' | 'voice' | 'temporal' | 'narrative' | 'other';
  readonly sourceExcerpt: string;
  readonly interpretations: readonly string[];
  readonly preservationStrategy: 'preserve' | 'resolve' | 'transliterate' | 'annotate' | 'review';
  readonly revealChapter: number | null;
  readonly revealSegment: number | null;
  readonly revealOffset: number | null;
  readonly evidenceSegment: number;
  readonly evidenceStartOffset: number | null;
  readonly confidence: number;
}

export interface SemanticRoleProposition {
  readonly predicate: string;
  readonly agent: string;
  readonly patient: string;
  readonly recipient: string;
  readonly speaker?: string;
  readonly addressee?: string;
  readonly speechAct?: string;
  readonly sourceCue: string;
  readonly sourceStartOffset?: number | null;
  readonly sourceEndOffset?: number | null;
  readonly voice: 'active' | 'passive' | 'causative' | 'causative-passive' | 'giving-receiving' | 'state' | 'ambiguous';
  readonly confidence: number;
  readonly ambiguity: string;
  readonly syntaxAgreement?: 'agrees' | 'neutral' | 'conflicts';
}

export interface SegmentSemanticRoles {
  readonly id: string;
  readonly propositions: readonly SemanticRoleProposition[];
}

export interface NarrativeContextManifest {
  readonly neighborOrdinals: readonly number[];
  readonly glossaryIds: readonly string[];
  readonly entityIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly frameIds: readonly string[];
  readonly memoryIds: readonly string[];
  readonly styleIds: readonly string[];
  readonly ambiguityIds: readonly string[];
  readonly readerFactIds: readonly string[];
  readonly translatorFactIds: readonly string[];
  readonly directionConstraints: readonly unknown[];
  readonly syntaxEvidence: readonly unknown[];
  readonly seriesContext: Readonly<Record<string, unknown>>;
  readonly position: { readonly chapterOrdinal: number; readonly firstSegmentOrdinal: number; readonly lastSegmentOrdinal: number; readonly firstOffset: number; readonly lastOffset: number | null };
}
