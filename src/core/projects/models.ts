export type ProjectSourceFormat = 'txt' | 'epub';
export type ProjectTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis';
export type ProjectContentMode = 'japanese' | 'bilingual' | 'unknown';

export interface ProjectSummary {
  readonly projectId: string;
  readonly title: string;
  readonly sourcePath: string;
  readonly sourceFormat: ProjectSourceFormat;
  readonly sourceEncoding: ProjectTextEncoding | null;
  readonly contentMode: ProjectContentMode;
  readonly sourceHash: string;
  readonly sourceSizeBytes: number;
  readonly chapterCount: number;
  readonly paragraphCount: number;
  readonly characterCount: number;
  readonly coverDataUrl?: string | null;
  readonly importedAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt: string;
}

export interface ProjectChapterSummary {
  readonly chapterId: string;
  readonly ordinal: number;
  readonly title: string;
  readonly href?: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly paragraphCount: number;
  readonly characterCount: number;
  readonly isNavigation: boolean;
}

export interface ProjectSnapshot {
  readonly project: ProjectSummary;
  readonly chapters: readonly ProjectChapterSummary[];
  readonly epub: {
    readonly packageVersion: string;
    readonly opfPath: string;
    readonly packageLanguage: string | null;
    readonly creators: readonly string[];
    readonly navigationKind: 'nav' | 'ncx' | 'both' | 'none';
    readonly navigationPath: string | null;
    readonly pageProgression: string | null;
    readonly manifestCount: number;
    readonly spineCount: number;
    readonly imageCount: number;
    readonly rubyCount: number;
    readonly scriptCount: number;
    readonly externalReferenceCount: number;
    readonly bilingualLayout: 'none' | 'alternating-lang' | 'alternating-opacity' | 'mixed' | 'unknown';
    readonly bilingualPairCount: number;
    readonly totalUncompressedBytes: number;
    readonly warnings: readonly string[];
  } | null;
  readonly readingPosition: ProjectReadingPosition | null;
  readonly epubDraftCount: number;
}

export interface ProjectReadingPosition {
  readonly chapterId: string;
  readonly blockOrdinal: number;
  readonly updatedAt: string;
}

export interface ChapterContentBlock {
  readonly blockId: string;
  readonly ordinal: number;
  readonly sourceLine: number | null;
  readonly tagName: string;
  readonly language: string | null;
  readonly scriptKind: 'japanese' | 'chinese' | 'mixed' | 'neutral' | 'unknown' | 'text';
  readonly sourceText: string;
  readonly styleHint: string | null;
  readonly pairedOrdinal: number | null;
  readonly draftText: string | null;
  readonly canEdit: boolean;
  readonly editRestriction: string | null;
}

export interface ProjectChapterContent {
  readonly projectId: string;
  readonly chapterId: string;
  readonly chapterOrdinal: number;
  readonly chapterTitle: string;
  readonly sourceFormat: ProjectSourceFormat;
  readonly contentMode: ProjectContentMode;
  readonly totalBlocks: number;
  readonly offset: number;
  readonly limit: number;
  readonly blocks: readonly ChapterContentBlock[];
}

export type SaveBlockDraftResult =
  | { readonly status: 'saved'; readonly blockId: string; readonly draftText: string | null; readonly updatedAt: string }
  | { readonly status: 'error'; readonly message: string };

export type ExportEpubResult =
  | { readonly status: 'cancelled' }
  | {
    readonly status: 'exported';
    readonly outputPath: string;
    readonly changedDocumentCount: number;
    readonly changedBlockCount: number;
    readonly outputSizeBytes: number;
  }
  | { readonly status: 'error'; readonly message: string };

export type ImportProjectResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'imported'; readonly snapshot: ProjectSnapshot; readonly duplicate: boolean }
  | { readonly status: 'error'; readonly message: string };

export type DeleteProjectResult =
  | { readonly status: 'deleted'; readonly projectId: string; readonly deletedTitle: string; readonly activeProject: ProjectSnapshot | null }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

export type ClearProjectsResult =
  | { readonly status: 'cleared'; readonly deletedCount: number }
  | { readonly status: 'error'; readonly message: string };

export interface ProjectDesktopApi {
  list(): Promise<readonly ProjectSummary[]>;
  getActive(): Promise<ProjectSnapshot | null>;
  importSource(): Promise<ImportProjectResult>;
  open(projectId: string): Promise<ProjectSnapshot | null>;
  delete(projectId: string): Promise<DeleteProjectResult>;
  clear(): Promise<ClearProjectsResult>;
  readChapter(projectId: string, chapterId: string, offset?: number, limit?: number): Promise<ProjectChapterContent | null>;
  saveBlockDraft(projectId: string, blockId: string, draftText: string | null): Promise<SaveBlockDraftResult>;
  saveReadingPosition(projectId: string, chapterId: string, blockOrdinal: number): Promise<boolean>;
  exportEpub(projectId: string): Promise<ExportEpubResult>;
}
