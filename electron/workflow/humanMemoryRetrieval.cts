import type { DatabaseSync } from 'node:sqlite';
import type { TranslationSegmentRecord } from './models.cjs';
import { analyzeJapaneseSyntax, type SegmentSyntaxEvidence } from './japaneseSyntaxEvidence.cjs';
import { POSITION_SQL } from './narrativePosition.cjs';
import { SeriesMemory } from './seriesMemory.cjs';

interface Row { [key: string]: unknown }
const safeJson = (value: unknown) => JSON.stringify(value ?? null);
const unique = (values: readonly unknown[]) => [...new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value)))];
const positionOffsetParams = (chapter: number, segment: number, offset = 0) => [chapter, chapter, segment, segment, offset] as const;

export class HumanMemoryRetrieval {
  readonly #database: DatabaseSync;
  readonly #series: SeriesMemory;
  constructor(database: DatabaseSync, series: SeriesMemory) { this.#database = database; this.#series = series; }

  context(projectId: string, segments: readonly TranslationSegmentRecord[]) {
    if (!segments.length) return null;
    const first = segments[0];
    const last = segments.at(-1)!;
    const joinedSource = segments.map((segment) => segment.sourceText).join('\n');
    const priorRows = this.#database.prepare(`
      SELECT memory_id, memory_class, summary, subject_key, object_key, track_key, worldline_key, scene_key,
        chapter_ordinal, segment_ordinal, source_start_offset, source_end_offset, importance,
        retention_policy, retrieval_scope, confidence
      FROM consolidated_memories
      WHERE project_id = ? AND consolidation_status = 'consolidated'
        AND ${POSITION_SQL.startsByOffset('chapter_ordinal', 'segment_ordinal', 'source_start_offset')}
      ORDER BY importance DESC, chapter_ordinal DESC, COALESCE(segment_ordinal, 1) DESC LIMIT 220
    `).all(projectId, ...positionOffsetParams(first.chapterOrdinal, first.segmentOrdinal, 0)) as unknown as Row[];
    const relevant = (row: Row) => {
      const subject = String(row.subject_key ?? '');
      const object = String(row.object_key ?? '');
      const recent = Number(row.chapter_ordinal) >= first.chapterOrdinal - (row.retention_policy === 'working' ? 1 : 3);
      return Number(row.importance) >= 0.84 || Boolean(subject && joinedSource.includes(subject))
        || Boolean(object && joinedSource.includes(object)) || recent;
    };
    const currentMemories: Row[] = priorRows.filter(relevant).slice(0, 90)
      .map((row) => ({ ...row, maySurface: true }));
    const futureMemories = (this.#database.prepare(`
      SELECT memory_id, memory_class, summary, subject_key, object_key, track_key, worldline_key,
        scene_key, chapter_ordinal, segment_ordinal, importance, confidence
      FROM consolidated_memories
      WHERE project_id = ? AND consolidation_status = 'consolidated'
        AND ${POSITION_SQL.startsAfterOffset('chapter_ordinal', 'segment_ordinal', 'source_start_offset')}
        AND importance >= 0.7 ORDER BY chapter_ordinal, COALESCE(segment_ordinal, 1), importance DESC LIMIT 120
    `).all(projectId, ...positionOffsetParams(first.chapterOrdinal, first.segmentOrdinal, 0)) as unknown as Row[])
      .filter(relevant).slice(0, 40).map((row): Row => ({ ...row, mayGuideInterpretation: true, maySurface: false }));

    const startsBy = POSITION_SQL.startsByOffset;
    const endsAfter = POSITION_SQL.endsAfterOffset;
    const styles = (this.#database.prepare(`
      SELECT style_id, owner_type, owner_key, decision_kind, source_pattern, target_strategy, rationale,
        valid_from_chapter, valid_from_segment, valid_from_offset, valid_to_chapter, valid_to_segment,
        valid_to_offset, confidence, status
      FROM translation_style_memories WHERE project_id = ? AND status IN ('confirmed', 'locked')
        AND ${startsBy('valid_from_chapter', 'valid_from_segment', 'valid_from_offset')}
        AND ${endsAfter('valid_to_chapter', 'valid_to_segment', 'valid_to_offset')}
      ORDER BY confidence DESC, usage_count DESC LIMIT 160
    `).all(projectId, ...positionOffsetParams(first.chapterOrdinal, first.segmentOrdinal),
      ...positionOffsetParams(first.chapterOrdinal, first.segmentOrdinal)) as unknown as Row[])
      .filter((row) => !row.owner_key || joinedSource.includes(String(row.owner_key))
        || !row.source_pattern || joinedSource.includes(String(row.source_pattern))).slice(0, 60);

    const ambiguities = this.#database.prepare(`
      SELECT ambiguity_id, chapter_ordinal, segment_ordinal, source_start_offset, source_end_offset,
        ambiguity_kind, source_excerpt, interpretations_json, preservation_strategy, reveal_chapter,
        reveal_segment, reveal_offset, selected_interpretation, resolution_note, confidence, status
      FROM narrative_ambiguities WHERE project_id = ? AND chapter_id = ?
        AND segment_ordinal BETWEEN ? AND ? AND status IN ('open', 'resolved', 'locked')
      ORDER BY segment_ordinal, COALESCE(source_start_offset, 0)
    `).all(projectId, first.chapterId, first.segmentOrdinal, last.segmentOrdinal) as unknown as Row[];

    const syntaxEvidence = segments.map((segment) => analyzeJapaneseSyntax(segment.segmentId, segment.sourceText));
    const series = this.#series.context(projectId, joinedSource);
    const transitionRows = this.#database.prepare(`
      SELECT record_kind, record_id, segment_ordinal, start_offset, end_offset, description FROM (
        SELECT 'claim' AS record_kind, c.claim_id AS record_id, c.valid_from_segment AS segment_ordinal,
          c.valid_from_offset AS start_offset, e.source_end_offset AS end_offset, c.statement AS description
        FROM narrative_claims c JOIN narrative_evidence e ON e.evidence_id = c.evidence_id
        WHERE c.project_id = ? AND c.valid_from_chapter = ? AND c.valid_from_segment BETWEEN ? AND ?
          AND c.valid_from_offset IS NOT NULL AND c.status <> 'superseded'
        UNION ALL
        SELECT 'event', n.event_id, n.valid_from_segment, n.valid_from_offset, e.source_end_offset, n.statement
        FROM narrative_events n JOIN narrative_evidence e ON e.evidence_id = n.evidence_id
        WHERE n.project_id = ? AND n.valid_from_chapter = ? AND n.valid_from_segment BETWEEN ? AND ?
          AND n.valid_from_offset IS NOT NULL AND n.status <> 'superseded'
        UNION ALL
        SELECT 'frame', f.frame_id, f.valid_from_segment, f.valid_from_offset, e.source_end_offset,
          ('进入 ' || f.frame_kind || ' / ' || f.scene_key)
        FROM narrative_context_frames f JOIN narrative_evidence e ON e.evidence_id = f.evidence_id
        WHERE f.project_id = ? AND f.valid_from_chapter = ? AND f.valid_from_segment BETWEEN ? AND ?
          AND f.valid_from_offset IS NOT NULL
        UNION ALL
        SELECT 'knowledge', k.knowledge_id, k.known_from_segment, k.known_from_offset, e.source_end_offset,
          ('角色知识变化：' || k.epistemic_state)
        FROM character_knowledge k JOIN narrative_evidence e ON e.evidence_id = k.evidence_id
        WHERE k.project_id = ? AND k.known_from_chapter = ? AND k.known_from_segment BETWEEN ? AND ?
          AND k.known_from_offset IS NOT NULL
      ) ORDER BY segment_ordinal, start_offset, record_kind
    `).all(projectId, first.chapterOrdinal, first.segmentOrdinal, last.segmentOrdinal,
      projectId, first.chapterOrdinal, first.segmentOrdinal, last.segmentOrdinal,
      projectId, first.chapterOrdinal, first.segmentOrdinal, last.segmentOrdinal,
      projectId, first.chapterOrdinal, first.segmentOrdinal, last.segmentOrdinal) as unknown as Row[];
    const exactSlices = segments.map((segment) => {
      const transitions = transitionRows.filter((row) => Number(row.segment_ordinal) === segment.segmentOrdinal)
        .map((row) => ({ ...row, start_offset: Math.max(0, Math.min(segment.sourceText.length, Number(row.start_offset))),
          end_offset: Math.max(0, Math.min(segment.sourceText.length, Number(row.end_offset ?? row.start_offset))) }));
      const boundaries = [...new Set([0, segment.sourceText.length,
        ...transitions.flatMap((row) => [Number(row.start_offset), Number(row.end_offset)])])].sort((a, b) => a - b);
      const slices = boundaries.slice(0, -1).map((startOffset, index) => ({
        startOffset, endOffset: boundaries[index + 1], sourceText: segment.sourceText.slice(startOffset, boundaries[index + 1]),
        transitionsStartingHere: transitions.filter((row) => Number(row.start_offset) === startOffset),
      })).filter((slice) => slice.sourceText.length > 0);
      return { segmentId: segment.segmentId, offsetUnit: 'UTF-16', slices };
    });
    const memoryIds = unique([...currentMemories, ...futureMemories, ...((series as { memories?: Row[] }).memories ?? [])].map((row) => row.memory_id));
    const styleIds = unique([...styles, ...((series as { styles?: Row[] }).styles ?? [])].map((row) => row.style_id));
    const ambiguityIds = unique(ambiguities.map((row) => row.ambiguity_id));
    return {
      currentMemories: safeJson(currentMemories), futureMemories: safeJson(futureMemories),
      styleMemories: safeJson(styles), ambiguities: safeJson(ambiguities),
      syntaxEvidence: safeJson(syntaxEvidence), seriesContext: safeJson(series), exactSlices: safeJson(exactSlices),
      rawSyntaxEvidence: syntaxEvidence as readonly SegmentSyntaxEvidence[],
      memoryIds, styleIds, ambiguityIds, seriesContextManifest: {
        seriesId: (series as { assignment?: { seriesId?: string } | null }).assignment?.seriesId ?? null,
        priorVolumeCount: ((series as { priorVolumes?: unknown[] }).priorVolumes ?? []).length,
      },
    };
  }
}
