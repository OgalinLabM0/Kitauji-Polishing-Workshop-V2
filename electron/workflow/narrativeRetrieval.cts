import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TranslationSegmentRecord } from './models.cjs';
import type { NarrativeContextManifest, SegmentSemanticRoles } from './narrativeModels.cjs';
import { POSITION_SQL, positionAtOrBefore } from './narrativePosition.cjs';

const safeJson = (value: unknown) => JSON.stringify(value ?? null);
interface IdRow { [key: string]: unknown }
const uniqueStrings = (values: readonly unknown[]) => [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
const positionOffsetParams = (chapter: number, segment: number, offset = 0) => [chapter, chapter, segment, segment, offset] as const;

export class NarrativeRetrieval {
  readonly #database: DatabaseSync;
  constructor(database: DatabaseSync) { this.#database = database; }

  boundarySegments(projectId: string, chapterOrdinal: number, firstSegment: number, lastSegment: number) {
    if (lastSegment <= firstSegment) return [];
    const rows = this.#database.prepare(`
      SELECT boundary FROM (
        SELECT valid_from_segment AS boundary FROM narrative_aliases
          WHERE project_id = ? AND valid_from_chapter = ?
        UNION ALL SELECT valid_to_segment + 1 FROM narrative_aliases
          WHERE project_id = ? AND valid_to_chapter = ? AND valid_to_segment IS NOT NULL
        UNION ALL SELECT reader_visible_from_segment FROM narrative_aliases
          WHERE project_id = ? AND reader_visible_from_chapter = ?
        UNION ALL SELECT valid_from_segment FROM narrative_claims
          WHERE project_id = ? AND valid_from_chapter = ?
        UNION ALL SELECT valid_to_segment + 1 FROM narrative_claims
          WHERE project_id = ? AND valid_to_chapter = ? AND valid_to_segment IS NOT NULL
        UNION ALL SELECT reader_visible_from_segment FROM narrative_claims
          WHERE project_id = ? AND reader_visible_from_chapter = ?
        UNION ALL SELECT valid_from_segment FROM narrative_events
          WHERE project_id = ? AND valid_from_chapter = ?
        UNION ALL SELECT valid_to_segment + 1 FROM narrative_events
          WHERE project_id = ? AND valid_to_chapter = ? AND valid_to_segment IS NOT NULL
        UNION ALL SELECT reader_visible_from_segment FROM narrative_events
          WHERE project_id = ? AND reader_visible_from_chapter = ?
        UNION ALL SELECT known_from_segment FROM character_knowledge
          WHERE project_id = ? AND known_from_chapter = ?
        UNION ALL SELECT known_to_segment + 1 FROM character_knowledge
          WHERE project_id = ? AND known_to_chapter = ? AND known_to_segment IS NOT NULL
        UNION ALL SELECT valid_from_segment FROM narrative_context_frames
          WHERE project_id = ? AND valid_from_chapter = ?
        UNION ALL SELECT valid_to_segment + 1 FROM narrative_context_frames
          WHERE project_id = ? AND valid_to_chapter = ? AND valid_to_segment IS NOT NULL
      ) WHERE boundary > ? AND boundary <= ? ORDER BY boundary
    `).all(
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      projectId, chapterOrdinal,
      firstSegment, lastSegment,
    ) as unknown as Array<{ boundary: number }>;
    return [...new Set(rows.map((row) => row.boundary))];
  }

  context(projectId: string, segments: readonly TranslationSegmentRecord[]) {
    if (!segments.length) return null;
    const first = segments[0];
    const last = segments[segments.length - 1];
    const chapter = first.chapterOrdinal;
    const segment = first.segmentOrdinal;
    const joinedSource = segments.map((item) => item.sourceText).join('\n');
    const startsBy = POSITION_SQL.startsByOffset;
    const endsAfter = POSITION_SQL.endsAfterOffset;
    const startsAfter = POSITION_SQL.startsAfterOffset;

    const frameRows = this.#database.prepare(`
      SELECT frame_id, frame_kind, worldline_key, story_time_key, scene_key, location_key,
        viewpoint_key, narrator_key, participant_keys_json, frame_key, parent_frame_key, parent_frame_id,
        nesting_depth, discourse_mode, quote_level, speaker_key, addressee_key,
        valid_from_chapter, valid_from_segment, valid_from_offset,
        valid_to_chapter, valid_to_segment, valid_to_offset, evidence_id, confidence, status
      FROM narrative_context_frames WHERE project_id = ?
        AND ${startsBy('valid_from_chapter', 'valid_from_segment', 'valid_from_offset')}
        AND ${endsAfter('valid_to_chapter', 'valid_to_segment', 'valid_to_offset')}
      ORDER BY nesting_depth DESC, confidence DESC, valid_from_chapter DESC, valid_from_segment DESC,
        COALESCE(valid_from_offset, 0) DESC LIMIT 30
    `).all(projectId, ...positionOffsetParams(chapter, segment), ...positionOffsetParams(chapter, segment)) as unknown as IdRow[];
    const activeWorldlines = new Set(frameRows.map((row) => String(row.worldline_key || 'main')));
    if (!activeWorldlines.size) activeWorldlines.add('main');

    const aliasRows = this.#database.prepare(`
      SELECT DISTINCT e.entity_id, e.canonical_source, e.canonical_translation, e.entity_kind,
        a.source_form, a.translated_form, a.alias_kind, a.reader_visible_from_chapter,
        a.reader_visible_from_segment, a.reader_visible_from_offset, a.confidence, a.status
      FROM narrative_entities e JOIN narrative_aliases a ON a.entity_id = e.entity_id
      WHERE e.project_id = ? AND instr(?, a.source_form) > 0
        AND ${startsBy('a.valid_from_chapter', 'a.valid_from_segment', 'a.valid_from_offset')}
        AND ${endsAfter('a.valid_to_chapter', 'a.valid_to_segment', 'a.valid_to_offset')}
      ORDER BY length(a.source_form) DESC, a.confidence DESC LIMIT 100
    `).all(projectId, joinedSource, ...positionOffsetParams(chapter, segment), ...positionOffsetParams(chapter, segment)) as unknown as IdRow[];

    const discourseRows = this.#database.prepare(`
      SELECT DISTINCT m.entity_id FROM narrative_mentions m
      WHERE m.project_id = ? AND m.chapter_id = ? AND m.entity_id IS NOT NULL
        AND m.segment_ordinal BETWEEN ? AND ?
    `).all(projectId, first.chapterId, Math.max(1, segment - 8), last.segmentOrdinal + 2) as unknown as IdRow[];
    const frameParticipants = frameRows.flatMap((row) => {
      try { return Array.isArray(JSON.parse(String(row.participant_keys_json))) ? JSON.parse(String(row.participant_keys_json)) as unknown[] : []; }
      catch { return []; }
    }).filter((value): value is string => typeof value === 'string');
    const frameEntityRows = frameParticipants.length ? this.#database.prepare(`
      SELECT DISTINCT e.entity_id FROM narrative_entities e LEFT JOIN narrative_aliases a ON a.entity_id = e.entity_id
      WHERE e.project_id = ? AND (e.canonical_source IN (${frameParticipants.map(() => '?').join(',')})
        OR a.source_form IN (${frameParticipants.map(() => '?').join(',')}))
    `).all(projectId, ...frameParticipants, ...frameParticipants) as unknown as IdRow[] : [];
    const entityIds = uniqueStrings([...aliasRows.map((row) => row.entity_id), ...discourseRows.map((row) => row.entity_id),
      ...frameEntityRows.map((row) => row.entity_id)]);
    const placeholders = entityIds.length ? entityIds.map(() => '?').join(',') : "''";
    const visibleAtCurrent = (row: IdRow, chapterKey: string, segmentKey: string, offsetKey: string) => positionAtOrBefore({
      chapter: Number(row[chapterKey]), segment: row[segmentKey] === null ? null : Number(row[segmentKey]),
      offset: row[offsetKey] === null || row[offsetKey] === undefined ? null : Number(row[offsetKey]),
    }, { chapter, segment, offset: 0 });

    const entities = aliasRows.map((row) => {
      const identityMaySurface = visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset');
      return {
        entity_id: row.entity_id, entity_kind: row.entity_kind, source_form: row.source_form,
        translated_form: row.translated_form, alias_kind: row.alias_kind, identityMaySurface,
        canonical_source: identityMaySurface ? row.canonical_source : null,
        canonical_translation: identityMaySurface ? row.canonical_translation : null,
      };
    });
    const hiddenIdentities = aliasRows.filter((row) => !visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset'))
      .map((row) => ({ entityId: row.entity_id, sourceForm: row.source_form, canonicalSource: row.canonical_source,
        canonicalTranslation: row.canonical_translation, mayGuideInterpretation: true, maySurfaceInTranslation: false }));

    const stateRows = this.#database.prepare(`
      SELECT w.snapshot_id, w.entity_id, e.canonical_source, e.canonical_translation, w.predicate,
        w.worldline_key, w.scene_key, w.value_json, w.valid_from_chapter, w.valid_from_segment, w.valid_to_chapter,
        w.valid_from_offset, w.valid_to_segment, w.valid_to_offset, w.source_claim_id, w.confidence, w.status,
        c.claim_kind, c.subject_key, c.object_key, c.statement, c.status AS claim_status,
        c.reader_visible_from_chapter, c.reader_visible_from_segment, c.reader_visible_from_offset, c.evidence_id
      FROM world_state_snapshots w
      JOIN narrative_entities e ON e.entity_id = w.entity_id
      JOIN narrative_claims c ON c.claim_id = w.source_claim_id
      WHERE w.project_id = ? AND w.entity_id IN (${placeholders})
        AND ${startsBy('w.valid_from_chapter', 'w.valid_from_segment', 'w.valid_from_offset')}
        AND ${endsAfter('w.valid_to_chapter', 'w.valid_to_segment', 'w.valid_to_offset')}
      ORDER BY w.confidence DESC, w.valid_from_chapter DESC, COALESCE(w.valid_from_segment, 1) DESC,
        COALESCE(w.valid_from_offset, 0) DESC LIMIT 100
    `).all(projectId, ...entityIds, ...positionOffsetParams(chapter, segment), ...positionOffsetParams(chapter, segment)) as unknown as IdRow[];
    const exactFrameStates = stateRows.filter((row) => activeWorldlines.has(String(row.worldline_key || 'main')));
    const exactStateKeys = new Set(exactFrameStates.map((row) => `${row.entity_id}:${row.object_key ?? ''}:${row.predicate}`));
    const scopedStateRows = [...exactFrameStates, ...stateRows.filter((row) => row.worldline_key === 'main'
      && !exactStateKeys.has(`${row.entity_id}:${row.object_key ?? ''}:${row.predicate}`))];
    const safeStateRows = scopedStateRows.filter((row) => visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset'));
    const hiddenStateRows = scopedStateRows.filter((row) => !visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset'));

    const activeClaims = this.#database.prepare(`
      SELECT c.claim_id, c.claim_kind, c.predicate, c.subject_entity_id, c.object_entity_id,
        c.subject_key, c.object_key, c.worldline_key, c.scene_key, c.value_json, c.statement,
        c.valid_from_chapter, c.valid_from_segment, c.valid_from_offset,
        c.valid_to_chapter, c.valid_to_segment, c.valid_to_offset, c.reader_visible_from_chapter,
        c.reader_visible_from_segment, c.reader_visible_from_offset, c.evidence_id, c.confidence, c.status
      FROM narrative_claims c
      WHERE c.project_id = ? AND c.status IN ('confirmed', 'locked', 'hypothesis')
        AND NOT (c.subject_entity_id IS NOT NULL AND c.claim_kind IN
          ('identity', 'character-state', 'relationship', 'address', 'voice', 'number', 'age', 'appearance', 'affiliation'))
        AND ${startsBy('c.valid_from_chapter', 'c.valid_from_segment', 'c.valid_from_offset')}
        AND ${endsAfter('c.valid_to_chapter', 'c.valid_to_segment', 'c.valid_to_offset')}
        AND (c.subject_entity_id IN (${placeholders}) OR c.object_entity_id IN (${placeholders})
          OR c.claim_kind IN ('viewpoint', 'setting', 'foreshadowing'))
      ORDER BY c.confidence DESC, c.valid_from_chapter DESC, COALESCE(c.valid_from_segment, 1) DESC,
        COALESCE(c.valid_from_offset, 0) DESC LIMIT 140
    `).all(projectId, ...positionOffsetParams(chapter, segment), ...positionOffsetParams(chapter, segment),
      ...entityIds, ...entityIds) as unknown as IdRow[];
    const seenGlobalStateTracks = new Set<string>();
    const reducedActiveClaims = activeClaims.filter((row) => activeWorldlines.has(String(row.worldline_key || 'main'))).filter((row) => {
      if (!['viewpoint', 'setting'].includes(String(row.claim_kind))) return true;
      const key = `${row.claim_kind}:${row.subject_key ?? ''}:${row.object_key ?? ''}:${row.predicate ?? ''}`;
      if (seenGlobalStateTracks.has(key)) return false;
      seenGlobalStateTracks.add(key);
      return true;
    });
    const readerClaims = reducedActiveClaims.filter((row) => visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset'));

    const futureClaimRows = this.#database.prepare(`
      SELECT c.claim_id, c.claim_kind, c.predicate, c.subject_entity_id, c.object_entity_id,
        c.subject_key, c.object_key, c.worldline_key, c.scene_key, c.value_json, c.statement,
        c.valid_from_chapter, c.valid_from_segment, c.valid_from_offset,
        c.reader_visible_from_chapter, c.reader_visible_from_segment, c.reader_visible_from_offset, c.evidence_id, c.confidence
      FROM narrative_claims c
      WHERE c.project_id = ? AND c.status IN ('confirmed', 'locked')
        AND (${startsAfter('c.reader_visible_from_chapter', 'c.reader_visible_from_segment', 'c.reader_visible_from_offset')}
          OR ${startsAfter('c.valid_from_chapter', 'c.valid_from_segment', 'c.valid_from_offset')})
        AND (c.subject_entity_id IN (${placeholders}) OR c.object_entity_id IN (${placeholders}))
      ORDER BY c.reader_visible_from_chapter, COALESCE(c.reader_visible_from_segment, 1), c.confidence DESC LIMIT 60
    `).all(projectId, ...positionOffsetParams(chapter, segment), ...positionOffsetParams(chapter, segment),
      ...entityIds, ...entityIds) as unknown as IdRow[];
    const scopedFutureClaimRows = futureClaimRows.filter((row) => activeWorldlines.has(String(row.worldline_key || 'main')));

    const eventRows = this.#database.prepare(`
      SELECT event_id, event_type, predicate, agent_entity_id, patient_entity_id, recipient_entity_id,
        agent_key, patient_key, recipient_key, worldline_key, scene_key, statement, direction_status, valid_from_chapter,
        valid_from_segment, valid_from_offset, valid_to_chapter, valid_to_segment, valid_to_offset,
        reader_visible_from_chapter, reader_visible_from_segment, reader_visible_from_offset, evidence_id, confidence, status
      FROM narrative_events
      WHERE project_id = ? AND status IN ('confirmed', 'locked', 'hypothesis')
        AND ${startsBy('valid_from_chapter', 'valid_from_segment', 'valid_from_offset')}
        AND (agent_entity_id IN (${placeholders}) OR patient_entity_id IN (${placeholders})
          OR recipient_entity_id IN (${placeholders}))
      ORDER BY confidence DESC, valid_from_chapter DESC, COALESCE(valid_from_segment, 1) DESC LIMIT 120
    `).all(projectId, ...positionOffsetParams(chapter, segment), ...entityIds, ...entityIds, ...entityIds) as unknown as IdRow[];
    const scopedEventRows = eventRows.filter((row) => activeWorldlines.has(String(row.worldline_key || 'main')));
    const readerEvents = scopedEventRows.filter((row) => visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset'));
    const futureEventRows = this.#database.prepare(`
      SELECT event_id, event_type, predicate, agent_entity_id, patient_entity_id, recipient_entity_id,
        agent_key, patient_key, recipient_key, worldline_key, scene_key, statement, direction_status, valid_from_chapter,
        valid_from_segment, valid_from_offset, reader_visible_from_chapter, reader_visible_from_segment,
        reader_visible_from_offset, evidence_id, confidence
      FROM narrative_events
      WHERE project_id = ? AND status IN ('confirmed', 'locked')
        AND ${startsAfter('reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset')}
        AND (agent_entity_id IN (${placeholders}) OR patient_entity_id IN (${placeholders})
          OR recipient_entity_id IN (${placeholders}))
      ORDER BY reader_visible_from_chapter, COALESCE(reader_visible_from_segment, 1), confidence DESC LIMIT 50
    `).all(projectId, ...positionOffsetParams(chapter, segment), ...entityIds, ...entityIds, ...entityIds) as unknown as IdRow[];
    const scopedFutureEventRows = futureEventRows.filter((row) => activeWorldlines.has(String(row.worldline_key || 'main')));

    const knowledgeRows = this.#database.prepare(`
      SELECT k.knowledge_id, k.character_entity_id, e.canonical_source AS character,
        k.claim_id, k.event_id, k.epistemic_state, k.known_from_chapter, k.known_from_segment,
        k.known_from_offset, k.known_to_chapter, k.known_to_segment, k.known_to_offset, k.confidence,
        COALESCE(c.statement, n.statement) AS statement,
        COALESCE(c.predicate, n.predicate) AS predicate,
        c.value_json, n.agent_key, n.patient_key, n.recipient_key
      FROM character_knowledge k
      JOIN narrative_entities e ON e.entity_id = k.character_entity_id
      LEFT JOIN narrative_claims c ON c.claim_id = k.claim_id
      LEFT JOIN narrative_events n ON n.event_id = k.event_id
      WHERE k.project_id = ? AND k.character_entity_id IN (${placeholders})
        AND ${startsBy('k.known_from_chapter', 'k.known_from_segment', 'k.known_from_offset')}
        AND ${endsAfter('k.known_to_chapter', 'k.known_to_segment', 'k.known_to_offset')}
      ORDER BY k.confidence DESC, k.known_from_chapter DESC, COALESCE(k.known_from_segment, 1) DESC LIMIT 120
    `).all(projectId, ...entityIds, ...positionOffsetParams(chapter, segment), ...positionOffsetParams(chapter, segment)) as unknown as IdRow[];
    const seenKnowledgeTracks = new Set<string>();
    const currentKnowledgeRows = knowledgeRows.filter((row) => {
      const key = `${row.character_entity_id ?? ''}:${row.predicate ?? ''}:${row.statement ?? ''}`;
      if (seenKnowledgeTracks.has(key)) return false;
      seenKnowledgeTracks.add(key);
      return true;
    });

    const conflicts = this.#database.prepare(`
      SELECT conflict_id, left_claim_id, right_claim_id, conflict_kind, explanation
      FROM claim_conflicts WHERE project_id = ? AND status = 'open'
        AND (left_claim_id IN (SELECT claim_id FROM narrative_claims WHERE subject_entity_id IN (${placeholders}) OR object_entity_id IN (${placeholders}))
          OR right_claim_id IN (SELECT claim_id FROM narrative_claims WHERE subject_entity_id IN (${placeholders}) OR object_entity_id IN (${placeholders})))
      LIMIT 40
    `).all(projectId, ...entityIds, ...entityIds, ...entityIds, ...entityIds) as unknown as IdRow[];

    const segmentTransitions = this.#database.prepare(`
      SELECT 'claim' AS transition_kind, c.claim_id AS record_id, c.claim_kind AS kind, c.predicate,
        c.subject_key AS agent_or_subject, c.object_key AS patient_or_object, NULL AS recipient,
        c.statement, c.value_json AS value_or_direction, e.segment_ordinal, e.source_excerpt,
        e.source_start_offset, e.source_end_offset, e.locator_status,
        c.valid_from_offset AS applies_from_offset,
        c.reader_visible_from_chapter, c.reader_visible_from_segment, c.reader_visible_from_offset
      FROM narrative_claims c JOIN narrative_evidence e ON e.evidence_id = c.evidence_id
      WHERE c.project_id = ? AND e.chapter_id = ? AND e.segment_ordinal BETWEEN ? AND ?
      UNION ALL
      SELECT 'event', n.event_id, n.event_type, n.predicate, n.agent_key, n.patient_key, n.recipient_key,
        n.statement, n.direction_status, e.segment_ordinal, e.source_excerpt,
        e.source_start_offset, e.source_end_offset, e.locator_status,
        n.valid_from_offset, n.reader_visible_from_chapter, n.reader_visible_from_segment,
        n.reader_visible_from_offset
      FROM narrative_events n JOIN narrative_evidence e ON e.evidence_id = n.evidence_id
      WHERE n.project_id = ? AND e.chapter_id = ? AND e.segment_ordinal BETWEEN ? AND ?
      ORDER BY segment_ordinal, source_start_offset, transition_kind
    `).all(projectId, first.chapterId, segment, last.segmentOrdinal,
      projectId, first.chapterId, segment, last.segmentOrdinal) as unknown as IdRow[];
    const currentTransitions = segmentTransitions.map((row) => ({ ...row,
      maySurface: visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset'),
      usage: row.locator_status === 'exact'
        ? '按 UTF-16 source_start_offset/source_end_offset 精确应用：起点前使用旧状态，证据跨度表示变化过程，跨度结束后使用新状态。'
        : '字符位置未能唯一定位，只能作为未决顺序证据，不得据此覆盖整段状态。',
    }));

    const unresolved = [...safeStateRows.filter((row) => row.claim_status === 'hypothesis' || row.status === 'conflict'),
      ...readerClaims.filter((row) => row.status === 'hypothesis'),
      ...readerEvents.filter((row) => row.status === 'hypothesis' || row.direction_status !== 'verified'), ...conflicts];
    const directionConstraints = [...readerEvents, ...scopedFutureEventRows].filter((row) => row.direction_status === 'verified').map((row) => ({
      eventId: row.event_id, predicate: row.predicate, agent: row.agent_key, patient: row.patient_key,
      recipient: row.recipient_key, statement: row.statement, source: row.evidence_id,
      maySurface: visibleAtCurrent(row, 'reader_visible_from_chapter', 'reader_visible_from_segment', 'reader_visible_from_offset'),
    }));
    const evidenceIds = uniqueStrings([...readerClaims, ...scopedFutureClaimRows, ...readerEvents, ...scopedFutureEventRows,
      ...frameRows].map((row) => row.evidence_id));
    const manifest: NarrativeContextManifest = {
      neighborOrdinals: [], glossaryIds: [], entityIds,
      claimIds: uniqueStrings([...readerClaims, ...scopedFutureClaimRows].map((row) => row.claim_id)),
      eventIds: uniqueStrings([...readerEvents, ...scopedFutureEventRows].map((row) => row.event_id)),
      evidenceIds, frameIds: uniqueStrings(frameRows.map((row) => row.frame_id)),
      memoryIds: [], styleIds: [], ambiguityIds: [], readerFactIds: [], translatorFactIds: [], directionConstraints,
      syntaxEvidence: [], seriesContext: {},
      position: { chapterOrdinal: chapter, firstSegmentOrdinal: segment, lastSegmentOrdinal: last.segmentOrdinal,
        firstOffset: 0, lastOffset: null },
    };
    return {
      position: safeJson({ chapterOrdinal: chapter, firstSegmentOrdinal: segment,
        lastSegmentOrdinal: last.segmentOrdinal, firstOffset: 0, lastOffset: null, offsetUnit: 'UTF-16' }),
      entities: safeJson(entities), worldState: safeJson(safeStateRows),
      narrativeFrames: safeJson(frameRows),
      readerKnowledge: safeJson({ claims: readerClaims, events: readerEvents }),
      translatorKnowledge: safeJson({ claims: scopedFutureClaimRows, events: scopedFutureEventRows,
        hiddenCurrentState: hiddenStateRows, hiddenIdentities, mayGuideInterpretation: true, maySurfaceInTranslation: false }),
      characterKnowledge: safeJson(currentKnowledgeRows.map((row) => ({ ...row, maySurfaceOnlyWhenSourceExpresses: true }))),
      directionLedger: safeJson(directionConstraints), segmentTransitions: safeJson(currentTransitions),
      unresolved: safeJson(unresolved), manifest,
    };
  }

  saveDependency(versionId: string, segment: TranslationSegmentRecord, manifest: NarrativeContextManifest, roles: readonly SegmentSemanticRoles[]) {
    const role = roles.find((item) => item.id === segment.segmentId) ?? { id: segment.segmentId, propositions: [] };
    const exactPosition = { chapterOrdinal: segment.chapterOrdinal, firstSegmentOrdinal: segment.segmentOrdinal,
      lastSegmentOrdinal: segment.segmentOrdinal, firstOffset: 0, lastOffset: segment.sourceText.length };
    this.#database.prepare(`
      INSERT INTO translation_dependencies(dependency_id, translation_version_id, segment_id, project_id,
        entity_ids_json, claim_ids_json, event_ids_json, evidence_ids_json, frame_ids_json,
        memory_ids_json, style_ids_json, ambiguity_ids_json, syntax_evidence_json, series_context_json,
        direction_constraints_json, context_position_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(translation_version_id) DO UPDATE SET
        entity_ids_json = excluded.entity_ids_json, claim_ids_json = excluded.claim_ids_json,
        event_ids_json = excluded.event_ids_json, evidence_ids_json = excluded.evidence_ids_json,
        frame_ids_json = excluded.frame_ids_json, memory_ids_json = excluded.memory_ids_json,
        style_ids_json = excluded.style_ids_json, ambiguity_ids_json = excluded.ambiguity_ids_json,
        syntax_evidence_json = excluded.syntax_evidence_json, series_context_json = excluded.series_context_json,
        direction_constraints_json = excluded.direction_constraints_json, context_position_json = excluded.context_position_json
    `).run(`dependency-${randomUUID()}`, versionId, segment.segmentId, segment.projectId,
      safeJson(manifest.entityIds), safeJson(manifest.claimIds), safeJson(manifest.eventIds), safeJson(manifest.evidenceIds),
      safeJson(manifest.frameIds), safeJson(manifest.memoryIds), safeJson(manifest.styleIds), safeJson(manifest.ambiguityIds),
      safeJson(manifest.syntaxEvidence), safeJson(manifest.seriesContext),
      safeJson({ memory: manifest.directionConstraints, currentSegment: role.propositions }),
      safeJson(exactPosition), new Date().toISOString());
  }
}
