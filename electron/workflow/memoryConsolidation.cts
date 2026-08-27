import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { memoryPolicyFor } from './memoryPolicy.cjs';
import type { MemoryClass, MemoryScope } from './narrativeModels.cjs';

interface ConsolidationCandidate {
  readonly sourceType: 'fact' | 'claim' | 'event' | 'frame' | 'summary';
  readonly sourceId: string;
  readonly kind: string;
  readonly predicate: string;
  readonly summary: string;
  readonly subjectKey: string | null;
  readonly objectKey: string | null;
  readonly worldlineKey: string;
  readonly sceneKey: string;
  readonly segmentOrdinal: number | null;
  readonly sourceStartOffset: number | null;
  readonly sourceEndOffset: number | null;
  readonly evidenceId: string | null;
  readonly evidenceStatus: string;
  readonly confidence: number;
  readonly sourceStatus: string;
  readonly suggestedMemoryClass?: string;
  readonly suggestedImportance?: number;
  readonly suggestedScope?: string;
}

const signatureFor = (candidate: ConsolidationCandidate) => createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
const clipped = (value: number) => Math.max(0, Math.min(1, Number(value) || 0));

const finalPolicy = (candidate: ConsolidationCandidate) => {
  const derived = memoryPolicyFor(candidate.kind, candidate.predicate, candidate.summary, candidate.confidence);
  const classes = new Set<MemoryClass>(['canon', 'character', 'relationship', 'event', 'state', 'episode-detail']);
  const scopes = new Set<MemoryScope>(['series', 'volume', 'chapter', 'scene']);
  const suggestedImportance = Number(candidate.suggestedImportance);
  return {
    memoryClass: classes.has(candidate.suggestedMemoryClass as MemoryClass)
      ? candidate.suggestedMemoryClass as MemoryClass : derived.memoryClass,
    importance: Number.isFinite(suggestedImportance)
      ? Math.max(derived.importance - 0.1, Math.min(derived.importance + 0.1, clipped(suggestedImportance)))
      : derived.importance,
    retentionPolicy: derived.retentionPolicy,
    retrievalScope: scopes.has(candidate.suggestedScope as MemoryScope)
      ? candidate.suggestedScope as MemoryScope : derived.retrievalScope,
  };
};

const trackFor = (candidate: ConsolidationCandidate, memoryClass: MemoryClass) => [
  memoryClass, candidate.subjectKey ?? '', candidate.objectKey ?? '', candidate.predicate,
  candidate.worldlineKey, candidate.sceneKey,
].join(':');

export class MemoryConsolidation {
  readonly #database: DatabaseSync;
  constructor(database: DatabaseSync) { this.#database = database; }

  #candidates(projectId: string, chapterId: string, chapterOrdinal: number): ConsolidationCandidate[] {
    const facts = this.#database.prepare(`
      SELECT f.fact_id AS source_id, f.fact_kind AS kind, f.fact_kind AS predicate, f.statement AS summary,
        f.subject_key, f.object_key, 'main' AS worldline_key, '' AS scene_key,
        f.chapter_start_segment AS segment_ordinal, f.chapter_start_offset AS source_start_offset,
        f.chapter_end_offset AS source_end_offset, NULL AS evidence_id,
        CASE WHEN f.evidence_excerpt <> '' THEN 'exact' ELSE 'unlocated' END AS evidence_status,
        f.confidence, f.status AS source_status, f.memory_class, f.importance, f.retrieval_scope
      FROM memory_facts f WHERE f.project_id = ? AND f.chapter_start = ? AND f.status <> 'superseded'
    `).all(projectId, chapterOrdinal) as unknown as Array<Record<string, unknown>>;
    const claims = this.#database.prepare(`
      SELECT c.claim_id AS source_id, c.claim_kind AS kind, c.predicate, c.statement AS summary,
        c.subject_key, c.object_key, c.worldline_key, c.scene_key, e.segment_ordinal,
        e.source_start_offset, e.source_end_offset, e.evidence_id, e.locator_status AS evidence_status,
        c.confidence, c.status AS source_status, c.memory_class, c.importance, c.retrieval_scope
      FROM narrative_claims c JOIN narrative_evidence e ON e.evidence_id = c.evidence_id
      WHERE c.project_id = ? AND e.chapter_id = ? AND c.status <> 'superseded'
    `).all(projectId, chapterId) as unknown as Array<Record<string, unknown>>;
    const events = this.#database.prepare(`
      SELECT n.event_id AS source_id, 'event' AS kind, n.predicate, n.statement AS summary,
        n.agent_key AS subject_key, COALESCE(n.patient_key, n.recipient_key) AS object_key,
        n.worldline_key, n.scene_key, e.segment_ordinal, e.source_start_offset, e.source_end_offset,
        e.evidence_id, e.locator_status AS evidence_status, n.confidence, n.status AS source_status,
        n.memory_class, n.importance, n.retrieval_scope
      FROM narrative_events n JOIN narrative_evidence e ON e.evidence_id = n.evidence_id
      WHERE n.project_id = ? AND e.chapter_id = ? AND n.status <> 'superseded'
    `).all(projectId, chapterId) as unknown as Array<Record<string, unknown>>;
    const frames = this.#database.prepare(`
      SELECT f.frame_id AS source_id, 'frame' AS kind, f.frame_kind AS predicate,
        ('叙事框架：' || f.frame_kind || ' / ' || f.scene_key || ' / ' || f.worldline_key) AS summary,
        NULL AS subject_key, NULL AS object_key, f.worldline_key, f.scene_key, e.segment_ordinal,
        e.source_start_offset, e.source_end_offset, e.evidence_id, e.locator_status AS evidence_status,
        f.confidence, f.status AS source_status, 'episode-detail' AS memory_class, 0.5 AS importance,
        'scene' AS retrieval_scope
      FROM narrative_context_frames f JOIN narrative_evidence e ON e.evidence_id = f.evidence_id
      WHERE f.project_id = ? AND e.chapter_id = ?
    `).all(projectId, chapterId) as unknown as Array<Record<string, unknown>>;
    const map = (row: Record<string, unknown>, sourceType: ConsolidationCandidate['sourceType']): ConsolidationCandidate => {
      const rawStart = row.source_start_offset == null ? null : Number(row.source_start_offset);
      const rawEnd = row.source_end_offset == null ? null : Number(row.source_end_offset);
      const sourceStartOffset = rawStart !== null && Number.isInteger(rawStart) && rawStart >= 0 ? rawStart : null;
      const sourceEndOffset = (sourceStartOffset !== null && rawEnd !== null && rawEnd < sourceStartOffset)
        ? null
        : (rawEnd !== null && Number.isInteger(rawEnd) && rawEnd >= 0 ? rawEnd : null);
      return {
        sourceType, sourceId: String(row.source_id), kind: String(row.kind), predicate: String(row.predicate),
        summary: String(row.summary), subjectKey: row.subject_key == null ? null : String(row.subject_key),
        objectKey: row.object_key == null ? null : String(row.object_key), worldlineKey: String(row.worldline_key || 'main'),
        sceneKey: String(row.scene_key || ''), segmentOrdinal: row.segment_ordinal == null ? null : Number(row.segment_ordinal),
        sourceStartOffset,
        sourceEndOffset,
        evidenceId: row.evidence_id == null ? null : String(row.evidence_id), evidenceStatus: String(row.evidence_status),
        confidence: clipped(Number(row.confidence)), sourceStatus: String(row.source_status),
        suggestedMemoryClass: row.memory_class == null ? undefined : String(row.memory_class),
        suggestedImportance: row.importance == null ? undefined : Number(row.importance),
        suggestedScope: row.retrieval_scope == null ? undefined : String(row.retrieval_scope),
      };
    };
    return [...facts.map((row) => map(row, row.kind === 'chapter-summary' ? 'summary' : 'fact')),
      ...claims.map((row) => map(row, 'claim')), ...events.map((row) => map(row, 'event')),
      ...frames.map((row) => map(row, 'frame'))];
  }

  consolidateChapter(projectId: string, chapterId: string, chapterOrdinal: number) {
    const candidates = this.#candidates(projectId, chapterId, chapterOrdinal);
    const timestamp = new Date().toISOString();
    const series = this.#database.prepare('SELECT series_id FROM series_projects WHERE project_id = ?').get(projectId) as { series_id: string } | undefined;
    const chapterSignature = createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
    const already = this.#database.prepare(`
      SELECT run_id FROM memory_consolidation_runs WHERE project_id = ? AND chapter_id = ? AND source_signature = ? AND status = 'completed'
    `).get(projectId, chapterId, chapterSignature);
    if (already) return { created: 0, superseded: 0, archived: 0, unchanged: true };
    const currentKeys = new Set(candidates.map((candidate) => `${candidate.sourceType}:${candidate.sourceId}`));
    const existingChapter = this.#database.prepare(`
      SELECT memory_id, source_record_type, source_record_id FROM consolidated_memories
      WHERE project_id = ? AND chapter_ordinal = ? AND consolidation_status NOT IN ('archived', 'superseded')
    `).all(projectId, chapterOrdinal) as unknown as Array<{ memory_id: string; source_record_type: string; source_record_id: string }>;
    let created = 0;
    let superseded = 0;
    let archived = 0;
    for (const old of existingChapter) {
      if (currentKeys.has(`${old.source_record_type}:${old.source_record_id}`)) continue;
      this.#database.prepare(`UPDATE consolidated_memories SET consolidation_status = 'archived', updated_at = ? WHERE memory_id = ?`)
        .run(timestamp, old.memory_id);
      archived += 1;
    }
    for (const candidate of candidates) {
      const policy = finalPolicy(candidate);
      const trackKey = trackFor(candidate, policy.memoryClass);
      const sourceSignature = signatureFor(candidate);
      const evidenceGrounded = candidate.sourceType === 'summary' || candidate.evidenceStatus === 'exact';
      const confirmed = ['confirmed', 'locked'].includes(candidate.sourceStatus) && candidate.confidence >= 0.9 && evidenceGrounded;
      const consolidationStatus = confirmed ? 'consolidated' : candidate.sourceStatus === 'conflict' ? 'conflict' : 'candidate';
      const current = this.#database.prepare(`
        SELECT memory_id, consolidation_status FROM consolidated_memories
        WHERE project_id = ? AND source_record_type = ? AND source_record_id = ?
      `).get(projectId, candidate.sourceType, candidate.sourceId) as { memory_id: string; consolidation_status: string } | undefined;
      const memoryId = current?.memory_id ?? `memory-${randomUUID()}`;
      let supersedesMemoryId: string | null = null;
      if (consolidationStatus === 'consolidated' && ['state', 'relationship', 'character'].includes(policy.memoryClass)) {
        const prior = this.#database.prepare(`
          SELECT memory_id FROM consolidated_memories
          WHERE project_id = ? AND track_key = ? AND memory_id <> ? AND consolidation_status = 'consolidated'
            AND (chapter_ordinal < ? OR (chapter_ordinal = ? AND COALESCE(segment_ordinal, 1) < COALESCE(?, 1)))
          ORDER BY chapter_ordinal DESC, COALESCE(segment_ordinal, 1) DESC LIMIT 1
        `).get(projectId, trackKey, memoryId, chapterOrdinal, chapterOrdinal, candidate.segmentOrdinal) as { memory_id: string } | undefined;
        if (prior) {
          supersedesMemoryId = prior.memory_id;
          this.#database.prepare(`UPDATE consolidated_memories SET consolidation_status = 'superseded', updated_at = ? WHERE memory_id = ?`)
            .run(timestamp, prior.memory_id);
          superseded += 1;
        }
      }
      this.#database.prepare(`
        INSERT INTO consolidated_memories(memory_id, project_id, series_id, source_record_type, source_record_id,
          memory_class, summary, subject_key, object_key, track_key, worldline_key, scene_key, chapter_ordinal,
          segment_ordinal, source_start_offset, source_end_offset, importance, retention_policy, retrieval_scope,
          consolidation_status, supersedes_memory_id, evidence_ids_json, confidence, source_signature,
          last_accessed_at, access_count, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
        ON CONFLICT(project_id, source_record_type, source_record_id) DO UPDATE SET
          series_id = excluded.series_id, memory_class = excluded.memory_class, summary = excluded.summary,
          subject_key = excluded.subject_key, object_key = excluded.object_key, track_key = excluded.track_key,
          worldline_key = excluded.worldline_key, scene_key = excluded.scene_key,
          chapter_ordinal = excluded.chapter_ordinal, segment_ordinal = excluded.segment_ordinal,
          source_start_offset = excluded.source_start_offset, source_end_offset = excluded.source_end_offset,
          importance = excluded.importance, retention_policy = excluded.retention_policy,
          retrieval_scope = excluded.retrieval_scope, consolidation_status = excluded.consolidation_status,
          supersedes_memory_id = excluded.supersedes_memory_id, evidence_ids_json = excluded.evidence_ids_json,
          confidence = excluded.confidence, source_signature = excluded.source_signature, updated_at = excluded.updated_at
      `).run(memoryId, projectId, series?.series_id ?? null, candidate.sourceType, candidate.sourceId,
        policy.memoryClass, candidate.summary, candidate.subjectKey, candidate.objectKey, trackKey,
        candidate.worldlineKey, candidate.sceneKey, chapterOrdinal, candidate.segmentOrdinal,
        candidate.sourceStartOffset, candidate.sourceEndOffset, policy.importance, policy.retentionPolicy,
        policy.retrievalScope, consolidationStatus, supersedesMemoryId, JSON.stringify(candidate.evidenceId ? [candidate.evidenceId] : []),
        candidate.confidence, sourceSignature, timestamp, timestamp);
      if (!current) created += 1;
      if (candidate.sourceType === 'fact' || candidate.sourceType === 'summary') {
        this.#database.prepare(`
          UPDATE memory_facts SET memory_class = ?, importance = ?, retention_policy = ?, retrieval_scope = ?,
            consolidation_status = ?, supersedes_fact_id = COALESCE(supersedes_fact_id, NULL), updated_at = ?
          WHERE fact_id = ?
        `).run(policy.memoryClass, policy.importance, policy.retentionPolicy, policy.retrievalScope,
          consolidationStatus, timestamp, candidate.sourceId);
      }
    }
    const workingArchive = this.#database.prepare(`
      UPDATE consolidated_memories SET consolidation_status = 'archived', updated_at = ?
      WHERE project_id = ? AND consolidation_status = 'consolidated'
        AND ((retention_policy = 'working' AND chapter_ordinal < ?)
          OR (retention_policy = 'episodic' AND importance < 0.45 AND chapter_ordinal < ?))
    `).run(timestamp, projectId, Math.max(1, chapterOrdinal - 1), Math.max(1, chapterOrdinal - 8));
    archived += Number(workingArchive.changes);
    this.#database.prepare(`
      INSERT INTO memory_consolidation_runs(run_id, project_id, chapter_id, chapter_ordinal, source_signature,
        created_count, superseded_count, archived_count, status, details_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
    `).run(`consolidation-${randomUUID()}`, projectId, chapterId, chapterOrdinal, chapterSignature,
      created, superseded, archived, JSON.stringify({ candidateCount: candidates.length }), timestamp);
    return { created, superseded, archived, unchanged: false };
  }

  markAccessed(memoryIds: readonly string[]) {
    if (!memoryIds.length) return;
    const timestamp = new Date().toISOString();
    const statement = this.#database.prepare('UPDATE consolidated_memories SET access_count = access_count + 1, last_accessed_at = ? WHERE memory_id = ?');
    memoryIds.forEach((memoryId) => statement.run(timestamp, memoryId));
  }

  finalizeVolume(projectId: string) {
    const project = this.#database.prepare('SELECT title, chapter_count FROM projects WHERE project_id = ?')
      .get(projectId) as { title: string; chapter_count: number } | undefined;
    if (!project) throw new Error('作品不存在。');
    const chapterSummaries = this.#database.prepare(`
      SELECT chapter_start AS chapter, statement AS summary FROM memory_facts
      WHERE project_id = ? AND fact_kind = 'chapter-summary' AND status IN ('confirmed', 'locked')
      ORDER BY chapter_start
    `).all(projectId) as unknown as Array<{ chapter: number; summary: string }>;
    const durable = this.#database.prepare(`
      SELECT memory_id, memory_class, summary, subject_key, object_key, importance, retrieval_scope
      FROM consolidated_memories WHERE project_id = ? AND consolidation_status = 'consolidated'
        AND source_record_id NOT LIKE 'volume:%' AND retention_policy IN ('permanent', 'stable')
      ORDER BY importance DESC, chapter_ordinal DESC LIMIT 240
    `).all(projectId);
    const timestamp = new Date().toISOString();
    const series = this.#database.prepare('SELECT series_id FROM series_projects WHERE project_id = ?').get(projectId) as { series_id: string } | undefined;
    const sourceId = `volume:${projectId}`;
    const summary = JSON.stringify({ title: project.title, chapterCount: project.chapter_count,
      chapterSummaries, durableMemories: durable });
    const signature = createHash('sha256').update(summary).digest('hex');
    const existing = this.#database.prepare(`
      SELECT memory_id FROM consolidated_memories WHERE project_id = ? AND source_record_type = 'summary' AND source_record_id = ?
    `).get(projectId, sourceId) as { memory_id: string } | undefined;
    const memoryId = existing?.memory_id ?? `memory-${randomUUID()}`;
    const lastChapter = chapterSummaries.at(-1)?.chapter ?? Math.max(1, project.chapter_count);
    const tail = this.#database.prepare(`
      SELECT segment_ordinal, source_text FROM translation_segments
      WHERE project_id = ? AND chapter_ordinal = ? ORDER BY segment_ordinal DESC LIMIT 1
    `).get(projectId, lastChapter) as { segment_ordinal: number; source_text: string } | undefined;
    const tailSegment = tail?.segment_ordinal ?? 1;
    const tailOffset = tail?.source_text.length ?? 0;
    this.#database.prepare(`
      INSERT INTO consolidated_memories(memory_id, project_id, series_id, source_record_type, source_record_id,
        memory_class, summary, subject_key, object_key, track_key, worldline_key, scene_key, chapter_ordinal,
        segment_ordinal, source_start_offset, source_end_offset, importance, retention_policy, retrieval_scope,
        consolidation_status, supersedes_memory_id, evidence_ids_json, confidence, source_signature,
        last_accessed_at, access_count, created_at, updated_at)
      VALUES(?, ?, ?, 'summary', ?, 'canon', ?, NULL, NULL, ?, 'main', '', ?, ?, ?, ?,
        0.98, 'permanent', 'series', 'consolidated', NULL, '[]', 1, ?, NULL, 0, ?, ?)
      ON CONFLICT(project_id, source_record_type, source_record_id) DO UPDATE SET
        series_id = excluded.series_id, summary = excluded.summary, chapter_ordinal = excluded.chapter_ordinal,
        segment_ordinal = excluded.segment_ordinal, source_start_offset = excluded.source_start_offset,
        source_end_offset = excluded.source_end_offset,
        source_signature = excluded.source_signature, consolidation_status = 'consolidated', updated_at = excluded.updated_at
    `).run(memoryId, projectId, series?.series_id ?? null, sourceId, summary,
      `volume:${projectId}`, lastChapter, tailSegment, tailOffset, tailOffset, signature, timestamp, timestamp);
    return { memoryId, chapterSummaryCount: chapterSummaries.length, durableMemoryCount: durable.length };
  }
}
