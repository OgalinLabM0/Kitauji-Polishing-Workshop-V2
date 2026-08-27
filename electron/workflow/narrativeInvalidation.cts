import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const safeArray = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
};

export class NarrativeInvalidation {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) { this.#database = database; }

  flagSelectedTranslations(projectId: string, changedEntityIds: readonly string[], reason: string) {
    if (!changedEntityIds.length) return 0;
    const changed = new Set(changedEntityIds);
    const dependencyRows = this.#database.prepare(`
      SELECT d.segment_id, d.entity_ids_json, s.selected_version_id
      FROM translation_dependencies d JOIN translation_segments s ON s.segment_id = d.segment_id
      WHERE d.project_id = ? AND s.selected_version_id = d.translation_version_id
        AND s.status IN ('approved', 'reviewing', 'needs-human')
    `).all(projectId) as unknown as Array<{ segment_id: string; entity_ids_json: string; selected_version_id: string }>;
    const fallbackRows = this.#database.prepare(`
      SELECT DISTINCT s.segment_id, '[]' AS entity_ids_json, s.selected_version_id
      FROM translation_segments s JOIN narrative_aliases a ON a.project_id = s.project_id
      WHERE s.project_id = ? AND s.selected_version_id IS NOT NULL
        AND a.entity_id IN (${changedEntityIds.map(() => '?').join(',')}) AND instr(s.source_text, a.source_form) > 0
    `).all(projectId, ...changedEntityIds) as unknown as Array<{ segment_id: string; entity_ids_json: string; selected_version_id: string }>;
    const rowMap = new Map([...fallbackRows, ...dependencyRows].map((row) => [row.segment_id, row]));
    const rows = [...rowMap.values()];
    const timestamp = new Date().toISOString();
    let flagged = 0;
    for (const row of rows) {
      const dependencyAffected = safeArray(row.entity_ids_json).filter((entityId) => changed.has(entityId));
      const affected = dependencyAffected.length ? dependencyAffected : [...changed];
      const existing = this.#database.prepare(`
        SELECT review_id FROM review_items WHERE segment_id = ? AND status = 'open'
          AND category = 'identity' AND title = '世界状态更新后需重新核对'
      `).get(row.segment_id);
      if (!existing) {
        this.#database.prepare(`
          INSERT INTO review_items(review_id, project_id, segment_id, category, severity, status, title,
            explanation, evidence_json, proposed_text, resolution_note, created_at, resolved_at)
          VALUES(?, ?, ?, 'identity', 'blocking', 'open', '世界状态更新后需重新核对', ?, ?, NULL, NULL, ?, NULL)
        `).run(`review-${randomUUID()}`, projectId, row.segment_id,
          `此译文依赖的人物身份、别名、状态或定向事件已经更新：${reason}。旧译文已保留，但必须用新状态重新复核。`,
          JSON.stringify({ changedEntityIds: affected, selectedVersionId: row.selected_version_id }), timestamp);
      }
      this.#database.prepare(`UPDATE translation_segments SET status = 'needs-human', updated_at = ? WHERE segment_id = ?`)
        .run(timestamp, row.segment_id);
      flagged += 1;
    }
    return flagged;
  }

  flagChapterTranslations(projectId: string, chapterId: string, reason: string) {
    const rows = this.#database.prepare(`
      SELECT segment_id, selected_version_id FROM translation_segments
      WHERE project_id = ? AND chapter_id = ? AND selected_version_id IS NOT NULL
        AND status IN ('approved', 'reviewing', 'needs-human')
    `).all(projectId, chapterId) as unknown as Array<{ segment_id: string; selected_version_id: string }>;
    const timestamp = new Date().toISOString();
    for (const row of rows) {
      const existing = this.#database.prepare(`
        SELECT review_id FROM review_items WHERE segment_id = ? AND status = 'open'
          AND category = 'literary-choice' AND title = '阅读记忆更新后需重新核对'
      `).get(row.segment_id);
      if (!existing) {
        this.#database.prepare(`
          INSERT INTO review_items(review_id, project_id, segment_id, category, severity, status, title,
            explanation, evidence_json, proposed_text, resolution_note, created_at, resolved_at)
          VALUES(?, ?, ?, 'literary-choice', 'blocking', 'open', '阅读记忆更新后需重新核对', ?, ?, NULL, NULL, ?, NULL)
        `).run(`review-${randomUUID()}`, projectId, row.segment_id,
          `本章的文风决策、叙事层或歧义证据已经更新：${reason}。旧译文已保留，但必须按新阅读状态重新复核。`,
          JSON.stringify({ chapterId, selectedVersionId: row.selected_version_id }), timestamp);
      }
      this.#database.prepare(`UPDATE translation_segments SET status = 'needs-human', updated_at = ? WHERE segment_id = ?`)
        .run(timestamp, row.segment_id);
    }
    return rows.length;
  }
}
