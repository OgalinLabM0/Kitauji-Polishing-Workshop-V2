import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDatabase } from '../projects/projectDatabase.cjs';
import { parseTxtDocument } from '../projects/txtImport.cjs';
import { WorkflowRepository } from './workflowRepository.cjs';
import { PROMPT_VERSION } from './prompts.cjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('workflow repository', () => {
  it('creates stable segments, persistent tasks and recoverable running items', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-workflow-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const sourceBytes = new Uint8Array(Buffer.from('序章\n関は来た。\n第一章\n祈は待った。', 'utf8'));
    const parsed = parseTxtDocument(sourceBytes);
    const projectId = 'project-1234567890abcdef12345678';
    const database = new ProjectDatabase(databasePath);
    database.persistTxtProject({
      project: {
        projectId, title: '任务测试', sourcePath: 'D:\\任务测试.txt', sourceFormat: 'txt',
        sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: 'f'.repeat(64),
        sourceSizeBytes: sourceBytes.length, chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
        importedAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z', lastOpenedAt: '2026-08-26T00:00:00.000Z',
      },
      originalBytes: sourceBytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
    });
    database.close();

    const repository = new WorkflowRepository(databasePath);
    expect(repository.initializeSegments(projectId)).toBe(4);
    expect(repository.initializeSegments(projectId)).toBe(4);
    const task = repository.createTask({ projectId, taskType: 'pre-read' }, 'deepseek-official');
    expect(task.totalItems).toBe(2);
    const claimed = repository.claimItems(task.taskId, 8);
    expect(claimed).toHaveLength(1);
    expect(repository.getTask(task.taskId)?.status).toBe('running');
    repository.savePreReadCheckpoint(claimed[0].taskItemId, {
      version: 1, pieceCount: 3, nextPieceIndex: 2, aggregate: { chapterSummary: '部分摘要' },
    });
    repository.close();

    const recovered = new WorkflowRepository(databasePath);
    expect(recovered.getTask(task.taskId)?.status).toBe('interrupted');
    expect(recovered.claimItems(task.taskId, 8)).toEqual([]);
    expect(recovered.preReadCheckpoint(claimed[0].taskItemId)).toMatchObject({ pieceCount: 3, nextPieceIndex: 2 });
    recovered.setTaskStatus(task.taskId, 'pending');
    recovered.close();

    const pendingRecovered = new WorkflowRepository(databasePath);
    expect(pendingRecovered.getTask(task.taskId)?.status).toBe('interrupted');
    pendingRecovered.setTaskStatus(task.taskId, 'pending');
    const resumedClaim = pendingRecovered.claimItems(task.taskId, 8);
    expect(resumedClaim).toHaveLength(1);
    expect(resumedClaim[0].attempts).toBe(2);
    pendingRecovered.requeueItemFromCheckpoint(resumedClaim[0].taskItemId, '输出被截断，自动从断点恢复。');
    expect(pendingRecovered.getTask(task.taskId)?.status).toBe('running');
    expect(pendingRecovered.preReadCheckpoint(resumedClaim[0].taskItemId)).toMatchObject({ pieceCount: 3, nextPieceIndex: 2 });
    const automaticRetry = pendingRecovered.claimItems(task.taskId, 8);
    expect(automaticRetry).toHaveLength(1);
    expect(automaticRetry[0].attempts).toBe(3);
    expect(pendingRecovered.preReadCheckpoint(automaticRetry[0].taskItemId)).toMatchObject({ aggregate: { chapterSummary: '部分摘要' } });
    pendingRecovered.finishItem(automaticRetry[0].taskItemId, 'failed', '达到自动恢复上限。');
    pendingRecovered.retryFailedTaskItems(task.taskId);
    const manualRetry = pendingRecovered.claimItems(task.taskId, 8);
    expect(manualRetry[0].attempts).toBe(1);
    expect(pendingRecovered.preReadCheckpoint(manualRetry[0].taskItemId)).toMatchObject({ nextPieceIndex: 2 });

    // 测试级联重命名同步机制
    pendingRecovered.savePreReadResult(projectId, 'c1', 1, {
      chapterSummary: '哈森克雷费尔中将正在指挥防线。',
      glossary: [{ sourceTerm: 'ハーゼンクレファー', translatedTerm: '哈森克雷费尔', reading: '', kind: 'character', gender: 'unknown', number: 'singular', sense: '参谋长', confidence: 0.95, notes: '' }],
      entities: [],
      facts: [{ statement: '哈森克雷费尔中将作为参谋长面临指挥权继承难题。', evidenceExcerpt: 'ハーゼンクレファー中将', confidence: 0.95, kind: 'character', subjectKey: 'ハーゼンクレファー', chapterStart: 1, readerVisibleFrom: 1 }],
    });

    const entries = pendingRecovered.glossary(projectId);
    const target = entries.find((e) => e.sourceTerm === 'ハーゼンクレファー');
    expect(target).toBeDefined();
    expect(target?.translatedTerm).toBe('哈森克雷费尔');
    expect(pendingRecovered.preReadResolvableKeys(projectId)).toContain('ハーゼンクレファー');

    // 用户修改术语表：将 哈森克雷费尔 改为 哈森克勒佛
    pendingRecovered.updateGlossary(target!.glossaryId, '哈森克勒佛', 'locked', '用户修正', '', 'male');

    // 验证记忆事实与章节摘要中的中文陈述是否自动级联更新为新译名
    const memories = pendingRecovered.memory(projectId);
    const updatedSummary = memories.find((m) => m.factKind === 'chapter-summary');
    const updatedFact = memories.find((m) => m.factKind === 'character');
    expect(updatedSummary?.statement).toBe('哈森克勒佛中将正在指挥防线。');
    expect(updatedFact?.statement).toBe('哈森克勒佛中将作为参谋长面临指挥权继承难题。');
    expect(memories.some((m) => m.statement.includes('哈森克雷费尔'))).toBe(false);

    pendingRecovered.close();

    const legacyTaskDatabase = new DatabaseSync(databasePath);
    legacyTaskDatabase.prepare("UPDATE workflow_tasks SET prompt_version = 'human-reading-legacy' WHERE task_id = ?").run(task.taskId);
    legacyTaskDatabase.prepare("UPDATE workflow_task_items SET status = CASE WHEN item_ordinal = 1 THEN 'completed' ELSE 'pending' END, checkpoint_json = 'legacy-checkpoint' WHERE task_id = ?").run(task.taskId);
    legacyTaskDatabase.close();
    const promptUpgrade = new WorkflowRepository(databasePath);
    expect(promptUpgrade.upgradePreReadTaskPrompt(task.taskId)).toBe(1);
    promptUpgrade.close();
    const upgradedTaskDatabase = new DatabaseSync(databasePath);
    expect(upgradedTaskDatabase.prepare('SELECT prompt_version, completed_items, failed_items FROM workflow_tasks WHERE task_id = ?').get(task.taskId))
      .toEqual({ prompt_version: PROMPT_VERSION, completed_items: 0, failed_items: 0 });
    expect(upgradedTaskDatabase.prepare("SELECT count(*) AS count FROM workflow_task_items WHERE task_id = ? AND status = 'pending' AND checkpoint_json = ''").get(task.taskId))
      .toEqual({ count: 2 });
    upgradedTaskDatabase.exec('DELETE FROM narrative_entities;');
    upgradedTaskDatabase.close();
    const backfilled = new WorkflowRepository(databasePath);
    backfilled.close();
    const verifiedDatabase = new DatabaseSync(databasePath);
    expect((verifiedDatabase.prepare('SELECT count(*) AS count FROM narrative_entities').get() as { count: number }).count).toBeGreaterThan(0);
    expect((verifiedDatabase.prepare('SELECT count(*) AS count FROM narrative_claims').get() as { count: number }).count).toBeGreaterThan(0);
    verifiedDatabase.close();
  });

  it('repairs already-approved model completions of cross-paragraph quotes as a new version', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-quote-repair-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const sourceBytes = new Uint8Array(Buffer.from('序章\n“戦争から煌きと魔術的な美が奪われた。', 'utf8'));
    const parsed = parseTxtDocument(sourceBytes);
    const projectId = 'project-quote-repair-12345678';
    const database = new ProjectDatabase(databasePath);
    database.persistTxtProject({
      project: {
        projectId, title: '跨段引号测试', sourcePath: 'D:\\跨段引号测试.txt', sourceFormat: 'txt',
        sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: 'e'.repeat(64),
        sourceSizeBytes: sourceBytes.length, chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
        importedAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', lastOpenedAt: '2026-08-28T00:00:00.000Z',
      },
      originalBytes: sourceBytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
    });
    database.close();

    const repository = new WorkflowRepository(databasePath);
    repository.initializeSegments(projectId);
    const lookup = new DatabaseSync(databasePath);
    const chapterId = (lookup.prepare('SELECT chapter_id FROM translation_segments WHERE project_id = ? ORDER BY chapter_ordinal LIMIT 1')
      .get(projectId) as { chapter_id: string }).chapter_id;
    lookup.close();
    const segment = repository.workbench(projectId, chapterId, 0, 20).segments.find((item) => item.sourceText.startsWith('“'))!;
    repository.saveManualVersion(repository.getSegment(segment.segmentId)!, '“战争的光芒与魔术般的美被夺走了。”', 'approved');

    expect(repository.repairSelectedBoundaryQuoteCompletions(projectId)).toBe(1);
    const repaired = repository.workbench(projectId, chapterId, 0, 20).segments.find((item) => item.segmentId === segment.segmentId)!;
    expect(repaired.selectedTranslation).toBe('“战争的光芒与魔术般的美被夺走了。');
    expect(repaired.status).toBe('approved');
    expect(repository.versions(segment.segmentId)[0]).toMatchObject({ stage: 'self-repair', selected: true });
    expect(repository.repairSelectedBoundaryQuoteCompletions(projectId)).toBe(0);
    repository.close();
  });
});
