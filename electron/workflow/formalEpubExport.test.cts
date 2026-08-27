import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDatabase } from '../projects/projectDatabase.cjs';
import { parseEpubDocument } from '../projects/epubImport.cjs';
import { parseTxtDocument } from '../projects/txtImport.cjs';
import { createEpubFixture } from '../projects/epubTestFixture.cjs';
import { buildFormalEpub } from './formalEpubExport.cjs';
import { WorkflowRepository } from './workflowRepository.cjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('formal EPUB export', () => {
  it('builds validated Chinese-only and bilingual EPUBs from Japanese TXT', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-formal-export-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const bytes = new Uint8Array(Buffer.from('序章\n関は来た。\n第一章\n祈は待った。', 'utf8'));
    const parsed = parseTxtDocument(bytes);
    const projectId = 'project-1234567890abcdef12345678';
    const database = new ProjectDatabase(databasePath);
    database.persistTxtProject({ project: { projectId, title: '成品检验', sourcePath: 'D:\\成品检验.txt', sourceFormat: 'txt', sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: '0'.repeat(64), sourceSizeBytes: bytes.length, chapterCount: parsed.chapters.length, paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount, importedAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z', lastOpenedAt: '2026-08-26T00:00:00.000Z' }, originalBytes: bytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters });
    // The production importer records the real source hash; repair the synthetic fixture to match it.
    database.close();
    const sqlite = new (await import('node:sqlite')).DatabaseSync(databasePath);
    const { createHash } = await import('node:crypto');
    sqlite.prepare('UPDATE projects SET source_hash = ? WHERE project_id = ?').run(createHash('sha256').update(bytes).digest('hex'), projectId);
    sqlite.close();

    const repository = new WorkflowRepository(databasePath);
    repository.initializeSegments(projectId);
    for (const chapter of ['project-1234567890abcdef12345678:c00001', 'project-1234567890abcdef12345678:c00002']) {
      const page = repository.workbench(projectId, chapter, 0, 20);
      page.segments.forEach((item) => {
        const segment = repository.getSegment(item.segmentId)!;
        repository.saveManualVersion(segment, item.segmentOrdinal === 1 ? `中文标题${segment.chapterOrdinal}` : `中文正文${segment.chapterOrdinal}`, 'approved');
      });
    }
    repository.importGlossary(projectId, [{ sourceTerm: '関', translatedTerm: '关', kind: 'character', note: '', reading: 'せき' }], true);
    const glossary = repository.glossary(projectId)[0];
    repository.updateGlossary(glossary.glossaryId, '关', 'locked', '', '角色名“关”的首次出场说明。');
    const data = repository.formalExportData(projectId);
    const chinese = await buildFormalEpub(data, 'cn-only');
    const bilingual = await buildFormalEpub(data, 'jp-cn');
    expect((await parseEpubDocument(chinese.bytes)).details.packageVersion).toBe('3.0');
    expect((await parseEpubDocument(bilingual.bytes)).contentMode).toBe('bilingual');
    expect(chinese.annotationCount).toBe(1);
    const chineseZip = await JSZip.loadAsync(chinese.bytes);
    const annotatedChapter = await chineseZip.file('OEBPS/chapter-0001.xhtml')?.async('text');
    expect(annotatedChapter).toContain('epub:type="noteref"');
    expect(annotatedChapter).toContain('角色名“关”的首次出场说明。');
    repository.close();
  });

  it('writes approved translations into an existing EPUB while retaining resources', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-formal-export-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const bytes = await createEpubFixture();
    const epub = await parseEpubDocument(bytes);
    const projectId = 'project-abcdef1234567890abcdef12';
    const database = new ProjectDatabase(databasePath);
    database.persistEpubProject({ project: { projectId, title: epub.title ?? 'EPUB', sourcePath: 'D:\\fixture.epub', sourceFormat: 'epub', sourceEncoding: null, contentMode: epub.contentMode, sourceHash: createHash('sha256').update(bytes).digest('hex'), sourceSizeBytes: bytes.length, chapterCount: epub.spineDocuments.length, paragraphCount: epub.textBlockCount, characterCount: epub.characterCount, importedAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z', lastOpenedAt: '2026-08-26T00:00:00.000Z' }, originalBytes: bytes, epub });
    database.close();
    const repository = new WorkflowRepository(databasePath);
    repository.initializeSegments(projectId);
    const chapterId = `${projectId}:s00001`;
    for (const item of repository.workbench(projectId, chapterId, 0, 20).segments) {
      repository.saveManualVersion(repository.getSegment(item.segmentId)!, `成稿${item.segmentOrdinal}`, 'approved');
    }
    const result = await buildFormalEpub(repository.formalExportData(projectId), 'jp-cn');
    const chineseOnly = await buildFormalEpub(repository.formalExportData(projectId), 'cn-only');
    const parsed = await parseEpubDocument(result.bytes);
    expect(parsed.contentMode).toBe('bilingual');
    const zip = await JSZip.loadAsync(result.bytes);
    expect(await zip.file('OPS/style.css')?.async('text')).toBe('body { writing-mode: vertical-rl; }');
    expect(await zip.file('OPS/chapter.xhtml')?.async('text')).toContain('成稿');
    const chineseZip = await JSZip.loadAsync(chineseOnly.bytes);
    const chineseChapter = await chineseZip.file('OPS/chapter.xhtml')?.async('text');
    expect(chineseChapter).toContain('<ruby>');
    expect(chineseChapter).toContain('<rt>からだ</rt>');
    expect(chineseChapter).toContain('href="style.css"');
    expect(chineseChapter).toContain('src="reader.js"');
    repository.close();
  });
});
