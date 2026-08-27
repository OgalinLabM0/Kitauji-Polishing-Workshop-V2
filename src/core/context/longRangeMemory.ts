import type { Confidence } from '../domain/models';

export type NarrativeMemoryKind =
  | 'plot-event'
  | 'character-state'
  | 'relationship-event'
  | 'address-trajectory'
  | 'voice-profile'
  | 'point-of-view'
  | 'era-and-world'
  | 'place-alias'
  | 'wordplay-decision'
  | 'chapter-emotion'
  | 'foreshadowing'
  | 'secret'
  | 'unresolved-question';

export interface DirectedRelationRef {
  readonly fromCharacterId: string;
  readonly toCharacterId: string;
}

export interface CharacterKnowledgeEntry {
  readonly characterId: string;
  readonly knownFromParagraphOrdinal: number;
  readonly state: 'knows' | 'believes' | 'suspects' | 'denies';
}

export interface NarrativeMemoryRecord {
  readonly memoryId: string;
  readonly kind: NarrativeMemoryKind;
  readonly summary: string;
  readonly validFromParagraphOrdinal: number;
  readonly validToParagraphOrdinal?: number;
  readonly revealedToReaderAtParagraphOrdinal?: number;
  readonly mayInformWithoutLeaking: boolean;
  readonly characterIds: readonly string[];
  readonly directedRelation?: DirectedRelationRef;
  readonly chapterIds: readonly string[];
  readonly sceneIds: readonly string[];
  readonly termIds: readonly string[];
  readonly characterKnowledge: readonly CharacterKnowledgeEntry[];
  readonly evidenceIds: readonly string[];
  readonly confidence: Confidence;
}

export interface LongRangeMemoryRequest {
  readonly paragraphOrdinal: number;
  readonly chapterId: string;
  readonly sceneId?: string;
  readonly characterIds: readonly string[];
  readonly directedRelation?: DirectedRelationRef;
  readonly termIds: readonly string[];
  readonly purpose: 'translate' | 'scene-analysis' | 'trajectory-review';
  readonly limits: {
    readonly readerSafe: number;
    readonly translatorOnly: number;
    readonly perCharacterKnowledge: number;
    readonly unresolved: number;
  };
}

export interface RestrictedNarrativeMemory {
  readonly record: NarrativeMemoryRecord;
  readonly mayGuideInterpretation: true;
  readonly maySurfaceInTranslation: false;
}

export interface LongRangeMemoryPack {
  readonly readerSafe: readonly NarrativeMemoryRecord[];
  readonly translatorOnly: readonly RestrictedNarrativeMemory[];
  readonly characterKnowledgeById: Readonly<Record<string, readonly NarrativeMemoryRecord[]>>;
  readonly unresolved: readonly NarrativeMemoryRecord[];
  readonly retrievalRule: 'entity-relation-time-first';
  readonly memoryCannotAuthorizeSourceAbsentText: true;
}

const HISTORY_BEARING_KINDS = new Set<NarrativeMemoryKind>([
  'plot-event',
  'relationship-event',
  'address-trajectory',
  'wordplay-decision',
  'foreshadowing',
]);

const GLOBAL_MEMORY_KINDS = new Set<NarrativeMemoryKind>([
  'point-of-view',
  'era-and-world',
  'chapter-emotion',
]);

/**
 * 从完整作品记忆中选出小而相关的长期记忆包。检索先看实体、关系方向、剧情时间、
 * 场景和术语，再排序限量；未来秘密只能进入 translatorOnly，永远不能成为补写授权。
 */
export function buildLongRangeMemoryPack(
  records: readonly NarrativeMemoryRecord[],
  request: LongRangeMemoryRequest,
): LongRangeMemoryPack {
  const ranked = records
    .map((record) => ({
      record,
      score: relevanceScore(record, request),
    }))
    .filter(({ record, score }) => score > 0 && isTemporallyRelevant(record, request))
    .sort((left, right) => right.score - left.score || left.record.memoryId.localeCompare(right.record.memoryId));

  const unresolved = take(
    ranked
      .filter(({ record }) =>
        record.confidence === 'low' ||
        record.confidence === 'unknown' ||
        record.kind === 'unresolved-question' ||
        record.evidenceIds.length === 0,
      )
      .map(({ record }) => record),
    request.limits.unresolved,
  );
  const unresolvedIds = new Set(unresolved.map((record) => record.memoryId));

  const readerSafe = take(
    ranked
      .map(({ record }) => record)
      .filter(
        (record) =>
          !unresolvedIds.has(record.memoryId) &&
          isReaderSafeAt(record, request.paragraphOrdinal),
      ),
    request.limits.readerSafe,
  );

  const readerSafeIds = new Set(readerSafe.map((record) => record.memoryId));
  const translatorOnly = take(
    ranked
      .map(({ record }) => record)
      .filter(
        (record) =>
          !unresolvedIds.has(record.memoryId) &&
          !readerSafeIds.has(record.memoryId) &&
          record.mayInformWithoutLeaking,
      )
      .map((record) => ({
        record,
        mayGuideInterpretation: true as const,
        maySurfaceInTranslation: false as const,
      })),
    request.limits.translatorOnly,
  );

  const characterKnowledgeById = Object.fromEntries(
    request.characterIds.map((characterId) => [
      characterId,
      take(
        ranked
          .map(({ record }) => record)
          .filter(
            (record) =>
              !unresolvedIds.has(record.memoryId) &&
              record.characterKnowledge.some(
                (entry) =>
                  entry.characterId === characterId &&
                  entry.knownFromParagraphOrdinal <= request.paragraphOrdinal,
              ),
          ),
        request.limits.perCharacterKnowledge,
      ),
    ]),
  );

  return {
    readerSafe,
    translatorOnly,
    characterKnowledgeById,
    unresolved,
    retrievalRule: 'entity-relation-time-first',
    memoryCannotAuthorizeSourceAbsentText: true,
  };
}

function relevanceScore(
  record: NarrativeMemoryRecord,
  request: LongRangeMemoryRequest,
): number {
  let score = 0;

  if (request.sceneId !== undefined && record.sceneIds.includes(request.sceneId)) {
    score += 120;
  }
  if (
    request.directedRelation !== undefined &&
    record.directedRelation?.fromCharacterId === request.directedRelation.fromCharacterId &&
    record.directedRelation.toCharacterId === request.directedRelation.toCharacterId
  ) {
    score += 100;
  }
  score += intersectionCount(record.termIds, request.termIds) * 80;
  if (record.chapterIds.includes(request.chapterId)) {
    score += 50;
  }
  score += intersectionCount(record.characterIds, request.characterIds) * 25;
  if (GLOBAL_MEMORY_KINDS.has(record.kind) && record.characterIds.length === 0) {
    score += 10;
  }

  if (
    record.validFromParagraphOrdinal <= request.paragraphOrdinal &&
    (record.validToParagraphOrdinal === undefined ||
      record.validToParagraphOrdinal >= request.paragraphOrdinal)
  ) {
    score += 30;
  } else if (record.validFromParagraphOrdinal <= request.paragraphOrdinal) {
    score += 10;
  } else if (record.mayInformWithoutLeaking) {
    score += 2;
  }

  return score;
}

function isTemporallyRelevant(
  record: NarrativeMemoryRecord,
  request: LongRangeMemoryRequest,
): boolean {
  if (record.validFromParagraphOrdinal > request.paragraphOrdinal) {
    return record.mayInformWithoutLeaking;
  }
  if (
    record.validToParagraphOrdinal === undefined ||
    record.validToParagraphOrdinal >= request.paragraphOrdinal
  ) {
    return true;
  }
  return request.purpose === 'trajectory-review' || HISTORY_BEARING_KINDS.has(record.kind);
}

function isReaderSafeAt(record: NarrativeMemoryRecord, paragraphOrdinal: number): boolean {
  return (
    record.validFromParagraphOrdinal <= paragraphOrdinal &&
    record.revealedToReaderAtParagraphOrdinal !== undefined &&
    record.revealedToReaderAtParagraphOrdinal <= paragraphOrdinal
  );
}

function intersectionCount(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((item) => rightSet.has(item))).size;
}

function take<T>(items: readonly T[], rawLimit: number): readonly T[] {
  return items.slice(0, Math.max(0, Math.trunc(rawLimit)));
}
