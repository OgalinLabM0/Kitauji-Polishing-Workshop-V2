import { describe, expect, it } from 'vitest';
import { getExportReadiness } from './exportReadiness';

describe('getExportReadiness', () => {
  it('blocks an empty project instead of treating zero as complete', () => {
    expect(getExportReadiness({ segmentCounts: {}, openReviewCount: 0 })).toMatchObject({
      total: 0,
      percentage: 0,
      isReady: false,
      reason: '当前项目还没有可导出的译文段落。',
    });
  });

  it('blocks unfinished segments and open review items', () => {
    expect(getExportReadiness({ segmentCounts: { approved: 8, translated: 2 }, openReviewCount: 1 })).toMatchObject({
      total: 10,
      remaining: 2,
      percentage: 80,
      isReady: false,
    });
  });

  it('allows export only when every segment is approved and review is clear', () => {
    expect(getExportReadiness({ segmentCounts: { approved: 10 }, openReviewCount: 0 })).toMatchObject({
      total: 10,
      remaining: 0,
      percentage: 100,
      isReady: true,
      reason: null,
    });
  });
});
