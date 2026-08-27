import { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Plus, RefreshCw, Server, ShieldCheck, Trash2, Unplug } from 'lucide-react';
import type { ProviderKind, ProviderProfileSummary, ProviderProtocol, ReasoningEffort, SaveProviderProfileInput } from '../../core/providers/models';
import { useProviderSettings } from './useProviderSettings';

type ProviderDraft = Omit<SaveProviderProfileInput, 'apiKey'> & { apiKey: string };

const toDraft = (profile: ProviderProfileSummary): ProviderDraft => ({
  profileId: profile.profileId, name: profile.name, kind: profile.kind, baseUrl: profile.baseUrl,
  protocol: profile.protocol, model: profile.model, reviewModel: profile.reviewModel,
  preReadModel: profile.preReadModel, agentModel: profile.agentModel || profile.reviewModel || profile.model,
  temperature: profile.temperature, batchSize: profile.batchSize,
  concurrency: profile.concurrency, timeoutSeconds: profile.timeoutSeconds, maxRetries: profile.maxRetries,
  maxOutputTokens: profile.maxOutputTokens, reasoningEffort: profile.reasoningEffort,
  agentReasoningEffort: profile.agentReasoningEffort || 'low', apiKey: '',
  kouriReasoningCapabilities: profile.kouriReasoningCapabilities,
  zeroDataRetention: profile.zeroDataRetention ?? false,
  customInstructions: profile.customInstructions,
});

const newCustomDraft = (count = 1): ProviderDraft => ({
  profileId: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  name: `新的兼容服务 ${count}`,
  kind: 'openai-compatible',
  baseUrl: 'https://example.com/v1', protocol: 'chat-completions', model: 'model-name',
  reviewModel: 'model-name', preReadModel: 'model-name', agentModel: 'model-name',
  temperature: 0.1, batchSize: 8,
  concurrency: 2, timeoutSeconds: 300, maxRetries: 3, maxOutputTokens: 8_192,
  reasoningEffort: 'none', agentReasoningEffort: 'none', apiKey: '',
  zeroDataRetention: false,
  customInstructions: '',
});

const providerKindLabel = (kind: ProviderKind) => kind === 'deepseek'
  ? 'DeepSeek 官方'
  : kind === 'kouri'
    ? 'Kouri 网关'
    : kind === 'command-code'
      ? 'Command Code'
      : 'OpenAI 兼容';

const numberValue = (value: string, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fidelityPreview = `1. 日文原文是唯一事实来源；不得增译、漏译、补动作、补因果或补心理。
2. 原文没有性别词、人数标记或称呼成分时不得添加；人物资料只帮助理解，不授权补写。
3. 数字、否定、程度、口吃、重复、语气与有表达作用的形式不得删减。
4. 粗俗、激烈、露骨或冒犯内容不得净化、弱化、美化、回避，也不得反向加码。
5. 称呼依据当前原文、A→B 关系阶段、场景与意图处理，不做全文机械统一。
6. 戏称、误读、昵称、谐音和双关按有证据的场景变体处理。
7. 后文真相可帮助译者消歧，但不得提前剧透，也不得越过角色知识边界。
8. 无法忠实处理时必须明确失败，禁止返回安全改写的替代稿。`;

export const ProviderSettings = () => {
  const provider = useProviderSettings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const profiles = provider.snapshot?.profiles ?? [];
  const isDraftNew = Boolean(draft && !profiles.some((p) => p.profileId === draft.profileId));
  const selected = useMemo(() => profiles.find((profile) => profile.profileId === selectedId) ?? null, [profiles, selectedId]);
  const currentReasoningCapability = selected?.kind === 'kouri'
    ? selected.kouriReasoningCapabilities?.find((item) => item.model === draft?.model && item.protocol === draft?.protocol) ?? null
    : null;

  useEffect(() => {
    if (!provider.snapshot || selectedId) return;
    setSelectedId(provider.snapshot.activeProfileId);
  }, [provider.snapshot, selectedId]);

  useEffect(() => {
    if (selected) setDraft(toDraft(selected));
  }, [selected]);

  const setField = <K extends keyof ProviderDraft,>(key: K, value: ProviderDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const setKind = (kind: ProviderKind) => {
    setDraft((current) => {
      if (!current) return current;
      if (kind !== 'command-code') return { ...current, kind };
      const model = 'deepseek/deepseek-v4-flash';
      return {
        ...current,
        kind,
        name: current.name.startsWith('新的兼容服务') ? 'Command Code GOAT' : current.name,
        baseUrl: 'https://api.commandcode.ai/provider/v1',
        protocol: 'chat-completions',
        model,
        reviewModel: model,
        preReadModel: model,
        agentModel: model,
        reasoningEffort: 'none',
        agentReasoningEffort: 'none',
        zeroDataRetention: false,
      };
    });
  };

  const save = async () => {
    if (!draft) return;
    const input: SaveProviderProfileInput = { ...draft, ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) };
    const saved = await provider.save(input);
    if (saved) { setSelectedId(draft.profileId); setDraft((current) => current ? { ...current, apiKey: '' } : current); }
  };

  const remove = async () => {
    if (!draft) return;
    if (isDraftNew) {
      // 如果是未保存的新草稿，直接放弃
      setDraft(null);
      setSelectedId(provider.snapshot?.activeProfileId ?? profiles[0]?.profileId ?? null);
      return;
    }
    if (!selected || !window.confirm(`删除“${selected.name}”配置？保存的密钥也会一并删除。`)) return;
    const deleted = await provider.deleteProfile(draft.profileId);
    if (deleted) {
      setDraft(null);
      setSelectedId(null);
    }
  };

  if (!provider.available) return <p className="storage-feedback storage-feedback--error">请从桌面程序打开设置，浏览器预览不能保存模型密钥。</p>;

  return (
    <>
      <header className="settings-page-head">
        <div><h1>模型与接口</h1><p>翻译、全书预读和独立复核可以使用不同模型；密钥只保存在当前 Windows 用户的加密存储中。</p></div>
        <span className={`provider-security ${provider.snapshot?.encryptionAvailable ? '' : 'provider-security--error'}`}><ShieldCheck size={15} />{provider.snapshot?.encryptionAvailable ? '系统加密可用' : '系统加密不可用'}</span>
      </header>

      {provider.error && <p className="storage-feedback storage-feedback--error">{provider.error}</p>}
      {provider.notice && <p className="storage-feedback storage-feedback--success">{provider.notice}</p>}
      {provider.connection?.status === 'connected' && <p className="storage-feedback storage-feedback--success">{provider.connection.message}{provider.connection.latencyMs ? ` · ${provider.connection.latencyMs} ms` : ''}</p>}

      <section className="provider-layout">
        <aside className="provider-list" aria-label="模型服务配置">
          <header>
            <span>服务配置 ({profiles.length + (isDraftNew ? 1 : 0)})</span>
            <button
              type="button"
              title="添加新的模型服务配置"
              onClick={() => {
                const next = newCustomDraft(profiles.length + 1);
                setSelectedId(next.profileId);
                setDraft(next);
              }}
            >
              <Plus size={15} />
            </button>
          </header>
          {provider.loading ? (
            <p>正在读取…</p>
          ) : (
            <>
              {profiles.map((profile) => (
                <button
                  type="button"
                  key={profile.profileId}
                  className={selectedId === profile.profileId && !isDraftNew ? 'active' : ''}
                  onClick={() => {
                    setSelectedId(profile.profileId);
                    setDraft(toDraft(profile));
                  }}
                >
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{providerKindLabel(profile.kind)}</small>
                  </span>
                  {provider.snapshot?.activeProfileId === profile.profileId && <Check size={14} aria-label="当前使用" />}
                </button>
              ))}
              {isDraftNew && draft && (
                <button
                  type="button"
                  key={draft.profileId}
                  className="active"
                  style={{ borderLeft: '3px solid #d97706', background: '#fffcf7' }}
                  onClick={() => setSelectedId(draft.profileId)}
                >
                  <span>
                    <strong>{draft.name || '新建配置'}</strong>
                    <small style={{ color: '#d97706', fontWeight: 600 }}>未保存草稿 (点击保存落地)</small>
                  </span>
                </button>
              )}
            </>
          )}
        </aside>

        {draft && (
          <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <section className="provider-form-section">
              <header><Server size={18} /><div><h2>服务地址</h2><p>可粘贴服务根地址，也可粘贴完整的 /chat/completions、/responses 或 /messages 地址，保存时会自动规范化。</p></div></header>
              <div className="provider-fields provider-fields--two">
                <label><span>配置名称</span><input value={draft.name} maxLength={80} onChange={(event) => setField('name', event.target.value)} /></label>
                <label><span>服务类型</span><select value={draft.kind} onChange={(event) => setKind(event.target.value as ProviderKind)}><option value="deepseek">DeepSeek 官方</option><option value="kouri">Kouri API</option><option value="command-code">Command Code（GOAT 及以上）</option><option value="openai-compatible">其他 OpenAI 兼容服务</option></select></label>
                <label className="provider-field-wide"><span>Base URL</span><input value={draft.baseUrl} spellCheck={false} onChange={(event) => setField('baseUrl', event.target.value)} /></label>
                <label><span>接口协议</span>{draft.kind === 'command-code'
                  ? <input value="自动：Claude → Messages；其他 → Chat" readOnly />
                  : <select value={draft.protocol} onChange={(event) => setField('protocol', event.target.value as ProviderProtocol)}><option value="chat-completions">Chat Completions</option><option value="responses">Responses API</option></select>}</label>
                <label><span>API Key</span><input type="password" autoComplete="new-password" value={draft.apiKey} placeholder={selected?.hasApiKey ? `已保存 ${selected.apiKeyHint ?? ''}；留空不变` : '粘贴后保存'} onChange={(event) => setField('apiKey', event.target.value)} /></label>
              </div>
              <p className="provider-note"><KeyRound size={14} />软件不会把完整密钥回显给界面，也不会写入项目、日志或备份。</p>
              {draft.kind === 'command-code' && <>
                <p className="provider-note"><RefreshCw size={14} />使用 Command Code Studio 创建的同一 API Key。GOAT 可用，但请求会消耗 GOAT 套餐额度，并受套餐可用模型范围限制。程序会让 Claude 自动走 Anthropic Messages，其余模型走 OpenAI Chat，四个工位可混用。</p>
                <label className="provider-zdr-option"><input type="checkbox" checked={Boolean(draft.zeroDataRetention)} onChange={(event) => setField('zeroDataRetention', event.target.checked)} /><span><strong>强制零数据保留（ZDR）</strong><small>会发送 x-cmd-zdr: 1。个别模型无 ZDR 上游时会失败，也可能改变上游与费用；不确定时保持关闭。</small></span></label>
              </>}
            </section>

            <section className="provider-form-section">
              <header><RefreshCw size={18} /><div><h2>工位模型分配</h2><p>全书预读、独立复核与 AI 知识/审校 Agent 可独立指定模型；不区分时填相同名称即可。</p></div></header>
              <div className="provider-fields provider-fields--four">
                <label><span>日文精译 / 润色</span><input list="provider-model-options" value={draft.model} onChange={(event) => setField('model', event.target.value)} /></label>
                <label><span>全书预读</span><input list="provider-model-options" value={draft.preReadModel} onChange={(event) => setField('preReadModel', event.target.value)} /></label>
                <label><span>独立复核</span><input list="provider-model-options" value={draft.reviewModel} onChange={(event) => setField('reviewModel', event.target.value)} /></label>
                <label><span>AI 知识/审校 Agent</span><input list="provider-model-options" value={draft.agentModel || draft.reviewModel} onChange={(event) => setField('agentModel', event.target.value)} /></label>
              </div>
              <datalist id="provider-model-options">{provider.models.map((model) => <option key={model} value={model} />)}</datalist>
              <button type="button" className="provider-inline-action" disabled={!selected?.hasApiKey || Boolean(provider.busy)} onClick={() => void provider.listModels(draft.profileId)}>{provider.busy === 'models' ? '正在读取…' : '从服务读取模型列表'}</button>
            </section>

            <section className="provider-form-section">
              <header><Server size={18} /><div><h2>{draft.kind === 'command-code' ? '请求边界' : '请求边界与思考强度'}</h2><p>{draft.kind === 'command-code' ? 'Command Code 只配置并发、重试与输出边界，思考模式由上游模型自行决定。' : '各工位与 AI Agent 的并发、重试与推理思考深度在此统一调控。'}</p></div></header>
              <div className="provider-fields provider-fields--three provider-number-fields">
                <label><span>批量段数</span><input type="number" min="1" max="40" value={draft.batchSize} onChange={(event) => setField('batchSize', numberValue(event.target.value, draft.batchSize))} /></label>
                <label><span>并发请求</span><input type="number" min="1" max="16" value={draft.concurrency} onChange={(event) => setField('concurrency', numberValue(event.target.value, draft.concurrency))} /></label>
                <label><span>超时（秒）</span><input type="number" min="15" max="1800" value={draft.timeoutSeconds} onChange={(event) => setField('timeoutSeconds', numberValue(event.target.value, draft.timeoutSeconds))} /></label>
                <label><span>最大重试</span><input type="number" min="0" max="8" value={draft.maxRetries} onChange={(event) => setField('maxRetries', numberValue(event.target.value, draft.maxRetries))} /></label>
                <label><span>最大输出 Token</span><input type="number" min="128" max="393216" value={draft.maxOutputTokens} onChange={(event) => setField('maxOutputTokens', numberValue(event.target.value, draft.maxOutputTokens))} /></label>
                <label><span>温度</span><input type="number" min="0" max="2" step="0.05" value={draft.temperature} onChange={(event) => setField('temperature', numberValue(event.target.value, draft.temperature))} /></label>
              </div>
              {draft.kind === 'command-code' && <p className="provider-note"><RefreshCw size={14} />内置 Command Code GOAT 配置使用 18432 Token 输出上限。DeepSeek V4 本身允许该值；更高上限可减少结构化预读被截断的概率，但也可能增加单次等待时间与用量。运行终端会显示每次请求实际发送的上限。</p>}
              {draft.kind !== 'command-code' && <div className="provider-fields provider-fields--two">
                <label><span>流水线思考模式 (翻译/预读/质检)</span><select value={draft.reasoningEffort} onChange={(event) => setField('reasoningEffort', event.target.value as ReasoningEffort)}><option value="none">关闭思考 (Fast / 纯直出)</option><option value="low">低强度思考 (Low)</option><option value="medium">中等强度思考 (Medium)</option><option value="high">高强度思考 (High / 深度推理)</option><option value="max">最大思考 (Max)</option></select></label>
                <label><span>AI Agent 独立思考模式 (知识与审校管家)</span><select value={draft.agentReasoningEffort || 'low'} onChange={(event) => setField('agentReasoningEffort', event.target.value as ReasoningEffort)}><option value="none">关闭思考 (Fast / 纯直出)</option><option value="low">低强度思考 (Low / 推荐)</option><option value="medium">中等强度思考 (Medium)</option><option value="high">高强度思考 (High / 深度推演)</option><option value="max">最大思考 (Max)</option></select></label>
              </div>}
              {draft.kind === 'kouri' && <p className="provider-note"><RefreshCw size={14} />Kouri 会按当前模型和协议实测 reasoning：支持时发送并记住有效档位，不支持时自动改用模型默认推理。强制 JSON Schema 仍由提示词与本地校验代替。{currentReasoningCapability ? ` 当前状态：${currentReasoningCapability.status === 'verified' ? `已验证显式 ${currentReasoningCapability.effectiveEffort}` : '只能使用默认推理'}（${new Date(currentReasoningCapability.checkedAt).toLocaleString()}）。` : ' 请保存后点击“测试连接”完成能力探测。'}</p>}
              {draft.kind === 'command-code' && <p className="provider-note"><RefreshCw size={14} />Command Code 请求不会发送 thinking、reasoning_effort 或 reasoning 字段，也不会再做思考能力探测、降档和失败重试。DeepSeek、Claude、Gemini、GPT 与其他模型均使用 Command Code 上游默认模式。</p>}
              <label className="provider-custom-instructions"><span>项目通用补充指令</span><textarea rows={6} maxLength={20000} value={draft.customInstructions} onChange={(event) => setField('customInstructions', event.target.value)} placeholder="可填写作品特有的文风、译名或排版要求。不可替换软件内置的忠实边界。" /><small>这段内容会附加到预读、翻译和复核工位；内置的不得增删、不得净化与知识边界规则始终优先。</small></label>
              <details className="provider-fidelity-preview"><summary>查看软件强制执行的忠实边界</summary><pre>{fidelityPreview}</pre><p>补充指令只能增加作品特有要求，不能覆盖这些边界；程序校验和独立复核也会再次执行。</p></details>
            </section>

            <footer className="provider-actions">
              <button type="submit" className="provider-save" disabled={Boolean(provider.busy) || !provider.snapshot?.encryptionAvailable}>{provider.busy === 'save' ? '正在保存…' : '保存设置'}</button>
              <button type="button" disabled={!selected?.hasApiKey || Boolean(provider.busy)} onClick={() => void provider.test(draft.profileId)}>{provider.busy === 'test' ? '正在连接…' : '测试连接（会调用模型）'}</button>
              {selected && provider.snapshot?.activeProfileId !== draft.profileId && <button type="button" disabled={Boolean(provider.busy)} onClick={() => void provider.setActive(draft.profileId)}>设为当前服务</button>}
              {selected?.hasApiKey && <button type="button" className="provider-danger-link" disabled={Boolean(provider.busy)} onClick={() => { if (window.confirm('删除这个配置中保存的 API Key？')) void provider.clearApiKey(draft.profileId); }}><Unplug size={14} />删除密钥</button>}
              {selected && profiles.length > 1 && <button type="button" className="provider-danger-link" disabled={Boolean(provider.busy)} onClick={() => void remove()}><Trash2 size={14} />删除配置</button>}
            </footer>
          </form>
        )}
      </section>
    </>
  );
};
