import type { DatabaseSync } from 'node:sqlite';
import type {
  ChapterContentBlock,
  EpubExportInput,
  ProjectChapterContent,
  ProjectContentMode,
  ProjectReadingPosition,
  ProjectSourceFormat,
  SaveBlockDraftResult,
} from './models.cjs';
import { elementChildren, parseXmlDocument } from './epubXml.cjs';
import { projectColumns, toProjectSummary, type ProjectRow } from './projectRows.cjs';

interface ChapterIdentityRow {
  readonly chapter_id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly source_format: ProjectSourceFormat;
  readonly content_mode: ProjectContentMode;
  readonly total_blocks: number;
}

interface EpubBlockRow {
  readonly block_id: string;
  readonly ordinal: number;
  readonly dom_path?: string;
  readonly source_line: number | null;
  readonly tag_name: string;
  readonly language: string | null;
  readonly script_kind: ChapterContentBlock['scriptKind'];
  readonly source_text: string;
  readonly source_xml: string;
  readonly style_hint: string | null;
  readonly paired_ordinal: number | null;
  readonly draft_text: string | null;
}

interface TxtParagraphRow {
  readonly paragraph_id: string;
  readonly ordinal: number;
  readonly source_line: number;
  readonly source_text: string;
}

const simpleXmlBlock = (sourceXml: string) => {
  try {
    const document = parseXmlDocument(sourceXml, 'EPUB 文本块', 'application/xhtml+xml');
    const root = document.documentElement;
    return root ? elementChildren(root).length === 0 : false;
  } catch {
    return false;
  }
};

const editDecision = (row: EpubBlockRow, mode: ProjectContentMode) => {
  if (mode !== 'bilingual') return { canEdit: false, editRestriction: '日文原书的中文生成将在翻译阶段接入。' };
  if (row.script_kind !== 'chinese') return { canEdit: false, editRestriction: '原文段只读；校样只修改已有中文段。' };
  if (!simpleXmlBlock(row.source_xml)) return { canEdit: false, editRestriction: '含 ruby、链接或行内样式，等待结构化标记写回。' };
  return { canEdit: true, editRestriction: null };
};

const chapterIdentity = (database: DatabaseSync, projectId: string, chapterId: string): ChapterIdentityRow | null => {
  const project = database.prepare('SELECT source_format, content_mode FROM projects WHERE project_id = ?').get(projectId) as {
    source_format: ProjectSourceFormat;
    content_mode: ProjectContentMode;
  } | undefined;
  if (!project) return null;
  if (project.source_format === 'epub') {
    const row = database.prepare(`
      SELECT spine_item_id AS chapter_id, ordinal, title, text_block_count AS total_blocks
      FROM epub_spine_items WHERE project_id = ? AND spine_item_id = ?
    `).get(projectId, chapterId) as Omit<ChapterIdentityRow, 'source_format' | 'content_mode'> | undefined;
    return row ? { ...row, ...project } : null;
  }
  const row = database.prepare(`
    SELECT chapter_id, ordinal, title, paragraph_count AS total_blocks
    FROM chapters WHERE project_id = ? AND chapter_id = ?
  `).get(projectId, chapterId) as Omit<ChapterIdentityRow, 'source_format' | 'content_mode'> | undefined;
  return row ? { ...row, ...project } : null;
};

export const readProjectChapter = (
  database: DatabaseSync,
  projectId: string,
  chapterId: string,
  offset: number,
  limit: number,
): ProjectChapterContent | null => {
  const chapter = chapterIdentity(database, projectId, chapterId);
  if (!chapter) return null;
  let blocks: readonly ChapterContentBlock[];
  if (chapter.source_format === 'epub') {
    const rows = database.prepare(`
      SELECT b.block_id, b.ordinal, b.dom_path, b.source_line, b.tag_name, b.language, b.script_kind,
        b.source_text, b.source_xml, b.style_hint, b.paired_ordinal, d.draft_text
      FROM epub_text_blocks b
      LEFT JOIN epub_block_drafts d ON d.block_id = b.block_id
      WHERE b.project_id = ? AND b.spine_item_id = ?
      ORDER BY b.ordinal LIMIT ? OFFSET ?
    `).all(projectId, chapterId, limit, offset) as unknown as EpubBlockRow[];
    blocks = rows.map((row) => ({
      blockId: row.block_id,
      ordinal: row.ordinal,
      domPath: row.dom_path,
      sourceLine: row.source_line,
      tagName: row.tag_name,
      language: row.language,
      scriptKind: row.script_kind,
      sourceText: row.source_text,
      styleHint: row.style_hint,
      pairedOrdinal: row.paired_ordinal,
      draftText: row.draft_text,
      ...editDecision(row, chapter.content_mode),
    }));
  } else {
    const rows = database.prepare(`
      SELECT paragraph_id, ordinal, source_line, source_text
      FROM paragraphs WHERE project_id = ? AND chapter_id = ?
      ORDER BY ordinal LIMIT ? OFFSET ?
    `).all(projectId, chapterId, limit, offset) as unknown as TxtParagraphRow[];
    blocks = rows.map((row) => ({
      blockId: row.paragraph_id,
      ordinal: row.ordinal,
      sourceLine: row.source_line,
      tagName: 'p',
      language: 'ja',
      scriptKind: 'text',
      sourceText: row.source_text,
      styleHint: null,
      pairedOrdinal: null,
      draftText: null,
      canEdit: false,
      editRestriction: 'TXT 当前提供原文阅读；译文工作区将在翻译阶段接入。',
    }));
  }
  return {
    projectId,
    chapterId,
    chapterOrdinal: chapter.ordinal,
    chapterTitle: chapter.title,
    sourceFormat: chapter.source_format,
    contentMode: chapter.content_mode,
    totalBlocks: chapter.total_blocks,
    offset,
    limit,
    blocks,
  };
};

export const readPosition = (database: DatabaseSync, projectId: string): ProjectReadingPosition | null => {
  const row = database.prepare(`
    SELECT chapter_id, block_ordinal, updated_at FROM reading_positions WHERE project_id = ?
  `).get(projectId) as { chapter_id: string; block_ordinal: number; updated_at: string } | undefined;
  return row ? { chapterId: row.chapter_id, blockOrdinal: row.block_ordinal, updatedAt: row.updated_at } : null;
};

export const savePosition = (
  database: DatabaseSync,
  projectId: string,
  chapterId: string,
  blockOrdinal: number,
  updatedAt: string,
) => {
  if (!chapterIdentity(database, projectId, chapterId)) return false;
  database.prepare(`
    INSERT INTO reading_positions(project_id, chapter_id, block_ordinal, updated_at) VALUES(?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET chapter_id = excluded.chapter_id,
      block_ordinal = excluded.block_ordinal, updated_at = excluded.updated_at
  `).run(projectId, chapterId, blockOrdinal, updatedAt);
  return true;
};

export const countEpubDrafts = (database: DatabaseSync, projectId: string) => (
  database.prepare('SELECT count(*) AS count FROM epub_block_drafts WHERE project_id = ?').get(projectId) as { count: number }
).count;

export const saveEpubBlockDraft = (
  database: DatabaseSync,
  projectId: string,
  blockId: string,
  draftText: string | null,
  updatedAt: string,
): SaveBlockDraftResult => {
  const row = database.prepare(`
    SELECT b.block_id, b.ordinal, b.source_line, b.tag_name, b.language, b.script_kind,
      b.source_text, b.source_xml, b.style_hint, b.paired_ordinal, b.source_hash,
      p.content_mode, NULL AS draft_text
    FROM epub_text_blocks b JOIN projects p ON p.project_id = b.project_id
    WHERE b.project_id = ? AND b.block_id = ?
  `).get(projectId, blockId) as (EpubBlockRow & { source_hash: string; content_mode: ProjectContentMode }) | undefined;
  if (!row) return { status: 'error', message: '没有找到要保存的 EPUB 文本段。' };
  const decision = editDecision(row, row.content_mode);
  if (!decision.canEdit) return { status: 'error', message: decision.editRestriction ?? '这个文本段当前不能写回。' };
  const normalizedDraft = draftText === null || draftText === row.source_text ? null : draftText;
  if (normalizedDraft === null) {
    database.prepare('DELETE FROM epub_block_drafts WHERE block_id = ? AND project_id = ?').run(blockId, projectId);
  } else {
    database.prepare(`
      INSERT INTO epub_block_drafts(block_id, project_id, draft_text, saved_source_hash, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(block_id) DO UPDATE SET draft_text = excluded.draft_text,
        saved_source_hash = excluded.saved_source_hash, updated_at = excluded.updated_at
    `).run(blockId, projectId, normalizedDraft, row.source_hash, updatedAt);
  }
  database.prepare('UPDATE projects SET updated_at = ? WHERE project_id = ?').run(updatedAt, projectId);
  return { status: 'saved', blockId, draftText: normalizedDraft, updatedAt };
};

export const readEpubExportInput = (database: DatabaseSync, projectId: string): EpubExportInput | null => {
  const projectRow = database.prepare(`SELECT ${projectColumns} FROM projects WHERE project_id = ? AND source_format = 'epub'`)
    .get(projectId) as ProjectRow | undefined;
  if (!projectRow) return null;
  const archive = database.prepare('SELECT original_bytes FROM source_archives WHERE project_id = ?').get(projectId) as {
    original_bytes: Uint8Array;
  } | undefined;
  if (!archive) throw new Error('EPUB 项目缺少原始文件快照。');
  const drafts = database.prepare(`
    SELECT d.block_id, s.href AS document_path, s.source_hash AS document_source_hash,
      b.dom_path, b.source_xml, b.source_hash, d.draft_text, d.saved_source_hash
    FROM epub_block_drafts d
    JOIN epub_text_blocks b ON b.block_id = d.block_id
    JOIN epub_spine_items s ON s.spine_item_id = b.spine_item_id
    WHERE d.project_id = ? ORDER BY s.ordinal, b.ordinal
  `).all(projectId) as unknown as Array<{
    block_id: string;
    document_path: string;
    document_source_hash: string;
    dom_path: string;
    source_xml: string;
    source_hash: string;
    draft_text: string;
    saved_source_hash: string;
  }>;
  return {
    project: toProjectSummary(projectRow),
    originalBytes: archive.original_bytes,
    drafts: drafts.map((row) => ({
      blockId: row.block_id,
      documentPath: row.document_path,
      documentSourceHash: row.document_source_hash,
      domPath: row.dom_path,
      sourceXml: row.source_xml,
      sourceHash: row.source_hash,
      draftText: row.draft_text,
      savedSourceHash: row.saved_source_hash,
    })),
  };
};
