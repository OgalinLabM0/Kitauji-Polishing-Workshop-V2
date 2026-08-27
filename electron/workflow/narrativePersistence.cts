import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  NarrativeEntityInput,
  NarrativeEventInput,
  NarrativeFactInput,
  NormalizedPreReadResult,
} from './narrativeModels.cjs';
import { rebuildWorldState } from './narrativeStateReducer.cjs';
import { evidenceSpan, groundedOffset, upsertNarrativeEvidence } from './sourceSpan.cjs';
import { memoryPolicyFor } from './memoryPolicy.cjs';

const safeJson = (value: unknown) => JSON.stringify(value ?? null);
const clipped = (value: unknown) => Math.max(0, Math.min(1, Number(value) || 0));
const statusFor = (confidence: number) => confidence >= 0.9 ? 'confirmed' : 'hypothesis';

const claimKindFor = (kind: string) => ({
  character: 'character-state', relationship: 'relationship', address: 'address', voice: 'voice',
  viewpoint: 'viewpoint', setting: 'setting', secret: 'secret', foreshadowing: 'foreshadowing',
  pun: 'wordplay', identity: 'identity', number: 'number', age: 'age', appearance: 'appearance', affiliation: 'affiliation',
}[kind] ?? 'character-state');

interface EntityCandidate {
  readonly sourceName: string;
  readonly canonicalSourceName: string;
  readonly translatedName: string;
  readonly kind: string;
  readonly gender: string;
  readonly number: string;
  readonly confidence: number;
  readonly evidenceExcerpt: string;
  readonly entity?: NarrativeEntityInput;
}

export interface NarrativeSaveResult {
  readonly entityIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly frameIds: readonly string[];
  readonly knowledgeChanged: boolean;
}

export class NarrativePersistence {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) { this.#database = database; }

  #chapterKnowledgeSignature(projectId: string, chapterId: string) {
    const rows = this.#database.prepare(`
      SELECT 'claim' AS record_type, c.claim_kind AS kind, c.predicate, c.subject_key AS role_a,
        c.object_key AS role_b, '' AS role_c, c.worldline_key, c.scene_key, c.value_json AS value, c.statement,
        c.valid_from_chapter, c.valid_from_segment, c.valid_from_offset, c.valid_to_chapter, c.valid_to_segment,
        c.valid_to_offset, c.reader_visible_from_chapter, c.reader_visible_from_segment,
        c.reader_visible_from_offset, c.memory_class, c.importance, c.retrieval_scope, c.confidence
      FROM narrative_claims c JOIN narrative_evidence e ON e.evidence_id = c.evidence_id
      WHERE c.project_id = ? AND e.chapter_id = ?
      UNION ALL
      SELECT 'event', n.event_type, n.predicate, COALESCE(n.agent_key, ''), COALESCE(n.patient_key, ''),
        COALESCE(n.recipient_key, ''), n.worldline_key, n.scene_key, n.direction_status, n.statement,
         n.valid_from_chapter, n.valid_from_segment, n.valid_from_offset, n.valid_to_chapter, n.valid_to_segment,
         n.valid_to_offset, n.reader_visible_from_chapter, n.reader_visible_from_segment,
         n.reader_visible_from_offset, n.memory_class, n.importance, n.retrieval_scope, n.confidence
      FROM narrative_events n JOIN narrative_evidence e ON e.evidence_id = n.evidence_id
      WHERE n.project_id = ? AND e.chapter_id = ?
      ORDER BY record_type, kind, predicate, role_a, role_b, role_c, statement
    `).all(projectId, chapterId, projectId, chapterId);
    const frames = this.#database.prepare(`
      SELECT f.frame_kind, f.worldline_key, f.story_time_key, f.scene_key, f.location_key,
        f.viewpoint_key, f.narrator_key, f.participant_keys_json, f.frame_key, f.parent_frame_key,
        f.nesting_depth, f.discourse_mode, f.quote_level, f.speaker_key, f.addressee_key,
        f.valid_from_chapter, f.valid_from_segment, f.valid_from_offset, f.valid_to_chapter,
        f.valid_to_segment, f.valid_to_offset, f.confidence
      FROM narrative_context_frames f JOIN narrative_evidence e ON e.evidence_id = f.evidence_id
      WHERE f.project_id = ? AND e.chapter_id = ? ORDER BY f.valid_from_chapter, f.valid_from_segment, f.scene_key
    `).all(projectId, chapterId);
    return JSON.stringify({ records: rows, frames });
  }

  #evidence(projectId: string, chapterId: string, chapterOrdinal: number, excerpt: string, timestamp: string,
    kind: 'direct' | 'inferred' | 'reviewer-corrected' | 'manual' = 'direct', preferredSegment: number | null = null,
    preferredStartOffset: number | null = null) {
    return upsertNarrativeEvidence(this.#database, projectId, chapterId, chapterOrdinal, excerpt, timestamp,
      kind, preferredSegment, preferredStartOffset);
  }

  #evidenceSegment(evidenceId: string) {
    return evidenceSpan(this.#database, evidenceId).segmentOrdinal;
  }

  #groundedSegment(positionChapter: number, requestedSegment: number | null, evidenceChapter: number,
    evidenceSegment: number | null) {
    return positionChapter === evidenceChapter ? evidenceSegment ?? requestedSegment ?? null : requestedSegment ?? null;
  }

  #upsertEntity(projectId: string, chapterOrdinal: number, candidate: EntityCandidate, timestamp: string) {
    const canonical = candidate.canonicalSourceName.trim() || candidate.sourceName.trim();
    const translated = candidate.translatedName.trim();
    if (!canonical || !translated) return null;

    // 检查是否为已知角色实体的单姓/简称或多形态别名（要求：译名 100% 相同且置信度 >= 0.99，杜绝同姓一家人误伤）
    if (candidate.kind === 'character' && candidate.confidence >= 0.99) {
      const sameTranslationChars = this.#database.prepare(`
        SELECT entity_id, canonical_source, canonical_translation FROM narrative_entities
        WHERE project_id = ? AND entity_kind = 'character' AND canonical_translation = ? AND canonical_source <> ?
      `).all(projectId, translated, canonical) as unknown as Array<{ entity_id: string; canonical_source: string; canonical_translation: string }>;

      if (sameTranslationChars.length === 1) {
        const mainChar = sameTranslationChars[0];
        if (mainChar.canonical_source.includes(canonical) || canonical.includes(mainChar.canonical_source)) {
          return mainChar.entity_id;
        }
      }
    }

    const existing = this.#database.prepare(`
      SELECT entity_id FROM narrative_entities WHERE project_id = ? AND canonical_source = ?
    `).get(projectId, canonical) as { entity_id: string } | undefined;
    const entityId = existing?.entity_id ?? `entity-${randomUUID()}`;
    this.#database.prepare(`
      INSERT INTO narrative_entities(entity_id, project_id, canonical_source, canonical_translation, entity_kind,
        gender, grammatical_number, confidence, status, first_seen_chapter, last_seen_chapter, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, canonical_source) DO UPDATE SET
        canonical_translation = CASE WHEN narrative_entities.status = 'locked' THEN narrative_entities.canonical_translation ELSE excluded.canonical_translation END,
        entity_kind = CASE WHEN narrative_entities.entity_kind = 'other' THEN excluded.entity_kind ELSE narrative_entities.entity_kind END,
        gender = CASE WHEN narrative_entities.gender = 'unknown' THEN excluded.gender ELSE narrative_entities.gender END,
        grammatical_number = CASE WHEN narrative_entities.grammatical_number = 'unknown' THEN excluded.grammatical_number ELSE narrative_entities.grammatical_number END,
        confidence = max(narrative_entities.confidence, excluded.confidence),
        status = CASE WHEN narrative_entities.status = 'locked' THEN 'locked' WHEN excluded.confidence >= 0.9 THEN 'confirmed' ELSE narrative_entities.status END,
        first_seen_chapter = min(narrative_entities.first_seen_chapter, excluded.first_seen_chapter),
        last_seen_chapter = max(narrative_entities.last_seen_chapter, excluded.last_seen_chapter),
        updated_at = excluded.updated_at
    `).run(entityId, projectId, canonical, translated, candidate.kind, candidate.gender, candidate.number,
      candidate.confidence, candidate.confidence >= 0.9 ? 'confirmed' : 'candidate', chapterOrdinal, chapterOrdinal, timestamp, timestamp);
    return (this.#database.prepare('SELECT entity_id FROM narrative_entities WHERE project_id = ? AND canonical_source = ?')
      .get(projectId, canonical) as { entity_id: string }).entity_id;
  }

  #resolveEntity(projectId: string, sourceKey: string) {
    const key = sourceKey.trim();
    if (!key) return null;
    const rows = this.#database.prepare(`
      SELECT DISTINCT e.entity_id FROM narrative_entities e
      LEFT JOIN narrative_aliases a ON a.entity_id = e.entity_id
      WHERE e.project_id = ? AND (e.canonical_source = ? OR a.source_form = ?)
    `).all(projectId, key, key) as unknown as Array<{ entity_id: string }>;
    return rows.length === 1 ? rows[0].entity_id : null;
  }

  #mention(projectId: string, chapterId: string, chapterOrdinal: number, entityId: string | null,
    sourceForm: string, role: string, evidenceId: string, confidence: number, timestamp: string) {
    if (!sourceForm.trim()) return;
    this.#database.prepare(`
      INSERT INTO narrative_mentions(mention_id, entity_id, project_id, chapter_id, chapter_ordinal,
        segment_ordinal, source_start_offset, source_end_offset, source_form, semantic_role, evidence_id, confidence, created_at)
      SELECT ?, ?, ?, ?, ?, segment_ordinal, source_start_offset, source_end_offset, ?, ?, ?, ?, ?
      FROM narrative_evidence WHERE evidence_id = ?
    `).run(`mention-${randomUUID()}`, entityId, projectId, chapterId, chapterOrdinal, sourceForm, role,
      evidenceId, confidence, timestamp, evidenceId);
  }

  #characterKnowledge(projectId: string, knowledge: Readonly<Record<string, unknown>>, claimId: string | null,
    eventId: string | null, evidenceId: string, fallbackChapter: number, fallbackSegment: number | null,
    confidence: number, timestamp: string) {
    for (const [characterKey, raw] of Object.entries(knowledge)) {
      const entityId = this.#resolveEntity(projectId, characterKey);
      if (!entityId) continue;
      const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const rawState = typeof raw === 'string' ? raw : record.state;
      const state = ['knows', 'believes', 'suspects', 'denies'].includes(String(rawState)) ? String(rawState) : 'knows';
      const knownFrom = Math.max(1, Math.floor(Number(record.knownFromChapter) || fallbackChapter));
      const requestedKnownSegment = Number.isInteger(Number(record.knownFromSegment)) && Number(record.knownFromSegment) >= 1
        ? Math.floor(Number(record.knownFromSegment)) : null;
      const knownFromSegment = this.#groundedSegment(knownFrom, requestedKnownSegment, fallbackChapter, fallbackSegment);
      const requestedKnownOffset = Number.isInteger(Number(record.knownFromOffset)) && Number(record.knownFromOffset) >= 0
        ? Math.floor(Number(record.knownFromOffset)) : null;
      const span = evidenceSpan(this.#database, evidenceId);
      const knownFromOffset = groundedOffset(knownFrom, knownFromSegment, requestedKnownOffset,
        fallbackChapter, span.segmentOrdinal, span.startOffset);
      const knownToChapter = record.knownToChapter === null || record.knownToChapter === undefined
        ? null : Math.max(1, Math.floor(Number(record.knownToChapter) || knownFrom));
      const knownToSegment = Number.isInteger(Number(record.knownToSegment)) && Number(record.knownToSegment) >= 1
        ? Math.floor(Number(record.knownToSegment)) : null;
      const knownToOffset = Number.isInteger(Number(record.knownToOffset)) && Number(record.knownToOffset) >= 0
        ? Math.floor(Number(record.knownToOffset)) : null;
      this.#database.prepare(`
        INSERT INTO character_knowledge(knowledge_id, project_id, character_entity_id, claim_id, event_id,
          epistemic_state, known_from_chapter, known_from_segment, known_from_offset,
          known_to_chapter, known_to_segment, known_to_offset, evidence_id, confidence, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`knowledge-${randomUUID()}`, projectId, entityId, claimId, eventId, state, knownFrom,
        knownFromSegment, knownFromOffset, knownToChapter, knownToSegment, knownToOffset, evidenceId, confidence, timestamp);
    }
  }

  #insertClaim(projectId: string, chapterId: string, chapterOrdinal: number, fact: NarrativeFactInput,
    timestamp: string, forcedKind?: string) {
    const evidenceId = this.#evidence(projectId, chapterId, chapterOrdinal, fact.evidenceExcerpt, timestamp,
      'direct', fact.evidenceSegment, fact.evidenceStartOffset);
    if (!evidenceId) return null;
    const span = evidenceSpan(this.#database, evidenceId);
    const evidenceSegment = span.segmentOrdinal;
    const validFromSegment = this.#groundedSegment(fact.chapterStart, fact.chapterStartSegment, chapterOrdinal, evidenceSegment);
    const readerVisibleFromSegment = this.#groundedSegment(fact.readerVisibleFrom, fact.readerVisibleFromSegment, chapterOrdinal, evidenceSegment);
    const validFromOffset = groundedOffset(fact.chapterStart, validFromSegment, fact.chapterStartOffset,
      chapterOrdinal, evidenceSegment, span.startOffset);
    const readerVisibleFromOffset = groundedOffset(fact.readerVisibleFrom, readerVisibleFromSegment,
      fact.readerVisibleFromOffset, chapterOrdinal, evidenceSegment, span.startOffset);
    const subjectEntityId = this.#resolveEntity(projectId, fact.subjectKey);
    const objectEntityId = this.#resolveEntity(projectId, fact.objectKey);
    const claimId = `claim-${randomUUID()}`;
    const confidence = clipped(fact.confidence);
    this.#database.prepare(`
      INSERT INTO narrative_claims(claim_id, project_id, claim_kind, predicate, subject_entity_id,
        object_entity_id, subject_key, object_key, worldline_key, scene_key, value_json, valid_from_chapter, valid_from_segment,
        valid_from_offset, valid_to_chapter, valid_to_segment, valid_to_offset,
        reader_visible_from_chapter, reader_visible_from_segment, reader_visible_from_offset,
        memory_class, importance, retrieval_scope, character_knowledge_json,
        statement, evidence_id, confidence, status, created_by, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pre-read', ?, ?)
    `).run(claimId, projectId, forcedKind ?? claimKindFor(fact.kind), fact.predicate || fact.kind,
      subjectEntityId, objectEntityId, fact.subjectKey || null, fact.objectKey || null,
      fact.worldlineKey || 'main', fact.sceneKey || '', safeJson(fact.value),
      fact.chapterStart, validFromSegment, validFromOffset, fact.chapterEnd ?? null, fact.chapterEndSegment ?? null,
      fact.chapterEndOffset ?? null, fact.readerVisibleFrom, readerVisibleFromSegment, readerVisibleFromOffset,
      fact.memoryClass || 'episode-detail', clipped(fact.importance), fact.retrievalScope || 'volume',
      safeJson(fact.characterKnowledge), fact.statement,
      evidenceId, confidence, statusFor(confidence), timestamp, timestamp);
    this.#mention(projectId, chapterId, chapterOrdinal, subjectEntityId, fact.subjectKey, 'referent', evidenceId, confidence, timestamp);
    this.#mention(projectId, chapterId, chapterOrdinal, objectEntityId, fact.objectKey, 'referent', evidenceId, confidence, timestamp);
    this.#characterKnowledge(projectId, fact.characterKnowledge, claimId, null, evidenceId, fact.chapterStart,
      validFromSegment, confidence, timestamp);
    return claimId;
  }

  #insertEvent(projectId: string, chapterId: string, chapterOrdinal: number, event: NarrativeEventInput, timestamp: string) {
    const evidenceId = this.#evidence(projectId, chapterId, chapterOrdinal, event.evidenceExcerpt, timestamp,
      'direct', event.evidenceSegment, event.evidenceStartOffset);
    if (!evidenceId) return null;
    const span = evidenceSpan(this.#database, evidenceId);
    const evidenceSegment = span.segmentOrdinal;
    const validFromSegment = this.#groundedSegment(event.chapterStart, event.chapterStartSegment, chapterOrdinal, evidenceSegment);
    const readerVisibleFromSegment = this.#groundedSegment(event.readerVisibleFrom, event.readerVisibleFromSegment, chapterOrdinal, evidenceSegment);
    const validFromOffset = groundedOffset(event.chapterStart, validFromSegment, event.chapterStartOffset,
      chapterOrdinal, evidenceSegment, span.startOffset);
    const readerVisibleFromOffset = groundedOffset(event.readerVisibleFrom, readerVisibleFromSegment,
      event.readerVisibleFromOffset, chapterOrdinal, evidenceSegment, span.startOffset);
    const agentEntityId = this.#resolveEntity(projectId, event.agentKey);
    const patientEntityId = this.#resolveEntity(projectId, event.patientKey);
    const recipientEntityId = this.#resolveEntity(projectId, event.recipientKey);
    const resolvedRequestedRoles = [event.agentKey, event.patientKey, event.recipientKey].filter(Boolean).length;
    const resolvedRoles = [agentEntityId, patientEntityId, recipientEntityId].filter(Boolean).length;
    const directionStatus = event.directionStatus === 'verified' && resolvedRoles < resolvedRequestedRoles
      ? 'unresolved'
      : event.directionStatus;
    const eventId = `event-${randomUUID()}`;
    const confidence = clipped(event.confidence);
    this.#database.prepare(`
      INSERT INTO narrative_events(event_id, project_id, event_type, predicate, agent_entity_id,
        patient_entity_id, recipient_entity_id, agent_key, patient_key, recipient_key, statement,
        worldline_key, scene_key,
        direction_status, valid_from_chapter, valid_from_segment, valid_from_offset,
        valid_to_chapter, valid_to_segment, valid_to_offset,
        reader_visible_from_chapter, reader_visible_from_segment, reader_visible_from_offset,
        memory_class, importance, retrieval_scope, character_knowledge_json, evidence_id, confidence, status,
        created_by, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pre-read', ?, ?)
    `).run(eventId, projectId, event.eventType, event.predicate || event.eventType, agentEntityId,
      patientEntityId, recipientEntityId, event.agentKey || null, event.patientKey || null,
      event.recipientKey || null, event.statement, event.worldlineKey || 'main', event.sceneKey || '',
      directionStatus, event.chapterStart, validFromSegment, validFromOffset,
      event.chapterEnd ?? null, event.chapterEndSegment ?? null, event.chapterEndOffset ?? null,
      event.readerVisibleFrom, readerVisibleFromSegment, readerVisibleFromOffset,
      event.memoryClass || 'event', clipped(event.importance), event.retrievalScope || 'volume',
      safeJson(event.characterKnowledge), evidenceId, confidence, statusFor(confidence), timestamp, timestamp);
    this.#mention(projectId, chapterId, chapterOrdinal, agentEntityId, event.agentKey, 'agent', evidenceId, confidence, timestamp);
    this.#mention(projectId, chapterId, chapterOrdinal, patientEntityId, event.patientKey, 'patient', evidenceId, confidence, timestamp);
    this.#mention(projectId, chapterId, chapterOrdinal, recipientEntityId, event.recipientKey, 'recipient', evidenceId, confidence, timestamp);
    this.#characterKnowledge(projectId, event.characterKnowledge, null, eventId, evidenceId, event.chapterStart,
      validFromSegment, confidence, timestamp);
    return eventId;
  }

  saveChapter(projectId: string, chapterId: string, chapterOrdinal: number, result: NormalizedPreReadResult): NarrativeSaveResult {
    const timestamp = new Date().toISOString();
    const previousSignature = this.#chapterKnowledgeSignature(projectId, chapterId);
    this.#database.prepare(`
      DELETE FROM narrative_claims WHERE project_id = ? AND status <> 'locked'
        AND evidence_id IN (SELECT evidence_id FROM narrative_evidence WHERE project_id = ? AND chapter_id = ?)
    `).run(projectId, projectId, chapterId);
    this.#database.prepare(`
      DELETE FROM narrative_events WHERE project_id = ? AND status <> 'locked'
        AND evidence_id IN (SELECT evidence_id FROM narrative_evidence WHERE project_id = ? AND chapter_id = ?)
    `).run(projectId, projectId, chapterId);
    this.#database.prepare(`
      DELETE FROM narrative_context_frames WHERE project_id = ? AND status <> 'locked'
        AND evidence_id IN (SELECT evidence_id FROM narrative_evidence WHERE project_id = ? AND chapter_id = ?)
    `).run(projectId, projectId, chapterId);
    this.#database.prepare(`
      DELETE FROM narrative_evidence WHERE project_id = ? AND chapter_id = ?
        AND evidence_id NOT IN (SELECT evidence_id FROM narrative_claims)
        AND evidence_id NOT IN (SELECT evidence_id FROM narrative_events)
        AND evidence_id NOT IN (SELECT evidence_id FROM narrative_context_frames)
        AND evidence_id NOT IN (SELECT evidence_id FROM narrative_aliases WHERE evidence_id IS NOT NULL)
    `).run(projectId, chapterId);
    const oldEvidenceIds = this.#database.prepare(`SELECT evidence_id FROM narrative_evidence WHERE project_id = ? AND chapter_id = ?`)
      .all(projectId, chapterId) as unknown as Array<{ evidence_id: string }>;
    if (oldEvidenceIds.length) {
      const placeholders = oldEvidenceIds.map(() => '?').join(',');
      this.#database.prepare(`DELETE FROM narrative_aliases WHERE evidence_id IN (${placeholders}) AND status <> 'locked'`)
        .run(...oldEvidenceIds.map((item) => item.evidence_id));
    }
    this.#database.prepare('DELETE FROM narrative_evidence WHERE project_id = ? AND chapter_id = ?').run(projectId, chapterId);

    const glossarySources = new Set(result.glossary.map((item) => String(item.sourceTerm ?? '').trim()));
    const allCandidates = [
      ...result.entities.map((entity) => ({
        sourceName: entity.sourceName, canonicalSourceName: entity.canonicalSourceName,
        translatedName: entity.translatedName, kind: entity.kind, gender: entity.gender,
        number: entity.number, confidence: entity.confidence,
        evidenceExcerpt: entity.evidence[0]?.excerpt ?? '', entity,
      })),
      ...result.glossary.filter((item) => !result.entities.some((entity) => entity.sourceName === String(item.sourceTerm ?? ''))).map((item) => ({
        sourceName: String(item.sourceTerm ?? ''), canonicalSourceName: String(item.sourceTerm ?? ''),
        translatedName: String(item.translatedTerm ?? ''), kind: String(item.kind ?? 'other'),
        gender: String(item.gender ?? 'unknown'), number: String(item.number ?? 'unknown'),
        confidence: clipped(item.confidence), evidenceExcerpt: String(item.evidenceExcerpt ?? ''),
      })),
    ] as EntityCandidate[];
    const candidates = allCandidates.filter((candidate) => candidate.sourceName && candidate.translatedName && (candidate.entity || glossarySources.has(candidate.sourceName)));

    const entityIds = new Set<string>();
    for (const candidate of candidates) {
      const entityId = this.#upsertEntity(projectId, chapterOrdinal, candidate, timestamp);
      if (!entityId) continue;
      entityIds.add(entityId);
      const evidenceId = this.#evidence(projectId, chapterId, chapterOrdinal, candidate.evidenceExcerpt, timestamp);
      const aliases = candidate.entity?.aliases ?? [];
      const canonicalAlias = {
        sourceForm: candidate.sourceName, translatedForm: candidate.translatedName, aliasKind: 'canonical' as const,
        validFromChapter: chapterOrdinal, validFromSegment: null, validFromOffset: null,
        validToChapter: null, validToSegment: null, validToOffset: null,
        readerVisibleFrom: chapterOrdinal, readerVisibleFromSegment: null, readerVisibleFromOffset: null,
        evidenceExcerpt: candidate.evidenceExcerpt, evidenceSegment: null, evidenceStartOffset: null,
        confidence: candidate.confidence,
      };
      for (const alias of [canonicalAlias, ...aliases]) {
        const aliasEvidenceId = this.#evidence(projectId, chapterId, chapterOrdinal, alias.evidenceExcerpt, timestamp,
          'direct', alias.evidenceSegment, alias.evidenceStartOffset) ?? evidenceId;
        const aliasSpan = aliasEvidenceId ? evidenceSpan(this.#database, aliasEvidenceId) : null;
        const groundedEvidenceSegment = aliasSpan?.segmentOrdinal ?? null;
        const validFromSegment = this.#groundedSegment(alias.validFromChapter, alias.validFromSegment,
          chapterOrdinal, groundedEvidenceSegment);
        const validFromOffset = groundedOffset(alias.validFromChapter, validFromSegment, alias.validFromOffset,
          chapterOrdinal, groundedEvidenceSegment, aliasSpan?.startOffset ?? null);
        const readerVisibleFrom = alias.readerVisibleFrom ?? alias.validFromChapter;
        const readerVisibleFromSegment = this.#groundedSegment(readerVisibleFrom, alias.readerVisibleFromSegment ?? null,
          chapterOrdinal, groundedEvidenceSegment);
        const readerVisibleFromOffset = groundedOffset(readerVisibleFrom, readerVisibleFromSegment,
          alias.readerVisibleFromOffset, chapterOrdinal, groundedEvidenceSegment, aliasSpan?.startOffset ?? null);
        this.#database.prepare(`
          INSERT INTO narrative_aliases(alias_id, entity_id, project_id, source_form, translated_form, alias_kind,
            valid_from_chapter, valid_from_segment, valid_from_offset, valid_to_chapter, valid_to_segment, valid_to_offset,
            reader_visible_from_chapter, reader_visible_from_segment, reader_visible_from_offset,
            confidence, status, evidence_id, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, entity_id, source_form, alias_kind, valid_from_chapter) DO UPDATE SET
            translated_form = excluded.translated_form, valid_from_segment = excluded.valid_from_segment, valid_from_offset = excluded.valid_from_offset,
            valid_to_chapter = excluded.valid_to_chapter, valid_to_segment = excluded.valid_to_segment, valid_to_offset = excluded.valid_to_offset,
            reader_visible_from_chapter = excluded.reader_visible_from_chapter,
            reader_visible_from_segment = excluded.reader_visible_from_segment,
            reader_visible_from_offset = excluded.reader_visible_from_offset,
            confidence = max(narrative_aliases.confidence, excluded.confidence), evidence_id = COALESCE(excluded.evidence_id, narrative_aliases.evidence_id)
        `).run(`alias-${randomUUID()}`, entityId, projectId, alias.sourceForm, alias.translatedForm,
          alias.aliasKind, alias.validFromChapter, validFromSegment, validFromOffset,
          alias.validToChapter ?? null, alias.validToSegment ?? null, alias.validToOffset ?? null,
          readerVisibleFrom, readerVisibleFromSegment, readerVisibleFromOffset, alias.confidence,
          alias.confidence >= 0.9 ? 'confirmed' : 'hypothesis', aliasEvidenceId, timestamp);
      }
    }

    const claimIds: string[] = [];
    for (const entity of result.entities) {
      const subjectKey = entity.canonicalSourceName || entity.sourceName;
      const attributes = [...entity.attributes];
      if (entity.gender !== 'unknown' && !attributes.some((item) => item.predicate === 'gender')) attributes.push({
        predicate: 'gender', value: entity.gender, worldlineKey: 'main', sceneKey: '',
        validFromChapter: chapterOrdinal, validFromSegment: null, validFromOffset: null,
        validToChapter: null, validToSegment: null, validToOffset: null,
        readerVisibleFrom: chapterOrdinal, readerVisibleFromSegment: null, readerVisibleFromOffset: null,
        evidenceExcerpt: entity.evidence.find((item) => item.kind === 'gender')?.excerpt ?? entity.evidence[0]?.excerpt ?? '',
        evidenceSegment: null, evidenceStartOffset: null, confidence: entity.confidence,
      });
      if (!['unknown', 'not-applicable'].includes(entity.number) && !attributes.some((item) => item.predicate === 'number')) attributes.push({
        predicate: 'number', value: entity.number, worldlineKey: 'main', sceneKey: '',
        validFromChapter: chapterOrdinal, validFromSegment: null, validFromOffset: null,
        validToChapter: null, validToSegment: null, validToOffset: null,
        readerVisibleFrom: chapterOrdinal, readerVisibleFromSegment: null, readerVisibleFromOffset: null,
        evidenceExcerpt: entity.evidence.find((item) => item.kind === 'number')?.excerpt ?? entity.evidence[0]?.excerpt ?? '',
        evidenceSegment: null, evidenceStartOffset: null, confidence: entity.confidence,
      });
      for (const attribute of attributes) {
        const policy = memoryPolicyFor(attribute.predicate, attribute.predicate,
          `${subjectKey} 的 ${attribute.predicate}`, attribute.confidence);
        const claimId = this.#insertClaim(projectId, chapterId, chapterOrdinal, {
          kind: attribute.predicate, predicate: attribute.predicate, subjectKey, objectKey: '',
          worldlineKey: attribute.worldlineKey || 'main', sceneKey: attribute.sceneKey || '', value: attribute.value,
          statement: `${subjectKey} 的 ${attribute.predicate}：${typeof attribute.value === 'string' ? attribute.value : safeJson(attribute.value)}`,
          chapterStart: attribute.validFromChapter, chapterStartSegment: attribute.validFromSegment,
          chapterStartOffset: attribute.validFromOffset,
          chapterEnd: attribute.validToChapter, chapterEndSegment: attribute.validToSegment,
          chapterEndOffset: attribute.validToOffset,
          readerVisibleFrom: attribute.readerVisibleFrom, readerVisibleFromSegment: attribute.readerVisibleFromSegment,
          readerVisibleFromOffset: attribute.readerVisibleFromOffset,
          characterKnowledge: {}, evidenceExcerpt: attribute.evidenceExcerpt,
          evidenceSegment: attribute.evidenceSegment, evidenceStartOffset: attribute.evidenceStartOffset,
          memoryClass: policy.memoryClass, importance: policy.importance, retrievalScope: policy.retrievalScope,
          confidence: attribute.confidence,
        }, timestamp, claimKindFor(attribute.predicate));
        if (claimId) claimIds.push(claimId);
      }
    }
    const eventIds: string[] = [];
    for (const fact of result.facts) {
      if (fact.kind === 'event') {
        const eventId = this.#insertEvent(projectId, chapterId, chapterOrdinal, {
          eventType: 'plot-event', predicate: fact.predicate || 'event', agentKey: fact.subjectKey,
          patientKey: fact.objectKey, recipientKey: '', statement: fact.statement,
          worldlineKey: fact.worldlineKey || 'main', sceneKey: fact.sceneKey || '',
          directionStatus: fact.subjectKey && fact.objectKey ? 'verified' : 'unresolved',
          chapterStart: fact.chapterStart, chapterStartSegment: fact.chapterStartSegment,
          chapterStartOffset: fact.chapterStartOffset,
          chapterEnd: fact.chapterEnd, chapterEndSegment: fact.chapterEndSegment, chapterEndOffset: fact.chapterEndOffset,
          readerVisibleFrom: fact.readerVisibleFrom, readerVisibleFromSegment: fact.readerVisibleFromSegment,
          readerVisibleFromOffset: fact.readerVisibleFromOffset,
          characterKnowledge: fact.characterKnowledge, evidenceExcerpt: fact.evidenceExcerpt,
          evidenceSegment: fact.evidenceSegment, evidenceStartOffset: fact.evidenceStartOffset,
          memoryClass: fact.memoryClass, importance: fact.importance, retrievalScope: fact.retrievalScope,
          confidence: fact.confidence,
        }, timestamp);
        if (eventId) eventIds.push(eventId);
      } else if (!['scene-summary', 'chapter-summary'].includes(fact.kind)) {
        const claimId = this.#insertClaim(projectId, chapterId, chapterOrdinal, fact, timestamp);
        if (claimId) claimIds.push(claimId);
      }
    }
    for (const event of result.events) {
      const eventId = this.#insertEvent(projectId, chapterId, chapterOrdinal, event, timestamp);
      if (eventId) eventIds.push(eventId);
    }
    const frameIds: string[] = [];
    const frameIdsByKey = new Map<string, string>();
    const pendingParents: Array<{ frameId: string; parentFrameKey: string }> = [];
    const seenFrames = new Set<string>();
    for (const frame of result.frames ?? []) {
      const dedupeKey = `${frame.frameKind}:${frame.worldlineKey}:${frame.sceneKey}:${frame.validFromChapter}:${frame.validFromSegment}:${frame.validFromOffset ?? ''}`;
      if (seenFrames.has(dedupeKey)) continue;
      seenFrames.add(dedupeKey);
      const evidenceId = this.#evidence(projectId, chapterId, chapterOrdinal, frame.evidenceExcerpt, timestamp,
        'direct', frame.evidenceSegment, frame.evidenceStartOffset);
      if (!evidenceId) continue;
      const span = evidenceSpan(this.#database, evidenceId);
      const evidenceSegment = span.segmentOrdinal;
      const validFromSegment = this.#groundedSegment(frame.validFromChapter, frame.validFromSegment,
        chapterOrdinal, evidenceSegment) ?? 1;
      const validFromOffset = groundedOffset(frame.validFromChapter, validFromSegment, frame.validFromOffset,
        chapterOrdinal, evidenceSegment, span.startOffset);
      const frameId = `frame-${randomUUID()}`;
      const storedFrameKey = frame.frameKey || dedupeKey;
      const confidence = clipped(frame.confidence);
      this.#database.prepare(`
        INSERT INTO narrative_context_frames(frame_id, project_id, chapter_id, frame_kind,
          worldline_key, story_time_key, scene_key, location_key, viewpoint_key, narrator_key,
          participant_keys_json, frame_key, parent_frame_key, parent_frame_id, nesting_depth,
          discourse_mode, quote_level, speaker_key, addressee_key,
          valid_from_chapter, valid_from_segment, valid_from_offset, valid_to_chapter,
          valid_to_segment, valid_to_offset, evidence_id, confidence, status, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(frameId, projectId, chapterId, frame.frameKind, frame.worldlineKey || 'main',
        frame.storyTimeKey || 'unknown', frame.sceneKey, frame.locationKey, frame.viewpointKey,
        frame.narratorKey, safeJson(frame.participantKeys), storedFrameKey, frame.parentFrameKey || '',
        Math.max(0, Math.floor(Number(frame.nestingDepth) || 0)), frame.discourseMode || 'unknown',
        Math.max(0, Math.floor(Number(frame.quoteLevel) || 0)), frame.speakerKey || '', frame.addresseeKey || '',
        frame.validFromChapter, validFromSegment, validFromOffset,
        frame.validToChapter ?? null, frame.validToSegment ?? null, frame.validToOffset ?? null,
        evidenceId, confidence,
        confidence >= 0.9 ? 'confirmed' : 'hypothesis', timestamp, timestamp);
      frameIds.push(frameId);
      frameIdsByKey.set(storedFrameKey, frameId);
      if (frame.parentFrameKey) pendingParents.push({ frameId, parentFrameKey: frame.parentFrameKey });
      for (const participant of frame.participantKeys) {
        const entityId = this.#resolveEntity(projectId, participant);
        if (entityId) entityIds.add(entityId);
      }
    }
    for (const pending of pendingParents) {
      const parentId = frameIdsByKey.get(pending.parentFrameKey);
      if (parentId && parentId !== pending.frameId) this.#database.prepare('UPDATE narrative_context_frames SET parent_frame_id = ? WHERE frame_id = ?')
        .run(parentId, pending.frameId);
    }
    rebuildWorldState(this.#database, projectId, timestamp);
    return {
      entityIds: [...entityIds], claimIds, eventIds, frameIds,
      knowledgeChanged: previousSignature !== this.#chapterKnowledgeSignature(projectId, chapterId),
    };
  }
}
