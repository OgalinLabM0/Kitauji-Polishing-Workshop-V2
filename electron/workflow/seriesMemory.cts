import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface SeriesAssignment {
  readonly seriesId: string;
  readonly name: string;
  readonly description: string;
  readonly volumeOrdinal: number;
  readonly volumeLabel: string;
}

const normalizeSeriesName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ja-JP');
const json = (value: unknown) => JSON.stringify(value ?? null);

export class SeriesMemory {
  readonly #database: DatabaseSync;
  constructor(database: DatabaseSync) { this.#database = database; }

  assignment(projectId: string): SeriesAssignment | null {
    const row = this.#database.prepare(`
      SELECT s.series_id, s.name, s.description, p.volume_ordinal, p.volume_label
      FROM series_projects p JOIN narrative_series s ON s.series_id = p.series_id
      WHERE p.project_id = ?
    `).get(projectId) as { series_id: string; name: string; description: string; volume_ordinal: number; volume_label: string } | undefined;
    return row ? { seriesId: row.series_id, name: row.name, description: row.description,
      volumeOrdinal: row.volume_ordinal, volumeLabel: row.volume_label } : null;
  }

  list() {
    return (this.#database.prepare(`
      SELECT s.series_id, s.name, s.description, count(p.project_id) AS volume_count,
        max(p.volume_ordinal) AS max_volume_ordinal
      FROM narrative_series s LEFT JOIN series_projects p ON p.series_id = s.series_id
      GROUP BY s.series_id ORDER BY s.name
    `).all() as unknown as Array<{ series_id: string; name: string; description: string; volume_count: number; max_volume_ordinal: number | null }>).map((row) => ({
      seriesId: row.series_id, name: row.name, description: row.description,
      volumeCount: row.volume_count, maxVolumeOrdinal: row.max_volume_ordinal ?? 0,
    }));
  }

  assign(projectId: string, name: string, volumeOrdinal: number, volumeLabel = '', description = '') {
    const project = this.#database.prepare('SELECT title FROM projects WHERE project_id = ?').get(projectId) as { title: string } | undefined;
    if (!project) throw new Error('作品不存在。');
    const cleanName = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!cleanName || cleanName.length > 120) throw new Error('系列名称不能为空且不能超过 120 个字符。');
    const ordinal = Math.floor(Number(volumeOrdinal));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 10_000) throw new Error('卷序必须是 1 到 10000 的整数。');
    const timestamp = new Date().toISOString();
    const normalized = normalizeSeriesName(cleanName);
    const existing = this.#database.prepare('SELECT series_id FROM narrative_series WHERE normalized_name = ?').get(normalized) as { series_id: string } | undefined;
    const seriesId = existing?.series_id ?? `series-${randomUUID()}`;
    if (!existing) this.#database.prepare(`
      INSERT INTO narrative_series(series_id, name, normalized_name, description, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(seriesId, cleanName, normalized, description.trim(), timestamp, timestamp);
    else this.#database.prepare('UPDATE narrative_series SET name = ?, description = CASE WHEN ? <> \'\' THEN ? ELSE description END, updated_at = ? WHERE series_id = ?')
      .run(cleanName, description.trim(), description.trim(), timestamp, seriesId);
    const occupied = this.#database.prepare('SELECT project_id FROM series_projects WHERE series_id = ? AND volume_ordinal = ? AND project_id <> ?')
      .get(seriesId, ordinal, projectId) as { project_id: string } | undefined;
    if (occupied) throw new Error(`该系列的第 ${ordinal} 卷已经由另一个项目占用。`);
    const old = this.assignment(projectId);
    if (old && old.seriesId !== seriesId) {
      this.#database.prepare('DELETE FROM series_entity_links WHERE project_id = ?').run(projectId);
      this.#database.prepare('DELETE FROM series_terms WHERE source_project_id = ?').run(projectId);
      this.#database.prepare('DELETE FROM series_projects WHERE project_id = ?').run(projectId);
    }
    this.#database.prepare(`
      INSERT INTO series_projects(series_id, project_id, volume_ordinal, volume_label, assignment_source, created_at, updated_at)
      VALUES(?, ?, ?, ?, 'manual', ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET series_id = excluded.series_id, volume_ordinal = excluded.volume_ordinal,
        volume_label = excluded.volume_label, updated_at = excluded.updated_at
    `).run(seriesId, projectId, ordinal, volumeLabel.trim() || `第 ${ordinal} 卷`, timestamp, timestamp);
    this.#database.prepare('UPDATE consolidated_memories SET series_id = ?, updated_at = ? WHERE project_id = ?').run(seriesId, timestamp, projectId);
    this.#database.prepare('UPDATE translation_style_memories SET series_id = ?, updated_at = ? WHERE project_id = ?').run(seriesId, timestamp, projectId);
    this.#database.prepare('UPDATE narrative_ambiguities SET series_id = ?, updated_at = ? WHERE project_id = ?').run(seriesId, timestamp, projectId);
    this.syncProject(projectId);
    return this.assignment(projectId)!;
  }

  unassign(projectId: string) {
    const current = this.assignment(projectId);
    if (!current) return false;
    const timestamp = new Date().toISOString();
    this.#database.prepare('DELETE FROM series_entity_links WHERE project_id = ?').run(projectId);
    this.#database.prepare('DELETE FROM series_terms WHERE source_project_id = ?').run(projectId);
    this.#database.prepare('DELETE FROM series_projects WHERE project_id = ?').run(projectId);
    this.#database.prepare('UPDATE consolidated_memories SET series_id = NULL, updated_at = ? WHERE project_id = ?').run(timestamp, projectId);
    this.#database.prepare('UPDATE translation_style_memories SET series_id = NULL, updated_at = ? WHERE project_id = ?').run(timestamp, projectId);
    this.#database.prepare('UPDATE narrative_ambiguities SET series_id = NULL, updated_at = ? WHERE project_id = ?').run(timestamp, projectId);
    return true;
  }

  syncProject(projectId: string) {
    const assignment = this.assignment(projectId);
    if (!assignment) return { entities: 0, terms: 0, conflicts: 0 };
    const timestamp = new Date().toISOString();
    let entities = 0;
    let terms = 0;
    let conflicts = 0;
    const entityRows = this.#database.prepare(`
      SELECT entity_id, canonical_source, canonical_translation, entity_kind, confidence, status
      FROM narrative_entities WHERE project_id = ? AND status IN ('confirmed', 'locked')
    `).all(projectId) as unknown as Array<{ entity_id: string; canonical_source: string; canonical_translation: string; entity_kind: string; confidence: number; status: string }>;
    for (const row of entityRows) {
      const current = this.#database.prepare('SELECT series_entity_id, canonical_translation, status FROM series_entities WHERE series_id = ? AND canonical_source = ?')
        .get(assignment.seriesId, row.canonical_source) as { series_entity_id: string; canonical_translation: string; status: string } | undefined;
      const seriesEntityId = current?.series_entity_id ?? `series-entity-${randomUUID()}`;
      const conflict = Boolean(current && current.canonical_translation !== row.canonical_translation);
      const status = conflict ? 'conflict' : row.status === 'locked' || row.confidence >= 0.94 ? 'confirmed' : 'candidate';
      this.#database.prepare(`
        INSERT INTO series_entities(series_entity_id, series_id, canonical_source, canonical_translation, entity_kind,
          confidence, status, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(series_id, canonical_source) DO UPDATE SET
          canonical_translation = CASE WHEN series_entities.status = 'locked' THEN series_entities.canonical_translation ELSE excluded.canonical_translation END,
          confidence = max(series_entities.confidence, excluded.confidence),
          status = CASE WHEN series_entities.status = 'locked' THEN 'locked' ELSE excluded.status END,
          updated_at = excluded.updated_at
      `).run(seriesEntityId, assignment.seriesId, row.canonical_source, row.canonical_translation, row.entity_kind,
        row.confidence, status, timestamp, timestamp);
      this.#database.prepare(`
        INSERT INTO series_entity_links(link_id, series_entity_id, project_id, entity_id, link_reason, confidence, status, created_at, updated_at)
        VALUES(?, ?, ?, ?, '同系列中规范原名完全一致且译名一致', ?, ?, ?, ?)
        ON CONFLICT(project_id, entity_id) DO UPDATE SET series_entity_id = excluded.series_entity_id,
          link_reason = excluded.link_reason, confidence = excluded.confidence, status = excluded.status, updated_at = excluded.updated_at
      `).run(`series-link-${randomUUID()}`, seriesEntityId, projectId, row.entity_id, row.confidence, status, timestamp, timestamp);
      entities += 1;
      if (conflict) conflicts += 1;
    }
    const termRows = this.#database.prepare(`
      SELECT glossary_id, source_term, translated_term, sense, entity_kind, confidence, status
      FROM glossary_entries WHERE project_id = ? AND status IN ('confirmed', 'locked')
    `).all(projectId) as unknown as Array<{ glossary_id: string; source_term: string; translated_term: string; sense: string; entity_kind: string; confidence: number; status: string }>;
    for (const row of termRows) {
      const current = this.#database.prepare('SELECT series_term_id, translated_term, status FROM series_terms WHERE series_id = ? AND source_term = ? AND sense = ?')
        .get(assignment.seriesId, row.source_term, row.sense) as { series_term_id: string; translated_term: string; status: string } | undefined;
      const conflict = Boolean(current && current.translated_term !== row.translated_term);
      const status = conflict ? 'conflict' : row.status === 'locked' || row.confidence >= 0.94 ? 'confirmed' : 'candidate';
      this.#database.prepare(`
        INSERT INTO series_terms(series_term_id, series_id, source_term, translated_term, sense, entity_kind,
          confidence, status, source_project_id, source_glossary_id, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(series_id, source_term, sense) DO UPDATE SET
          translated_term = CASE WHEN series_terms.status = 'locked' THEN series_terms.translated_term ELSE excluded.translated_term END,
          confidence = max(series_terms.confidence, excluded.confidence),
          status = CASE WHEN series_terms.status = 'locked' THEN 'locked' ELSE excluded.status END,
          source_project_id = excluded.source_project_id, source_glossary_id = excluded.source_glossary_id,
          updated_at = excluded.updated_at
      `).run(current?.series_term_id ?? `series-term-${randomUUID()}`, assignment.seriesId, row.source_term,
        row.translated_term, row.sense, row.entity_kind, row.confidence, status, projectId, row.glossary_id, timestamp, timestamp);
      terms += 1;
      if (conflict) conflicts += 1;
    }
    return { entities, terms, conflicts };
  }

  context(projectId: string, joinedSource: string) {
    const assignment = this.assignment(projectId);
    if (!assignment) return { assignment: null, entities: [], terms: [], memories: [], styles: [], conflicts: [] };
    const priorProjects = this.#database.prepare(`
      SELECT project_id, volume_ordinal, volume_label FROM series_projects
      WHERE series_id = ? AND volume_ordinal < ? ORDER BY volume_ordinal
    `).all(assignment.seriesId, assignment.volumeOrdinal) as unknown as Array<{ project_id: string; volume_ordinal: number; volume_label: string }>;
    const priorIds = priorProjects.map((row) => row.project_id);
    if (!priorIds.length) return { assignment, entities: [], terms: [], memories: [], styles: [], conflicts: [] };
    const placeholders = priorIds.map(() => '?').join(',');
    const entities = (this.#database.prepare(`
      SELECT DISTINCT se.series_entity_id, se.canonical_source, se.canonical_translation, se.entity_kind, se.confidence
      FROM series_entities se JOIN series_entity_links l ON l.series_entity_id = se.series_entity_id
      WHERE se.series_id = ? AND se.status IN ('confirmed', 'locked') AND l.status IN ('confirmed', 'locked')
        AND l.project_id IN (${placeholders})
      ORDER BY se.confidence DESC
    `).all(assignment.seriesId, ...priorIds) as unknown as Array<Record<string, unknown>>)
      .filter((row) => joinedSource.includes(String(row.canonical_source))).slice(0, 60);
    const terms = (this.#database.prepare(`
      SELECT series_term_id, source_term, translated_term, sense, entity_kind, confidence
      FROM series_terms WHERE series_id = ? AND status IN ('confirmed', 'locked')
        AND source_project_id IN (${placeholders}) ORDER BY confidence DESC, length(source_term) DESC
    `).all(assignment.seriesId, ...priorIds) as unknown as Array<Record<string, unknown>>)
      .filter((row) => joinedSource.includes(String(row.source_term))).slice(0, 80);
    const rawMemories = this.#database.prepare(`
      SELECT memory_id, memory_class, summary, subject_key, object_key, track_key, worldline_key,
        importance, retention_policy, retrieval_scope, confidence, project_id
      FROM consolidated_memories WHERE series_id = ? AND project_id IN (${placeholders})
        AND consolidation_status = 'consolidated' AND retrieval_scope IN ('series', 'volume')
      ORDER BY importance DESC, chapter_ordinal DESC LIMIT 240
    `).all(assignment.seriesId, ...priorIds) as unknown as Array<Record<string, unknown>>;
    const memories = rawMemories.filter((row) => {
      const subject = String(row.subject_key ?? '');
      const object = String(row.object_key ?? '');
      return Number(row.importance) >= 0.88 || Boolean(subject && joinedSource.includes(subject)) || Boolean(object && joinedSource.includes(object));
    }).slice(0, 80);
    const styles = (this.#database.prepare(`
      SELECT style_id, owner_type, owner_key, decision_kind, source_pattern, target_strategy, rationale, confidence
      FROM translation_style_memories WHERE series_id = ? AND project_id IN (${placeholders})
        AND status IN ('confirmed', 'locked') ORDER BY confidence DESC, usage_count DESC LIMIT 160
    `).all(assignment.seriesId, ...priorIds) as unknown as Array<Record<string, unknown>>)
      .filter((row) => !row.owner_key || joinedSource.includes(String(row.owner_key)) || !row.source_pattern || joinedSource.includes(String(row.source_pattern))).slice(0, 50);
    const conflicts = [
      ...this.#database.prepare(`SELECT series_entity_id AS id, canonical_source AS source, canonical_translation AS value, 'entity' AS kind FROM series_entities WHERE series_id = ? AND status = 'conflict' LIMIT 30`).all(assignment.seriesId),
      ...this.#database.prepare(`SELECT series_term_id AS id, source_term AS source, translated_term AS value, 'term' AS kind FROM series_terms WHERE series_id = ? AND status = 'conflict' LIMIT 30`).all(assignment.seriesId),
    ];
    return { assignment, priorVolumes: priorProjects, entities, terms, memories, styles, conflicts };
  }

  contextJson(projectId: string, joinedSource: string) { return json(this.context(projectId, joinedSource)); }
}
