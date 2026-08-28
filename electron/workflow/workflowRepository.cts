import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateProjectDatabase } from '../projects/projectSchema.cjs';
import type { ModelResponse } from '../providers/models.cjs';
import type {
  ClaimedTaskItem,
  StartWorkflowInput,
  TranslationSegmentRecord,
  WorkflowOverview,
  WorkflowTaskStatus,
  WorkflowTaskSummary,
  WorkflowTaskType,
  WorkbenchPage,
  GlossaryRecord,
  MemoryFactRecord,
  ReviewQueueRecord,
} from './models.cjs';
import { PROMPT_VERSION } from './prompts.cjs';
import { NarrativePersistence } from './narrativePersistence.cjs';
import { NarrativeRetrieval } from './narrativeRetrieval.cjs';
import { NarrativeInvalidation } from './narrativeInvalidation.cjs';
import { backfillLegacyNarrativeKnowledge } from './narrativeLegacyBackfill.cjs';
import type { NarrativeContextManifest, NormalizedPreReadResult, SegmentSemanticRoles } from './narrativeModels.cjs';
import { HumanMemoryPersistence } from './humanMemoryPersistence.cjs';
import { HumanMemoryRetrieval } from './humanMemoryRetrieval.cjs';
import { MemoryConsolidation } from './memoryConsolidation.cjs';
import { SeriesMemory } from './seriesMemory.cjs';
import { locateSourceSpan } from './sourceSpan.cjs';
import { memoryPolicyFor } from './memoryPolicy.cjs';
import { POSITION_SQL } from './narrativePosition.cjs';

interface TaskRow {
  task_id: string; project_id: string; task_type: WorkflowTaskType; status: WorkflowTaskStatus;
  provider_profile_id: string | null; total_items: number; completed_items: number; failed_items: number;
  warning_items: number; input_tokens: number; output_tokens: number; error_message: string | null;
  created_at: string; started_at: string | null; updated_at: string; completed_at: string | null;
}

interface SegmentRow {
  segment_id: string; project_id: string; chapter_id: string; chapter_ordinal: number; segment_ordinal: number;
  source_block_id: string; target_block_id: string | null; source_text: string; original_translation: string | null; status: string;
}

interface TaskItemRow {
  task_item_id: string; task_id: string; chapter_id: string; segment_id: string | null; item_ordinal: number; attempts: number;
}

const taskColumns = `task_id, project_id, task_type, status, provider_profile_id, total_items,
  completed_items, failed_items, warning_items, input_tokens, output_tokens, error_message,
  created_at, started_at, updated_at, completed_at`;

const toTask = (row: TaskRow): WorkflowTaskSummary => ({
  taskId: row.task_id, projectId: row.project_id, taskType: row.task_type, status: row.status,
  providerProfileId: row.provider_profile_id, totalItems: row.total_items, completedItems: row.completed_items,
  failedItems: row.failed_items, warningItems: row.warning_items, inputTokens: row.input_tokens,
  outputTokens: row.output_tokens, errorMessage: row.error_message, createdAt: row.created_at,
  startedAt: row.started_at, updatedAt: row.updated_at, completedAt: row.completed_at,
});

const toSegment = (row: SegmentRow): TranslationSegmentRecord => ({
  segmentId: row.segment_id, projectId: row.project_id, chapterId: row.chapter_id,
  chapterOrdinal: row.chapter_ordinal, segmentOrdinal: row.segment_ordinal,
  sourceBlockId: row.source_block_id, targetBlockId: row.target_block_id,
  sourceText: row.source_text, originalTranslation: row.original_translation, status: row.status,
});

const hashText = (text: string) => createHash('sha256').update(text).digest('hex');
const now = () => new Date().toISOString();

const safeJson = (value: unknown) => JSON.stringify(value ?? {});

export class WorkflowRepository {
  readonly #database: DatabaseSync;
  readonly #narrativePersistence: NarrativePersistence;
  readonly #narrativeRetrieval: NarrativeRetrieval;
  readonly #narrativeInvalidation: NarrativeInvalidation;
  readonly #humanMemoryPersistence: HumanMemoryPersistence;
  readonly #humanMemoryRetrieval: HumanMemoryRetrieval;
  readonly #memoryConsolidation: MemoryConsolidation;
  readonly #seriesMemory: SeriesMemory;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (databasePath !== ':memory:') this.#database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrateProjectDatabase(this.#database);
    this.#narrativePersistence = new NarrativePersistence(this.#database);
    this.#narrativeRetrieval = new NarrativeRetrieval(this.#database);
    this.#narrativeInvalidation = new NarrativeInvalidation(this.#database);
    this.#seriesMemory = new SeriesMemory(this.#database);
    this.#humanMemoryPersistence = new HumanMemoryPersistence(this.#database);
    this.#humanMemoryRetrieval = new HumanMemoryRetrieval(this.#database, this.#seriesMemory);
    this.#memoryConsolidation = new MemoryConsolidation(this.#database);
    this.#transaction(() => backfillLegacyNarrativeKnowledge(this.#database));
    this.recoverInterruptedTasks();
  }

  close() { this.#database.close(); }

  #transaction<T>(action: () => T) {
    this.#database.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.#database.exec('COMMIT'); return result; }
    catch (error) { this.#database.exec('ROLLBACK'); throw error; }
  }

  recoverInterruptedTasks() {
    return this.interruptActiveTasks('软件上次退出时任务仍在运行，可从任务页继续。');
  }

  interruptActiveTasks(message: string) {
    const timestamp = now();
    return this.#transaction(() => {
      this.#database.prepare(`UPDATE workflow_task_items SET status = 'pending', started_at = NULL, updated_at = ? WHERE status = 'running'`).run(timestamp);
      return Number(this.#database.prepare(`UPDATE workflow_tasks SET status = 'interrupted', error_message = ?, updated_at = ? WHERE status IN ('pending', 'running', 'pausing')`).run(message, timestamp).changes);
    });
  }

  initializeSegments(projectId: string) {
    const project = this.#database.prepare('SELECT source_format, content_mode FROM projects WHERE project_id = ?').get(projectId) as { source_format: 'txt' | 'epub'; content_mode: string } | undefined;
    if (!project) throw new Error('作品不存在。');
    const timestamp = now();
    if (project.source_format === 'txt') {
      const rows = this.#database.prepare(`
        SELECT c.chapter_id || ':title' AS source_block_id, c.title AS source_text, 1 AS segment_ordinal,
          c.chapter_id, c.ordinal AS chapter_ordinal
        FROM chapters c WHERE c.project_id = ?
        UNION ALL
        SELECT p.paragraph_id AS source_block_id, p.source_text, p.ordinal + 1 AS segment_ordinal,
          c.chapter_id, c.ordinal AS chapter_ordinal
        FROM paragraphs p JOIN chapters c ON c.chapter_id = p.chapter_id WHERE p.project_id = ?
        ORDER BY chapter_ordinal, segment_ordinal
      `).all(projectId, projectId) as unknown as Array<{ source_block_id: string; source_text: string; segment_ordinal: number; chapter_id: string; chapter_ordinal: number }>;
      this.#transaction(() => rows.forEach((row) => this.#database.prepare(`
        INSERT INTO translation_segments(segment_id, project_id, chapter_id, chapter_ordinal, segment_ordinal,
          source_block_id, target_block_id, source_text, original_translation, source_hash, status,
          selected_version_id, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(project_id, source_block_id) DO NOTHING
      `).run(`segment:${row.source_block_id}`, projectId, row.chapter_id, row.chapter_ordinal, row.segment_ordinal,
        row.source_block_id, row.source_text, hashText(row.source_text), timestamp, timestamp)));
    } else {
      const spines = this.#database.prepare(`
        SELECT spine_item_id, ordinal, href, title FROM epub_spine_items WHERE project_id = ? ORDER BY ordinal
      `).all(projectId) as unknown as Array<{ spine_item_id: string; ordinal: number; href: string; title: string }>;

      const blockStmt = this.#database.prepare(`
        SELECT b.block_id AS source_block_id, b.source_text, b.source_hash, b.ordinal,
          t.block_id AS target_block_id, t.source_text AS original_translation
        FROM epub_text_blocks b
        LEFT JOIN epub_text_blocks t ON t.spine_item_id = b.spine_item_id
          AND t.ordinal = b.paired_ordinal AND t.script_kind = 'chinese'
        WHERE b.project_id = ? AND b.spine_item_id = ? AND b.script_kind <> 'chinese'
        ORDER BY b.ordinal
      `);

      const insertStmt = this.#database.prepare(`
        INSERT INTO translation_segments(segment_id, project_id, chapter_id, chapter_ordinal, segment_ordinal,
          source_block_id, target_block_id, source_text, original_translation, source_hash, status,
          selected_version_id, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(project_id, source_block_id) DO NOTHING
      `);

      this.#transaction(() => {
        for (const spine of spines) {
          const blocks = blockStmt.all(projectId, spine.spine_item_id) as unknown as Array<{
            source_block_id: string; source_text: string; source_hash: string; ordinal: number;
            target_block_id: string | null; original_translation: string | null;
          }>;

          const rawTitle = (spine.title || '').trim();
          const isGenericHref = !rawTitle || rawTitle.endsWith('.html') || rawTitle.endsWith('.xhtml') || rawTitle.startsWith('part0');
          const firstBlockMatchesTitle = blocks.length > 0 && blocks[0].source_text.trim() === rawTitle;
          const hasSeparateTitle = !isGenericHref && !firstBlockMatchesTitle;

          if (hasSeparateTitle) {
            const titleBlockId = `${spine.spine_item_id}:title`;
            insertStmt.run(
              `segment:${titleBlockId}`, projectId, spine.spine_item_id, spine.ordinal, 1,
              titleBlockId, null, rawTitle, null, hashText(rawTitle), timestamp, timestamp,
            );
          }

          const offset = hasSeparateTitle ? 1 : 0;
          for (let i = 0; i < blocks.length; i += 1) {
            const b = blocks[i];
            insertStmt.run(
              `segment:${b.source_block_id}`, projectId, spine.spine_item_id, spine.ordinal, i + 1 + offset,
              b.source_block_id, b.target_block_id, b.source_text, b.original_translation, b.source_hash, timestamp, timestamp,
            );
          }
        }
      });
    }
    return (this.#database.prepare('SELECT count(*) AS count FROM translation_segments WHERE project_id = ?').get(projectId) as { count: number }).count;
  }

  getTask(taskId: string) {
    const row = this.#database.prepare(`SELECT ${taskColumns} FROM workflow_tasks WHERE task_id = ?`).get(taskId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  overview(projectId: string): WorkflowOverview {
    const tasks = this.#database.prepare(`SELECT ${taskColumns} FROM workflow_tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT 30`).all(projectId) as unknown as TaskRow[];
    const counts = this.#database.prepare('SELECT status, count(*) AS count FROM translation_segments WHERE project_id = ? GROUP BY status').all(projectId) as unknown as Array<{ status: string; count: number }>;
    const scalar = (sql: string) => (this.#database.prepare(sql).get(projectId) as { count: number }).count;
    return {
      tasks: tasks.map(toTask),
      segmentCounts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
      glossaryCount: scalar('SELECT count(*) AS count FROM glossary_entries WHERE project_id = ? AND status NOT IN (\'rejected\')'),
      memoryFactCount: scalar('SELECT count(*) AS count FROM memory_facts WHERE project_id = ? AND status NOT IN (\'superseded\')'),
      openReviewCount: scalar('SELECT count(*) AS count FROM review_items WHERE project_id = ? AND status = \'open\''),
    };
  }

  createTask(input: StartWorkflowInput, providerProfileId: string) {
    this.initializeSegments(input.projectId);
    const active = this.#database.prepare(`
      SELECT task_id FROM workflow_tasks WHERE project_id = ?
        AND status IN ('pending', 'running', 'pausing', 'paused', 'interrupted') LIMIT 1
    `).get(input.projectId) as { task_id: string } | undefined;
    if (active) throw new Error('这本书还有未结束的任务，请先继续或取消原任务。');
    const chapterIds = input.chapterIds?.filter((value) => typeof value === 'string') ?? [];
    const allowedChapter = chapterIds.length ? ` AND chapter_id IN (${chapterIds.map(() => '?').join(',')})` : '';
    if (input.taskType === 'translate') {
      const missingPreRead = this.#database.prepare(`
        SELECT count(DISTINCT s.chapter_id) AS count FROM translation_segments s
        WHERE s.project_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM workflow_task_items i JOIN workflow_tasks t ON t.task_id = i.task_id
            WHERE t.project_id = s.project_id AND t.task_type = 'pre-read' AND t.status = 'completed'
              AND t.prompt_version = ?
              AND i.chapter_id = s.chapter_id AND i.status = 'completed'
          )
      `).get(input.projectId, PROMPT_VERSION) as { count: number };
      if (missingPreRead.count > 0) {
        throw new Error(`全书仍有 ${missingPreRead.count} 个章节没有完成预读；人类式连续翻译必须先读完整本书。`);
      }
    }
    let rows: Array<{ chapter_id: string; segment_id: string | null }>;
    if (input.taskType === 'pre-read') {
      rows = (this.#database.prepare(`SELECT DISTINCT chapter_id, NULL AS segment_id FROM translation_segments WHERE project_id = ?${allowedChapter} ORDER BY chapter_ordinal`)
        .all(input.projectId, ...chapterIds) as unknown as Array<{ chapter_id: string; segment_id: null }>);
    } else if (input.taskType === 'review') {
      rows = (this.#database.prepare(`SELECT chapter_id, segment_id FROM translation_segments WHERE project_id = ?${allowedChapter} AND selected_version_id IS NOT NULL ORDER BY chapter_ordinal, segment_ordinal`)
        .all(input.projectId, ...chapterIds) as unknown as Array<{ chapter_id: string; segment_id: string }>);
    } else {
      const statusFilter = input.replaceApproved ? '' : ` AND status <> 'approved'`;
      rows = (this.#database.prepare(`SELECT chapter_id, segment_id FROM translation_segments WHERE project_id = ?${allowedChapter}${statusFilter} ORDER BY chapter_ordinal, segment_ordinal`)
        .all(input.projectId, ...chapterIds) as unknown as Array<{ chapter_id: string; segment_id: string }>);
    }
    if (!rows.length) throw new Error(input.taskType === 'translate' ? '所选范围没有待翻译段落。' : '所选范围没有可处理正文。');
    const taskId = `task-${randomUUID()}`;
    const timestamp = now();
    this.#transaction(() => {
      this.#database.prepare(`
        INSERT INTO workflow_tasks(task_id, project_id, task_type, status, provider_profile_id, scope_json,
          prompt_version, total_items, completed_items, failed_items, warning_items, input_tokens,
          output_tokens, error_message, created_at, started_at, updated_at, completed_at)
        VALUES(?, ?, ?, 'pending', ?, ?, ?, ?, 0, 0, 0, 0, 0, NULL, ?, NULL, ?, NULL)
      `).run(taskId, input.projectId, input.taskType, providerProfileId, safeJson({ chapterIds, replaceApproved: Boolean(input.replaceApproved) }), PROMPT_VERSION, rows.length, timestamp, timestamp);
      const insert = this.#database.prepare(`
        INSERT INTO workflow_task_items(task_item_id, task_id, project_id, chapter_id, segment_id,
          item_ordinal, status, attempts, error_message, started_at, updated_at, completed_at)
        VALUES(?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, NULL)
      `);
      rows.forEach((row, index) => insert.run(`item-${randomUUID()}`, taskId, input.projectId, row.chapter_id, row.segment_id, index + 1, timestamp));
      this.log(input.projectId, taskId, null, 'task-created', `已建立${input.taskType === 'pre-read' ? '全书预读' : input.taskType === 'translate' ? '翻译' : '复核'}任务，共 ${rows.length} 项。`, {});
    });
    const task = this.getTask(taskId);
    if (!task) throw new Error('任务创建后无法读取。');
    return task;
  }

  upgradePreReadTaskPrompt(taskId: string) {
    const timestamp = now();
    return this.#transaction(() => {
      const row = this.#database.prepare(`
        SELECT task_type, prompt_version FROM workflow_tasks WHERE task_id = ?
      `).get(taskId) as { task_type: WorkflowTaskType; prompt_version: string } | undefined;
      if (!row || row.task_type !== 'pre-read' || row.prompt_version === PROMPT_VERSION) return 0;
      const reset = this.#database.prepare(`
        SELECT count(*) AS count FROM workflow_task_items
        WHERE task_id = ? AND status IN ('completed', 'failed', 'skipped', 'running')
      `).get(taskId) as { count: number };
      this.#database.prepare(`
        UPDATE workflow_task_items SET status = 'pending', error_message = NULL, checkpoint_json = '',
          started_at = NULL, completed_at = NULL, updated_at = ? WHERE task_id = ?
      `).run(timestamp, taskId);
      this.#database.prepare(`
        UPDATE workflow_tasks SET prompt_version = ?, completed_items = 0, failed_items = 0,
          error_message = NULL, completed_at = NULL, updated_at = ? WHERE task_id = ?
      `).run(PROMPT_VERSION, timestamp, taskId);
      return reset.count;
    });
  }

  claimItems(taskId: string, limit: number): readonly ClaimedTaskItem[] {
    return this.#transaction(() => {
      const task = this.getTask(taskId);
      if (!task || !['pending', 'running'].includes(task.status)) return [];
      const timestamp = now();
      if (task.status === 'pending') this.#database.prepare(`UPDATE workflow_tasks SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE task_id = ?`).run(timestamp, timestamp, taskId);
      const firstPending = this.#database.prepare(`SELECT chapter_id FROM workflow_task_items WHERE task_id = ? AND status = 'pending' ORDER BY item_ordinal LIMIT 1`).get(taskId) as { chapter_id: string } | undefined;
      if (!firstPending) return [];
      const items = this.#database.prepare(`
        SELECT task_item_id, task_id, chapter_id, segment_id, item_ordinal, attempts
        FROM workflow_task_items WHERE task_id = ? AND status = 'pending' AND chapter_id = ?
        ORDER BY item_ordinal LIMIT ?
      `).all(taskId, firstPending.chapter_id, limit) as unknown as TaskItemRow[];
      const update = this.#database.prepare(`UPDATE workflow_task_items SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ? WHERE task_item_id = ?`);
      items.forEach((item) => update.run(timestamp, timestamp, item.task_item_id));
      const segmentStatement = this.#database.prepare(`
        SELECT segment_id, project_id, chapter_id, chapter_ordinal, segment_ordinal, source_block_id,
          target_block_id, source_text, original_translation, status FROM translation_segments WHERE segment_id = ?
      `);
      return items.map((item) => {
        const row = item.segment_id ? segmentStatement.get(item.segment_id) as SegmentRow | undefined : undefined;
        return {
          taskItemId: item.task_item_id, taskId: item.task_id, chapterId: item.chapter_id,
          segmentId: item.segment_id, itemOrdinal: item.item_ordinal, attempts: item.attempts + 1,
          segment: row ? toSegment(row) : null,
        };
      });
    });
  }

  preReadCheckpoint(itemId: string) {
    const row = this.#database.prepare(`SELECT checkpoint_json FROM workflow_task_items WHERE task_item_id = ?`).get(itemId) as { checkpoint_json: string } | undefined;
    if (!row?.checkpoint_json) return null;
    try { return JSON.parse(row.checkpoint_json) as unknown; }
    catch { return null; }
  }

  savePreReadCheckpoint(itemId: string, checkpoint: unknown) {
    const timestamp = now();
    const result = this.#database.prepare(`
      UPDATE workflow_task_items SET checkpoint_json = ?, updated_at = ?
      WHERE task_item_id = ? AND status = 'running'
    `).run(safeJson(checkpoint), timestamp, itemId);
    if (Number(result.changes) !== 1) throw new Error('预读分片断点无法保存。');
  }

  readChapterMaterial(projectId: string, chapterId: string) {
    const rows = this.#database.prepare(`
      SELECT segment_ordinal, source_text, original_translation FROM translation_segments
      WHERE project_id = ? AND chapter_id = ? ORDER BY segment_ordinal
    `).all(projectId, chapterId) as unknown as Array<{ segment_ordinal: number; source_text: string; original_translation: string | null }>;
    return rows.map((row) => `[${row.segment_ordinal}] JP: ${row.source_text}${row.original_translation ? `\n既有CN: ${row.original_translation}` : ''}`).join('\n\n');
  }

  preReadResolvableKeys(projectId: string) {
    const rows = this.#database.prepare(`
      SELECT canonical_source AS source_key FROM narrative_entities WHERE project_id = ?
      UNION
      SELECT source_form AS source_key FROM narrative_aliases WHERE project_id = ?
      UNION
      SELECT source_term AS source_key FROM glossary_entries WHERE project_id = ? AND status <> 'rejected'
      ORDER BY source_key
    `).all(projectId, projectId, projectId) as unknown as Array<{ source_key: string }>;
    return rows.map((row) => row.source_key.trim()).filter(Boolean);
  }

  preReadContext(projectId: string, chapterOrdinal: number, currentSource = '') {
    const summaries = this.#database.prepare(`
      SELECT chapter_start, statement FROM memory_facts
      WHERE project_id = ? AND fact_kind = 'chapter-summary' AND chapter_start < ? AND status = 'confirmed'
      ORDER BY chapter_start DESC LIMIT 8
    `).all(projectId, chapterOrdinal) as unknown as Array<{ chapter_start: number; statement: string }>;
    const durableFacts = this.#database.prepare(`
      SELECT fact_kind, subject_key, object_key, statement, chapter_start, reader_visible_from, confidence
      FROM memory_facts WHERE project_id = ? AND chapter_start < ? AND status IN ('confirmed', 'locked')
        AND fact_kind <> 'chapter-summary'
      ORDER BY confidence DESC, chapter_start DESC LIMIT 80
    `).all(projectId, chapterOrdinal) as unknown as Array<Record<string, unknown>>;
    const terms = this.#database.prepare(`
      SELECT source_term, translated_term, reading, entity_kind, sense, status
      FROM glossary_entries WHERE project_id = ? AND status IN ('confirmed', 'locked')
      ORDER BY CASE status WHEN 'locked' THEN 0 ELSE 1 END, confidence DESC LIMIT 120
    `).all(projectId) as unknown as Array<Record<string, unknown>>;
    const layeredMemories = this.#database.prepare(`
      SELECT memory_id, memory_class, summary, subject_key, object_key, worldline_key, scene_key,
        chapter_ordinal, segment_ordinal, importance, retention_policy, retrieval_scope, confidence
      FROM consolidated_memories WHERE project_id = ? AND chapter_ordinal < ?
        AND consolidation_status = 'consolidated'
      ORDER BY importance DESC, chapter_ordinal DESC LIMIT 120
    `).all(projectId, chapterOrdinal) as unknown as Array<Record<string, unknown>>;
    const styleMemories = this.#database.prepare(`
      SELECT style_id, owner_type, owner_key, decision_kind, source_pattern, target_strategy, rationale, confidence
      FROM translation_style_memories WHERE project_id = ? AND valid_from_chapter < ?
        AND status IN ('confirmed', 'locked') ORDER BY confidence DESC, usage_count DESC LIMIT 80
    `).all(projectId, chapterOrdinal) as unknown as Array<Record<string, unknown>>;
    const seriesContext = this.#seriesMemory.context(projectId, currentSource);
    return safeJson({
      recentChapterSummaries: summaries.reverse().map((row) => ({ chapter: row.chapter_start, summary: row.statement })),
      establishedFacts: durableFacts,
      establishedTerms: terms,
      layeredMemories,
      styleMemories,
      priorVolumeSeriesContext: seriesContext,
      safety: '只继承 consolidated/confirmed/locked 记录；冲突、候选和已归档情节细节不作为事实。',
    });
  }

  chapterOrdinal(projectId: string, chapterId: string) {
    const row = this.#database.prepare('SELECT chapter_ordinal FROM translation_segments WHERE project_id = ? AND chapter_id = ? ORDER BY segment_ordinal LIMIT 1')
      .get(projectId, chapterId) as { chapter_ordinal: number } | undefined;
    if (!row) throw new Error('任务章节没有可处理正文。');
    return row.chapter_ordinal;
  }

  selectedTranslation(segmentId: string) {
    const row = this.#database.prepare(`
      SELECT v.text FROM translation_segments s
      JOIN translation_versions v ON v.version_id = s.selected_version_id
      WHERE s.segment_id = ?
    `).get(segmentId) as { text: string } | undefined;
    return row?.text ?? null;
  }

  setSegmentStatus(segmentId: string, status: string) {
    this.#database.prepare('UPDATE translation_segments SET status = ?, updated_at = ? WHERE segment_id = ?').run(status, now(), segmentId);
  }

  getSegment(segmentId: string) {
    const row = this.#database.prepare(`
      SELECT segment_id, project_id, chapter_id, chapter_ordinal, segment_ordinal, source_block_id,
        target_block_id, source_text, original_translation, status FROM translation_segments WHERE segment_id = ?
    `).get(segmentId) as SegmentRow | undefined;
    return row ? toSegment(row) : null;
  }

  workbench(projectId: string, chapterId: string, offset: number, limit: number): WorkbenchPage {
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const total = (this.#database.prepare('SELECT count(*) AS count FROM translation_segments WHERE project_id = ? AND chapter_id = ?').get(projectId, chapterId) as { count: number }).count;
    const rows = this.#database.prepare(`
      SELECT s.segment_id, s.chapter_id, s.chapter_ordinal, s.segment_ordinal, s.source_block_id, s.target_block_id, s.source_text,
        s.original_translation, s.status, v.text AS selected_translation,
        COALESCE(b.tag_name, CASE WHEN s.source_block_id LIKE '%:title' THEN 'h1' ELSE 'p' END) AS tag_name,
        (SELECT count(*) FROM translation_versions vv WHERE vv.segment_id = s.segment_id) AS version_count,
        (SELECT count(*) FROM review_items r WHERE r.segment_id = s.segment_id AND r.status = 'open') AS open_review_count
      FROM translation_segments s
      LEFT JOIN epub_text_blocks b ON b.block_id = s.source_block_id
      LEFT JOIN translation_versions v ON v.version_id = s.selected_version_id
      WHERE s.project_id = ? AND s.chapter_id = ? ORDER BY s.segment_ordinal LIMIT ? OFFSET ?
    `).all(projectId, chapterId, safeLimit, safeOffset) as unknown as Array<{
      segment_id: string; chapter_id: string; chapter_ordinal: number; segment_ordinal: number;
      source_block_id: string; target_block_id: string | null; source_text: string; original_translation: string | null; status: string; selected_translation: string | null;
      tag_name: string; version_count: number; open_review_count: number;
    }>;
    return {
      projectId, chapterId, total, offset: safeOffset, limit: safeLimit,
      segments: rows.map((row) => ({
        segmentId: row.segment_id, chapterId: row.chapter_id, chapterOrdinal: row.chapter_ordinal,
        segmentOrdinal: row.segment_ordinal, sourceBlockId: row.source_block_id,
        targetBlockId: row.target_block_id,
        tagName: row.tag_name,
        isTitle: row.source_block_id.endsWith(':title') || /^h[1-6]$/i.test(row.tag_name),
        sourceText: row.source_text, originalTranslation: row.original_translation,
        selectedTranslation: row.selected_translation, status: row.status, versionCount: row.version_count,
        openReviewCount: row.open_review_count,
      })),
    };
  }

  versions(segmentId: string) {
    return (this.#database.prepare(`
      SELECT v.version_id, v.version_number, v.stage, v.text, v.model, v.provider_profile_id,
        v.input_tokens, v.output_tokens, v.elapsed_ms, v.created_at,
        CASE WHEN s.selected_version_id = v.version_id THEN 1 ELSE 0 END AS selected
      FROM translation_versions v JOIN translation_segments s ON s.segment_id = v.segment_id
      WHERE v.segment_id = ? ORDER BY v.version_number DESC
    `).all(segmentId) as unknown as Array<{
      version_id: string; version_number: number; stage: string; text: string; model: string | null;
      provider_profile_id: string | null; input_tokens: number | null; output_tokens: number | null;
      elapsed_ms: number | null; created_at: string; selected: number;
    }>).map((row) => ({ versionId: row.version_id, versionNumber: row.version_number, stage: row.stage,
      text: row.text, model: row.model, providerProfileId: row.provider_profile_id,
      inputTokens: row.input_tokens, outputTokens: row.output_tokens, elapsedMs: row.elapsed_ms,
      createdAt: row.created_at, selected: Boolean(row.selected) }));
  }

  restoreVersion(segment: TranslationSegmentRecord, versionId: string) {
    const row = this.#database.prepare('SELECT version_id FROM translation_versions WHERE version_id = ? AND segment_id = ?')
      .get(versionId, segment.segmentId) as { version_id: string } | undefined;
    if (!row) throw new Error('版本不存在或不属于当前段落。');
    this.#transaction(() => {
      this.#database.prepare(`UPDATE translation_segments SET selected_version_id = ?, status = 'approved', updated_at = ? WHERE segment_id = ?`)
        .run(versionId, now(), segment.segmentId);
      this.log(segment.projectId, null, segment.segmentId, 'version-restored', '人工恢复了历史译文版本。', { versionId });
    });
    return versionId;
  }

  closeSegmentReviews(segmentId: string, status: 'auto-resolved' | 'superseded', note: string, excludeReviewId?: string) {
    const timestamp = now();
    const result = excludeReviewId
      ? this.#database.prepare(`UPDATE review_items SET status = ?, resolution_note = ?, resolved_at = ? WHERE segment_id = ? AND status = 'open' AND review_id <> ?`)
        .run(status, note, timestamp, segmentId, excludeReviewId)
      : this.#database.prepare(`UPDATE review_items SET status = ?, resolution_note = ?, resolved_at = ? WHERE segment_id = ? AND status = 'open'`)
        .run(status, note, timestamp, segmentId);
    return Number(result.changes);
  }

  saveManualVersion(segment: TranslationSegmentRecord, text: string, status: string) {
    const timestamp = now();
    return this.#transaction(() => {
      const versionNumber = ((this.#database.prepare('SELECT max(version_number) AS value FROM translation_versions WHERE segment_id = ?').get(segment.segmentId) as { value: number | null }).value ?? 0) + 1;
      const versionId = `version-${randomUUID()}`;
      this.#database.prepare(`
        INSERT INTO translation_versions(version_id, segment_id, project_id, version_number, stage, text,
          model, provider_profile_id, prompt_version, context_manifest_json, response_id, finish_reason,
          input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, elapsed_ms, created_at)
        VALUES(?, ?, ?, ?, 'manual', ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)
      `).run(versionId, segment.segmentId, segment.projectId, versionNumber, text, PROMPT_VERSION, safeJson({ humanEdit: true }), timestamp);
      this.#database.prepare('UPDATE translation_segments SET selected_version_id = ?, status = ?, updated_at = ? WHERE segment_id = ?').run(versionId, status, timestamp, segment.segmentId);
      this.log(segment.projectId, null, segment.segmentId, 'manual-edit', '人工编辑保存为新版本。', { versionId, status });
      return versionId;
    });
  }

  glossary(projectId: string): readonly GlossaryRecord[] {
    const rows = this.#database.prepare(`
      SELECT g.glossary_id, g.source_term, g.translated_term, g.reading, g.entity_kind, g.gender,
        g.grammatical_number, g.sense, g.confidence, g.status, g.notes, g.epub_note,
        COALESCE((
          SELECT count(*) FROM translation_segments s
          WHERE s.project_id = g.project_id AND instr(s.source_text, g.source_term) > 0
        ), 1) AS occurrence_count
      FROM glossary_entries g WHERE g.project_id = ? AND g.status <> 'rejected'
      ORDER BY CASE g.status WHEN 'conflict' THEN 0 WHEN 'candidate' THEN 1 WHEN 'locked' THEN 2 ELSE 3 END,
        g.entity_kind, g.source_term
    `).all(projectId) as unknown as Array<{
      glossary_id: string; source_term: string; translated_term: string; reading: string | null;
      entity_kind: string; gender: string; grammatical_number: string; sense: string; confidence: number;
      status: string; notes: string; epub_note: string; occurrence_count: number;
    }>;
    const evidenceStatement = this.#database.prepare(`
      SELECT e.chapter_id, e.source_excerpt,
        COALESCE(e.translation_excerpt, (
          SELECT COALESCE(v.text, s.original_translation) FROM translation_segments s
          LEFT JOIN translation_versions v ON v.version_id = s.selected_version_id
          WHERE s.project_id = e.project_id AND s.chapter_id = e.chapter_id AND instr(s.source_text, ?) > 0
          ORDER BY s.segment_ordinal LIMIT 1
        )) AS translation_excerpt,
        e.evidence_kind
      FROM glossary_evidence e WHERE e.glossary_id = ? ORDER BY e.chapter_id LIMIT 20
    `);
    return rows.map((row) => ({
      glossaryId: row.glossary_id, sourceTerm: row.source_term, translatedTerm: row.translated_term,
      reading: row.reading, entityKind: row.entity_kind, gender: row.gender,
      grammaticalNumber: row.grammatical_number, sense: row.sense, confidence: row.confidence,
      status: row.status, notes: row.notes, epubNote: row.epub_note,
      occurrenceCount: Math.max(1, Number(row.occurrence_count) || 1),
      evidence: (evidenceStatement.all(row.source_term, row.glossary_id) as unknown as Array<{ chapter_id: string; source_excerpt: string; translation_excerpt: string | null; evidence_kind: string }>).map((evidence) => ({
        chapterId: evidence.chapter_id, sourceExcerpt: evidence.source_excerpt,
        translationExcerpt: evidence.translation_excerpt, evidenceKind: evidence.evidence_kind,
      })),
    }));
  }

  memory(projectId: string): readonly MemoryFactRecord[] {
    const rows = this.#database.prepare(`
      SELECT fact_id, fact_kind, subject_key, object_key, statement, chapter_start,
        chapter_start_segment, chapter_start_offset, reader_visible_from, evidence_excerpt, confidence, status,
        memory_class, importance, retention_policy, retrieval_scope, consolidation_status
      FROM memory_facts WHERE project_id = ? AND status <> 'superseded'
      ORDER BY chapter_start, fact_kind, confidence DESC
    `).all(projectId) as unknown as Array<{
      fact_id: string; fact_kind: string; subject_key: string | null; object_key: string | null;
      statement: string; chapter_start: number; chapter_start_segment: number | null; chapter_start_offset: number | null;
      reader_visible_from: number; evidence_excerpt: string; confidence: number; status: string;
      memory_class: string; importance: number; retention_policy: string; retrieval_scope: string; consolidation_status: string;
    }>;
    return rows.map((row) => ({ factId: row.fact_id, factKind: row.fact_kind, subjectKey: row.subject_key,
      objectKey: row.object_key, statement: row.statement, chapterStart: row.chapter_start,
      chapterStartSegment: row.chapter_start_segment, chapterStartOffset: row.chapter_start_offset,
      readerVisibleFrom: row.reader_visible_from, evidenceExcerpt: row.evidence_excerpt,
      confidence: row.confidence, status: row.status, memoryClass: row.memory_class, importance: row.importance,
      retentionPolicy: row.retention_policy, retrievalScope: row.retrieval_scope,
      consolidationStatus: row.consolidation_status }));
  }

  seriesAssignment(projectId: string) { return this.#seriesMemory.assignment(projectId); }
  listSeries() { return this.#seriesMemory.list(); }

  assignSeries(projectId: string, name: string, volumeOrdinal: number, volumeLabel: string, description: string) {
    return this.#transaction(() => {
      const assignment = this.#seriesMemory.assign(projectId, name, volumeOrdinal, volumeLabel, description);
      this.log(projectId, null, null, 'series-assigned', `已加入系列“${assignment.name}”第 ${assignment.volumeOrdinal} 卷。`, assignment);
      return assignment;
    });
  }

  unassignSeries(projectId: string) {
    return this.#transaction(() => {
      const removed = this.#seriesMemory.unassign(projectId);
      if (removed) this.log(projectId, null, null, 'series-unassigned', '已解除当前作品的系列归属。', {});
      return removed;
    });
  }

  ambiguities(projectId: string) { return this.#humanMemoryPersistence.ambiguities(projectId); }

  resolveAmbiguity(ambiguityId: string, selectedInterpretation: string | null,
    preservationStrategy: string, note: string, lock: boolean) {
    return this.#transaction(() => {
      const result = this.#humanMemoryPersistence.resolveAmbiguity(ambiguityId, selectedInterpretation,
        preservationStrategy, note, lock);
      const segment = this.#database.prepare(`
        SELECT segment_id FROM translation_segments WHERE project_id = ? AND chapter_id = ? AND segment_ordinal = ?
      `).get(result.projectId, result.chapterId, result.segmentOrdinal) as { segment_id: string } | undefined;
      if (segment) this.#database.prepare(`
        UPDATE translation_segments SET status = CASE WHEN selected_version_id IS NULL THEN status ELSE 'needs-human' END,
          updated_at = ? WHERE segment_id = ?
      `).run(now(), segment.segment_id);
      if (segment) {
        const reviewId = `review-${randomUUID()}`;
        this.#database.prepare(`
          INSERT INTO review_items(review_id, project_id, segment_id, category, severity, status, title,
            explanation, evidence_json, proposed_text, resolution_note, created_at, resolved_at)
          SELECT ?, ?, ?, 'literary-choice', 'blocking', 'open', '歧义裁定后需重新核对', ?, ?, NULL, NULL, ?, NULL
          WHERE NOT EXISTS (
            SELECT 1 FROM review_items WHERE segment_id = ? AND category = 'literary-choice'
              AND title = '歧义裁定后需重新核对' AND status = 'open'
          )
        `).run(reviewId, result.projectId, segment.segment_id,
          `歧义处理策略已改为“${preservationStrategy}”，旧译文不得沿用未经裁定的解释。`,
          safeJson({ ambiguityId, selectedInterpretation, lock }), now(), segment.segment_id);
      }
      this.log(result.projectId, null, segment?.segment_id ?? null, 'ambiguity-resolved',
        `歧义策略已裁定为 ${preservationStrategy}。`, { ambiguityId, selectedInterpretation, lock });
      return result;
    });
  }

  reviews(projectId: string): readonly ReviewQueueRecord[] {
    const rows = this.#database.prepare(`
      SELECT r.review_id, r.segment_id, r.category, r.severity, r.status, r.title, r.explanation,
        r.proposed_text, r.created_at, s.chapter_ordinal, s.segment_ordinal, s.chapter_id,
        s.source_text, s.original_translation, v.text AS current_translation
      FROM review_items r
      LEFT JOIN translation_segments s ON s.segment_id = r.segment_id
      LEFT JOIN translation_versions v ON v.version_id = s.selected_version_id
      WHERE r.project_id = ? AND r.status = 'open'
      ORDER BY CASE r.severity WHEN 'must-human' THEN 0 WHEN 'blocking' THEN 1 ELSE 2 END, r.created_at
    `).all(projectId) as unknown as Array<{
      review_id: string; segment_id: string | null; category: string; severity: string; status: string;
      title: string; explanation: string; proposed_text: string | null; created_at: string;
      chapter_ordinal: number | null; segment_ordinal: number | null; chapter_id: string | null;
      source_text: string | null; original_translation: string | null; current_translation: string | null;
    }>;
    const contextStatement = this.#database.prepare(`
      SELECT segment_ordinal, source_text, original_translation FROM translation_segments
      WHERE project_id = ? AND chapter_id = ? AND segment_ordinal BETWEEN ? AND ? ORDER BY segment_ordinal
    `);
    return rows.map((row) => ({ reviewId: row.review_id, segmentId: row.segment_id,
      chapterOrdinal: row.chapter_ordinal, segmentOrdinal: row.segment_ordinal, category: row.category,
      severity: row.severity, status: row.status, title: row.title, explanation: row.explanation,
      proposedText: row.proposed_text, sourceText: row.source_text, originalTranslation: row.original_translation,
      currentTranslation: row.current_translation,
      contextExcerpt: row.chapter_id && row.segment_ordinal !== null
        ? (contextStatement.all(projectId, row.chapter_id, Math.max(1, row.segment_ordinal - 2), row.segment_ordinal + 2) as unknown as Array<{ segment_ordinal: number; source_text: string; original_translation: string | null }>).map((item) => `${item.segment_ordinal}. ${item.source_text}${item.original_translation ? `\n   原译：${item.original_translation}` : ''}`).join('\n')
        : null,
      createdAt: row.created_at }));
  }

  getReview(reviewId: string) {
    const row = this.#database.prepare(`
      SELECT review_id, project_id, segment_id, proposed_text, status FROM review_items WHERE review_id = ?
    `).get(reviewId) as { review_id: string; project_id: string; segment_id: string | null; proposed_text: string | null; status: string } | undefined;
    return row ?? null;
  }

  resolveReview(reviewId: string, status: 'accepted' | 'rejected', note: string) {
    const row = this.#database.prepare('SELECT project_id, segment_id FROM review_items WHERE review_id = ? AND status = \'open\'').get(reviewId) as { project_id: string; segment_id: string | null } | undefined;
    if (!row) throw new Error('复核事项不存在或已经处理。');
    const timestamp = now();
    this.#database.prepare('UPDATE review_items SET status = ?, resolution_note = ?, resolved_at = ? WHERE review_id = ?').run(status, note, timestamp, reviewId);
    this.log(row.project_id, null, row.segment_id, 'review-resolved', status === 'accepted' ? '人工接受复核候选。' : '人工驳回复核候选。', { reviewId, note });
    return row;
  }

  importGlossary(projectId: string, records: readonly { sourceTerm: string; translatedTerm: string; kind: string; note: string; reading: string }[], locked: boolean) {
    const exists = this.#database.prepare('SELECT project_id FROM projects WHERE project_id = ?').get(projectId);
    if (!exists) throw new Error('作品不存在。');
    const timestamp = now();
    let imported = 0;
    this.#transaction(() => {
      const statement = this.#database.prepare(`
        INSERT INTO glossary_entries(glossary_id, project_id, source_term, translated_term, reading,
          entity_kind, gender, grammatical_number, sense, confidence, status, notes, epub_note, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, '用户导入', 1, ?, ?, '', ?, ?)
        ON CONFLICT(project_id, source_term, sense) DO UPDATE SET translated_term = excluded.translated_term,
          reading = excluded.reading, entity_kind = excluded.entity_kind, status = excluded.status,
          notes = excluded.notes, updated_at = excluded.updated_at
      `);
      for (const record of records) {
        const notApplicable = !['character', 'animal'].includes(record.kind);
        statement.run(`glossary-${randomUUID()}`, projectId, record.sourceTerm, record.translatedTerm,
          record.reading || null, record.kind, notApplicable ? 'not-applicable' : 'unknown',
          notApplicable ? 'not-applicable' : 'unknown', locked ? 'locked' : 'candidate', record.note, timestamp, timestamp);
        imported += 1;
      }
      this.log(projectId, null, null, 'glossary-import', `人工导入 ${imported} 个术语。`, { locked });
    });
    return imported;
  }

  updateGlossary(glossaryId: string, translatedTerm: string, status: string, notes: string, epubNote: string, gender?: string) {
    const timestamp = now();
    const existing = this.#database.prepare('SELECT project_id, source_term, translated_term FROM glossary_entries WHERE glossary_id = ?').get(glossaryId) as { project_id: string; source_term: string; translated_term: string } | undefined;
    if (!existing) throw new Error('术语不存在。');

    const oldTranslated = existing.translated_term.trim();
    const newTranslated = translatedTerm.trim();

    return this.#transaction(() => {
      if (gender) {
        this.#database.prepare(`UPDATE glossary_entries SET translated_term = ?, status = ?, notes = ?, epub_note = ?, gender = ?, updated_at = ? WHERE glossary_id = ?`)
          .run(newTranslated, status, notes, epubNote, gender, timestamp, glossaryId);
      } else {
        this.#database.prepare(`UPDATE glossary_entries SET translated_term = ?, status = ?, notes = ?, epub_note = ?, updated_at = ? WHERE glossary_id = ?`)
          .run(newTranslated, status, notes, epubNote, timestamp, glossaryId);
      }

      // 级联同步：当修改了中文译名时，自动同步重写所有记忆事实、章节摘要和复核项中的旧中文名
      if (oldTranslated && newTranslated && oldTranslated !== newTranslated && oldTranslated.length >= 2) {
        this.#database.prepare(`
          UPDATE memory_facts 
          SET statement = replace(statement, ?, ?),
              character_knowledge_json = replace(character_knowledge_json, ?, ?),
              updated_at = ?
          WHERE project_id = ? AND instr(statement, ?) > 0
        `).run(oldTranslated, newTranslated, oldTranslated, newTranslated, timestamp, existing.project_id, oldTranslated);

        this.#database.prepare(`
          UPDATE review_items
          SET explanation = replace(explanation, ?, ?),
              proposed_text = replace(proposed_text, ?, ?)
          WHERE project_id = ? AND status = 'open' AND (instr(explanation, ?) > 0 OR instr(proposed_text, ?) > 0)
        `).run(oldTranslated, newTranslated, oldTranslated, newTranslated, existing.project_id, oldTranslated, oldTranslated);

        this.#database.prepare(`
          UPDATE consolidated_memories
          SET summary = replace(summary, ?, ?), updated_at = ?
          WHERE project_id = ? AND instr(summary, ?) > 0
        `).run(oldTranslated, newTranslated, timestamp, existing.project_id, oldTranslated);

        this.#database.prepare(`
          UPDATE translation_style_memories
          SET target_strategy = replace(target_strategy, ?, ?),
              rationale = replace(rationale, ?, ?), updated_at = ?
          WHERE project_id = ? AND (instr(target_strategy, ?) > 0 OR instr(rationale, ?) > 0)
        `).run(oldTranslated, newTranslated, oldTranslated, newTranslated, timestamp,
          existing.project_id, oldTranslated, oldTranslated);

        this.log(existing.project_id, null, null, 'glossary-cascade-rename', `术语“${existing.source_term}”译名已更正（${oldTranslated} → ${newTranslated}），全书记忆事实与摘要已级联同步。`, { oldTranslated, newTranslated });
      }

      if (oldTranslated && newTranslated && oldTranslated !== newTranslated) {
        const narrativeEntities = this.#database.prepare(`
          SELECT DISTINCT e.entity_id FROM narrative_entities e LEFT JOIN narrative_aliases a ON a.entity_id = e.entity_id
          WHERE e.project_id = ? AND (e.canonical_source = ? OR a.source_form = ?)
        `).all(existing.project_id, existing.source_term, existing.source_term) as unknown as Array<{ entity_id: string }>;
        this.#database.prepare(`UPDATE narrative_entities SET canonical_translation = ?, updated_at = ? WHERE project_id = ? AND canonical_source = ?`)
          .run(newTranslated, timestamp, existing.project_id, existing.source_term);
        this.#database.prepare(`UPDATE narrative_aliases SET translated_form = ? WHERE project_id = ? AND source_form = ?`)
          .run(newTranslated, existing.project_id, existing.source_term);
        this.#narrativeInvalidation.flagSelectedTranslations(existing.project_id, narrativeEntities.map((item) => item.entity_id), `术语“${existing.source_term}”译名由“${oldTranslated}”改为“${newTranslated}”`);
      }

      this.#seriesMemory.syncProject(existing.project_id);

      return glossaryId;
    });
  }

  assertFormalExportReady(projectId: string) {
    const exists = this.#database.prepare('SELECT 1 AS ok FROM projects WHERE project_id = ?').get(projectId) as { ok: number } | undefined;
    if (!exists) throw new Error('作品不存在。');
    const counts = this.#database.prepare(`SELECT count(*) AS total, sum(CASE WHEN status = 'approved' AND selected_version_id IS NOT NULL THEN 1 ELSE 0 END) AS approved FROM translation_segments WHERE project_id = ?`).get(projectId) as { total: number; approved: number };
    if (!counts.total) throw new Error('还没有翻译段落。请先完成全书预读和翻译。');
    if (counts.approved !== counts.total) throw new Error(`成品导出已阻止：${counts.total - counts.approved} 个段落尚未成为通过复核的成稿。`);
    const openReviews = (this.#database.prepare(`SELECT count(*) AS count FROM review_items WHERE project_id = ? AND status = 'open'`).get(projectId) as { count: number }).count;
    if (openReviews) throw new Error(`成品导出已阻止：还有 ${openReviews} 项复核没有裁定。`);
  }

  formalExportData(projectId: string) {
    this.assertFormalExportReady(projectId);
    const project = this.#database.prepare(`
      SELECT p.title, p.source_format, p.content_mode, p.source_hash,
        e.opf_path, e.navigation_path
      FROM projects p LEFT JOIN epub_documents e ON e.project_id = p.project_id WHERE p.project_id = ?
    `).get(projectId) as { title: string; source_format: 'txt' | 'epub'; content_mode: string; source_hash: string; opf_path: string | null; navigation_path: string | null } | undefined;
    if (!project) throw new Error('作品不存在。');
    const annotationCandidates = this.#database.prepare(`
      SELECT glossary_id, source_term, epub_note FROM glossary_entries
      WHERE project_id = ? AND status IN ('confirmed', 'locked') AND trim(epub_note) <> ''
      ORDER BY length(source_term) DESC, source_term
    `).all(projectId) as unknown as Array<{ glossary_id: string; source_term: string; epub_note: string }>;
    const attachAnnotations = <T extends { source_text: string; segment_ordinal: number; source_tag?: string }>(segments: readonly T[]) => {
      const used = new Set<string>();
      return segments.map((segment) => {
        const canAnnotate = segment.segment_ordinal > 1 && !/^h[1-6]$/u.test(segment.source_tag ?? '');
        const annotations = canAnnotate ? annotationCandidates.filter((candidate) => !used.has(candidate.glossary_id) && segment.source_text.includes(candidate.source_term)).map((candidate) => {
          used.add(candidate.glossary_id);
          return { annotationId: `kitauji-${candidate.glossary_id.replace(/[^a-zA-Z0-9_-]/gu, '-')}`, sourceTerm: candidate.source_term, note: candidate.epub_note };
        }) : [];
        return { ...segment, annotations };
      });
    };
    const archiveRow = this.#database.prepare(project.source_format === 'epub'
      ? 'SELECT original_bytes FROM source_archives WHERE project_id = ?'
      : 'SELECT original_bytes FROM source_documents WHERE project_id = ?').get(projectId) as { original_bytes: Uint8Array } | undefined;
    if (!archiveRow) throw new Error('项目缺少不可变原文件快照。');
    if (project.source_format === 'txt') {
      const segments = this.#database.prepare(`
        SELECT s.chapter_id, s.chapter_ordinal, s.segment_ordinal, s.source_text, v.text AS translation
        FROM translation_segments s JOIN translation_versions v ON v.version_id = s.selected_version_id
        WHERE s.project_id = ? ORDER BY s.chapter_ordinal, s.segment_ordinal
      `).all(projectId) as unknown as Array<{ chapter_id: string; chapter_ordinal: number; segment_ordinal: number; source_text: string; translation: string }>;
      return { project: { title: project.title, sourceFormat: project.source_format, contentMode: project.content_mode, sourceHash: project.source_hash, opfPath: null, navigationPath: null }, originalBytes: archiveRow.original_bytes, txtSegments: attachAnnotations(segments), epubSegments: [] };
    }
    const segments = this.#database.prepare(`
      SELECT s.chapter_id, s.chapter_ordinal, s.segment_ordinal, s.source_text, v.text AS translation,
        sp.href AS document_path, sp.source_hash AS document_source_hash,
        sb.dom_path AS source_dom_path, sb.source_xml AS source_xml, sb.tag_name AS source_tag,
        tb.dom_path AS target_dom_path, tb.source_xml AS target_xml, tb.tag_name AS target_tag
      FROM translation_segments s
      JOIN translation_versions v ON v.version_id = s.selected_version_id
      JOIN epub_text_blocks sb ON sb.block_id = s.source_block_id
      JOIN epub_spine_items sp ON sp.spine_item_id = sb.spine_item_id
      LEFT JOIN epub_text_blocks tb ON tb.block_id = s.target_block_id
      WHERE s.project_id = ? ORDER BY s.chapter_ordinal, s.segment_ordinal
    `).all(projectId) as unknown as Array<{
      chapter_id: string; chapter_ordinal: number; segment_ordinal: number; source_text: string; translation: string;
      document_path: string; document_source_hash: string; source_dom_path: string; source_xml: string; source_tag: string;
      target_dom_path: string | null; target_xml: string | null; target_tag: string | null;
    }>;
    return { project: { title: project.title, sourceFormat: project.source_format, contentMode: project.content_mode, sourceHash: project.source_hash, opfPath: project.opf_path, navigationPath: project.navigation_path }, originalBytes: archiveRow.original_bytes, txtSegments: [], epubSegments: attachAnnotations(segments) };
  }

  projectTitle(projectId: string) {
    const row = this.#database.prepare('SELECT title FROM projects WHERE project_id = ?').get(projectId) as { title: string } | undefined;
    if (!row) throw new Error('作品不存在。');
    return row.title;
  }

  contextForSegments(projectId: string, segments: readonly TranslationSegmentRecord[]) {
    if (!segments.length) throw new Error('上下文检索至少需要一个段落。');
    const first = segments[0];
    const last = segments[segments.length - 1];
    const neighbors = this.#database.prepare(`
      SELECT s.segment_ordinal, s.source_text, s.original_translation, v.text AS selected_translation
      FROM translation_segments s LEFT JOIN translation_versions v ON v.version_id = s.selected_version_id
      WHERE s.project_id = ? AND s.chapter_id = ? AND s.segment_ordinal BETWEEN ? AND ?
      ORDER BY segment_ordinal
    `).all(projectId, first.chapterId, Math.max(1, first.segmentOrdinal - 4), last.segmentOrdinal + 3) as unknown as Array<{ segment_ordinal: number; source_text: string; original_translation: string | null; selected_translation: string | null }>;
    const joinedSource = neighbors.map((row) => row.source_text).join('\n');
    const glossary = (this.#database.prepare(`
      SELECT glossary_id, source_term, translated_term, sense, entity_kind, gender, grammatical_number, confidence, notes
      FROM glossary_entries WHERE project_id = ? AND status IN ('confirmed', 'locked') ORDER BY length(source_term) DESC
    `).all(projectId) as unknown as Array<Record<string, unknown>>).filter((row) => joinedSource.includes(String(row.source_term)));
    const readerFacts = this.#database.prepare(`
      SELECT fact_id, fact_kind, subject_key, object_key, statement, chapter_start, chapter_start_segment,
        chapter_start_offset, chapter_end, chapter_end_segment, chapter_end_offset,
        reader_visible_from, reader_visible_from_segment, reader_visible_from_offset,
        character_knowledge_json, confidence
      FROM memory_facts WHERE project_id = ? AND status IN ('confirmed', 'locked', 'hypothesis')
        AND ${POSITION_SQL.startsByOffset('chapter_start', 'chapter_start_segment', 'chapter_start_offset')}
        AND ${POSITION_SQL.endsAfterOffset('chapter_end', 'chapter_end_segment', 'chapter_end_offset')}
        AND ${POSITION_SQL.startsByOffset('reader_visible_from', 'reader_visible_from_segment', 'reader_visible_from_offset')}
        AND (subject_key IS NULL OR instr(?, subject_key) > 0 OR instr(?, COALESCE(object_key, '')) > 0
          OR fact_kind IN ('viewpoint', 'setting', 'scene-summary', 'chapter-summary'))
      ORDER BY confidence DESC, chapter_start DESC, COALESCE(chapter_start_segment, 1) DESC LIMIT 80
    `).all(projectId,
      first.chapterOrdinal, first.chapterOrdinal, first.segmentOrdinal, first.segmentOrdinal, 0,
      first.chapterOrdinal, first.chapterOrdinal, first.segmentOrdinal, first.segmentOrdinal, 0,
      first.chapterOrdinal, first.chapterOrdinal, first.segmentOrdinal, first.segmentOrdinal, 0,
      joinedSource, joinedSource) as unknown as Array<Record<string, unknown>>;
    const futureFacts = this.#database.prepare(`
      SELECT fact_id, fact_kind, subject_key, object_key, statement, chapter_start, chapter_start_segment,
        chapter_start_offset, reader_visible_from, reader_visible_from_segment, reader_visible_from_offset, confidence
      FROM memory_facts WHERE project_id = ? AND status IN ('confirmed', 'locked')
        AND ${POSITION_SQL.startsAfterOffset('reader_visible_from', 'reader_visible_from_segment', 'reader_visible_from_offset')}
        AND (subject_key IS NULL OR instr(?, subject_key) > 0 OR instr(?, COALESCE(object_key, '')) > 0
          OR fact_kind IN ('viewpoint', 'setting', 'scene-summary', 'chapter-summary'))
      ORDER BY reader_visible_from, COALESCE(reader_visible_from_segment, 1), confidence DESC LIMIT 40
    `).all(projectId, first.chapterOrdinal, first.chapterOrdinal, first.segmentOrdinal, first.segmentOrdinal, 0,
      joinedSource, joinedSource) as unknown as Array<Record<string, unknown>>;
    const narrative = this.#narrativeRetrieval.context(projectId, segments);
    const human = this.#humanMemoryRetrieval.context(projectId, segments);
    const manifest: NarrativeContextManifest = narrative?.manifest ?? {
      neighborOrdinals: [], glossaryIds: [], entityIds: [], claimIds: [], eventIds: [], evidenceIds: [], frameIds: [],
      memoryIds: [], styleIds: [], ambiguityIds: [], readerFactIds: [], translatorFactIds: [], directionConstraints: [],
      syntaxEvidence: [], seriesContext: {},
      position: { chapterOrdinal: first.chapterOrdinal, firstSegmentOrdinal: first.segmentOrdinal,
        lastSegmentOrdinal: last.segmentOrdinal, firstOffset: 0, lastOffset: null },
    };
    return {
      neighbors: neighbors.map((row) => `${row.segment_ordinal}: ${row.source_text}${row.original_translation ? `\n  既有CN: ${row.original_translation}` : ''}${row.selected_translation ? `\n  当前成稿: ${row.selected_translation}` : ''}`).join('\n'),
      glossary: safeJson(glossary), readerFacts: safeJson(readerFacts), translatorFacts: safeJson(futureFacts),
      entities: narrative?.entities ?? '[]', worldState: narrative?.worldState ?? '[]',
      narrativeFrames: narrative?.narrativeFrames ?? '[]',
      readerKnowledge: narrative?.readerKnowledge ?? '{"claims":[],"events":[]}',
      translatorKnowledge: narrative?.translatorKnowledge ?? '{"claims":[],"events":[]}',
      characterKnowledge: narrative?.characterKnowledge ?? '[]', directionLedger: narrative?.directionLedger ?? '[]',
      segmentTransitions: narrative?.segmentTransitions ?? '[]',
      exactSlices: human?.exactSlices ?? '[]',
      consolidatedMemories: human?.currentMemories ?? '[]',
      futureConsolidatedMemories: human?.futureMemories ?? '[]',
      styleMemories: human?.styleMemories ?? '[]',
      ambiguities: human?.ambiguities ?? '[]',
      syntaxEvidence: human?.syntaxEvidence ?? '[]',
      seriesContext: human?.seriesContext ?? '{"assignment":null}',
      rawSyntaxEvidence: human?.rawSyntaxEvidence ?? [],
      unresolved: narrative?.unresolved ?? '[]',
      contextPosition: narrative?.position ?? safeJson({ chapterOrdinal: first.chapterOrdinal,
        firstSegmentOrdinal: first.segmentOrdinal, lastSegmentOrdinal: last.segmentOrdinal }),
      manifest: {
        ...manifest,
        neighborOrdinals: neighbors.map((row) => row.segment_ordinal),
        glossaryIds: glossary.map((row) => String(row.glossary_id)),
        readerFactIds: readerFacts.map((row) => String(row.fact_id)),
        translatorFactIds: futureFacts.map((row) => String(row.fact_id)),
        memoryIds: human?.memoryIds ?? [],
        styleIds: human?.styleIds ?? [],
        ambiguityIds: human?.ambiguityIds ?? [],
        syntaxEvidence: human?.rawSyntaxEvidence ?? [],
        seriesContext: human?.seriesContextManifest ?? {},
      },
    };
  }

  narrativeBoundarySegments(projectId: string, segments: readonly TranslationSegmentRecord[]) {
    if (segments.length < 2) return [];
    return this.#narrativeRetrieval.boundarySegments(projectId, segments[0].chapterOrdinal,
      segments[0].segmentOrdinal, segments[segments.length - 1].segmentOrdinal);
  }

  finalizePreRead(projectId: string) {
    return this.#transaction(() => {
      const dossier = this.#memoryConsolidation.finalizeVolume(projectId);
      const seriesSync = this.#seriesMemory.syncProject(projectId);
      this.log(projectId, null, null, 'volume-memory-consolidated', '全书预读完成，已生成卷级长期记忆档案。', { dossier, seriesSync });
      return { dossier, seriesSync };
    });
  }

  savePreReadResult(projectId: string, chapterId: string, chapterOrdinal: number, result: {
    readonly chapterSummary: string;
    readonly glossary: readonly Record<string, unknown>[];
    readonly entities: readonly Record<string, unknown>[];
    readonly facts: readonly Record<string, unknown>[];
    readonly events?: readonly Record<string, unknown>[];
    readonly frames?: readonly Record<string, unknown>[];
    readonly styleDecisions?: readonly Record<string, unknown>[];
    readonly ambiguities?: readonly Record<string, unknown>[];
  }) {
    const timestamp = now();
    this.#transaction(() => {
      const chapterTail = this.#database.prepare(`
        SELECT segment_ordinal, source_text FROM translation_segments
        WHERE project_id = ? AND chapter_id = ? ORDER BY segment_ordinal DESC LIMIT 1
      `).get(projectId, chapterId) as { segment_ordinal: number; source_text: string } | undefined;
      const tailSegment = chapterTail?.segment_ordinal ?? 1;
      const tailOffset = chapterTail?.source_text.length ?? 0;
      const locateEvidence = (excerpt: string, preferredSegment: unknown, preferredOffset: unknown) => locateSourceSpan(
        this.#database, projectId, chapterId, excerpt,
        Number.isInteger(Number(preferredSegment)) && Number(preferredSegment) >= 1 ? Number(preferredSegment) : null,
        Number.isInteger(Number(preferredOffset)) && Number(preferredOffset) >= 0 ? Number(preferredOffset) : null,
      );
      this.#database.prepare(`DELETE FROM memory_facts WHERE project_id = ? AND chapter_start = ? AND created_by = 'pre-read' AND status <> 'locked'`).run(projectId, chapterOrdinal);
      const insertGlossary = this.#database.prepare(`
        INSERT INTO glossary_entries(glossary_id, project_id, source_term, translated_term, reading,
          entity_kind, gender, grammatical_number, sense, confidence, status, notes, epub_note, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
        ON CONFLICT(project_id, source_term, sense) DO UPDATE SET
          translated_term = CASE WHEN glossary_entries.status = 'locked' THEN glossary_entries.translated_term ELSE excluded.translated_term END,
          reading = CASE WHEN glossary_entries.status = 'locked' THEN glossary_entries.reading ELSE excluded.reading END,
          gender = CASE WHEN glossary_entries.gender IN ('male', 'female') THEN glossary_entries.gender ELSE excluded.gender END,
          confidence = max(glossary_entries.confidence, excluded.confidence),
          status = CASE WHEN glossary_entries.status = 'locked' THEN 'locked' ELSE excluded.status END,
          notes = CASE WHEN glossary_entries.status = 'locked' THEN glossary_entries.notes ELSE excluded.notes END,
          updated_at = excluded.updated_at
      `);
      const evidenceInsert = this.#database.prepare(`
        INSERT INTO glossary_evidence(evidence_id, glossary_id, project_id, chapter_id, source_block_id,
          source_excerpt, translation_excerpt, evidence_kind, created_at) VALUES(?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `);
      const glossarySources = new Set(result.glossary.map((item) => String(item.sourceTerm ?? '').trim()));
      const candidates = [...result.glossary, ...result.entities.filter((entity) => !glossarySources.has(String(entity.sourceName ?? '').trim())).map((entity) => ({
        sourceTerm: entity.sourceName, translatedTerm: entity.translatedName, reading: entity.reading,
        kind: entity.kind, gender: entity.gender, number: entity.number,
        sense: `实体：${String(entity.sourceName ?? '')}`, confidence: entity.confidence, notes: entity.notes,
        evidenceExcerpt: Array.isArray(entity.evidence) ? (entity.evidence[0] as Record<string, unknown> | undefined)?.excerpt : '',
      }))];

      for (const item of candidates) {
        const sourceTerm = String(item.sourceTerm ?? '').trim();
        let translatedTerm = String(item.translatedTerm ?? '').trim();
        const sense = String(item.sense ?? '').trim();
        if (!sourceTerm || !translatedTerm || !sense) continue;
        
        // 专名类型硬约束（只允许 character, place, organization, item 4 类实体）
        const allowedKinds = new Set(['character', 'place', 'organization', 'item']);
        if (item.kind && !allowedKinds.has(String(item.kind))) continue;

        // 术语准入门槛过滤（严格遵循 LinguaGacha 黄金法则，剔除排版碎片、代词、普通军衔、常规战术动作与字典常识词）
        if (/^(本電子書籍|電子書籍|リーディングシステム|縦書き|横書き|サムネイル|注釈|目次|奥付|表紙|ページ|イラスト|カバー|株式会社|発行|著作権)/u.test(sourceTerm)) continue;
        if (/^(私|わたし|わたくし|僕|ぼく|俺|おれ|自分|貴様|お前|君|きみ|あなた|あんた|あいつ|やつ|奴|此奴|誰|何|彼|彼女|彼ら|彼女ら|誰か|何者か|これ|それ|あれ)$/u.test(sourceTerm)) continue;
        if (/^(中隊長|小隊長|大隊長|連隊長|師団長|司令官|指揮官|士官|将校|大佐|中佐|少佐|大尉|中尉|少尉|准尉|曹長|軍曹|伍長|兵長|上等兵|一等兵|二等兵|下士官|通信士官|先任士官|古参兵|新兵|兵士|将兵|兵隊|歩兵|砲兵|騎兵|工兵|敵|敵兵|敵軍|味方|友軍|観測班|男|女|男性|女性|少年|少女|青年|老人|大人|子供|人間|人物|市民|住民|民間人|群衆)$/u.test(sourceTerm)) continue;
        if (/^(準備射撃|大隊|旅団|連隊|師団|軍団|小隊|中隊|榴弾|トーチカ|時間|場所|言葉|写真|命令|作戦|戦闘|戦争)$/u.test(sourceTerm)) continue;
        if (/^(ツーマンセル|狙撃戦術|敵損耗最大化|敵拘束時間|伏撃|混戦|殿軍|ゲリラ的|遅延防御|半包囲|死守命令|促成教育|銃殺の指揮|面制圧|擾乱射撃|機動防御|防衛線|突撃|掃討|索敵|後退|進撃|演習弾)/u.test(sourceTerm)) continue;
        if (/^(共和主義者|共産主義者|皇帝専制|搾取構造|階級|階級の欺瞞|アカ|存在Ｘ|アジ演説|内ゲバ|総括|マルキスト|プロパガンダ|帝国主義|ソ連|電気椅子|反体制派|シンパシー|百殺一戒|造反有理|愛国無罪|アピールポイント|サイレントマジョリティ|三種の神器)/u.test(sourceTerm)) continue;
        if (/^(エターナルヨウジョ|まほう幼女|リバタリアンのリーマン|あとがき|後書き|著者|作者|解説)/u.test(sourceTerm)) continue;
        
        // 标点忠实度自愈保护：若日文原文包含『』等特殊引号，自动纠偏防止模型误转为普通双引号
        if (sourceTerm.includes('『') && sourceTerm.includes('』')) {
          translatedTerm = translatedTerm.replace(/[“"']([^“”"']+)["'”]/gu, '『$1』');
          if (!translatedTerm.includes('『')) {
            const matchInside = sourceTerm.match(/『([^』]+)』/u);
            if (matchInside && translatedTerm.includes(matchInside[1])) {
              translatedTerm = translatedTerm.replace(matchInside[1], `『${matchInside[1]}』`);
            }
          }
        }

        const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0));
        const notes = String(item.notes ?? '');
        const ambiguous = /谐音|双关|误读|多解|不确定|冲突/u.test(notes);

        // 检查是否为已知角色实体的单姓/简称或多形态别名（要求：译名 100% 相同且置信度 >= 0.99，杜绝同姓一家人误伤）
        if (item.kind === 'character' && confidence >= 0.99) {
          const sameTranslationChars = this.#database.prepare(`
            SELECT glossary_id, source_term, translated_term, entity_kind FROM glossary_entries
            WHERE project_id = ? AND entity_kind = 'character' AND translated_term = ? AND source_term <> ?
          `).all(projectId, translatedTerm, sourceTerm) as unknown as Array<{ glossary_id: string; source_term: string; translated_term: string }>;

          if (sameTranslationChars.length === 1) {
            const mainChar = sameTranslationChars[0];
            if (mainChar.source_term.includes(sourceTerm) || sourceTerm.includes(mainChar.source_term)) {
              const excerpt = String(item.evidenceExcerpt ?? '').trim();
              if (excerpt) {
                evidenceInsert.run(`evidence-${randomUUID()}`, mainChar.glossary_id, projectId, chapterId, `chapter:${chapterId}`, excerpt, 'occurrence', timestamp);
              }
              continue;
            }
          }
        }
        
        // 严格按 (project_id, source_term) 唯一查重，防止同一词条因 sense 微小差异出现重复行
        const existing = this.#database.prepare('SELECT glossary_id, sense, status, translated_term, gender, confidence FROM glossary_entries WHERE project_id = ? AND source_term = ?').get(projectId, sourceTerm) as { glossary_id: string; sense: string; status: string; translated_term: string; gender: string; confidence: number } | undefined;
        
        const glossaryId = existing?.glossary_id ?? `glossary-${randomUUID()}`;
        const targetSense = existing?.sense || sense;
        const status = existing?.status === 'locked' ? 'locked' : (confidence >= 0.94 && !ambiguous ? 'confirmed' : 'candidate');

        insertGlossary.run(glossaryId, projectId, sourceTerm, translatedTerm, String(item.reading ?? '') || null,
          String(item.kind ?? 'item'), String(item.gender ?? 'unknown'), String(item.number ?? 'unknown'),
          targetSense, confidence, status, notes, timestamp, timestamp);
        const excerpt = String(item.evidenceExcerpt ?? '').trim();
        if (excerpt) evidenceInsert.run(`evidence-${randomUUID()}`, glossaryId, projectId, chapterId, `chapter:${chapterId}`, excerpt, /谐音|双关|误读/u.test(notes) ? 'pun' : 'occurrence', timestamp);
      }

      const factInsert = this.#database.prepare(`
        INSERT INTO memory_facts(fact_id, project_id, fact_kind, subject_key, object_key, statement,
          chapter_start, chapter_start_segment, chapter_start_offset, chapter_end, chapter_end_segment, chapter_end_offset,
          reader_visible_from, reader_visible_from_segment, reader_visible_from_offset,
          memory_class, importance, retention_policy, retrieval_scope, consolidation_status, supersedes_fact_id,
          character_knowledge_json, source_block_id,
          evidence_excerpt, confidence, status, created_by, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'pre-read', ?, ?)
      `);
      factInsert.run(`fact-${randomUUID()}`, projectId, 'chapter-summary', null, null, result.chapterSummary,
        chapterOrdinal, tailSegment, tailOffset, chapterOrdinal, tailSegment, tailOffset,
        chapterOrdinal, tailSegment, tailOffset,
        'episode-detail', 0.62, 'episodic', 'chapter', 'consolidated', '{}',
        result.chapterSummary, 1, 'confirmed', timestamp, timestamp);
      
      const seenFacts = new Set<string>();
      for (const fact of result.facts) {
        const statement = String(fact.statement ?? '').trim();
        const evidence = String(fact.evidenceExcerpt ?? '').trim();
        if (!statement || !evidence) continue;
        if (seenFacts.has(statement)) continue;
        seenFacts.add(statement);
        const confidence = Math.max(0, Math.min(1, Number(fact.confidence) || 0));
        const factChapterStart = Math.max(1, Number(fact.chapterStart) || chapterOrdinal);
        const readerVisibleFrom = Math.max(1, Number(fact.readerVisibleFrom) || chapterOrdinal);
        const located = locateEvidence(evidence, fact.evidenceSegment, fact.evidenceStartOffset);
        const groundedSegment = located.segmentOrdinal;
        const chapterStartSegment = factChapterStart === chapterOrdinal ? groundedSegment : (Number(fact.chapterStartSegment) || null);
        const rawStartOffset = factChapterStart === chapterOrdinal && chapterStartSegment === groundedSegment
          ? located.startOffset ?? (Number.isInteger(Number(fact.chapterStartOffset)) ? Number(fact.chapterStartOffset) : null)
          : (Number.isInteger(Number(fact.chapterStartOffset)) ? Number(fact.chapterStartOffset) : null);
        const chapterStartOffset = Number.isInteger(rawStartOffset) && Number(rawStartOffset) >= 0 ? Number(rawStartOffset) : null;
        const readerVisibleFromSegment = readerVisibleFrom === chapterOrdinal ? groundedSegment : (Number(fact.readerVisibleFromSegment) || null);
        const readerVisibleFromOffset = readerVisibleFrom === chapterOrdinal && readerVisibleFromSegment === groundedSegment
          ? located.startOffset ?? (Number.isInteger(Number(fact.readerVisibleFromOffset)) ? Number(fact.readerVisibleFromOffset) : null)
          : (Number.isInteger(Number(fact.readerVisibleFromOffset)) ? Number(fact.readerVisibleFromOffset) : null);
        const policy = memoryPolicyFor(String(fact.kind ?? 'event'), String(fact.predicate ?? fact.kind ?? 'event'), statement, confidence);
        
        const rawEndOffset = Number.isInteger(Number(fact.chapterEndOffset)) && Number(fact.chapterEndOffset) >= 0 ? Number(fact.chapterEndOffset) : null;
        // 物理完整性约束自愈：若 endOffset 小于 startOffset，强制置为 null 防止触发 CHECK 报错
        const chapterEndOffset = (rawEndOffset !== null && chapterStartOffset !== null && rawEndOffset < chapterStartOffset)
          ? null
          : rawEndOffset;

        factInsert.run(`fact-${randomUUID()}`, projectId, String(fact.kind ?? 'event'), String(fact.subjectKey ?? '') || null,
          String(fact.objectKey ?? '') || null, statement, factChapterStart, chapterStartSegment,
          chapterStartOffset,
          fact.chapterEnd === null || fact.chapterEnd === undefined ? null : Math.max(1, Number(fact.chapterEnd) || factChapterStart),
          Number(fact.chapterEndSegment) || null,
          chapterEndOffset,
          readerVisibleFrom, readerVisibleFromSegment, readerVisibleFromOffset,
          policy.memoryClass, policy.importance, policy.retentionPolicy, policy.retrievalScope,
          confidence >= 0.9 && located.status === 'exact' ? 'consolidated' : 'candidate',
          safeJson(fact.characterKnowledge), evidence,
          confidence, confidence >= 0.9 ? 'confirmed' : 'hypothesis', timestamp, timestamp);
      }
      const structuredResult = {
        chapterSummary: result.chapterSummary,
        glossary: [...result.glossary],
        entities: result.entities as unknown as NormalizedPreReadResult['entities'],
        facts: result.facts.map((fact) => ({
          kind: String(fact.kind ?? 'event'), predicate: String(fact.predicate ?? fact.kind ?? 'event'),
          subjectKey: String(fact.subjectKey ?? ''), objectKey: String(fact.objectKey ?? ''),
          worldlineKey: String(fact.worldlineKey ?? 'main') || 'main', sceneKey: String(fact.sceneKey ?? ''),
          value: fact.value ?? { statement: String(fact.statement ?? '') }, statement: String(fact.statement ?? ''),
          chapterStart: Math.max(1, Number(fact.chapterStart) || chapterOrdinal),
          chapterStartSegment: Number(fact.chapterStartSegment) || null,
          chapterStartOffset: Number.isInteger(Number(fact.chapterStartOffset)) && Number(fact.chapterStartOffset) >= 0 ? Number(fact.chapterStartOffset) : null,
          chapterEnd: fact.chapterEnd === null || fact.chapterEnd === undefined ? null : Math.max(1, Number(fact.chapterEnd) || chapterOrdinal),
          chapterEndSegment: Number(fact.chapterEndSegment) || null,
          chapterEndOffset: Number.isInteger(Number(fact.chapterEndOffset)) && Number(fact.chapterEndOffset) >= 0 ? Number(fact.chapterEndOffset) : null,
          readerVisibleFrom: Math.max(1, Number(fact.readerVisibleFrom) || chapterOrdinal),
          readerVisibleFromSegment: Number(fact.readerVisibleFromSegment) || null,
          readerVisibleFromOffset: Number.isInteger(Number(fact.readerVisibleFromOffset)) && Number(fact.readerVisibleFromOffset) >= 0 ? Number(fact.readerVisibleFromOffset) : null,
          characterKnowledge: fact.characterKnowledge && typeof fact.characterKnowledge === 'object' && !Array.isArray(fact.characterKnowledge)
            ? fact.characterKnowledge as Readonly<Record<string, unknown>> : {},
          evidenceExcerpt: String(fact.evidenceExcerpt ?? ''), evidenceSegment: Number(fact.evidenceSegment) || null,
          evidenceStartOffset: Number.isInteger(Number(fact.evidenceStartOffset)) && Number(fact.evidenceStartOffset) >= 0 ? Number(fact.evidenceStartOffset) : null,
          memoryClass: ['canon', 'character', 'relationship', 'event', 'state', 'episode-detail'].includes(String(fact.memoryClass))
            ? String(fact.memoryClass) as NormalizedPreReadResult['facts'][number]['memoryClass'] : memoryPolicyFor(String(fact.kind ?? 'event'), String(fact.predicate ?? ''), String(fact.statement ?? ''), Number(fact.confidence)).memoryClass,
          importance: Math.max(0, Math.min(1, Number(fact.importance) || memoryPolicyFor(String(fact.kind ?? 'event'), String(fact.predicate ?? ''), String(fact.statement ?? ''), Number(fact.confidence)).importance)),
          retrievalScope: ['series', 'volume', 'chapter', 'scene'].includes(String(fact.retrievalScope))
            ? String(fact.retrievalScope) as NormalizedPreReadResult['facts'][number]['retrievalScope'] : memoryPolicyFor(String(fact.kind ?? 'event'), String(fact.predicate ?? ''), String(fact.statement ?? ''), Number(fact.confidence)).retrievalScope,
          confidence: Math.max(0, Math.min(1, Number(fact.confidence) || 0)),
        })),
        events: (result.events ?? []) as unknown as NormalizedPreReadResult['events'],
        frames: (result.frames ?? []) as unknown as NormalizedPreReadResult['frames'],
        styleDecisions: (result.styleDecisions ?? []) as unknown as NormalizedPreReadResult['styleDecisions'],
        ambiguities: (result.ambiguities ?? []) as unknown as NormalizedPreReadResult['ambiguities'],
      } satisfies NormalizedPreReadResult;
      const narrativeSave = this.#narrativePersistence.saveChapter(projectId, chapterId, chapterOrdinal, structuredResult);
      const humanSave = this.#humanMemoryPersistence.saveChapter(projectId, chapterId, chapterOrdinal,
        structuredResult.styleDecisions, structuredResult.ambiguities);
      const consolidation = this.#memoryConsolidation.consolidateChapter(projectId, chapterId, chapterOrdinal);
      const seriesSync = this.#seriesMemory.syncProject(projectId);
      const entityInvalidated = narrativeSave.knowledgeChanged
        ? this.#narrativeInvalidation.flagSelectedTranslations(projectId, narrativeSave.entityIds, `第 ${chapterOrdinal} 章预读证据重新归并`)
        : 0;
      const chapterInvalidated = humanSave.changed
        ? this.#narrativeInvalidation.flagChapterTranslations(projectId, chapterId, `第 ${chapterOrdinal} 章文风或歧义证据重新归并`)
        : 0;
      const invalidated = Math.max(entityInvalidated, chapterInvalidated);
      this.log(projectId, null, null, 'pre-read-saved', `第 ${chapterOrdinal} 章认知结果已写入并完成记忆巩固。`, {
        chapterId, invalidatedTranslations: invalidated, styleCount: humanSave.styleIds.length,
        ambiguityCount: humanSave.ambiguityIds.length, consolidation, seriesSync,
      });
    });
  }

  saveTranslationVersion(segment: TranslationSegmentRecord, text: string, stage: 'initial' | 'self-repair' | 'independent-review' | 'manual' | 'final', profileId: string, model: string, contextManifest: NarrativeContextManifest, response: ModelResponse, elapsedMs: number, status: string | null, roles: readonly SegmentSemanticRoles[] = []) {
    const timestamp = now();
    return this.#transaction(() => {
      const versionNumber = ((this.#database.prepare('SELECT max(version_number) AS value FROM translation_versions WHERE segment_id = ?').get(segment.segmentId) as { value: number | null }).value ?? 0) + 1;
      const versionId = `version-${randomUUID()}`;
      this.#database.prepare(`
        INSERT INTO translation_versions(version_id, segment_id, project_id, version_number, stage, text,
          model, provider_profile_id, prompt_version, context_manifest_json, response_id, finish_reason,
          input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, elapsed_ms, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(versionId, segment.segmentId, segment.projectId, versionNumber, stage, text, model, profileId,
        PROMPT_VERSION, safeJson(contextManifest), response.responseId, response.finishReason,
        response.inputTokens, response.outputTokens, response.cachedInputTokens, response.reasoningTokens, elapsedMs, timestamp);
      if (status !== null) this.#database.prepare('UPDATE translation_segments SET selected_version_id = ?, status = ?, updated_at = ? WHERE segment_id = ?')
        .run(versionId, status, timestamp, segment.segmentId);
      this.#narrativeRetrieval.saveDependency(versionId, segment, contextManifest, roles);
      this.#memoryConsolidation.markAccessed(contextManifest.memoryIds);
      this.#humanMemoryPersistence.markStyleUsed(contextManifest.styleIds);
      return versionId;
    });
  }

  createReviewItem(segment: TranslationSegmentRecord, category: string, severity: string, title: string, explanation: string, evidence: unknown, proposedText?: string) {
    const existing = this.#database.prepare(`SELECT review_id FROM review_items WHERE segment_id = ? AND category = ? AND title = ? AND status = 'open' LIMIT 1`)
      .get(segment.segmentId, category, title) as { review_id: string } | undefined;
    if (existing) {
      this.#database.prepare(`UPDATE review_items SET severity = ?, explanation = ?, evidence_json = ?, proposed_text = ?, created_at = ? WHERE review_id = ?`)
        .run(severity, explanation, safeJson(evidence), proposedText ?? null, now(), existing.review_id);
      return existing.review_id;
    }
    const reviewId = `review-${randomUUID()}`;
    this.#database.prepare(`
      INSERT INTO review_items(review_id, project_id, segment_id, category, severity, status, title,
        explanation, evidence_json, proposed_text, resolution_note, created_at, resolved_at)
      VALUES(?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, NULL, ?, NULL)
    `).run(reviewId, segment.projectId, segment.segmentId, category, severity, title, explanation, safeJson(evidence), proposedText ?? null, now());
    return reviewId;
  }

  finishItem(itemId: string, status: 'completed' | 'failed' | 'skipped', errorMessage: string | null, usage?: { inputTokens: number; outputTokens: number; warning?: boolean }) {
    const timestamp = now();
    this.#transaction(() => {
      const row = this.#database.prepare('SELECT task_id FROM workflow_task_items WHERE task_item_id = ?').get(itemId) as { task_id: string } | undefined;
      if (!row) return;
      this.#database.prepare(`UPDATE workflow_task_items SET status = ?, error_message = ?, checkpoint_json = CASE WHEN ? IN ('completed', 'skipped') THEN '' ELSE checkpoint_json END, updated_at = ?, completed_at = ? WHERE task_item_id = ?`)
        .run(status, errorMessage, status, timestamp, timestamp, itemId);
      if (usage) this.#database.prepare(`UPDATE workflow_tasks SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, warning_items = warning_items + ?, updated_at = ? WHERE task_id = ?`)
        .run(usage.inputTokens, usage.outputTokens, usage.warning ? 1 : 0, timestamp, row.task_id);
      this.#refreshTask(row.task_id, timestamp);
    });
  }

  requeueItemFromCheckpoint(itemId: string, errorMessage: string) {
    const timestamp = now();
    return this.#transaction(() => {
      const row = this.#database.prepare('SELECT task_id FROM workflow_task_items WHERE task_item_id = ?').get(itemId) as { task_id: string } | undefined;
      if (!row) throw new Error('待恢复的任务项不存在。');
      this.#database.prepare(`
        UPDATE workflow_task_items
        SET status = 'pending', error_message = ?, started_at = NULL, completed_at = NULL, updated_at = ?
        WHERE task_item_id = ?
      `).run(errorMessage, timestamp, itemId);
      this.#database.prepare(`
        UPDATE workflow_tasks
        SET status = 'running', error_message = NULL, completed_at = NULL, updated_at = ?
        WHERE task_id = ?
      `).run(timestamp, row.task_id);
      const task = this.getTask(row.task_id);
      if (!task) throw new Error('待恢复的任务不存在。');
      return task;
    });
  }

  #refreshTask(taskId: string, timestamp: string) {
    const counts = this.#database.prepare(`
      SELECT count(*) AS total,
        sum(CASE WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS completed,
        sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        sum(CASE WHEN status IN ('pending', 'running') THEN 1 ELSE 0 END) AS remaining
      FROM workflow_task_items WHERE task_id = ?
    `).get(taskId) as { total: number; completed: number; failed: number; remaining: number };
    this.#database.prepare('UPDATE workflow_tasks SET completed_items = ?, failed_items = ?, updated_at = ? WHERE task_id = ?')
      .run(counts.completed, counts.failed, timestamp, taskId);
    const task = this.getTask(taskId);
    if (counts.remaining === 0 && task && !['paused', 'cancelled'].includes(task.status)) {
      const finalStatus = counts.failed > 0 ? 'failed' : 'completed';
      this.#database.prepare('UPDATE workflow_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE task_id = ?')
        .run(finalStatus, timestamp, timestamp, taskId);
    }
  }

  setTaskStatus(taskId: string, status: WorkflowTaskStatus, errorMessage: string | null = null) {
    const timestamp = now();
    if (status === 'paused' || status === 'cancelled' || status === 'interrupted') {
      this.#database.prepare(`UPDATE workflow_task_items SET status = 'pending', started_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'running'`).run(timestamp, taskId);
    }
    this.#database.prepare('UPDATE workflow_tasks SET status = ?, error_message = ?, updated_at = ?, completed_at = CASE WHEN ? IN (\'cancelled\', \'completed\', \'failed\') THEN ? ELSE completed_at END WHERE task_id = ?')
      .run(status, errorMessage, timestamp, status, timestamp, taskId);
    const task = this.getTask(taskId);
    if (!task) throw new Error('任务不存在。');
    return task;
  }

  retryFailedTaskItems(taskId: string) {
    const timestamp = now();
    return this.#transaction(() => {
      this.#database.prepare(`UPDATE workflow_task_items SET status = 'pending', attempts = 0, started_at = NULL, completed_at = NULL, error_message = NULL, updated_at = ? WHERE task_id = ? AND status = 'failed'`).run(timestamp, taskId);
      this.#refreshTask(taskId, timestamp);
      this.#database.prepare(`UPDATE workflow_tasks SET status = 'pending', error_message = NULL, completed_at = NULL, updated_at = ? WHERE task_id = ?`).run(timestamp, taskId);
      const task = this.getTask(taskId);
      if (!task) throw new Error('任务不存在。');
      return task;
    });
  }

  getProjectGlobalContext(projectId: string) {
    const glossary = this.glossary(projectId);
    const facts = this.memory(projectId);
    const reviews = this.reviews(projectId);
    const ambiguities = this.ambiguities(projectId);
    const chapters = this.#database.prepare(`
      SELECT chapter_id, ordinal, title, character_count, paragraph_count FROM chapters
      WHERE project_id = ? ORDER BY ordinal
    `).all(projectId) as unknown as Array<{
      chapter_id: string; ordinal: number; title: string; character_count: number; paragraph_count: number;
    }>;
    const styleDecisions = this.#database.prepare(`
      SELECT style_id, decision_kind, source_pattern, target_strategy, rationale FROM translation_style_memories
      WHERE project_id = ?
    `).all(projectId) as unknown as Array<{
      style_id: string; decision_kind: string; source_pattern: string; target_strategy: string; rationale: string;
    }>;
    const entities = this.#database.prepare(`
      SELECT e.entity_id, e.canonical_source, e.canonical_translation, e.entity_kind, e.gender,
        group_concat(a.source_form, '||') AS aliases
      FROM narrative_entities e
      LEFT JOIN narrative_aliases a ON a.entity_id = e.entity_id
      WHERE e.project_id = ?
      GROUP BY e.entity_id
    `).all(projectId) as unknown as Array<{
      entity_id: string; canonical_source: string; canonical_translation: string; entity_kind: string; gender: string; aliases: string | null;
    }>;

    return {
      glossary,
      facts,
      reviews,
      ambiguities,
      chapters,
      styleDecisions,
      entities: entities.map((e) => ({
        entityId: e.entity_id,
        canonicalSource: e.canonical_source,
        canonicalTranslation: e.canonical_translation,
        entityKind: e.entity_kind,
        gender: e.gender,
        aliases: e.aliases ? e.aliases.split('||').filter(Boolean) : [],
      })),
    };
  }

  updateCharacterRelations(
    projectId: string,
    updates: {
      readonly modifiedCharacters?: readonly {
        readonly sourceTerm: string;
        readonly translatedTerm?: string;
        readonly gender?: string;
        readonly sense?: string;
        readonly notes?: string;
        readonly status?: string;
        readonly aliases?: readonly string[];
      }[];
      readonly newRelationships?: readonly {
        readonly subject: string;
        readonly predicate: string;
        readonly object: string;
        readonly statement: string;
        readonly importance?: number;
      }[];
    },
  ) {
    const timestamp = now();
    let count = 0;
    if (updates.modifiedCharacters) {
      for (const char of updates.modifiedCharacters) {
        const entry = this.#database.prepare('SELECT glossary_id, translated_term FROM glossary_entries WHERE project_id = ? AND source_term = ?')
          .get(projectId, char.sourceTerm) as { glossary_id: string; translated_term: string } | undefined;
        if (entry) {
          this.updateGlossary(
            entry.glossary_id,
            char.translatedTerm ?? entry.translated_term,
            char.status ?? 'confirmed',
            char.notes ?? '',
            '',
            char.gender,
          );
          if (char.sense) {
            this.#database.prepare('UPDATE glossary_entries SET sense = ?, updated_at = ? WHERE glossary_id = ?')
              .run(char.sense, timestamp, entry.glossary_id);
          }
          count += 1;
        }
        if (char.aliases && char.aliases.length > 0) {
          const entity = this.#database.prepare('SELECT entity_id FROM narrative_entities WHERE project_id = ? AND canonical_source = ?')
            .get(projectId, char.sourceTerm) as { entity_id: string } | undefined;
          if (entity) {
            for (const alias of char.aliases) {
              this.#database.prepare(`
                INSERT OR IGNORE INTO narrative_aliases(alias_id, entity_id, project_id, source_form, translated_form, alias_kind, confidence, created_at)
                VALUES(?, ?, ?, ?, ?, 'alias', 1.0, ?)
              `).run(`alias-${randomUUID()}`, entity.entity_id, projectId, alias, char.translatedTerm ?? null, timestamp);
            }
          }
        }
      }
    }
    if (updates.newRelationships) {
      for (const rel of updates.newRelationships) {
        const factId = `fact-${randomUUID()}`;
        this.#database.prepare(`
          INSERT INTO memory_facts(fact_id, project_id, fact_kind, subject_key, object_key,
            statement, chapter_start, reader_visible_from, evidence_excerpt, confidence, status, memory_class, importance,
            retention_policy, retrieval_scope, consolidation_status, character_knowledge_json, created_by, created_at, updated_at)
          VALUES(?, ?, 'relationship', ?, ?, ?, 1, 1, 'AI 关系助理梳理建立', 1.0, 'confirmed', 'relationship', ?, 'stable', 'series', 'consolidated', '{}', 'character-agent', ?, ?)
        `).run(factId, projectId, rel.subject, rel.object, rel.statement, rel.importance ?? 0.8, timestamp, timestamp);
        count += 1;
      }
    }
    return count;
  }

  updateMemoryFacts(
    projectId: string,
    updates: {
      readonly modifiedFacts?: readonly {
        readonly factId: string;
        readonly statement?: string;
        readonly importance?: number;
        readonly status?: string;
        readonly memoryClass?: string;
        readonly retrievalScope?: string;
      }[];
      readonly archivedFactIds?: readonly string[];
      readonly newConsolidatedFacts?: readonly {
        readonly subjectKey?: string;
        readonly objectKey?: string;
        readonly factKind: string;
        readonly statement: string;
        readonly importance: number;
        readonly chapterStart: number;
      }[];
    },
  ) {
    const timestamp = now();
    return this.#transaction(() => {
      let count = 0;
      if (updates.modifiedFacts) {
        for (const mod of updates.modifiedFacts) {
          const fact = this.#database.prepare('SELECT fact_id FROM memory_facts WHERE project_id = ? AND fact_id = ?').get(projectId, mod.factId);
          if (fact) {
            this.#database.prepare(`
              UPDATE memory_facts
              SET statement = COALESCE(?, statement),
                  importance = COALESCE(?, importance),
                  status = COALESCE(?, status),
                  memory_class = COALESCE(?, memory_class),
                  retrieval_scope = COALESCE(?, retrieval_scope),
                  updated_at = ?
              WHERE fact_id = ?
            `).run(mod.statement ?? null, mod.importance ?? null, mod.status ?? null, mod.memoryClass ?? null, mod.retrievalScope ?? null, timestamp, mod.factId);
            count += 1;
          }
        }
      }
      if (updates.archivedFactIds) {
        for (const fid of updates.archivedFactIds) {
          this.#database.prepare(`UPDATE memory_facts SET status = 'archived', updated_at = ? WHERE project_id = ? AND fact_id = ?`)
            .run(timestamp, projectId, fid);
          count += 1;
        }
      }
      if (updates.newConsolidatedFacts) {
        for (const cf of updates.newConsolidatedFacts) {
          const factId = `fact-${randomUUID()}`;
          this.#database.prepare(`
            INSERT INTO memory_facts(fact_id, project_id, fact_kind, subject_key, object_key,
              statement, chapter_start, reader_visible_from, evidence_excerpt, confidence, status, memory_class, importance,
              retention_policy, retrieval_scope, consolidation_status, character_knowledge_json, created_by, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'AI 记忆管理精炼归并', 1.0, 'confirmed', 'canon', ?, 'stable', 'series', 'consolidated', '{}', 'memory-agent', ?, ?)
          `).run(factId, projectId, cf.factKind, cf.subjectKey ?? null, cf.objectKey ?? null, cf.statement, cf.chapterStart || 1, cf.chapterStart || 1, cf.importance || 0.85, timestamp, timestamp);
          count += 1;
        }
      }
      return count;
    });
  }

  log(projectId: string, taskId: string | null, segmentId: string | null, eventType: string, message: string, details: unknown) {
    this.#database.prepare(`INSERT INTO operation_log(log_id, project_id, task_id, segment_id, event_type, message, details_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`log-${randomUUID()}`, projectId, taskId, segmentId, eventType, message, safeJson(details), now());
  }
}
