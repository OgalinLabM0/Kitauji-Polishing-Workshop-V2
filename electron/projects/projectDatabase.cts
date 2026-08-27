import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  EpubExportInput,
  PersistedEpubProject,
  PersistedTxtProject,
  ProjectChapterContent,
  ProjectSnapshot,
  ProjectSummary,
  SaveBlockDraftResult,
} from './models.cjs';
import { insertEpubRows, insertProjectRow, insertTxtRows } from './projectPersistence.cjs';
import {
  projectColumns,
  toEpubDetails,
  toProjectSummary,
  type ChapterRow,
  type EpubDetailsRow,
  type EpubSpineRow,
  type ProjectRow,
} from './projectRows.cjs';
import { createPreMigrationSnapshot } from '../storage/databaseSafety.cjs';
import { CURRENT_PROJECT_SCHEMA_VERSION, migrateProjectDatabase } from './projectSchema.cjs';
import {
  countEpubDrafts,
  readEpubExportInput,
  readPosition,
  readProjectChapter,
  saveEpubBlockDraft,
  savePosition,
} from './projectReading.cjs';

import { extractCoverFromEpubBytes } from './epubImport.cjs';

const isNavigationDocument = (href: string, title: string, navigationPath: string | null) => (
  href === navigationPath ||
  /(?:^|[\/_-])(?:toc|nav)(?:[\/_.-]|$)/iu.test(href) ||
  /^(?:目次|目录|contents?|table of contents)$/iu.test(title.trim())
);

export class ProjectDatabase {
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (databasePath !== ':memory:') createPreMigrationSnapshot(this.#database, databasePath, CURRENT_PROJECT_SCHEMA_VERSION);
    if (databasePath !== ':memory:') this.#database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrateProjectDatabase(this.#database);
  }

  get schemaVersion() {
    return (this.#database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  }

  listProjects(): readonly ProjectSummary[] {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS project_covers (
        project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
        cover_data_url TEXT NOT NULL
      ) STRICT;
    `);
    const rows = this.#database.prepare(`
      SELECT p.project_id, p.title, p.source_path, p.source_format, p.source_encoding, p.content_mode,
        p.source_hash, p.source_size_bytes, p.chapter_count, p.paragraph_count, p.character_count,
        p.imported_at, p.updated_at, p.last_opened_at, c.cover_data_url
      FROM projects p
      LEFT JOIN project_covers c ON c.project_id = p.project_id
      ORDER BY p.last_opened_at DESC, p.imported_at DESC
    `).all() as unknown as Array<ProjectRow & { cover_data_url?: string | null }>;

    return rows.map((row) => {
      let coverUrl = row.cover_data_url ?? null;
      if (!coverUrl && row.source_format === 'epub') {
        const archiveRow = this.#database.prepare('SELECT original_bytes FROM source_archives WHERE project_id = ?').get(row.project_id) as { original_bytes: Uint8Array } | undefined;
        if (archiveRow?.original_bytes) {
          void extractCoverFromEpubBytes(archiveRow.original_bytes).then((url) => {
            if (url) {
              try {
                this.#database.prepare(`
                  INSERT INTO project_covers(project_id, cover_data_url) VALUES(?, ?)
                  ON CONFLICT(project_id) DO UPDATE SET cover_data_url = excluded.cover_data_url
                `).run(row.project_id, url);
              } catch {
                // ignore
              }
            }
          });
        }
      }
      return toProjectSummary({ ...row, cover_data_url: coverUrl });
    });
  }

  getProject(projectId: string): ProjectSnapshot | null {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS project_covers (
        project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
        cover_data_url TEXT NOT NULL
      ) STRICT;
    `);
    const projectRow = this.#database.prepare(`
      SELECT p.project_id, p.title, p.source_path, p.source_format, p.source_encoding, p.content_mode,
        p.source_hash, p.source_size_bytes, p.chapter_count, p.paragraph_count, p.character_count,
        p.imported_at, p.updated_at, p.last_opened_at, c.cover_data_url
      FROM projects p
      LEFT JOIN project_covers c ON c.project_id = p.project_id
      WHERE p.project_id = ?
    `).get(projectId) as (ProjectRow & { cover_data_url?: string | null }) | undefined;
    if (!projectRow) return null;
    return projectRow.source_format === 'epub'
      ? this.#getEpubProject(projectRow)
      : this.#getTxtProject(projectRow);
  }

  #getTxtProject(projectRow: ProjectRow): ProjectSnapshot {
    const rows = this.#database.prepare(`
      SELECT chapter_id, ordinal, title, start_line, end_line, paragraph_count, character_count
      FROM chapters WHERE project_id = ? ORDER BY ordinal
    `).all(projectRow.project_id) as unknown as ChapterRow[];
    return {
      project: toProjectSummary(projectRow),
      chapters: rows.map((row) => ({
        chapterId: row.chapter_id,
        ordinal: row.ordinal,
        title: row.title,
        startLine: row.start_line,
        endLine: row.end_line,
        paragraphCount: row.paragraph_count,
        characterCount: row.character_count,
        isNavigation: false,
      })),
      epub: null,
      readingPosition: readPosition(this.#database, projectRow.project_id),
      epubDraftCount: 0,
    };
  }

  #getEpubProject(projectRow: ProjectRow): ProjectSnapshot {
    const rows = this.#database.prepare(`
      SELECT spine_item_id, ordinal, title, text_block_count, character_count, href
      FROM epub_spine_items WHERE project_id = ? ORDER BY ordinal
    `).all(projectRow.project_id) as unknown as EpubSpineRow[];
    const detailsRow = this.#database.prepare(`
      SELECT package_version, opf_path, package_language, creators_json, navigation_kind,
        navigation_path, page_progression, manifest_count, spine_count, image_count, ruby_count,
        script_count, external_reference_count, bilingual_layout, bilingual_pair_count,
        total_uncompressed_bytes, warnings_json
      FROM epub_documents WHERE project_id = ?
    `).get(projectRow.project_id) as EpubDetailsRow | undefined;
    if (!detailsRow) throw new Error('EPUB 项目缺少结构记录。');
    return {
      project: toProjectSummary(projectRow),
      chapters: rows.map((row) => ({
        chapterId: row.spine_item_id,
        ordinal: row.ordinal,
        title: row.title,
        href: row.href,
        startLine: 0,
        endLine: 0,
        paragraphCount: row.text_block_count,
        characterCount: row.character_count,
        isNavigation: isNavigationDocument(row.href, row.title, detailsRow.navigation_path),
      })),
      epub: toEpubDetails(detailsRow),
      readingPosition: readPosition(this.#database, projectRow.project_id),
      epubDraftCount: countEpubDrafts(this.#database, projectRow.project_id),
    };
  }

  getActiveProject(): ProjectSnapshot | null {
    const state = this.#database.prepare(`SELECT value FROM app_state WHERE key = 'active_project_id'`).get() as { value: string } | undefined;
    return state ? this.getProject(state.value) : null;
  }

  #activateProject(projectId: string, openedAt: string) {
    this.#database.prepare('UPDATE projects SET last_opened_at = ? WHERE project_id = ?').run(openedAt, projectId);
    this.#database.prepare(`
      INSERT INTO app_state(key, value) VALUES('active_project_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(projectId);
  }

  openProject(projectId: string, openedAt = new Date().toISOString()): ProjectSnapshot | null {
    if (!this.getProject(projectId)) return null;
    this.#transaction(() => this.#activateProject(projectId, openedAt));
    return this.getProject(projectId);
  }

  deleteProject(projectId: string) {
    const project = this.#database.prepare('SELECT title FROM projects WHERE project_id = ?').get(projectId) as { title: string } | undefined;
    if (!project) return null;
    this.#transaction(() => {
      const active = this.#database.prepare(`SELECT value FROM app_state WHERE key = 'active_project_id'`).get() as { value: string } | undefined;
      this.#database.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
      if (active?.value === projectId) {
        const next = this.#database.prepare('SELECT project_id FROM projects ORDER BY last_opened_at DESC, imported_at DESC LIMIT 1').get() as { project_id: string } | undefined;
        if (next) {
          this.#database.prepare(`UPDATE app_state SET value = ? WHERE key = 'active_project_id'`).run(next.project_id);
        } else {
          this.#database.prepare(`DELETE FROM app_state WHERE key = 'active_project_id'`).run();
        }
      }
    });
    return { deletedTitle: project.title, activeProject: this.getActiveProject() };
  }

  clearProjects() {
    const count = this.countRows('projects');
    this.#transaction(() => {
      this.#database.prepare('DELETE FROM projects').run();
      this.#database.prepare(`DELETE FROM app_state WHERE key = 'active_project_id'`).run();
    });
    return count;
  }

  #openDuplicate(project: ProjectSummary) {
    const existing = this.#database.prepare('SELECT project_id FROM projects WHERE source_hash = ?').get(project.sourceHash) as { project_id: string } | undefined;
    if (!existing) return null;
    this.#transaction(() => {
      this.#database.prepare(`
        UPDATE projects SET title = ?, source_path = ?, updated_at = ?, last_opened_at = ? WHERE project_id = ?
      `).run(project.title, project.sourcePath, project.updatedAt, project.lastOpenedAt, existing.project_id);
      this.#activateProject(existing.project_id, project.lastOpenedAt);
    });
    const snapshot = this.getProject(existing.project_id);
    if (!snapshot) throw new Error('重复项目存在但无法重新打开。');
    return { snapshot, duplicate: true as const };
  }

  #transaction(action: () => void) {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      action();
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  persistTxtProject(input: PersistedTxtProject): { readonly snapshot: ProjectSnapshot; readonly duplicate: boolean } {
    const duplicate = this.#openDuplicate(input.project);
    if (duplicate) return duplicate;
    this.#transaction(() => {
      insertProjectRow(this.#database, input.project);
      insertTxtRows(this.#database, input);
      this.#activateProject(input.project.projectId, input.project.lastOpenedAt);
    });
    const snapshot = this.getProject(input.project.projectId);
    if (!snapshot) throw new Error('TXT 项目写入完成后无法读取。');
    return { snapshot, duplicate: false };
  }

  persistEpubProject(input: PersistedEpubProject): { readonly snapshot: ProjectSnapshot; readonly duplicate: boolean } {
    const duplicate = this.#openDuplicate(input.project);
    if (duplicate) return duplicate;
    this.#transaction(() => {
      insertProjectRow(this.#database, input.project);
      insertEpubRows(this.#database, input);
      this.#activateProject(input.project.projectId, input.project.lastOpenedAt);
    });
    const snapshot = this.getProject(input.project.projectId);
    if (!snapshot) throw new Error('EPUB 项目写入完成后无法读取。');
    return { snapshot, duplicate: false };
  }

  readOriginalSource(projectId: string): Uint8Array | null {
    const text = this.#database.prepare('SELECT original_bytes FROM source_documents WHERE project_id = ?').get(projectId) as { original_bytes: Uint8Array } | undefined;
    if (text) return text.original_bytes;
    const archive = this.#database.prepare('SELECT original_bytes FROM source_archives WHERE project_id = ?').get(projectId) as { original_bytes: Uint8Array } | undefined;
    return archive?.original_bytes ?? null;
  }

  readChapter(projectId: string, chapterId: string, offset: number, limit: number): ProjectChapterContent | null {
    return readProjectChapter(this.#database, projectId, chapterId, offset, limit);
  }

  saveReadingPosition(projectId: string, chapterId: string, blockOrdinal: number, updatedAt: string) {
    let saved = false;
    this.#transaction(() => { saved = savePosition(this.#database, projectId, chapterId, blockOrdinal, updatedAt); });
    return saved;
  }

  saveBlockDraft(projectId: string, blockId: string, draftText: string | null, updatedAt: string): SaveBlockDraftResult {
    let result: SaveBlockDraftResult = { status: 'error', message: '校改草稿没有保存。' };
    this.#transaction(() => { result = saveEpubBlockDraft(this.#database, projectId, blockId, draftText, updatedAt); });
    return result;
  }

  getEpubExportInput(projectId: string): EpubExportInput | null {
    return readEpubExportInput(this.#database, projectId);
  }

  countRows(table: 'projects' | 'chapters' | 'paragraphs' | 'epub_documents' | 'epub_spine_items' | 'epub_text_blocks' | 'reading_positions' | 'epub_block_drafts') {
    return (this.#database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
  }

  integrityCheck() {
    return (this.#database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }
}
