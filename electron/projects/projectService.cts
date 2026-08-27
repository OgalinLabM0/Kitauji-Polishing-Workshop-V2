import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExportEpubResult,
  ClearProjectsResult,
  DeleteProjectResult,
  ImportProjectResult,
  ProjectChapterContent,
  ProjectSnapshot,
  ProjectSummary,
  SaveBlockDraftResult,
} from './models.cjs';
import { MAX_EPUB_SOURCE_BYTES } from './epubArchivePolicy.cjs';
import { buildEpubProofExport } from './epubExport.cjs';
import { parseEpubDocument } from './epubImport.cjs';
import { ProjectDatabase } from './projectDatabase.cjs';
import { MAX_TXT_SOURCE_BYTES, parseTxtDocument } from './txtImport.cjs';
import { ProjectPageCache } from '../storage/projectPageCache.cjs';

const safeErrorMessage = (error: unknown) => error instanceof Error ? error.message : '导入失败。';
const projectIdPattern = /^project-[a-f0-9]{24}$/u;
const chapterIdPattern = /^project-[a-f0-9]{24}:[cs]\d{5}$/u;
const blockIdPattern = /^project-[a-f0-9]{24}:s\d{5}:b\d{7}$/u;

export class ProjectService {
  readonly #database: ProjectDatabase;
  readonly #pageCache: ProjectPageCache | null;

  constructor(databasePath: string, cacheDirectory?: string) {
    this.#database = new ProjectDatabase(databasePath);
    this.#pageCache = cacheDirectory ? new ProjectPageCache(cacheDirectory) : null;
  }

  listProjects(): readonly ProjectSummary[] {
    return this.#database.listProjects();
  }

  getActiveProject(): ProjectSnapshot | null {
    return this.#database.getActiveProject();
  }

  openProject(projectId: string): ProjectSnapshot | null {
    if (!projectIdPattern.test(projectId)) return null;
    return this.#database.openProject(projectId);
  }

  deleteProject(projectId: string): DeleteProjectResult {
    try {
      if (!projectIdPattern.test(projectId)) return { status: 'not-found' };
      const result = this.#database.deleteProject(projectId);
      if (!result) return { status: 'not-found' };
      this.#pageCache?.invalidateProject(projectId);
      return { status: 'deleted', projectId, ...result };
    } catch (error) {
      return { status: 'error', message: safeErrorMessage(error) };
    }
  }

  clearProjects(): ClearProjectsResult {
    try {
      const projectIds = this.#database.listProjects().map(({ projectId }) => projectId);
      const deletedCount = this.#database.clearProjects();
      projectIds.forEach((projectId) => this.#pageCache?.invalidateProject(projectId));
      return { status: 'cleared', deletedCount };
    } catch (error) {
      return { status: 'error', message: safeErrorMessage(error) };
    }
  }

  setCacheDirectory(cacheDirectory: string) {
    this.#pageCache?.setDirectory(cacheDirectory);
  }

  readChapter(projectId: string, chapterId: string, offset = 0, limit = 120): ProjectChapterContent | null {
    if (!projectIdPattern.test(projectId) || !chapterIdPattern.test(chapterId)) return null;
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(200, Math.max(1, limit)) : 120;
    const cached = this.#pageCache?.get(projectId, chapterId, safeOffset, safeLimit);
    if (cached) return cached;
    const content = this.#database.readChapter(projectId, chapterId, safeOffset, safeLimit);
    if (content) this.#pageCache?.set(content);
    return content;
  }

  readSourceFile(projectId: string): string | null {
    if (!projectIdPattern.test(projectId)) return null;
    const bytes = this.#database.readOriginalSource(projectId);
    if (!bytes) return null;
    return Buffer.from(bytes).toString('base64');
  }

  saveReadingPosition(projectId: string, chapterId: string, blockOrdinal: number) {
    if (!projectIdPattern.test(projectId) || !chapterIdPattern.test(chapterId)) return false;
    if (!Number.isSafeInteger(blockOrdinal) || blockOrdinal < 1) return false;
    return this.#database.saveReadingPosition(projectId, chapterId, blockOrdinal, new Date().toISOString());
  }

  saveBlockDraft(projectId: string, blockId: string, draftText: string | null): SaveBlockDraftResult {
    if (!projectIdPattern.test(projectId) || !blockIdPattern.test(blockId)) {
      return { status: 'error', message: '校改目标无效。' };
    }
    if (draftText !== null) {
      if (draftText.length > 200_000) return { status: 'error', message: '单段校改超过 20 万字符的安全上限。' };
      if (!draftText.trim()) return { status: 'error', message: '校改内容不能为空；如需撤销，请使用“恢复原文”。' };
    }
    const result = this.#database.saveBlockDraft(projectId, blockId, draftText, new Date().toISOString());
    if (result.status === 'saved') this.#pageCache?.invalidateProject(projectId);
    return result;
  }

  async exportEpubToFile(projectId: string, outputPath: string): Promise<ExportEpubResult> {
    try {
      if (!projectIdPattern.test(projectId)) throw new Error('EPUB 项目无效。');
      if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLocaleLowerCase('en-US') !== '.epub') {
        throw new Error('导出位置必须是绝对路径，并以 .epub 结尾。');
      }
      const input = this.#database.getEpubExportInput(projectId);
      if (!input) throw new Error('没有找到可导出的 EPUB 项目。');
      if (path.resolve(outputPath).toLocaleLowerCase('en-US') === path.resolve(input.project.sourcePath).toLocaleLowerCase('en-US')) {
        throw new Error('不能覆盖导入时的原 EPUB，请另存为新的校样文件。');
      }
      const built = await buildEpubProofExport(input);
      const temporaryPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporaryPath, built.bytes, { flag: 'wx' });
        await rename(temporaryPath, outputPath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      return {
        status: 'exported',
        outputPath,
        changedDocumentCount: built.changedDocumentCount,
        changedBlockCount: built.changedBlockCount,
        outputSizeBytes: built.bytes.byteLength,
      };
    } catch (error) {
      return { status: 'error', message: safeErrorMessage(error) };
    }
  }

  async importSourceFile(sourcePath: string): Promise<ImportProjectResult> {
    const extension = path.extname(sourcePath).toLocaleLowerCase('en-US');
    if (extension === '.txt') return this.importTxtFile(sourcePath);
    if (extension === '.epub') return this.importEpubFile(sourcePath);
    return { status: 'error', message: '当前作品导入支持 .txt 和 .epub 文件。' };
  }

  async importTxtFile(sourcePath: string): Promise<ImportProjectResult> {
    try {
      if (!path.isAbsolute(sourcePath)) throw new Error('导入路径必须是绝对路径。');
      if (path.extname(sourcePath).toLocaleLowerCase() !== '.txt') throw new Error('当前正式导入只接受 .txt 文件。');
      const fileStats = await stat(sourcePath);
      if (!fileStats.isFile()) throw new Error('所选路径不是文件。');
      if (fileStats.size > MAX_TXT_SOURCE_BYTES) throw new Error('文本文件超过 64 MiB 的当前安全上限。');

      const bytes = await readFile(sourcePath);
      const parsed = parseTxtDocument(bytes);
      const sourceHash = createHash('sha256').update(bytes).digest('hex');
      const projectId = `project-${sourceHash.slice(0, 24)}`;
      const now = new Date().toISOString();
      const title = path.basename(sourcePath, path.extname(sourcePath)).trim() || '未命名作品';
      const project: ProjectSummary = {
        projectId,
        title,
        sourcePath,
        sourceFormat: 'txt',
        sourceEncoding: parsed.encoding,
        contentMode: 'japanese',
        sourceHash,
        sourceSizeBytes: bytes.byteLength,
        chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount,
        characterCount: parsed.characterCount,
        importedAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      };
      const persisted = this.#database.persistTxtProject({
        project,
        originalBytes: bytes,
        decodedText: parsed.text,
        newline: parsed.newline,
        chapters: parsed.chapters,
      });
      return { status: 'imported', ...persisted };
    } catch (error) {
      return { status: 'error', message: safeErrorMessage(error) };
    }
  }

  async importEpubFile(sourcePath: string): Promise<ImportProjectResult> {
    try {
      if (!path.isAbsolute(sourcePath)) throw new Error('导入路径必须是绝对路径。');
      if (path.extname(sourcePath).toLocaleLowerCase('en-US') !== '.epub') throw new Error('EPUB 导入只接受 .epub 文件。');
      const fileStats = await stat(sourcePath);
      if (!fileStats.isFile()) throw new Error('所选路径不是文件。');
      if (fileStats.size > MAX_EPUB_SOURCE_BYTES) throw new Error('EPUB 超过 512 MiB 的当前安全上限。');
      const bytes = await readFile(sourcePath);
      const parsed = await parseEpubDocument(bytes);
      const sourceHash = createHash('sha256').update(bytes).digest('hex');
      const now = new Date().toISOString();
      const fallbackTitle = path.basename(sourcePath, path.extname(sourcePath)).trim() || '未命名作品';
      const project: ProjectSummary = {
        projectId: `project-${sourceHash.slice(0, 24)}`,
        title: parsed.title || fallbackTitle,
        sourcePath,
        sourceFormat: 'epub',
        sourceEncoding: null,
        contentMode: parsed.contentMode,
        sourceHash,
        sourceSizeBytes: bytes.byteLength,
        chapterCount: parsed.spineDocuments.length,
        paragraphCount: parsed.textBlockCount,
        characterCount: parsed.characterCount,
        importedAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      };
      const persisted = this.#database.persistEpubProject({ project, originalBytes: bytes, epub: parsed });
      return { status: 'imported', ...persisted };
    } catch (error) {
      return { status: 'error', message: safeErrorMessage(error) };
    }
  }

  close() {
    this.#database.close();
  }
}
