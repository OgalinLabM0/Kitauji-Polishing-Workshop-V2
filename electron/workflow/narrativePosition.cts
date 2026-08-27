export interface NarrativePosition {
  readonly chapter: number;
  readonly segment: number | null;
  readonly offset?: number | null;
}

export const normalizedSegment = (segment: number | null | undefined, fallback: number) =>
  segment === null || segment === undefined ? fallback : Math.max(1, Math.floor(segment));

export const comparePosition = (left: NarrativePosition, right: NarrativePosition) => {
  if (left.chapter !== right.chapter) return left.chapter - right.chapter;
  const segmentDifference = normalizedSegment(left.segment, 1) - normalizedSegment(right.segment, 1);
  if (segmentDifference) return segmentDifference;
  const leftOffset = left.offset === null || left.offset === undefined ? 0 : Math.max(0, Math.floor(left.offset));
  const rightOffset = right.offset === null || right.offset === undefined ? 0 : Math.max(0, Math.floor(right.offset));
  return leftOffset - rightOffset;
};

export const positionAtOrBefore = (left: NarrativePosition, right: NarrativePosition) => comparePosition(left, right) <= 0;

export const previousPosition = (position: NarrativePosition): NarrativePosition => {
  const segment = normalizedSegment(position.segment, 1);
  const offset = position.offset === null || position.offset === undefined ? null : Math.max(0, Math.floor(position.offset));
  if (offset !== null && offset > 0) return { chapter: position.chapter, segment, offset: offset - 1 };
  if (segment > 1) return { chapter: position.chapter, segment: segment - 1 };
  return { chapter: Math.max(1, position.chapter - 1), segment: null };
};

export const POSITION_SQL = {
  startsBy: (chapterColumn: string, segmentColumn: string) =>
    `(${chapterColumn} < ? OR (${chapterColumn} = ? AND COALESCE(${segmentColumn}, 1) <= ?))`,
  endsAfter: (chapterColumn: string, segmentColumn: string) =>
    `(${chapterColumn} IS NULL OR ${chapterColumn} > ? OR (${chapterColumn} = ? AND COALESCE(${segmentColumn}, 2147483647) >= ?))`,
  startsAfter: (chapterColumn: string, segmentColumn: string) =>
    `(${chapterColumn} > ? OR (${chapterColumn} = ? AND COALESCE(${segmentColumn}, 1) > ?))`,
  startsByOffset: (chapterColumn: string, segmentColumn: string, offsetColumn: string) =>
    `(${chapterColumn} < ? OR (${chapterColumn} = ? AND (COALESCE(${segmentColumn}, 1) < ? OR (COALESCE(${segmentColumn}, 1) = ? AND COALESCE(${offsetColumn}, 0) <= ?))))`,
  endsAfterOffset: (chapterColumn: string, segmentColumn: string, offsetColumn: string) =>
    `(${chapterColumn} IS NULL OR ${chapterColumn} > ? OR (${chapterColumn} = ? AND (COALESCE(${segmentColumn}, 2147483647) > ? OR (COALESCE(${segmentColumn}, 2147483647) = ? AND COALESCE(${offsetColumn}, 2147483647) >= ?))))`,
  startsAfterOffset: (chapterColumn: string, segmentColumn: string, offsetColumn: string) =>
    `(${chapterColumn} > ? OR (${chapterColumn} = ? AND (COALESCE(${segmentColumn}, 1) > ? OR (COALESCE(${segmentColumn}, 1) = ? AND COALESCE(${offsetColumn}, 0) > ?))))`,
} as const;
