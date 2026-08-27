import { useCallback, useEffect, useState } from 'react';
import type { ProviderConnectionResult, ProviderSettingsSnapshot, SaveProviderProfileInput } from '../../core/providers/models';

type BusyAction = 'save' | 'active' | 'key' | 'delete' | 'models' | 'test' | null;

export const useProviderSettings = () => {
  const api = window.kitaujiDesktop?.providers;
  const [snapshot, setSnapshot] = useState<ProviderSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(api));
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<ProviderConnectionResult | null>(null);
  const [models, setModels] = useState<readonly string[]>([]);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try { setSnapshot(await api.get()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取模型服务设置。'); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async <T,>(action: Exclude<BusyAction, null>, operation: () => Promise<{ status: 'ok'; data: T } | { status: 'error'; message: string }>) => {
    setBusy(action); setError(null); setNotice(null); setConnection(null);
    try {
      const result = await operation();
      if (result.status === 'error') { setError(result.message); return null; }
      return result.data;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型服务操作失败。');
      return null;
    } finally { setBusy(null); }
  }, []);

  const save = useCallback(async (input: SaveProviderProfileInput) => {
    if (!api) return false;
    const next = await run('save', () => api.save(input));
    if (!next) return false;
    setSnapshot(next); setNotice('模型服务设置已保存。'); return true;
  }, [api, run]);

  const setActive = useCallback(async (profileId: string) => {
    if (!api) return;
    const next = await run('active', () => api.setActive(profileId));
    if (next) { setSnapshot(next); setNotice('已设为当前任务使用的服务。'); }
  }, [api, run]);

  const clearApiKey = useCallback(async (profileId: string) => {
    if (!api) return;
    const next = await run('key', () => api.clearApiKey(profileId));
    if (next) { setSnapshot(next); setNotice('已删除这个配置保存的 API Key。'); }
  }, [api, run]);

  const deleteProfile = useCallback(async (profileId: string) => {
    if (!api) return false;
    const next = await run('delete', () => api.delete(profileId));
    if (!next) return false;
    setSnapshot(next); setNotice('模型服务配置已删除。'); return true;
  }, [api, run]);

  const listModels = useCallback(async (profileId: string) => {
    if (!api) return;
    const next = await run('models', () => api.listModels(profileId));
    if (next) { setModels(next); setNotice(next.length ? `读取到 ${next.length} 个模型。` : '服务没有返回可用模型列表，可继续手动填写。'); }
  }, [api, run]);

  const test = useCallback(async (profileId: string) => {
    if (!api) return;
    setBusy('test'); setError(null); setNotice(null); setConnection(null);
    try {
      const result = await api.test(profileId);
      setConnection(result);
      setSnapshot(await api.get());
      if (result.status === 'error') setError(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '连接测试失败。'); }
    finally { setBusy(null); }
  }, [api]);

  return { available: Boolean(api), snapshot, loading, busy, error, notice, connection, models, save, setActive, clearApiKey, deleteProfile, listModels, test };
};
