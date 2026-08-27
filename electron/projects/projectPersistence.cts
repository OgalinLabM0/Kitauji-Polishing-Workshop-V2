import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { PersistedEpubProject, PersistedTxtProject, ProjectSummary } from './models.cjs';
import { projectColumns } from './projectRows.cjs';

export const insertProjectRow = (database: DatabaseSync, project: ProjectSummary) => {
  const values: SQLInputValue[] = [
    project.projectId, project.title, project.sourcePath, project.sourceFormat,
    project.sourceEncoding, project.contentMode, project.sourceHash, project.sourceSizeBytes,
    project.chapterCount, project.paragraphCount, project.characterCount,
    project.importedAt, project.updatedAt, project.lastOpenedAt,
  ];
  database.prepare(`INSERT INTO projects(${projectColumns}) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...values);
};

export const insertTxtRows = (database: DatabaseSync, input: PersistedTxtProject) => {
  database.prepare(`INSERT INTO source_documents(project_id, original_bytes, decoded_text, newline_style) VALUES(?, ?, ?, ?)`)
    .run(input.project.projectId, input.originalBytes, input.decodedText, input.newline);
  const insertChapter = database.prepare(`
    INSERT INTO chapters(chapter_id, project_id, ordinal, title, start_line, end_line, source_text, paragraph_count, character_count)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertParagraph = database.prepare(`
    INSERT INTO paragraphs(paragraph_id, chapter_id, project_id, ordinal, source_line, source_text)
    VALUES(?, ?, ?, ?, ?, ?)
  `);
  for (const chapter of input.chapters) {
    const chapterId = `${input.project.projectId}:c${String(chapter.ordinal).padStart(5, '0')}`;
    insertChapter.run(chapterId, input.project.projectId, chapter.ordinal, chapter.title, chapter.startLine, chapter.endLine, chapter.content, chapter.paragraphs.length, chapter.characterCount);
    for (const paragraph of chapter.paragraphs) {
      const paragraphId = `${chapterId}:p${String(paragraph.ordinal).padStart(6, '0')}`;
      insertParagraph.run(paragraphId, chapterId, input.project.projectId, paragraph.ordinal, paragraph.sourceLine, paragraph.text);
    }
  }
};

export const insertEpubRows = (database: DatabaseSync, input: PersistedEpubProject) => {
  database.prepare('INSERT INTO source_archives(project_id, original_bytes) VALUES(?, ?)').run(input.project.projectId, input.originalBytes);
  database.exec(`
    CREATE TABLE IF NOT EXISTS project_covers (
      project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
      cover_data_url TEXT NOT NULL
    ) STRICT;
  `);
  if (input.epub.coverDataUrl) {
    database.prepare(`
      INSERT INTO project_covers(project_id, cover_data_url) VALUES(?, ?)
      ON CONFLICT(project_id) DO UPDATE SET cover_data_url = excluded.cover_data_url
    `).run(input.project.projectId, input.epub.coverDataUrl);
  }
  const details = input.epub.details;
  database.prepare(`
    INSERT INTO epub_documents(
      project_id, package_version, opf_path, package_language, creators_json,
      navigation_kind, navigation_path, page_progression, manifest_count, spine_count,
      image_count, ruby_count, script_count, external_reference_count, bilingual_layout,
      bilingual_pair_count, total_uncompressed_bytes, warnings_json
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.project.projectId, details.packageVersion, details.opfPath, details.packageLanguage,
    JSON.stringify(details.creators), details.navigationKind, details.navigationPath,
    details.pageProgression, details.manifestCount, details.spineCount, details.imageCount,
    details.rubyCount, details.scriptCount, details.externalReferenceCount,
    details.bilingualLayout, details.bilingualPairCount, details.totalUncompressedBytes,
    JSON.stringify(details.warnings),
  );
  const insertSpine = database.prepare(`
    INSERT INTO epub_spine_items(
      spine_item_id, project_id, ordinal, item_id, href, media_type, linear, title,
      source_hash, source_size_bytes, text_block_count, character_count, kana_count,
      han_count, script_count, ruby_count, image_count, external_reference_count
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBlock = database.prepare(`
    INSERT INTO epub_text_blocks(
      block_id, spine_item_id, project_id, ordinal, dom_path, source_line, tag_name,
      language, script_kind, source_text, source_xml, source_hash, style_hint, paired_ordinal
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const document of input.epub.spineDocuments) {
    const spineItemId = `${input.project.projectId}:s${String(document.ordinal).padStart(5, '0')}`;
    insertSpine.run(
      spineItemId, input.project.projectId, document.ordinal, document.itemId, document.href,
      document.mediaType, document.linear ? 1 : 0, document.title, document.sourceHash,
      document.sourceSizeBytes, document.textBlockCount, document.characterCount,
      document.kanaCount, document.hanCount, document.scriptCount, document.rubyCount,
      document.imageCount, document.externalReferenceCount,
    );
    for (const block of document.blocks) {
      const blockId = `${spineItemId}:b${String(block.ordinal).padStart(7, '0')}`;
      insertBlock.run(
        blockId, spineItemId, input.project.projectId, block.ordinal, block.domPath,
        block.sourceLine, block.tagName, block.language, block.scriptKind, block.sourceText,
        block.sourceXml, block.sourceHash, block.styleHint, block.pairedOrdinal,
      );
    }
  }
};
