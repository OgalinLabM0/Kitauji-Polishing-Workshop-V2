import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StorageDirectoryKind, StorageInfo } from '../../core/storage/models';

const readableError = (error: unknown) => error instanceof Error ? error.message : '存储信息暂时无法读取。';

export const useStorageSettings = () => {
  const api = window.kitaujiDesktop?.storage;
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(api));
  const [busy, setBusy] = useState<StorageDirectoryKind | 'clear' | 'backup' | 'restore' | 'restart' | 'factory-reset' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    if (!api) {
      setLoading(false);
      return () => { current = false; };
    }
    void api.info()
      .then((result) => current && setInfo(result))
      .catch((reason) => current && setError(readableError(reason)))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [api]);

  const choose = useCallback(async (kind: StorageDirectoryKind) => {
    if (!api || busy) return;
    setBusy(kind);
    setNotice(null);
    setError(null);
    try {
      const result = await api.chooseDirectory(kind);
      if (result.status === 'error') setError(result.message);
      if (result.status === 'saved') {
        setInfo(result.info);
        setNotice(kind === 'books' ? '默认书籍目录已保存。' : kind === 'exports' ? '默认导出目录已保存。' : kind === 'database' ? '数据库已经位于所选位置。' : '缓存位置已切换。');
      }
      if (result.status === 'restart-required') {
        setInfo(result.info);
        setNotice('数据库新位置已保存。重启后会迁移、校验并切换；失败时仍使用原数据库。');
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(null);
    }
  }, [api, busy]);

  const reset = useCallback(async (kind: StorageDirectoryKind) => {
    if (!api || busy) return;
    setBusy(kind);
    setNotice(null);
    setError(null);
    try {
      const result = await api.resetDirectory(kind);
      if (result.status === 'error') setError(result.message);
      if (result.status === 'saved') {
        setInfo(result.info);
        setNotice(kind === 'cache' ? '缓存位置已恢复系统默认。' : kind === 'database' ? '数据库已经位于系统默认位置。' : '已取消固定目录，文件窗口将使用系统位置。');
      }
      if (result.status === 'restart-required') {
        setInfo(result.info);
        setNotice('已安排迁回系统默认数据库位置，重启后执行安全迁移。');
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(null);
    }
  }, [api, busy]);

  const clearCache = useCallback(async () => {
    if (!api || busy) return;
    setBusy('clear');
    setNotice(null);
    setError(null);
    try {
      const result = await api.clearCache();
      if (result.status === 'error') setError(result.message);
      if (result.status === 'cleared') {
        setInfo(result.info);
        setNotice(`缓存已清理：${result.removedFileCount.toLocaleString()} 个文件。原书、草稿和阅读进度未受影响。`);
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(null);
    }
  }, [api, busy]);

  const backupDatabase = useCallback(async () => {
    if (!api || busy) return;
    setBusy('backup');
    setNotice(null);
    setError(null);
    try {
      const result = await api.backupDatabase();
      if (result.status === 'error') setError(result.message);
      if (result.status === 'saved') {
        setNotice(`整库备份已校验并保存：${result.projectCount.toLocaleString()} 个项目，schema v${result.schemaVersion}。位置：${result.path}`);
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(null);
    }
  }, [api, busy]);

  const restoreDatabase = useCallback(async () => {
    if (!api || busy) return;
    setBusy('restore');
    setNotice(null);
    setError(null);
    try {
      const result = await api.restoreDatabase();
      if (result.status === 'error') setError(result.message);
      if (result.status === 'restart-required') {
        setInfo(result.info);
        setNotice(`备份已校验：${result.sourceFileName}（${result.projectCount.toLocaleString()} 个项目，schema v${result.schemaVersion}）。重启后恢复，当前库会先自动留存安全副本。`);
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(null);
    }
  }, [api, busy]);

  const restartForDatabaseMove = useCallback(async () => {
    if (!api || busy) return;
    setBusy('restart');
    setError(null);
    try { await api.restartForDatabaseMove(); }
    catch (reason) { setError(readableError(reason)); setBusy(null); }
  }, [api, busy]);

  const factoryReset = useCallback(async () => {
    if (!api || busy) return;
    setBusy('factory-reset');
    setNotice(null);
    setError(null);
    try {
      const result = await api.factoryReset();
      if (result.status === 'error') {
        setError(result.message);
        setBusy(null);
      }
    } catch (reason) {
      setError(readableError(reason));
      setBusy(null);
    }
  }, [api, busy]);

  return useMemo(() => ({ available: Boolean(api), info, loading, busy, notice, error, choose, reset, clearCache, backupDatabase, restoreDatabase, restartForDatabaseMove, factoryReset }), [api, info, loading, busy, notice, error, choose, reset, clearCache, backupDatabase, restoreDatabase, restartForDatabaseMove, factoryReset]);
};
