import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectChapterContent } from '../projects/models.cjs';

const safeProjectId = /^project-[a-f0-9]{24}$/u;
const sourceFormats = new Set(['txt', 'epub']);
const contentModes = new Set(['japanese', 'bilingual', 'unknown']);
const scriptKinds = new Set(['japanese', 'chinese', 'mixed', 'neutral', 'unknown', 'text']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isNullableOrdinal = (value: unknown): value is number | null => value === null || (Number.isSafeInteger(value) && Number(value) >= 0);

const validBlock = (block: unknown) => isRecord(block)
  && typeof block.blockId === 'string'
  && Number.isSafeInteger(block.ordinal) && Number(block.ordinal) >= 0
  && isNullableOrdinal(block.sourceLine)
  && typeof block.tagName === 'string'
  && isNullableString(block.language)
  && typeof block.scriptKind === 'string' && scriptKinds.has(block.scriptKind)
  && typeof block.sourceText === 'string'
  && isNullableString(block.styleHint)
  && isNullableOrdinal(block.pairedOrdinal)
  && isNullableString(block.draftText)
  && typeof block.canEdit === 'boolean'
  && isNullableString(block.editRestriction);

const validCachedContent = (value: unknown, projectId: string, chapterId: string, offset: number, limit: number): value is ProjectChapterContent => {
  if (!isRecord(value) || value.projectId !== projectId || value.chapterId !== chapterId || value.offset !== offset || value.limit !== limit) return false;
  if (typeof value.chapterTitle !== 'string' || !Number.isSafeInteger(value.chapterOrdinal) || Number(value.chapterOrdinal) < 0) return false;
  if (typeof value.sourceFormat !== 'string' || !sourceFormats.has(value.sourceFormat) || typeof value.contentMode !== 'string' || !contentModes.has(value.contentMode)) return false;
  if (!Number.isSafeInteger(value.totalBlocks) || Number(value.totalBlocks) < 0 || !Array.isArray(value.blocks)) return false;
  return value.blocks.every(validBlock);
};

export class ProjectPageCache {
  #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  setDirectory(directory: string) {
    this.#directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  #filePath(projectId: string, chapterId: string, offset: number, limit: number) {
    const digest = createHash('sha256').update(`${projectId}\0${chapterId}\0${offset}\0${limit}`).digest('hex').slice(0, 28);
    return path.join(this.#directory, `${projectId}_${digest}.json`);
  }

  get(projectId: string, chapterId: string, offset: number, limit: number): ProjectChapterContent | null {
    if (!safeProjectId.test(projectId)) return null;
    const filePath = this.#filePath(projectId, chapterId, offset, limit);
    if (!existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
      if (!validCachedContent(parsed, projectId, chapterId, offset, limit)) {
        rmSync(filePath, { force: true });
        return null;
      }
      return parsed;
    } catch {
      rmSync(filePath, { force: true });
      return null;
    }
  }

  set(content: ProjectChapterContent) {
    if (!safeProjectId.test(content.projectId)) return;
    const filePath = this.#filePath(content.projectId, content.chapterId, content.offset, content.limit);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(content), { encoding: 'utf8', flag: 'wx' });
    rmSync(filePath, { force: true });
    renameSync(temporaryPath, filePath);
  }

  invalidateProject(projectId: string) {
    if (!safeProjectId.test(projectId) || !existsSync(this.#directory)) return;
    const prefix = `${projectId}_`;
    for (const entry of readdirSync(this.#directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json')) {
        rmSync(path.join(this.#directory, entry.name), { force: true });
      }
    }
  }
}
