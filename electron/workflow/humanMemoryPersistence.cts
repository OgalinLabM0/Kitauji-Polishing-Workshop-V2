import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { NarrativeAmbiguityInput, NarrativeStyleDecisionInput } from './narrativeModels.cjs';
import { evidenceSpan, groundedOffset, upsertNarrativeEvidence } from './sourceSpan.cjs';

const clipped = (value: number) => Math.max(0, Math.min(1, Number(value) || 0));

export class HumanMemoryPersistence {
  readonly #database: DatabaseSync;
  constructor(database: DatabaseSync) { this.#database = database; }

  #chapterSignature(projectId: string, chapterId: string, chapterOrdinal: number) {
    const styles = this.#database.prepare(`
      SELECT owner_type, owner_key, decision_kind, source_pattern, target_strategy, rationale,
        valid_from_chapter, valid_from_segment, valid_from_offset, valid_to_chapter, valid_to_segment,
        valid_to_offset, confidence, status FROM translation_style_memories
      WHERE project_id = ? AND valid_from_chapter = ? ORDER BY owner_type, owner_key, decision_kind, source_pattern
    `).all(projectId, chapterOrdinal);
    const ambiguities = this.#database.prepare(`
      SELECT segment_ordinal, source_start_offset, source_end_offset, ambiguity_kind, source_excerpt,
        interpretations_json, preservation_strategy, reveal_chapter, reveal_segment, reveal_offset,
        selected_interpretation, confidence, status FROM narrative_ambiguities
      WHERE project_id = ? AND chapter_id = ? ORDER BY segment_ordinal, source_start_offset, ambiguity_kind
    `).all(projectId, chapterId);
    return JSON.stringify({ styles, ambiguities });
  }

  saveChapter(projectId: string, chapterId: string, chapterOrdinal: number,
    styleDecisions: readonly NarrativeStyleDecisionInput[], ambiguities: readonly NarrativeAmbiguityInput[]) {
    const timestamp = new Date().toISOString();
    const previousSignature = this.#chapterSignature(projectId, chapterId, chapterOrdinal);
    const series = this.#database.prepare('SELECT series_id FROM series_projects WHERE project_id = ?').get(projectId) as { series_id: string } | undefined;
    this.#database.prepare(`
      DELETE FROM translation_style_memories WHERE project_id = ? AND valid_from_chapter = ?
        AND created_by = 'pre-read' AND status <> 'locked'
    `).run(projectId, chapterOrdinal);
    this.#database.prepare(`
      DELETE FROM narrative_ambiguities WHERE project_id = ? AND chapter_id = ? AND status <> 'locked'
    `).run(projectId, chapterId);
    const styleIds: string[] = [];
    for (const item of styleDecisions) {
      const evidenceId = upsertNarrativeEvidence(this.#database, projectId, chapterId, chapterOrdinal,
        item.evidenceExcerpt, timestamp, 'direct', item.evidenceSegment, item.evidenceStartOffset);
      if (!evidenceId) continue;
      const span = evidenceSpan(this.#database, evidenceId);
      const fromSegment = item.validFromChapter === chapterOrdinal ? span.segmentOrdinal ?? item.validFromSegment : item.validFromSegment;
      const fromOffset = groundedOffset(item.validFromChapter, fromSegment, item.validFromOffset,
        chapterOrdinal, span.segmentOrdinal, span.startOffset);
      const confidence = clipped(item.confidence);
      const status = confidence >= 0.9 && span.status === 'exact' ? 'confirmed' : 'candidate';
      const styleId = `style-${randomUUID()}`;
      this.#database.prepare(`
        INSERT INTO translation_style_memories(style_id, project_id, series_id, owner_type, owner_key,
          decision_kind, source_pattern, target_strategy, rationale, valid_from_chapter, valid_from_segment,
          valid_from_offset, valid_to_chapter, valid_to_segment, valid_to_offset, evidence_id, confidence,
          status, usage_count, created_by, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pre-read', ?, ?)
        ON CONFLICT(project_id, owner_type, owner_key, decision_kind, source_pattern, valid_from_chapter)
        DO UPDATE SET target_strategy = excluded.target_strategy, rationale = excluded.rationale,
          valid_from_segment = excluded.valid_from_segment, valid_from_offset = excluded.valid_from_offset,
          valid_to_chapter = excluded.valid_to_chapter, valid_to_segment = excluded.valid_to_segment,
          valid_to_offset = excluded.valid_to_offset, evidence_id = excluded.evidence_id,
          confidence = max(translation_style_memories.confidence, excluded.confidence),
          status = CASE WHEN translation_style_memories.status = 'locked' THEN 'locked' ELSE excluded.status END,
          series_id = excluded.series_id, updated_at = excluded.updated_at
      `).run(styleId, projectId, series?.series_id ?? null, item.ownerType, item.ownerKey, item.decisionKind,
        item.sourcePattern, item.targetStrategy, item.rationale, item.validFromChapter, fromSegment, fromOffset,
        item.validToChapter, item.validToSegment, item.validToOffset, evidenceId, confidence, status, timestamp, timestamp);
      const stored = this.#database.prepare(`
        SELECT style_id FROM translation_style_memories WHERE project_id = ? AND owner_type = ? AND owner_key = ?
          AND decision_kind = ? AND source_pattern = ? AND valid_from_chapter = ?
      `).get(projectId, item.ownerType, item.ownerKey, item.decisionKind, item.sourcePattern, item.validFromChapter) as { style_id: string };
      styleIds.push(stored.style_id);
    }
    const ambiguityIds: string[] = [];
    for (const item of ambiguities) {
      if (item.interpretations.length < 2) continue;
      const evidenceId = upsertNarrativeEvidence(this.#database, projectId, chapterId, chapterOrdinal,
        item.sourceExcerpt, timestamp, 'direct', item.evidenceSegment, item.evidenceStartOffset);
      if (!evidenceId) continue;
      const span = evidenceSpan(this.#database, evidenceId);
      const segmentOrdinal = span.segmentOrdinal ?? item.evidenceSegment;
      if (!segmentOrdinal) continue;
      const confidence = clipped(item.confidence);
      const status = span.status === 'exact' && confidence >= 0.7 ? 'open' : 'candidate';
      const ambiguityId = `ambiguity-${randomUUID()}`;
      this.#database.prepare(`
        INSERT INTO narrative_ambiguities(ambiguity_id, project_id, series_id, chapter_id, chapter_ordinal,
          segment_ordinal, source_start_offset, source_end_offset, ambiguity_kind, source_excerpt,
          interpretations_json, preservation_strategy, reveal_chapter, reveal_segment, reveal_offset,
          selected_interpretation, resolution_note, evidence_id, confidence, status, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, chapter_id, segment_ordinal, source_start_offset, ambiguity_kind, source_excerpt)
        DO UPDATE SET interpretations_json = excluded.interpretations_json,
          preservation_strategy = excluded.preservation_strategy, reveal_chapter = excluded.reveal_chapter,
          reveal_segment = excluded.reveal_segment, reveal_offset = excluded.reveal_offset,
          evidence_id = excluded.evidence_id, confidence = excluded.confidence,
          status = CASE WHEN narrative_ambiguities.status = 'locked' THEN 'locked' ELSE excluded.status END,
          series_id = excluded.series_id, updated_at = excluded.updated_at
      `).run(ambiguityId, projectId, series?.series_id ?? null, chapterId, chapterOrdinal, segmentOrdinal,
        span.startOffset, span.endOffset, item.ambiguityKind, item.sourceExcerpt, JSON.stringify(item.interpretations),
        item.preservationStrategy, item.revealChapter, item.revealSegment, item.revealOffset, evidenceId,
        confidence, status, timestamp, timestamp);
      const stored = this.#database.prepare(`
        SELECT ambiguity_id FROM narrative_ambiguities WHERE project_id = ? AND chapter_id = ?
          AND segment_ordinal = ? AND source_start_offset IS ? AND ambiguity_kind = ? AND source_excerpt = ?
      `).get(projectId, chapterId, segmentOrdinal, span.startOffset, item.ambiguityKind, item.sourceExcerpt) as { ambiguity_id: string };
      ambiguityIds.push(stored.ambiguity_id);
    }
    return { styleIds, ambiguityIds,
      changed: previousSignature !== this.#chapterSignature(projectId, chapterId, chapterOrdinal) };
  }

  ambiguities(projectId: string) {
    return (this.#database.prepare(`
      SELECT ambiguity_id, chapter_ordinal, segment_ordinal, source_start_offset, source_end_offset,
        ambiguity_kind, source_excerpt, interpretations_json, preservation_strategy, reveal_chapter,
        reveal_segment, reveal_offset, selected_interpretation, resolution_note, confidence, status
      FROM narrative_ambiguities WHERE project_id = ? AND status <> 'superseded'
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, chapter_ordinal, segment_ordinal, source_start_offset
    `).all(projectId) as unknown as Array<Record<string, unknown>>).map((row) => ({
      ambiguityId: String(row.ambiguity_id), chapterOrdinal: Number(row.chapter_ordinal),
      segmentOrdinal: Number(row.segment_ordinal), sourceStartOffset: row.source_start_offset == null ? null : Number(row.source_start_offset),
      sourceEndOffset: row.source_end_offset == null ? null : Number(row.source_end_offset), ambiguityKind: String(row.ambiguity_kind),
      sourceExcerpt: String(row.source_excerpt), interpretations: (() => { try { const value = JSON.parse(String(row.interpretations_json)); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } })(),
      preservationStrategy: String(row.preservation_strategy), revealChapter: row.reveal_chapter == null ? null : Number(row.reveal_chapter),
      revealSegment: row.reveal_segment == null ? null : Number(row.reveal_segment), revealOffset: row.reveal_offset == null ? null : Number(row.reveal_offset),
      selectedInterpretation: row.selected_interpretation == null ? null : String(row.selected_interpretation),
      resolutionNote: String(row.resolution_note), confidence: Number(row.confidence), status: String(row.status),
    }));
  }

  resolveAmbiguity(ambiguityId: string, selectedInterpretation: string | null,
    preservationStrategy: string, note: string, lock: boolean) {
    const row = this.#database.prepare(`
      SELECT project_id, chapter_id, segment_ordinal, interpretations_json, status FROM narrative_ambiguities WHERE ambiguity_id = ?
    `).get(ambiguityId) as { project_id: string; chapter_id: string; segment_ordinal: number; interpretations_json: string; status: string } | undefined;
    if (!row) throw new Error('歧义事项不存在。');
    let interpretations: string[] = [];
    try { const parsed = JSON.parse(row.interpretations_json); if (Array.isArray(parsed)) interpretations = parsed.map(String); } catch { /* invalid rows stay unresolved */ }
    const strategy = ['preserve', 'resolve', 'transliterate', 'annotate', 'review'].includes(preservationStrategy)
      ? preservationStrategy : 'review';
    const selected = selectedInterpretation?.trim() || null;
    if (strategy === 'resolve' && (!selected || !interpretations.includes(selected))) throw new Error('解决歧义时必须选择已有解释之一。');
    const timestamp = new Date().toISOString();
    this.#database.prepare(`
      UPDATE narrative_ambiguities SET selected_interpretation = ?, preservation_strategy = ?,
        resolution_note = ?, status = ?, updated_at = ? WHERE ambiguity_id = ?
    `).run(selected, strategy, note.trim(), lock ? 'locked' : 'resolved', timestamp, ambiguityId);
    return { projectId: row.project_id, chapterId: row.chapter_id, segmentOrdinal: row.segment_ordinal, ambiguityId };
  }

  markStyleUsed(styleIds: readonly string[]) {
    const statement = this.#database.prepare('UPDATE translation_style_memories SET usage_count = usage_count + 1, updated_at = ? WHERE style_id = ?');
    const timestamp = new Date().toISOString();
    styleIds.forEach((styleId) => statement.run(timestamp, styleId));
  }
}
