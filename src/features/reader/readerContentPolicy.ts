import type { WorkbenchSegment } from '../../core/workflow/models';
import type { ChapterContentBlock } from '../../core/projects/models';

export type ReaderMode = 'final' | 'bilingual' | 'source' | 'original';

export const MISSING_FINAL_TEXT = '〔本段尚无润色定稿〕';
export const MISSING_ORIGINAL_TEXT = '〔本段没有既有译文〕';

export interface ReaderSegmentPresentation {
  readonly primaryText: string;
  readonly sourceText: string;
  readonly missingTranslation: boolean;
}

const nonEmpty = (value: string | null | undefined) => value?.trim() || null;

export const readerSegmentPresentation = (
  segment: WorkbenchSegment,
  mode: ReaderMode,
): ReaderSegmentPresentation => {
  const selected = nonEmpty(segment.selectedTranslation);
  const original = nonEmpty(segment.originalTranslation);
  if (mode === 'source') {
    return { primaryText: segment.sourceText, sourceText: segment.sourceText, missingTranslation: false };
  }
  if (mode === 'original') {
    return {
      primaryText: original ?? MISSING_ORIGINAL_TEXT,
      sourceText: segment.sourceText,
      missingTranslation: original === null,
    };
  }
  return {
    primaryText: selected ?? MISSING_FINAL_TEXT,
    sourceText: segment.sourceText,
    missingTranslation: selected === null,
  };
};

export const readerModeNotice = (segments: readonly WorkbenchSegment[], mode: ReaderMode) => {
  if (!segments.length) return '当前章节没有可显示的正文段落。';
  if (mode === 'source') return null;
  const available = mode === 'original'
    ? segments.filter((segment) => nonEmpty(segment.originalTranslation)).length
    : segments.filter((segment) => nonEmpty(segment.selectedTranslation)).length;
  if (available === segments.length) return null;
  const missing = segments.length - available;
  if (mode === 'original') {
    return available === 0
      ? '本章没有随原书导入的既有译文；页面会明确显示“没有既有译文”，不会拿其他文本冒充。'
      : `本章有 ${missing} 段没有既有译文，缺失位置已明确标注。`;
  }
  if (mode === 'bilingual') {
    return available === 0
      ? '本章尚未生成润色定稿；双语模式只显示真实日文，并在中文位置标明缺失。'
      : `本章有 ${missing} 段尚无润色定稿；双语模式不会用日文冒充中文译文。`;
  }
  return available === 0
    ? '本章尚未生成润色定稿；当前页面只显示缺失标记，请切换“日文原著”阅读原文。'
    : `本章有 ${missing} 段尚无润色定稿，未完成位置已明确标注。`;
};

export const mergeReaderSegments = (
  blocks: readonly ChapterContentBlock[],
  translated: readonly WorkbenchSegment[],
  chapterId: string,
  chapterOrdinal: number,
): readonly WorkbenchSegment[] => {
  const blockByOrdinal = new Map(blocks.map((block) => [block.ordinal, block]));
  const translatedByBlock = new Map(
    translated.flatMap((segment) => segment.sourceBlockId ? [[segment.sourceBlockId, segment] as const] : []),
  );
  const translatedByOrdinal = new Map(translated.map((segment) => [segment.segmentOrdinal, segment]));

  return blocks.flatMap((block): WorkbenchSegment[] => {
    const pair = block.pairedOrdinal === null ? null : blockByOrdinal.get(block.pairedOrdinal) ?? null;
    if (block.scriptKind === 'chinese' && pair?.scriptKind === 'japanese') return [];
    const existing = translatedByBlock.get(block.blockId) ?? translatedByOrdinal.get(block.ordinal);
    const pairedTranslation = pair?.scriptKind === 'chinese' ? pair.sourceText : null;
    if (existing) {
      return [{
        ...existing,
        sourceBlockId: existing.sourceBlockId ?? block.blockId,
        targetBlockId: existing.targetBlockId ?? (pair?.scriptKind === 'chinese' ? pair.blockId : null),
        tagName: existing.tagName ?? block.tagName,
        originalTranslation: existing.originalTranslation ?? pairedTranslation,
      }];
    }
    return [{
      segmentId: block.blockId,
      chapterId,
      chapterOrdinal,
      segmentOrdinal: block.ordinal,
      sourceBlockId: block.blockId,
      targetBlockId: pair?.scriptKind === 'chinese' ? pair.blockId : null,
      tagName: block.tagName,
      sourceText: block.sourceText,
      originalTranslation: pairedTranslation,
      selectedTranslation: block.draftText,
      status: 'pending',
      versionCount: block.draftText ? 1 : 0,
      openReviewCount: 0,
    }];
  });
};
