import path from 'node:path';
import { ProjectService } from '../electron/projects/projectService.cjs';

const [sourcePath, databasePath, outputPath] = process.argv.slice(2).map((value) => value ? path.resolve(value) : '');
if (!sourcePath || !databasePath || !outputPath) {
  throw new Error('用法：verify-real-epub-roundtrip <源 EPUB> <测试数据库> <输出 EPUB>');
}

const verify = async () => {
  const service = new ProjectService(databasePath);
  try {
  const imported = await service.importEpubFile(sourcePath);
  if (imported.status !== 'imported') throw new Error(imported.status === 'error' ? imported.message : '测试导入被取消。');
  let editable: { blockId: string; sourceText: string } | null = null;
  let editableBlockCount = 0;
  let protectedChineseBlockCount = 0;
  for (const chapter of imported.snapshot.chapters) {
    for (let offset = 0; offset < chapter.paragraphCount; offset += 200) {
      const page = service.readChapter(imported.snapshot.project.projectId, chapter.chapterId, offset, 200);
      for (const block of page?.blocks ?? []) {
        if (block.canEdit) {
          editableBlockCount += 1;
          editable ??= { blockId: block.blockId, sourceText: block.sourceText };
        } else if (block.scriptKind === 'chinese') {
          protectedChineseBlockCount += 1;
        }
      }
    }
  }
  if (!editable) throw new Error('真实样书中没有找到可安全写回的普通中文段。');
  const saved = service.saveBlockDraft(
    imported.snapshot.project.projectId,
    editable.blockId,
    `${editable.sourceText}〔结构往返验证〕`,
  );
  if (saved.status !== 'saved') throw new Error(saved.message);
  const exported = await service.exportEpubToFile(imported.snapshot.project.projectId, outputPath);
  if (exported.status !== 'exported') throw new Error(exported.status === 'error' ? exported.message : '测试导出被取消。');
  const reopened = await service.importEpubFile(outputPath);
  if (reopened.status !== 'imported') throw new Error(reopened.status === 'error' ? reopened.message : '输出 EPUB 无法重新导入。');
  process.stdout.write(JSON.stringify({
    sourceProjectId: imported.snapshot.project.projectId,
    outputProjectId: reopened.snapshot.project.projectId,
    changedDocumentCount: exported.changedDocumentCount,
    changedBlockCount: exported.changedBlockCount,
    outputSizeBytes: exported.outputSizeBytes,
    outputSpineCount: reopened.snapshot.project.chapterCount,
    outputBlockCount: reopened.snapshot.project.paragraphCount,
    editableBlockCount,
    protectedChineseBlockCount,
  }));
  } finally {
    service.close();
  }
};

void verify().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
