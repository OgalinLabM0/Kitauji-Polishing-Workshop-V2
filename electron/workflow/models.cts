export type WorkflowTaskType = 'pre-read' | 'translate' | 'review' | 'export';
export type WorkflowTaskStatus = 'pending' | 'running' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface WorkflowTaskSummary {
  readonly taskId: string;
  readonly projectId: string;
  readonly taskType: WorkflowTaskType;
  readonly status: WorkflowTaskStatus;
  readonly providerProfileId: string | null;
  readonly totalItems: number;
  readonly completedItems: number;
  readonly failedItems: number;
  readonly warningItems: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface WorkflowOverview {
  readonly tasks: readonly WorkflowTaskSummary[];
  readonly segmentCounts: Readonly<Record<string, number>>;
  readonly glossaryCount: number;
  readonly memoryFactCount: number;
  readonly openReviewCount: number;
}

export interface StartWorkflowInput {
  readonly projectId: string;
  readonly taskType: 'pre-read' | 'translate' | 'review';
  readonly chapterIds?: readonly string[];
  readonly replaceApproved?: boolean;
}

export type WorkflowOperationResult<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'error'; readonly message: string };

export interface WorkflowDesktopApi {
  readonly overview: (projectId: string) => Promise<WorkflowOverview>;
  readonly start: (input: StartWorkflowInput) => Promise<WorkflowOperationResult<WorkflowTaskSummary>>;
  readonly pause: (taskId: string) => Promise<WorkflowOperationResult<WorkflowTaskSummary>>;
  readonly resume: (taskId: string) => Promise<WorkflowOperationResult<WorkflowTaskSummary>>;
  readonly cancel: (taskId: string) => Promise<WorkflowOperationResult<WorkflowTaskSummary>>;
  readonly seriesAssignment: (projectId: string) => Promise<SeriesAssignmentRecord | null>;
  readonly listSeries: () => Promise<readonly SeriesSummaryRecord[]>;
  readonly assignSeries: (projectId: string, input: SeriesAssignmentInput) => Promise<WorkflowOperationResult<SeriesAssignmentRecord>>;
  readonly unassignSeries: (projectId: string) => Promise<WorkflowOperationResult<boolean>>;
  readonly ambiguities: (projectId: string) => Promise<readonly AmbiguityRecord[]>;
  readonly resolveAmbiguity: (ambiguityId: string, input: AmbiguityResolutionInput) => Promise<WorkflowOperationResult<unknown>>;
}

export interface TranslationSegmentRecord {
  readonly segmentId: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterOrdinal: number;
  readonly segmentOrdinal: number;
  readonly sourceBlockId: string;
  readonly targetBlockId: string | null;
  readonly sourceText: string;
  readonly originalTranslation: string | null;
  readonly status: string;
}

export interface ClaimedTaskItem {
  readonly taskItemId: string;
  readonly taskId: string;
  readonly chapterId: string;
  readonly segmentId: string | null;
  readonly itemOrdinal: number;
  readonly attempts: number;
  readonly segment: TranslationSegmentRecord | null;
}

export interface WorkbenchSegment {
  readonly segmentId: string;
  readonly chapterId: string;
  readonly chapterOrdinal: number;
  readonly segmentOrdinal: number;
  readonly sourceBlockId?: string;
  readonly tagName?: string;
  readonly isTitle?: boolean;
  readonly sourceText: string;
  readonly originalTranslation: string | null;
  readonly selectedTranslation: string | null;
  readonly status: string;
  readonly versionCount: number;
  readonly openReviewCount: number;
}

export interface WorkbenchPage {
  readonly projectId: string;
  readonly chapterId: string;
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly segments: readonly WorkbenchSegment[];
}

export interface TranslationVersionRecord {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly stage: string;
  readonly text: string;
  readonly model: string | null;
  readonly providerProfileId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly elapsedMs: number | null;
  readonly createdAt: string;
  readonly selected: boolean;
}

export interface GlossaryRecord {
  readonly glossaryId: string;
  readonly sourceTerm: string;
  readonly translatedTerm: string;
  readonly reading: string | null;
  readonly entityKind: string;
  readonly gender: string;
  readonly grammaticalNumber: string;
  readonly sense: string;
  readonly confidence: number;
  readonly status: string;
  readonly notes: string;
  readonly epubNote: string;
  readonly occurrenceCount: number;
  readonly evidence: readonly { chapterId: string; sourceExcerpt: string; translationExcerpt: string | null; evidenceKind: string }[];
}

export interface MemoryFactRecord {
  readonly factId: string;
  readonly factKind: string;
  readonly subjectKey: string | null;
  readonly objectKey: string | null;
  readonly statement: string;
  readonly chapterStart: number;
  readonly readerVisibleFrom: number;
  readonly evidenceExcerpt: string;
  readonly confidence: number;
  readonly status: string;
  readonly chapterStartSegment?: number | null;
  readonly chapterStartOffset?: number | null;
  readonly memoryClass?: string;
  readonly importance?: number;
  readonly retentionPolicy?: string;
  readonly retrievalScope?: string;
  readonly consolidationStatus?: string;
}

export interface SeriesAssignmentRecord { readonly seriesId: string; readonly name: string; readonly description: string; readonly volumeOrdinal: number; readonly volumeLabel: string; }
export interface SeriesSummaryRecord { readonly seriesId: string; readonly name: string; readonly description: string; readonly volumeCount: number; readonly maxVolumeOrdinal: number; }
export interface SeriesAssignmentInput { readonly name: string; readonly volumeOrdinal: number; readonly volumeLabel?: string; readonly description?: string; }
export interface AmbiguityRecord { readonly ambiguityId: string; readonly chapterOrdinal: number; readonly segmentOrdinal: number; readonly sourceStartOffset: number | null; readonly sourceEndOffset: number | null; readonly ambiguityKind: string; readonly sourceExcerpt: string; readonly interpretations: readonly string[]; readonly preservationStrategy: string; readonly revealChapter: number | null; readonly revealSegment: number | null; readonly revealOffset: number | null; readonly selectedInterpretation: string | null; readonly resolutionNote: string; readonly confidence: number; readonly status: string; }
export interface AmbiguityResolutionInput { readonly selectedInterpretation?: string | null; readonly preservationStrategy: 'preserve' | 'resolve' | 'transliterate' | 'annotate' | 'review'; readonly note?: string; readonly lock?: boolean; }

export interface ReviewQueueRecord {
  readonly reviewId: string;
  readonly segmentId: string | null;
  readonly chapterOrdinal: number | null;
  readonly segmentOrdinal: number | null;
  readonly category: string;
  readonly severity: string;
  readonly status: string;
  readonly title: string;
  readonly explanation: string;
  readonly proposedText: string | null;
  readonly sourceText: string | null;
  readonly originalTranslation: string | null;
  readonly currentTranslation: string | null;
  readonly contextExcerpt: string | null;
  readonly createdAt: string;
}

export interface GlossaryImportInput { readonly sourceTerm: string; readonly canonicalChinese: string; readonly category?: string; readonly note?: string; readonly pronunciation?: string; }

export interface WorkflowLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: 'info' | 'api' | 'success' | 'warn' | 'error';
  readonly stage: 'pre-read' | 'translate' | 'review' | 'system';
  readonly message: string;
  readonly details?: string | null;
  readonly model?: string | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly elapsedMs?: number | null;
}
