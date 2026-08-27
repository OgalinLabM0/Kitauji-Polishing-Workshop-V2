import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildEpubProofExport } from './epubExport.cjs';
import { parseEpubDocument } from './epubImport.cjs';
import { createEpubFixture } from './epubTestFixture.cjs';
import { ProjectDatabase } from './projectDatabase.cjs';
import { ProjectService } from './projectService.cjs';
import { parseTxtDocument } from './txtImport.cjs';

const sourceBytes = new Uint8Array(Buffer.from('序章\n一行目。\n第一章\n二行目。', 'utf8'));

const buildInput = () => {
  const parsed = parseTxtDocument(sourceBytes);
  return {
    project: {
      projectId: 'project-1234567890abcdef12345678',
      title: '检验作品',
      sourcePath: 'D:\\books\\检验作品.txt',
      sourceFormat: 'txt' as const,
      sourceEncoding: parsed.encoding,
      contentMode: 'japanese' as const,
      sourceHash: 'a'.repeat(64),
      sourceSizeBytes: sourceBytes.byteLength,
      chapterCount: parsed.chapters.length,
      paragraphCount: parsed.paragraphCount,
      characterCount: parsed.characterCount,
      importedAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
      lastOpenedAt: '2026-08-26T00:00:00.000Z',
    },
    originalBytes: sourceBytes,
    decodedText: parsed.text,
    newline: parsed.newline,
    chapters: parsed.chapters,
  };
};

describe('project database', () => {
  it('creates the current schema and starts empty', () => {
    const database = new ProjectDatabase(':memory:');
    expect(database.schemaVersion).toBe(9);
    expect(database.listProjects()).toEqual([]);
    database.close();
  });

  it('stores immutable source bytes, chapters and paragraphs in one project transaction', () => {
    const database = new ProjectDatabase(':memory:');
    const result = database.persistTxtProject(buildInput());
    expect(result.duplicate).toBe(false);
    expect(result.snapshot.project).toMatchObject({ title: '检验作品', chapterCount: 2, paragraphCount: 2 });
    expect(result.snapshot.chapters.map((chapter) => chapter.title)).toEqual(['序章', '第一章']);
    expect(database.countRows('projects')).toBe(1);
    expect(database.countRows('chapters')).toBe(2);
    expect(database.countRows('paragraphs')).toBe(2);
    expect(Buffer.from(database.readOriginalSource(result.snapshot.project.projectId) ?? []).equals(Buffer.from(sourceBytes))).toBe(true);
    database.close();
  });

  it('deduplicates identical source hashes and keeps one active project', () => {
    const database = new ProjectDatabase(':memory:');
    database.persistTxtProject(buildInput());
    const duplicate = database.persistTxtProject({ ...buildInput(), project: { ...buildInput().project, sourcePath: 'D:\\moved\\检验作品.txt' } });
    expect(duplicate.duplicate).toBe(true);
    expect(database.countRows('projects')).toBe(1);
    expect(database.getActiveProject()?.project.sourcePath).toBe('D:\\moved\\检验作品.txt');
    database.close();
  });

  it('deletes one project with cascades and clears the active project when the library becomes empty', () => {
    const database = new ProjectDatabase(':memory:');
    const result = database.persistTxtProject(buildInput());
    expect(database.deleteProject(result.snapshot.project.projectId)).toMatchObject({ deletedTitle: '检验作品', activeProject: null });
    expect(database.countRows('projects')).toBe(0);
    expect(database.countRows('chapters')).toBe(0);
    expect(database.countRows('paragraphs')).toBe(0);
    expect(database.integrityCheck()).toBe('ok');
    database.close();
  });

  it('clears every project and dependent source row in one transaction', () => {
    const database = new ProjectDatabase(':memory:');
    database.persistTxtProject(buildInput());
    expect(database.clearProjects()).toBe(1);
    expect(database.getActiveProject()).toBeNull();
    expect(database.countRows('projects')).toBe(0);
    expect(database.countRows('chapters')).toBe(0);
    expect(database.countRows('paragraphs')).toBe(0);
    database.close();
  });

  it('imports the shipped Japanese TXT sample through the real file service', async () => {
    const service = new ProjectService(':memory:');
    const samplePath = path.resolve('samples', '日文TXT导入示例.txt');
    const result = await service.importTxtFile(samplePath);
    expect(result.status).toBe('imported');
    if (result.status === 'imported') {
      expect(result.snapshot.project).toMatchObject({ title: '日文TXT导入示例', sourceEncoding: 'utf-8', chapterCount: 4 });
      expect(result.snapshot.chapters.map((chapter) => chapter.title)).toEqual(['开篇', '序章', '第一章　もう一度、最初から', '第二章　名前の呼び方']);
    }
    service.close();
  });

  it('stores an EPUB archive, structure, text blocks and bilingual pairing in one transaction', async () => {
    const database = new ProjectDatabase(':memory:');
    const bytes = await createEpubFixture();
    const epub = await parseEpubDocument(bytes);
    const result = database.persistEpubProject({
      project: {
        projectId: 'project-abcdef1234567890abcdef12',
        title: epub.title ?? 'EPUB',
        sourcePath: 'D:\\books\\fixture.epub',
        sourceFormat: 'epub',
        sourceEncoding: null,
        contentMode: epub.contentMode,
        sourceHash: 'b'.repeat(64),
        sourceSizeBytes: bytes.byteLength,
        chapterCount: epub.spineDocuments.length,
        paragraphCount: epub.textBlockCount,
        characterCount: epub.characterCount,
        importedAt: '2026-08-26T01:00:00.000Z',
        updatedAt: '2026-08-26T01:00:00.000Z',
        lastOpenedAt: '2026-08-26T01:00:00.000Z',
      },
      originalBytes: bytes,
      epub,
    });
    expect(result.snapshot.project).toMatchObject({ sourceFormat: 'epub', contentMode: 'bilingual' });
    expect(result.snapshot.epub).toMatchObject({ opfPath: 'OPS/package.opf', bilingualPairCount: 1 });
    expect(result.snapshot.chapters[0]).toMatchObject({ title: '序章', paragraphCount: 4 });
    expect(database.countRows('epub_documents')).toBe(1);
    expect(database.countRows('epub_spine_items')).toBe(1);
    expect(database.countRows('epub_text_blocks')).toBe(4);
    expect(Buffer.from(database.readOriginalSource(result.snapshot.project.projectId) ?? []).equals(Buffer.from(bytes))).toBe(true);
    expect(database.integrityCheck()).toBe('ok');
    database.close();
  });

  it('reads chapters, persists reading position and only edits plain Chinese blocks', async () => {
    const database = new ProjectDatabase(':memory:');
    const bytes = await createEpubFixture();
    const epub = await parseEpubDocument(bytes);
    const projectId = 'project-fedcba0987654321fedcba09';
    const persisted = database.persistEpubProject({
      project: {
        projectId,
        title: '双语校样',
        sourcePath: 'D:\\books\\bilingual.epub',
        sourceFormat: 'epub',
        sourceEncoding: null,
        contentMode: epub.contentMode,
        sourceHash: 'c'.repeat(64),
        sourceSizeBytes: bytes.byteLength,
        chapterCount: epub.spineDocuments.length,
        paragraphCount: epub.textBlockCount,
        characterCount: epub.characterCount,
        importedAt: '2026-08-26T02:00:00.000Z',
        updatedAt: '2026-08-26T02:00:00.000Z',
        lastOpenedAt: '2026-08-26T02:00:00.000Z',
      },
      originalBytes: bytes,
      epub,
    });
    const chapterId = persisted.snapshot.chapters[0].chapterId;
    const chapter = database.readChapter(projectId, chapterId, 0, 120);
    expect(chapter?.blocks.map((block) => [block.scriptKind, block.canEdit])).toEqual([
      ['neutral', false], ['chinese', true], ['japanese', false], ['japanese', false],
    ]);
    const chinese = chapter?.blocks[1];
    expect(chinese).toBeDefined();
    const saved = database.saveBlockDraft(projectId, chinese!.blockId, '这是人工校改后的中文。', '2026-08-26T02:01:00.000Z');
    expect(saved).toMatchObject({ status: 'saved', draftText: '这是人工校改后的中文。' });
    expect(database.saveReadingPosition(projectId, chapterId, 2, '2026-08-26T02:02:00.000Z')).toBe(true);
    expect(database.getProject(projectId)).toMatchObject({
      epubDraftCount: 1,
      readingPosition: { chapterId, blockOrdinal: 2 },
    });
    expect(database.countRows('epub_block_drafts')).toBe(1);
    expect(database.countRows('reading_positions')).toBe(1);
    const japanese = chapter?.blocks[2];
    expect(database.saveBlockDraft(projectId, japanese!.blockId, '不应写入', '2026-08-26T02:03:00.000Z')).toMatchObject({ status: 'error' });
    database.close();
  });

  it('writes saved Chinese drafts into a validated EPUB copy without changing other resources', async () => {
    const database = new ProjectDatabase(':memory:');
    const bytes = await createEpubFixture();
    const epub = await parseEpubDocument(bytes);
    const sourceHash = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const projectId = `project-${sourceHash.slice(0, 24)}`;
    const persisted = database.persistEpubProject({
      project: {
        projectId,
        title: '写回检验',
        sourcePath: 'D:\\books\\writeback.epub',
        sourceFormat: 'epub',
        sourceEncoding: null,
        contentMode: epub.contentMode,
        sourceHash,
        sourceSizeBytes: bytes.byteLength,
        chapterCount: epub.spineDocuments.length,
        paragraphCount: epub.textBlockCount,
        characterCount: epub.characterCount,
        importedAt: '2026-08-26T03:00:00.000Z',
        updatedAt: '2026-08-26T03:00:00.000Z',
        lastOpenedAt: '2026-08-26T03:00:00.000Z',
      },
      originalBytes: bytes,
      epub,
    });
    const chapter = database.readChapter(projectId, persisted.snapshot.chapters[0].chapterId, 0, 120);
    const chinese = chapter?.blocks.find((block) => block.scriptKind === 'chinese');
    expect(chinese?.canEdit).toBe(true);
    database.saveBlockDraft(projectId, chinese!.blockId, '这是人工校改后的中文。', '2026-08-26T03:01:00.000Z');
    const input = database.getEpubExportInput(projectId);
    expect(input).not.toBeNull();
    const output = await buildEpubProofExport(input!);
    expect(output).toMatchObject({ changedDocumentCount: 1, changedBlockCount: 1 });
    const [originalZip, outputZip] = await Promise.all([JSZip.loadAsync(bytes), JSZip.loadAsync(output.bytes)]);
    const [originalChapter, outputChapter, originalRubyResource, outputRubyResource] = await Promise.all([
      originalZip.file('OPS/chapter.xhtml')!.async('string'),
      outputZip.file('OPS/chapter.xhtml')!.async('string'),
      originalZip.file('OPS/style.css')!.async('uint8array'),
      outputZip.file('OPS/style.css')!.async('uint8array'),
    ]);
    expect(originalChapter).toContain('<p>这是中文。</p>');
    expect(outputChapter).toContain('<p>这是人工校改后的中文。</p>');
    expect(outputChapter).toContain('<ruby>身体<rt>からだ</rt></ruby>');
    expect(Buffer.from(outputRubyResource).equals(Buffer.from(originalRubyResource))).toBe(true);
    database.close();
  });
});
