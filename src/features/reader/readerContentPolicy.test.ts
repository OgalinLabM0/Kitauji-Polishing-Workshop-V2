import { describe, expect, it } from 'vitest';
import type { WorkbenchSegment } from '../../core/workflow/models';
import { MISSING_FINAL_TEXT, mergeReaderSegments, readerModeNotice, readerSegmentPresentation } from './readerContentPolicy';

const segment = (overrides: Partial<WorkbenchSegment> = {}): WorkbenchSegment => ({
  segmentId: 's1', chapterId: 'c1', chapterOrdinal: 1, segmentOrdinal: 1,
  sourceText: '原文です。', originalTranslation: null, selectedTranslation: null,
  status: 'pending', versionCount: 0, openReviewCount: 0, ...overrides,
});

describe('reader content policy', () => {
  it('never substitutes source text for a missing final translation', () => {
    expect(readerSegmentPresentation(segment(), 'final')).toMatchObject({
      primaryText: MISSING_FINAL_TEXT, missingTranslation: true,
    });
  });

  it('always returns the Japanese source in source mode', () => {
    expect(readerSegmentPresentation(segment({ selectedTranslation: '现有译文' }), 'source').primaryText).toBe('原文です。');
  });

  it('reports unavailable and partially unavailable translations', () => {
    expect(readerModeNotice([segment()], 'bilingual')).toContain('尚未生成润色定稿');
    expect(readerModeNotice([segment({ selectedTranslation: '译文' }), segment({ segmentId: 's2' })], 'final')).toContain('1 段');
    expect(readerModeNotice([segment({ originalTranslation: '旧译' })], 'original')).toBeNull();
  });

  it('builds untranslated segments and removes only a paired Chinese source block', () => {
    const blocks = [
      { blockId: 'jp-1', ordinal: 1, sourceLine: null, tagName: 'p', language: 'ja', scriptKind: 'japanese' as const, sourceText: '敵だ。', styleHint: null, pairedOrdinal: 2, draftText: null, canEdit: true, editRestriction: null },
      { blockId: 'cn-1', ordinal: 2, sourceLine: null, tagName: 'p', language: 'zh', scriptKind: 'chinese' as const, sourceText: '是敌人。', styleHint: null, pairedOrdinal: 1, draftText: null, canEdit: true, editRestriction: null },
      { blockId: 'jp-2', ordinal: 3, sourceLine: null, tagName: 'p', language: 'ja', scriptKind: 'japanese' as const, sourceText: '進め。', styleHint: null, pairedOrdinal: null, draftText: null, canEdit: true, editRestriction: null },
    ];
    expect(mergeReaderSegments(blocks, [], 'chapter-1', 1)).toMatchObject([
      { sourceBlockId: 'jp-1', targetBlockId: 'cn-1', originalTranslation: '是敌人。', selectedTranslation: null },
      { sourceBlockId: 'jp-2', targetBlockId: null, originalTranslation: null, selectedTranslation: null },
    ]);
  });
});
