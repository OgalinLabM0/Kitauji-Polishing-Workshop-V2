import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StartWorkflowInput, WorkflowOverview, WorkflowTaskSummary } from '../../core/workflow/models';

const activeStatuses = new Set(['pending', 'running', 'pausing', 'paused', 'interrupted']);

export const useWorkflowOverview = (projectId: string | null) => {
  const api = window.kitaujiDesktop?.workflow;
  const [overview, setOverview] = useState<WorkflowOverview | null>(null);
  const [loading, setLoading] = useState(Boolean(api && projectId));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!api || !projectId) return;
    if (!quiet) setLoading(true);
    try { setOverview(await api.overview(projectId)); setError(null); }
    catch (reason) { if (!quiet) setError(reason instanceof Error ? reason.message : '无法读取任务状态。'); }
    finally { if (!quiet) setLoading(false); }
  }, [api, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!api || !projectId) return;
    const needsPolling = overview?.tasks.some((task) => ['pending', 'running', 'pausing'].includes(task.status));
    if (!needsPolling) return;
    const timer = window.setInterval(() => void refresh(true), 1_500);
    return () => window.clearInterval(timer);
  }, [api, projectId, overview, refresh]);

  const operation = useCallback(async (key: string, action: () => Promise<{ status: 'ok'; data: WorkflowTaskSummary } | { status: 'error'; message: string }>, success: string) => {
    setBusy(key); setError(null); setNotice(null);
    try {
      const result = await action();
      if (result.status === 'error') { setError(result.message); return null; }
      setNotice(success); await refresh(true); return result.data;
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务操作失败。'); return null; }
    finally { setBusy(null); }
  }, [refresh]);

  const start = useCallback((taskType: StartWorkflowInput['taskType'], options?: Omit<StartWorkflowInput, 'projectId' | 'taskType'>) => {
    if (!api || !projectId) return Promise.resolve(null);
    const label = taskType === 'pre-read' ? '全书预读' : taskType === 'translate' ? '翻译 / 润色' : '独立复核';
    return operation(`start:${taskType}`, () => api.start({ projectId, taskType, ...options }), `${label}任务已经开始。`);
  }, [api, operation, projectId]);
  const pause = useCallback((taskId: string) => api ? operation(`pause:${taskId}`, () => api.pause(taskId), '正在安全暂停；当前请求取消后会保存进度。') : Promise.resolve(null), [api, operation]);
  const resume = useCallback((taskId: string) => api ? operation(`resume:${taskId}`, () => api.resume(taskId), '任务已从断点继续。') : Promise.resolve(null), [api, operation]);
  const retryFailed = useCallback((taskId: string) => api ? operation(`retry:${taskId}`, () => api.retryFailed(taskId), '已重置失败项目并重新开始执行。') : Promise.resolve(null), [api, operation]);
  const cancel = useCallback((taskId: string) => api ? operation(`cancel:${taskId}`, () => api.cancel(taskId), '任务已取消，已完成结果仍保留。') : Promise.resolve(null), [api, operation]);

  const activeTasks = useMemo(() => {
    const tasks = overview?.tasks ?? [];
    return tasks.filter((task, index) => activeStatuses.has(task.status)
      || index === 0 && task.status === 'failed' && task.failedItems > 0);
  }, [overview]);
  return { available: Boolean(api), overview, activeTasks, loading, busy, error, notice, refresh, start, pause, resume, retryFailed, cancel };
};
