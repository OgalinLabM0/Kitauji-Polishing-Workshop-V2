import type { DatabaseSync } from 'node:sqlite';
import { NarrativePersistence } from './narrativePersistence.cjs';
import type { NormalizedPreReadResult } from './narrativeModels.cjs';

const parseObject = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Readonly<Record<string, unknown>> : {};
  } catch { return {}; }
};

export const backfillLegacyNarrativeKnowledge = (database: DatabaseSync) => {
  const projects = database.prepare(`
    SELECT p.project_id FROM projects p
    WHERE NOT EXISTS (SELECT 1 FROM narrative_entities e WHERE e.project_id = p.project_id)
      AND (EXISTS (SELECT 1 FROM glossary_entries g WHERE g.project_id = p.project_id AND g.status <> 'rejected')
        OR EXISTS (SELECT 1 FROM memory_facts f WHERE f.project_id = p.project_id AND f.status <> 'superseded'))
  `).all() as unknown as Array<{ project_id: string }>;
  const persistence = new NarrativePersistence(database);
  let backfilledProjects = 0;
  for (const project of projects) {
    const glossary = database.prepare(`
      SELECT g.source_term, g.translated_term, g.reading, g.entity_kind, g.gender,
        g.grammatical_number, g.confidence, g.notes,
        COALESCE((SELECT source_excerpt FROM glossary_evidence e WHERE e.glossary_id = g.glossary_id ORDER BY created_at LIMIT 1), g.source_term) AS evidence_excerpt
      FROM glossary_entries g WHERE g.project_id = ? AND g.status <> 'rejected'
      ORDER BY g.confidence DESC
    `).all(project.project_id) as unknown as Array<Record<string, unknown>>;
    const facts = database.prepare(`
      SELECT fact_kind, subject_key, object_key, statement, chapter_start, chapter_start_segment,
        chapter_end, chapter_end_segment, reader_visible_from, reader_visible_from_segment,
        character_knowledge_json, evidence_excerpt, confidence
      FROM memory_facts WHERE project_id = ? AND status <> 'superseded'
        AND fact_kind NOT IN ('chapter-summary', 'scene-summary')
      ORDER BY chapter_start, confidence DESC
    `).all(project.project_id) as unknown as Array<{
      fact_kind: string; subject_key: string | null; object_key: string | null; statement: string;
      chapter_start: number; chapter_start_segment: number | null; chapter_end: number | null;
      chapter_end_segment: number | null; reader_visible_from: number; reader_visible_from_segment: number | null;
      character_knowledge_json: string; evidence_excerpt: string; confidence: number;
    }>;
    const chapterOrdinals = [...new Set([1, ...facts.map((fact) => fact.chapter_start)])].sort((left, right) => left - right);
    for (let index = 0; index < chapterOrdinals.length; index += 1) {
      const chapterOrdinal = chapterOrdinals[index];
      const chapter = database.prepare(`
        SELECT chapter_id FROM translation_segments WHERE project_id = ? AND chapter_ordinal = ? ORDER BY segment_ordinal LIMIT 1
      `).get(project.project_id, chapterOrdinal) as { chapter_id: string } | undefined;
      if (!chapter) continue;
      const entities = index === 0 ? glossary.map((item) => ({
        sourceName: String(item.source_term ?? ''), canonicalSourceName: String(item.source_term ?? ''),
        translatedName: String(item.translated_term ?? ''), reading: String(item.reading ?? ''),
        kind: String(item.entity_kind ?? 'other'), gender: String(item.gender ?? 'unknown'),
        number: String(item.grammatical_number ?? 'unknown'), confidence: Number(item.confidence) || 0,
        notes: String(item.notes ?? ''), evidence: [{ excerpt: String(item.evidence_excerpt ?? item.source_term ?? ''), kind: 'occurrence' }],
        aliases: [], attributes: [],
      })).filter((item) => item.sourceName && item.translatedName) : [];
      const normalized: NormalizedPreReadResult = {
        chapterSummary: '', entities, glossary: [], events: [], frames: [], styleDecisions: [], ambiguities: [],
        facts: facts.filter((fact) => fact.chapter_start === chapterOrdinal).map((fact) => ({
          kind: fact.fact_kind, predicate: fact.fact_kind, subjectKey: fact.subject_key ?? '', objectKey: fact.object_key ?? '',
          worldlineKey: 'main', sceneKey: '',
          value: { legacyStatement: fact.statement }, statement: fact.statement,
          chapterStart: fact.chapter_start, chapterStartSegment: fact.chapter_start_segment,
          chapterStartOffset: null, chapterEnd: fact.chapter_end, chapterEndSegment: fact.chapter_end_segment,
          chapterEndOffset: null,
          readerVisibleFrom: fact.reader_visible_from, readerVisibleFromSegment: fact.reader_visible_from_segment,
          readerVisibleFromOffset: null,
          characterKnowledge: parseObject(fact.character_knowledge_json),
          evidenceExcerpt: fact.evidence_excerpt, evidenceSegment: fact.chapter_start_segment, evidenceStartOffset: null,
          memoryClass: 'episode-detail', importance: 0.5, retrievalScope: 'volume', confidence: fact.confidence,
        })),
      };
      persistence.saveChapter(project.project_id, chapter.chapter_id, chapterOrdinal, normalized);
    }
    backfilledProjects += 1;
  }
  return backfilledProjects;
};
