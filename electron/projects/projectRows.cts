import type { EpubProjectDetails, ProjectSummary } from './models.cjs';

export interface ProjectRow {
  readonly project_id: string;
  readonly title: string;
  readonly source_path: string;
  readonly source_format: ProjectSummary['sourceFormat'];
  readonly source_encoding: ProjectSummary['sourceEncoding'];
  readonly content_mode: ProjectSummary['contentMode'];
  readonly source_hash: string;
  readonly source_size_bytes: number;
  readonly chapter_count: number;
  readonly paragraph_count: number;
  readonly character_count: number;
  readonly imported_at: string;
  readonly updated_at: string;
  readonly last_opened_at: string;
}

export interface ChapterRow {
  readonly chapter_id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly paragraph_count: number;
  readonly character_count: number;
}

export interface EpubSpineRow {
  readonly spine_item_id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly text_block_count: number;
  readonly character_count: number;
  readonly href: string;
}

export interface EpubDetailsRow {
  readonly package_version: string;
  readonly opf_path: string;
  readonly package_language: string | null;
  readonly creators_json: string;
  readonly navigation_kind: EpubProjectDetails['navigationKind'];
  readonly navigation_path: string | null;
  readonly page_progression: string | null;
  readonly manifest_count: number;
  readonly spine_count: number;
  readonly image_count: number;
  readonly ruby_count: number;
  readonly script_count: number;
  readonly external_reference_count: number;
  readonly bilingual_layout: EpubProjectDetails['bilingualLayout'];
  readonly bilingual_pair_count: number;
  readonly total_uncompressed_bytes: number;
  readonly warnings_json: string;
}

export const projectColumns = `
  project_id, title, source_path, source_format, source_encoding, content_mode, source_hash,
  source_size_bytes, chapter_count, paragraph_count, character_count,
  imported_at, updated_at, last_opened_at
`;

export const toProjectSummary = (row: ProjectRow & { readonly cover_data_url?: string | null }): ProjectSummary => ({
  projectId: row.project_id,
  title: row.title,
  sourcePath: row.source_path,
  sourceFormat: row.source_format,
  sourceEncoding: row.source_encoding,
  contentMode: row.content_mode,
  sourceHash: row.source_hash,
  sourceSizeBytes: row.source_size_bytes,
  chapterCount: row.chapter_count,
  paragraphCount: row.paragraph_count,
  characterCount: row.character_count,
  coverDataUrl: row.cover_data_url ?? null,
  importedAt: row.imported_at,
  updatedAt: row.updated_at,
  lastOpenedAt: row.last_opened_at,
});

const parseStringArray = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
};

export const toEpubDetails = (row: EpubDetailsRow): EpubProjectDetails => ({
  packageVersion: row.package_version,
  opfPath: row.opf_path,
  packageLanguage: row.package_language,
  creators: parseStringArray(row.creators_json),
  navigationKind: row.navigation_kind,
  navigationPath: row.navigation_path,
  pageProgression: row.page_progression,
  manifestCount: row.manifest_count,
  spineCount: row.spine_count,
  imageCount: row.image_count,
  rubyCount: row.ruby_count,
  scriptCount: row.script_count,
  externalReferenceCount: row.external_reference_count,
  bilingualLayout: row.bilingual_layout,
  bilingualPairCount: row.bilingual_pair_count,
  totalUncompressedBytes: row.total_uncompressed_bytes,
  warnings: parseStringArray(row.warnings_json),
});
