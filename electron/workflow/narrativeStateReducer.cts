import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { previousPosition } from './narrativePosition.cjs';

interface ClaimRow {
  claim_id: string;
  entity_id: string;
  object_identity: string;
  worldline_key: string;
  scene_key: string;
  predicate: string;
  value_json: string;
  valid_from_chapter: number;
  valid_from_segment: number | null;
  valid_from_offset: number | null;
  valid_to_chapter: number | null;
  valid_to_segment: number | null;
  valid_to_offset: number | null;
  confidence: number;
}

const sameValue = (left: ClaimRow, right: ClaimRow) => left.value_json === right.value_json;
const samePosition = (left: ClaimRow, right: ClaimRow) => left.valid_from_chapter === right.valid_from_chapter
  && left.valid_from_segment === right.valid_from_segment && left.valid_from_offset === right.valid_from_offset;
const sameTrack = (left: ClaimRow, right: ClaimRow) => left.entity_id === right.entity_id
  && left.object_identity === right.object_identity && left.predicate === right.predicate
  && left.worldline_key === right.worldline_key;

export const rebuildWorldState = (database: DatabaseSync, projectId: string, timestamp: string) => {
  database.prepare('DELETE FROM world_state_snapshots WHERE project_id = ?').run(projectId);
  database.prepare("DELETE FROM claim_conflicts WHERE project_id = ? AND status = 'open'").run(projectId);
  const rows = database.prepare(`
    SELECT claim_id, subject_entity_id AS entity_id,
      COALESCE(object_entity_id, object_key, '') AS object_identity,
      worldline_key, scene_key, predicate, value_json, valid_from_chapter,
      valid_from_segment, valid_from_offset, valid_to_chapter, valid_to_segment, valid_to_offset, confidence
    FROM narrative_claims
    WHERE project_id = ? AND subject_entity_id IS NOT NULL
      AND claim_kind IN ('identity', 'character-state', 'number', 'age', 'appearance', 'affiliation', 'voice', 'relationship', 'address')
      AND status IN ('confirmed', 'locked', 'hypothesis')
    ORDER BY subject_entity_id, object_identity, worldline_key, predicate, valid_from_chapter,
      COALESCE(valid_from_segment, 0), COALESCE(valid_from_offset, 0), confidence DESC
  `).all(projectId) as unknown as ClaimRow[];
  const insertSnapshot = database.prepare(`
    INSERT INTO world_state_snapshots(snapshot_id, project_id, entity_id, predicate, value_json,
      worldline_key, scene_key,
      valid_from_chapter, valid_from_segment, valid_from_offset, valid_to_chapter, valid_to_segment, valid_to_offset,
      source_claim_id, confidence, status, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertConflict = database.prepare(`
    INSERT OR IGNORE INTO claim_conflicts(conflict_id, project_id, left_claim_id, right_claim_id,
      conflict_kind, status, explanation, resolution_json, created_at, resolved_at)
    VALUES(?, ?, ?, ?, 'value', 'open', ?, '{}', ?, NULL)
  `);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const next = rows.slice(index + 1).find((candidate) => sameTrack(candidate, row));
    let validToChapter = row.valid_to_chapter;
    let validToSegment = row.valid_to_segment;
    let validToOffset = row.valid_to_offset;
    let status: 'active' | 'historical' | 'conflict' = validToChapter === null ? 'active' : 'historical';
    if (next && samePosition(row, next) && !sameValue(row, next)) {
      status = 'conflict';
      insertConflict.run(`conflict-${randomUUID()}`, projectId, row.claim_id, next.claim_id,
        `同一人物的“${row.predicate}”在同一时间点存在互斥值，必须复核原文证据。`, timestamp);
    } else if (next && validToChapter === null) {
      const end = previousPosition({ chapter: next.valid_from_chapter, segment: next.valid_from_segment, offset: next.valid_from_offset });
      validToChapter = end.chapter;
      validToSegment = end.segment;
      validToOffset = end.offset ?? null;
      status = 'historical';
    }
    insertSnapshot.run(`snapshot-${randomUUID()}`, projectId, row.entity_id, row.predicate, row.value_json,
      row.worldline_key, row.scene_key,
      row.valid_from_chapter, row.valid_from_segment, row.valid_from_offset, validToChapter, validToSegment, validToOffset,
      row.claim_id, row.confidence, status, timestamp);
  }
};
