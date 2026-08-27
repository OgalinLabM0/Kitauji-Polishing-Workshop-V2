import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface LocatedSourceSpan {
  readonly sourceBlockId: string | null;
  readonly segmentOrdinal: number | null;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  readonly status: 'exact' | 'ambiguous' | 'unlocated';
}

interface SegmentSourceRow {
  readonly source_block_id: string;
  readonly segment_ordinal: number;
  readonly source_text: string;
}

const occurrences = (source: string, excerpt: string) => {
  const offsets: number[] = [];
  let cursor = 0;
  while (excerpt && cursor <= source.length - excerpt.length) {
    const found = source.indexOf(excerpt, cursor);
    if (found < 0) break;
    offsets.push(found);
    cursor = found + Math.max(1, excerpt.length);
  }
  return offsets;
};

export const locateSourceSpan = (
  database: DatabaseSync,
  projectId: string,
  chapterId: string,
  excerpt: string,
  preferredSegment: number | null,
  preferredStartOffset: number | null,
): LocatedSourceSpan => {
  const normalized = excerpt.trim();
  if (!normalized) return { sourceBlockId: null, segmentOrdinal: null, startOffset: null, endOffset: null, status: 'unlocated' };
  const rows = database.prepare(`
    SELECT source_block_id, segment_ordinal, source_text
    FROM translation_segments
    WHERE project_id = ? AND chapter_id = ? AND instr(source_text, ?) > 0
    ORDER BY CASE WHEN segment_ordinal = ? THEN 0 ELSE 1 END, segment_ordinal
  `).all(projectId, chapterId, normalized, preferredSegment ?? -1) as unknown as SegmentSourceRow[];
  const matches = rows.flatMap((row) => occurrences(row.source_text, normalized).map((startOffset) => ({
    row, startOffset, endOffset: startOffset + normalized.length,
  })));
  if (preferredSegment !== null && preferredStartOffset !== null) {
    const exact = matches.find((match) => match.row.segment_ordinal === preferredSegment
      && match.startOffset === preferredStartOffset);
    if (exact) return {
      sourceBlockId: exact.row.source_block_id, segmentOrdinal: exact.row.segment_ordinal,
      startOffset: exact.startOffset, endOffset: exact.endOffset, status: 'exact',
    };
  }
  const preferredMatches = preferredSegment === null ? [] : matches.filter((match) => match.row.segment_ordinal === preferredSegment);
  const decisive = preferredMatches.length === 1 ? preferredMatches[0] : matches.length === 1 ? matches[0] : null;
  if (decisive) return {
    sourceBlockId: decisive.row.source_block_id, segmentOrdinal: decisive.row.segment_ordinal,
    startOffset: decisive.startOffset, endOffset: decisive.endOffset, status: 'exact',
  };
  if (matches.length) {
    const row = preferredMatches[0]?.row ?? matches[0].row;
    return { sourceBlockId: row.source_block_id, segmentOrdinal: row.segment_ordinal, startOffset: null, endOffset: null, status: 'ambiguous' };
  }
  const approximate = database.prepare(`
    SELECT source_block_id, segment_ordinal FROM translation_segments
    WHERE project_id = ? AND chapter_id = ?
      AND (segment_ordinal = ? OR instr(?, source_text) > 0)
    ORDER BY CASE WHEN segment_ordinal = ? THEN 0 ELSE 1 END, abs(length(source_text) - length(?)), segment_ordinal
    LIMIT 1
  `).get(projectId, chapterId, preferredSegment ?? -1, normalized, preferredSegment ?? -1, normalized) as {
    source_block_id: string; segment_ordinal: number;
  } | undefined;
  return {
    sourceBlockId: approximate?.source_block_id ?? null,
    segmentOrdinal: approximate?.segment_ordinal ?? null,
    startOffset: null,
    endOffset: null,
    status: 'unlocated',
  };
};

export const evidenceSpan = (database: DatabaseSync, evidenceId: string) => {
  const row = database.prepare(`
    SELECT segment_ordinal, source_start_offset, source_end_offset, locator_status
    FROM narrative_evidence WHERE evidence_id = ?
  `).get(evidenceId) as {
    segment_ordinal: number | null;
    source_start_offset: number | null;
    source_end_offset: number | null;
    locator_status: 'exact' | 'ambiguous' | 'unlocated';
  } | undefined;
  return row ? {
    segmentOrdinal: row.segment_ordinal,
    startOffset: row.source_start_offset,
    endOffset: row.source_end_offset,
    status: row.locator_status,
  } : { segmentOrdinal: null, startOffset: null, endOffset: null, status: 'unlocated' as const };
};

export const groundedOffset = (
  requestedChapter: number,
  requestedSegment: number | null | undefined,
  requestedOffset: number | null | undefined,
  evidenceChapter: number,
  evidenceSegment: number | null,
  evidenceOffset: number | null,
) => {
  if (Number.isInteger(requestedOffset) && Number(requestedOffset) >= 0) return Number(requestedOffset);
  if (requestedChapter !== evidenceChapter || evidenceSegment === null || (requestedSegment ?? null) !== evidenceSegment) return null;
  return evidenceOffset;
};

export const upsertNarrativeEvidence = (
  database: DatabaseSync,
  projectId: string,
  chapterId: string,
  chapterOrdinal: number,
  excerpt: string,
  timestamp: string,
  kind: 'direct' | 'inferred' | 'reviewer-corrected' | 'manual' = 'direct',
  preferredSegment: number | null = null,
  preferredStartOffset: number | null = null,
) => {
  const normalized = excerpt.trim();
  if (!normalized) return null;
  const located = locateSourceSpan(database, projectId, chapterId, normalized, preferredSegment, preferredStartOffset);
  const hash = createHash('sha256').update([
    located.segmentOrdinal ?? 'unknown', located.startOffset ?? preferredStartOffset ?? 'unknown', normalized,
  ].join('\u0000')).digest('hex');
  const existing = database.prepare(`
    SELECT evidence_id FROM narrative_evidence
    WHERE project_id = ? AND chapter_id = ? AND source_hash = ? AND evidence_kind = ?
  `).get(projectId, chapterId, hash, kind) as { evidence_id: string } | undefined;
  if (existing) return existing.evidence_id;
  const evidenceId = `narrative-evidence-${randomUUID()}`;
  database.prepare(`
    INSERT INTO narrative_evidence(evidence_id, project_id, chapter_id, chapter_ordinal, segment_ordinal,
      source_block_id, source_excerpt, source_hash, source_start_offset, source_end_offset, locator_status,
      evidence_kind, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(evidenceId, projectId, chapterId, chapterOrdinal, located.segmentOrdinal, located.sourceBlockId,
    normalized, hash, located.startOffset, located.endOffset, located.status, kind, timestamp);
  return evidenceId;
};
