export type ProjectSourceFormat = 'txt' | 'epub';
export type ProjectTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis';
export type ProjectContentMode = 'japanese' | 'bilingual' | 'unknown';
export type EpubNavigationKind = 'nav' | 'ncx' | 'both' | 'none';
export type EpubBilingualLayout = 'none' | 'alternating-lang' | 'alternating-opacity' | 'mixed' | 'unknown';
export type EpubScriptKind = 'japanese' | 'chinese' | 'mixed' | 'neutral' | 'unknown';

export interface ParsedParagraph {
  readonly ordinal: number;
  readonly sourceLine: number;
  readonly text: string;
}

export interface ParsedChapter {
  readonly ordinal: number;
  readonly title: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly paragraphs: readonly ParsedParagraph[];
  readonly characterCount: number;
}

export interface DecodedTextDocument {
  readonly encoding: ProjectTextEncoding;
  readonly text: string;
  readonly newline: 'crlf' | 'lf' | 'cr' | 'mixed' | 'none';
}

export interface TxtImportDocument extends DecodedTextDocument {
  readonly chapters: readonly ParsedChapter[];
  readonly paragraphCount: number;
  readonly characterCount: number;
}

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
  readonly epub: EpubProjectDetails | null;
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
  readonly scriptKind: EpubScriptKind | 'text';
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

export interface PersistedTxtProject {
  readonly project: ProjectSummary;
  readonly originalBytes: Uint8Array;
  readonly decodedText: string;
  readonly newline: DecodedTextDocument['newline'];
  readonly chapters: readonly ParsedChapter[];
}

export interface EpubTextBlock {
  readonly ordinal: number;
  readonly domPath: string;
  readonly sourceLine: number | null;
  readonly tagName: string;
  readonly language: string | null;
  readonly scriptKind: EpubScriptKind;
  readonly sourceText: string;
  readonly sourceXml: string;
  readonly sourceHash: string;
  readonly styleHint: string | null;
  readonly pairedOrdinal: number | null;
}

export interface EpubSpineDocument {
  readonly ordinal: number;
  readonly itemId: string;
  readonly href: string;
  readonly mediaType: string;
  readonly linear: boolean;
  readonly title: string;
  readonly sourceHash: string;
  readonly sourceSizeBytes: number;
  readonly textBlockCount: number;
  readonly characterCount: number;
  readonly kanaCount: number;
  readonly hanCount: number;
  readonly scriptCount: number;
  readonly rubyCount: number;
  readonly imageCount: number;
  readonly externalReferenceCount: number;
  readonly blocks: readonly EpubTextBlock[];
}

export interface EpubProjectDetails {
  readonly packageVersion: string;
  readonly opfPath: string;
  readonly packageLanguage: string | null;
  readonly creators: readonly string[];
  readonly navigationKind: EpubNavigationKind;
  readonly navigationPath: string | null;
  readonly pageProgression: string | null;
  readonly manifestCount: number;
  readonly spineCount: number;
  readonly imageCount: number;
  readonly rubyCount: number;
  readonly scriptCount: number;
  readonly externalReferenceCount: number;
  readonly bilingualLayout: EpubBilingualLayout;
  readonly bilingualPairCount: number;
  readonly totalUncompressedBytes: number;
  readonly warnings: readonly string[];
}

export interface EpubImportDocument {
  readonly title: string | null;
  readonly coverDataUrl?: string | null;
  readonly details: EpubProjectDetails;
  readonly spineDocuments: readonly EpubSpineDocument[];
  readonly textBlockCount: number;
  readonly characterCount: number;
  readonly contentMode: ProjectContentMode;
}

export interface PersistedEpubProject {
  readonly project: ProjectSummary;
  readonly originalBytes: Uint8Array;
  readonly epub: EpubImportDocument;
}

export interface EpubDraftForExport {
  readonly blockId: string;
  readonly documentPath: string;
  readonly documentSourceHash: string;
  readonly domPath: string;
  readonly sourceXml: string;
  readonly sourceHash: string;
  readonly draftText: string;
  readonly savedSourceHash: string;
}

export interface EpubExportInput {
  readonly project: ProjectSummary;
  readonly originalBytes: Uint8Array;
  readonly drafts: readonly EpubDraftForExport[];
}

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
