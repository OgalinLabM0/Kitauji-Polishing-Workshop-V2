export interface ExportReadinessInput {
  readonly segmentCounts: Readonly<Record<string, number>>;
  readonly openReviewCount: number;
}

export const getExportReadiness = ({ segmentCounts, openReviewCount }: ExportReadinessInput) => {
  const total = Object.values(segmentCounts).reduce((sum, value) => sum + value, 0);
  const approved = segmentCounts.approved ?? 0;
  const remaining = Math.max(0, total - approved);
  const isReady = total > 0 && remaining === 0 && openReviewCount === 0;
  const reason = total === 0
    ? '当前项目还没有可导出的译文段落。'
    : remaining > 0
      ? `还有 ${remaining.toLocaleString()} 个段落未定稿。`
      : openReviewCount > 0
        ? `还有 ${openReviewCount.toLocaleString()} 个复核项未处理。`
        : null;
  return {
    total,
    approved,
    remaining,
    openReviewCount,
    percentage: total > 0 ? Math.round((approved / total) * 100) : 0,
    isReady,
    reason,
  } as const;
};
