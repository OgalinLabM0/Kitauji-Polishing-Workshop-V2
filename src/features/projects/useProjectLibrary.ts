import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectSnapshot, ProjectSummary } from '../../core/projects/models';

export interface ProjectLibrary {
  readonly available: boolean;
  readonly loading: boolean;
  readonly importing: boolean;
  readonly mutating: boolean;
  readonly projects: readonly ProjectSummary[];
  readonly activeProject: ProjectSnapshot | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly importSource: () => Promise<void>;
  readonly openProject: (projectId: string) => Promise<void>;
  readonly deleteProject: (projectId: string) => Promise<boolean>;
  readonly clearProjects: () => Promise<boolean>;
}

const readableError = (error: unknown) => error instanceof Error ? error.message : '项目库暂时无法读取。';

export const useProjectLibrary = (): ProjectLibrary => {
  const api = window.kitaujiDesktop?.projects;
  const [loading, setLoading] = useState(Boolean(api));
  const [importing, setImporting] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    if (!api) {
      setLoading(false);
      return () => { current = false; };
    }

    void Promise.all([api.list(), api.getActive()])
      .then(([projectList, active]) => {
        if (!current) return;
        setProjects(projectList);
        setActiveProject(active);
      })
      .catch((reason) => current && setError(readableError(reason)))
      .finally(() => current && setLoading(false));

    return () => { current = false; };
  }, [api]);

  const importSource = useCallback(async () => {
    if (!api || importing) return;
    setImporting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.importSource();
      if (result.status === 'cancelled') return;
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      const refreshed = await api.list();
      setProjects(refreshed);
      setActiveProject(result.snapshot);
      setNotice(result.duplicate ? '已打开项目库中相同的原文。' : '作品已安全导入，并保存原文件快照。');
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setImporting(false);
    }
  }, [api, importing]);

  const openProject = useCallback(async (projectId: string) => {
    if (!api) return;
    setNotice(null);
    setError(null);
    try {
      const opened = await api.open(projectId);
      if (!opened) {
        setError('没有找到这个作品。');
        return;
      }
      setActiveProject(opened);
      setProjects(await api.list());
    } catch (reason) {
      setError(readableError(reason));
    }
  }, [api]);

  const deleteProject = useCallback(async (projectId: string) => {
    if (!api || mutating) return false;
    setMutating(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.delete(projectId);
      if (result.status === 'error') {
        setError(result.message);
        return false;
      }
      if (result.status === 'not-found') {
        setError('这部作品已经不在书架中。');
        return false;
      }
      setProjects(await api.list());
      setActiveProject(result.activeProject);
      setNotice(`已从书架删除《${result.deletedTitle}》；原 EPUB/TXT 文件没有删除。`);
      return true;
    } catch (reason) {
      setError(readableError(reason));
      return false;
    } finally {
      setMutating(false);
    }
  }, [api, mutating]);

  const clearProjects = useCallback(async () => {
    if (!api || mutating) return false;
    setMutating(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.clear();
      if (result.status === 'error') {
        setError(result.message);
        return false;
      }
      setProjects([]);
      setActiveProject(null);
      setNotice(`书架已清空，共移除 ${result.deletedCount.toLocaleString()} 个项目；原 EPUB/TXT 文件没有删除。`);
      return true;
    } catch (reason) {
      setError(readableError(reason));
      return false;
    } finally {
      setMutating(false);
    }
  }, [api, mutating]);

  return useMemo(() => ({
    available: Boolean(api),
    loading,
    importing,
    mutating,
    projects,
    activeProject,
    notice,
    error,
    importSource,
    openProject,
    deleteProject,
    clearProjects,
  }), [api, loading, importing, mutating, projects, activeProject, notice, error, importSource, openProject, deleteProject, clearProjects]);
};
