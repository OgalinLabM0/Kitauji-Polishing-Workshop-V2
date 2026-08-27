import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExportEpubResult,
  ProjectChapterContent,
  ProjectSnapshot,
  SaveBlockDraftResult,
} from '../../core/projects/models';

const PAGE_SIZE = 120;
const readableError = (error: unknown) => error instanceof Error ? error.message : '正文暂时无法读取。';

export const useChapterReader = (snapshot: ProjectSnapshot | null) => {
  const api = window.kitaujiDesktop?.projects;
  const [content, setContent] = useState<ProjectChapterContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [draftCount, setDraftCount] = useState(snapshot?.epubDraftCount ?? 0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openPage = useCallback(async (chapterId: string, offset = 0) => {
    if (!api || !snapshot) return;
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      const loaded = await api.readChapter(snapshot.project.projectId, chapterId, offset, PAGE_SIZE);
      if (!loaded) {
        setError('没有找到这个阅读项。');
        return;
      }
      setContent(loaded);
      const firstOrdinal = loaded.blocks[0]?.ordinal ?? 1;
      void api.saveReadingPosition(snapshot.project.projectId, chapterId, firstOrdinal);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
    }
  }, [api, snapshot]);

  useEffect(() => {
    setContent(null);
    setDraftCount(snapshot?.epubDraftCount ?? 0);
    setNotice(null);
    setError(null);
    if (!snapshot || snapshot.chapters.length === 0) return;
    const remembered = snapshot.readingPosition;
    const firstReadable = snapshot.chapters.find((chapter) => chapter.paragraphCount > 0 && !chapter.isNavigation)
      ?? snapshot.chapters.find((chapter) => chapter.paragraphCount > 0)
      ?? snapshot.chapters[0];
    const chapterId = remembered && snapshot.chapters.some((chapter) => chapter.chapterId === remembered.chapterId)
      ? remembered.chapterId
      : firstReadable.chapterId;
    const offset = remembered?.chapterId === chapterId
      ? Math.floor(Math.max(0, remembered.blockOrdinal - 1) / PAGE_SIZE) * PAGE_SIZE
      : 0;
    void openPage(chapterId, offset);
  }, [snapshot?.project.projectId, openPage]);

  const saveDraft = useCallback(async (blockId: string, draftText: string | null): Promise<SaveBlockDraftResult> => {
    if (!api || !snapshot) return { status: 'error', message: '请从桌面程序进入。' };
    setSavingBlockId(blockId);
    setNotice(null);
    setError(null);
    const before = content?.blocks.find((block) => block.blockId === blockId)?.draftText ?? null;
    try {
      const result = await api.saveBlockDraft(snapshot.project.projectId, blockId, draftText);
      if (result.status === 'error') {
        setError(result.message);
        return result;
      }
      setContent((current) => current ? {
        ...current,
        blocks: current.blocks.map((block) => block.blockId === blockId ? { ...block, draftText: result.draftText } : block),
      } : current);
      if (before === null && result.draftText !== null) setDraftCount((count) => count + 1);
      if (before !== null && result.draftText === null) setDraftCount((count) => Math.max(0, count - 1));
      setNotice(result.draftText === null ? '已恢复这一段的原中文。' : '校改已保存。');
      return result;
    } catch (reason) {
      const message = readableError(reason);
      setError(message);
      return { status: 'error', message };
    } finally {
      setSavingBlockId(null);
    }
  }, [api, snapshot, content]);

  const exportEpub = useCallback(async (): Promise<ExportEpubResult> => {
    if (!api || !snapshot) return { status: 'error', message: '请从桌面程序进入。' };
    setExporting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.exportEpub(snapshot.project.projectId);
      if (result.status === 'error') setError(result.message);
      if (result.status === 'exported') {
        setNotice(`校样已导出：${result.outputPath}`);
      }
      return result;
    } catch (reason) {
      const message = readableError(reason);
      setError(message);
      return { status: 'error', message };
    } finally {
      setExporting(false);
    }
  }, [api, snapshot]);

  return useMemo(() => ({
    content,
    loading,
    savingBlockId,
    exporting,
    draftCount,
    notice,
    error,
    openPage,
    saveDraft,
    exportEpub,
    pageSize: PAGE_SIZE,
  }), [content, loading, savingBlockId, exporting, draftCount, notice, error, openPage, saveDraft, exportEpub]);
};
