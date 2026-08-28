import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  Cpu,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  Zap,
} from 'lucide-react';
import type {
  ProviderKind,
  ProviderProfileSummary,
  ProviderProtocol,
  ReasoningEffort,
  SaveProviderProfileInput,
} from '../../core/providers/models';
import { useProviderSettings } from './useProviderSettings';
import '../../styles/settings.css';

type ProviderDraft = Omit<SaveProviderProfileInput, 'apiKey'> & { apiKey: string };

const toDraft = (profile: ProviderProfileSummary): ProviderDraft => ({
  profileId: profile.profileId,
  name: profile.name,
  kind: profile.kind,
  baseUrl: profile.baseUrl,
  protocol: profile.protocol,
  model: profile.model,
  reviewModel: profile.reviewModel,
  preReadModel: profile.preReadModel,
  agentModel: profile.agentModel || profile.reviewModel || profile.model,
  temperature: profile.temperature,
  batchSize: profile.batchSize,
  concurrency: profile.concurrency,
  timeoutSeconds: profile.timeoutSeconds,
  maxRetries: profile.maxRetries,
  maxOutputTokens: profile.maxOutputTokens,
  reasoningEffort: profile.reasoningEffort,
  agentReasoningEffort: profile.agentReasoningEffort || 'low',
  apiKey: '',
  kouriReasoningCapabilities: profile.kouriReasoningCapabilities,
  zeroDataRetention: profile.zeroDataRetention ?? false,
  customInstructions: profile.customInstructions,
});

const newCustomDraft = (count = 1): ProviderDraft => ({
  profileId: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  name: `兼容模型服务 ${count}`,
  kind: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  protocol: 'chat-completions',
  model: 'gpt-4o',
  reviewModel: 'gpt-4o',
  preReadModel: 'gpt-4o-mini',
  agentModel: 'gpt-4o',
  temperature: 0.1,
  batchSize: 8,
  concurrency: 2,
  timeoutSeconds: 300,
  maxRetries: 3,
  maxOutputTokens: 8_192,
  reasoningEffort: 'none',
  agentReasoningEffort: 'none',
  apiKey: '',
  zeroDataRetention: false,
  customInstructions: '',
});

const numberValue = (value: string, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const providerDefaults = (kind: ProviderKind): Partial<ProviderDraft> => {
  if (kind === 'command-code') {
    const model = 'deepseek/deepseek-v4-flash';
    return {
      baseUrl: 'https://api.commandcode.ai/provider/v1', protocol: 'chat-completions',
      model, reviewModel: model, preReadModel: model, agentModel: model,
      timeoutSeconds: 600, maxOutputTokens: 18_432,
      reasoningEffort: 'none', agentReasoningEffort: 'none', zeroDataRetention: false,
    };
  }
  if (kind === 'deepseek') return { baseUrl: 'https://api.deepseek.com', protocol: 'chat-completions' };
  if (kind === 'kouri') return { baseUrl: 'https://api.kourichat.com/v1', protocol: 'chat-completions', timeoutSeconds: 600 };
  return {};
};

export const ProviderSettings = () => {
  const provider = useProviderSettings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const profiles = provider.snapshot?.profiles ?? [];
  const isDraftNew = Boolean(draft && !profiles.some((p) => p.profileId === draft.profileId));
  const selected = useMemo(
    () => profiles.find((profile) => profile.profileId === selectedId) ?? null,
    [profiles, selectedId],
  );
  const currentReasoningCapability = selected?.kind === 'kouri'
    ? selected.kouriReasoningCapabilities?.find(
        (item) => item.model === draft?.model && item.protocol === draft?.protocol,
      ) ?? null
    : null;

  useEffect(() => {
    if (!provider.snapshot || selectedId) return;
    setSelectedId(provider.snapshot.activeProfileId);
  }, [provider.snapshot, selectedId]);

  useEffect(() => {
    if (selected) setDraft(toDraft(selected));
  }, [selected]);

  const setField = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const setKind = (kind: ProviderKind) => {
    setDraft((current) => current ? { ...current, kind, ...providerDefaults(kind) } : current);
  };

  const handleSave = async () => {
    if (!draft) return;
    const savePayload: SaveProviderProfileInput = {
      ...draft,
      apiKey: draft.apiKey.trim() || undefined,
    };
    const saved = await provider.save(savePayload);
    if (saved) {
      setSelectedId(draft.profileId);
      setDraft((current) => current ? { ...current, apiKey: '' } : current);
    }
  };

  const handleDelete = async () => {
    if (!draft) return;
    if (isDraftNew) {
      setDraft(null);
      setSelectedId(null);
      return;
    }
    if (!selected || !window.confirm(`删除“${selected.name}”配置？保存的密钥也会一并删除。`)) return;
    if (await provider.deleteProfile(selected.profileId)) {
      setDraft(null);
      setSelectedId(null);
    }
  };

  return (
    <div className="provider-settings-container">
      {/* 1. Header */}
      <header className="settings-page-head">
        <div>
          <h1>模型与接口中枢</h1>
          <p>
            配置日中翻译、全书预读、审校润色与各板块智能 Agent 的独立模型分配与并发参数。
          </p>
        </div>
        <div className="provider-header-actions">
          <span className={`provider-security-state ${provider.snapshot?.encryptionAvailable ? '' : 'is-error'}`}>
            <ShieldCheck size={14} />
            {provider.snapshot?.encryptionAvailable ? '系统密钥加密可用' : '系统密钥加密不可用'}
          </span>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              const next = newCustomDraft(profiles.length + 1);
              setDraft(next);
              setSelectedId(next.profileId);
            }}
          >
            <Plus size={14} /> 新增服务配置
          </button>
        </div>
      </header>

      {/* 2. Feedback Messages */}
      {provider.error && (
        <div className="settings-alert-box alert-error">
          <AlertCircle size={15} />
          <span>{provider.error}</span>
        </div>
      )}
      {provider.notice && (
        <div className="settings-alert-box alert-success">
          <Check size={15} />
          <span>{provider.notice}</span>
        </div>
      )}
      {provider.connection?.status === 'connected' && (
        <div className="settings-alert-box alert-success">
          <Check size={15} />
          <span>{provider.connection.message}{provider.connection.latencyMs ? ` · ${provider.connection.latencyMs} ms` : ''}</span>
        </div>
      )}

      {/* 3. Provider Selector Pills Bar */}
      <div className="provider-profiles-bar">
        <span className="profiles-bar-label">选择服务实例：</span>
        <div className="profiles-pills-list">
          {profiles.map((p) => {
            const isActive = p.profileId === provider.snapshot?.activeProfileId;
            const isSelected = p.profileId === (draft?.profileId ?? selectedId);
            return (
              <button
                key={p.profileId}
                type="button"
                className={`profile-pill ${isSelected ? 'selected' : ''} ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedId(p.profileId);
                  setDraft(toDraft(p));
                }}
              >
                <Server size={13} />
                <strong>{p.name}</strong>
                {isActive && <span className="active-tag">当前生效</span>}
                <span className={`key-mini-tag ${p.hasApiKey ? 'has-key' : ''}`}>
                  {p.hasApiKey ? p.apiKeyHint : '未填密钥'}
                </span>
              </button>
            );
          })}
          {isDraftNew && draft && (
            <button
              type="button"
              className="profile-pill selected draft-profile-pill"
              onClick={() => setSelectedId(draft.profileId)}
            >
              <Plus size={13} />
              <strong>{draft.name || '新建配置'}</strong>
              <span className="draft-tag">未保存</span>
            </button>
          )}
        </div>
      </div>

      {draft ? (
        <div className="provider-cards-grid">
          {/* Card 1: Connection & Credentials */}
          <section className="settings-document-card">
            <header className="card-header">
              <Server size={18} />
              <div>
                <h2>服务接入与连接凭据</h2>
                <p>设置服务商类型、Base URL 与访问密钥（密钥加密存储于本地 Keychain）。</p>
              </div>
            </header>

            <div className="card-fields-grid">
              <label className="field-group">
                <span>配置名称</span>
                <input
                  value={draft.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="如：DeepSeek 官方直连"
                />
              </label>

              <label className="field-group">
                <span>服务商类型</span>
                <select
                  value={draft.kind}
                  onChange={(e) => setKind(e.target.value as ProviderKind)}
                >
                  <option value="deepseek">DeepSeek 官方</option>
                  <option value="kouri">Kouri 模型网关</option>
                  <option value="openai-compatible">OpenAI 兼容接口</option>
                  <option value="command-code">Command Code</option>
                </select>
              </label>

              <label className="field-group">
                <span>接口协议</span>
                {draft.kind === 'command-code' ? (
                  <input value="自动分流（Claude Messages / 其他 Chat）" readOnly />
                ) : (
                  <select
                    value={draft.protocol}
                    onChange={(e) => setField('protocol', e.target.value as ProviderProtocol)}
                  >
                    <option value="chat-completions">Chat Completions</option>
                    <option value="responses">Responses API</option>
                  </select>
                )}
              </label>

              <label className="field-group full-width">
                <span>API Base URL</span>
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setField('baseUrl', e.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                />
              </label>

              <label className="field-group full-width">
                <span>API Key (密钥)</span>
                <div className="key-input-wrap">
                  <KeyRound size={14} className="key-icon" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={draft.apiKey}
                    onChange={(e) => setField('apiKey', e.target.value)}
                    placeholder={
                      selected?.hasApiKey ? `已保存 ${selected.apiKeyHint ?? ''}；留空保持不变` : '粘贴 API Key 后保存'
                    }
                  />
                </div>
                <small className={`api-key-status ${selected?.hasApiKey || draft.apiKey.trim() ? 'has-key' : 'missing-key'}`}>
                  {draft.apiKey.trim()
                    ? `待保存的新密钥：••••${draft.apiKey.trim().slice(-4)}`
                    : selected?.hasApiKey
                      ? `已经输入并加密保存：${selected.apiKeyHint}`
                      : '尚未输入 API Key，连接测试和模型调用不可用。'}
                </small>
              </label>

              <p className="provider-note full-width">
                <KeyRound size={14} />完整密钥不会回显，也不会写入项目数据库、日志或导出的备份。
              </p>
              {draft.kind === 'command-code' && (
                <label className="provider-check-option full-width">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.zeroDataRetention)}
                    onChange={(e) => setField('zeroDataRetention', e.target.checked)}
                  />
                  <span><strong>强制零数据保留（ZDR）</strong><small>发送 x-cmd-zdr: 1；个别上游不支持时会请求失败，不确定时保持关闭。</small></span>
                </label>
              )}
            </div>
          </section>

          {/* Card 2: 4-Station Model Allocation Matrix */}
          <section className="settings-document-card">
            <header className="card-header">
              <Layers size={18} />
              <div>
                <h2>4 工位独立模型分配矩阵</h2>
                <p>为不同任务类型分配最适配的模型（预读提取、主译润色、审校仲裁与专属助理）。</p>
              </div>
            </header>

            <div className="card-fields-grid">
              <label className="field-group">
                <span className="station-label">
                  <Sparkles size={13} /> 工位 1：全书预读与专名提取
                </span>
                <input
                  list="provider-model-options"
                  value={draft.preReadModel || draft.model}
                  onChange={(e) => setField('preReadModel', e.target.value)}
                  placeholder="如：deepseek-chat 或 gpt-4o-mini"
                />
                <small>负责扫描全篇剧情、抽提专名与构建世界线长程记忆</small>
              </label>

              <label className="field-group">
                <span className="station-label">
                  <Zap size={13} /> 工位 2：核心翻译与文学润色
                </span>
                <input
                  list="provider-model-options"
                  value={draft.model}
                  onChange={(e) => setField('model', e.target.value)}
                  placeholder="如：deepseek-reasoner 或 gpt-4o"
                />
                <small>负责逐章逐段文学意合翻译、去除翻译腔并严格保留标点</small>
              </label>

              <label className="field-group">
                <span className="station-label">
                  <ShieldCheck size={13} /> 工位 3：质量复核与一致性仲裁
                </span>
                <input
                  list="provider-model-options"
                  value={draft.reviewModel || draft.model}
                  onChange={(e) => setField('reviewModel', e.target.value)}
                  placeholder="如：deepseek-reasoner 或 claude-3-7-sonnet"
                />
                <small>负责执行 8 大忠实硬规则查验与专名冲突裁定</small>
              </label>

              <label className="field-group">
                <span className="station-label">
                  <Bot size={13} /> 工位 4：各板块专属 Domain Agent
                </span>
                <input
                  list="provider-model-options"
                  value={draft.agentModel || draft.reviewModel || draft.model}
                  onChange={(e) => setField('agentModel', e.target.value)}
                  placeholder="如：deepseek-reasoner 或 gpt-4o"
                />
                <small>响应你在术语、人物、记忆、润色工坊各界面的自然语言指令</small>
              </label>
            </div>
            <datalist id="provider-model-options">
              {provider.models.map((model) => <option key={model} value={model} />)}
            </datalist>
            <div className="provider-inline-row">
              <button
                type="button"
                className="secondary-btn"
                disabled={!selected?.hasApiKey || Boolean(provider.busy)}
                title={isDraftNew ? '请先保存新配置和密钥' : !selected?.hasApiKey ? '请先输入并保存 API Key' : undefined}
                onClick={() => void provider.listModels(draft.profileId)}
              >
                <RefreshCw size={14} />
                {provider.busy === 'models' ? '正在读取模型列表…' : '从服务读取模型列表'}
              </button>
              <small>{provider.models.length ? `本次读取到 ${provider.models.length} 个模型，可在上方输入框选择。` : '模型名称仍可手动填写。'}</small>
            </div>
          </section>

          {/* Card 3: Performance, Concurrency & Reasoning Effort */}
          <section className="settings-document-card">
            <header className="card-header">
              <Cpu size={18} />
              <div>
                <h2>并发吞吐与思考强度调谐</h2>
                <p>精细控制并发请求数、批处理大小、超时重试与模型深度思考（Reasoning）强度。</p>
              </div>
            </header>

            <div className="card-fields-grid three-col">
              <label className="field-group">
                <span>最大并发请求数 (Concurrency)</span>
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={draft.concurrency}
                  onChange={(e) => setField('concurrency', numberValue(e.target.value, 2))}
                />
              </label>

              <label className="field-group">
                <span>段落批处理大小 (Batch Size)</span>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={draft.batchSize}
                  onChange={(e) => setField('batchSize', numberValue(e.target.value, 8))}
                />
              </label>

              <label className="field-group">
                <span>超时时间 (秒)</span>
                <input
                  type="number"
                  min="15"
                  max="1800"
                  value={draft.timeoutSeconds}
                  onChange={(e) => setField('timeoutSeconds', numberValue(e.target.value, 300))}
                />
              </label>

              <label className="field-group">
                <span>最大失败重试次数</span>
                <input
                  type="number"
                  min="0"
                  max="8"
                  value={draft.maxRetries}
                  onChange={(e) => setField('maxRetries', numberValue(e.target.value, 3))}
                />
              </label>

              <label className="field-group">
                <span>最大输出 Token</span>
                <input
                  type="number"
                  min="128"
                  max="393216"
                  value={draft.maxOutputTokens}
                  onChange={(e) => setField('maxOutputTokens', numberValue(e.target.value, 8192))}
                />
                <small>这是实际请求上限，必须有值；提高上限只减少长 JSON 被截断，不会自动提高翻译质量。</small>
              </label>

              <label className="field-group">
                <span>温度参数 (Temperature)</span>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1.5"
                  value={draft.temperature}
                  onChange={(e) => setField('temperature', numberValue(e.target.value, 0.1))}
                />
              </label>
            </div>

            {draft.kind !== 'command-code' ? (
              <div className="card-fields-grid reasoning-fields">
                <label className="field-group">
                  <span>流水线思考强度（翻译 / 预读 / 质检）</span>
                  <select value={draft.reasoningEffort} onChange={(e) => setField('reasoningEffort', e.target.value as ReasoningEffort)}>
                    <option value="none">关闭思考 (None)</option>
                    <option value="low">低强度 (Low)</option>
                    <option value="medium">中等强度 (Medium)</option>
                    <option value="high">高强度 (High)</option>
                    <option value="max">最大强度 (Max)</option>
                  </select>
                </label>
                <label className="field-group">
                  <span>AI Agent 独立思考强度</span>
                  <select value={draft.agentReasoningEffort || 'low'} onChange={(e) => setField('agentReasoningEffort', e.target.value as ReasoningEffort)}>
                    <option value="none">关闭思考 (None)</option>
                    <option value="low">低强度 (Low)</option>
                    <option value="medium">中等强度 (Medium)</option>
                    <option value="high">高强度 (High)</option>
                    <option value="max">最大强度 (Max)</option>
                  </select>
                </label>
              </div>
            ) : (
              <p className="provider-note">
                <RefreshCw size={14} />Command Code 不再发送 thinking、reasoning_effort 或 reasoning 字段；思考方式完全交给上游模型默认行为，避免 DeepSeek 因私有参数而不可用。
              </p>
            )}

            {draft.kind === 'command-code' && (
              <p className="provider-note"><Server size={14} />内置 GOAT 配置默认 18432 Token。更高值会延长最坏等待时间与用量，但只有输出实际很长时才产生影响。</p>
            )}
            {draft.kind === 'kouri' && (
              <p className="provider-note">
                <RefreshCw size={14} />Kouri 会按模型与协议实测显式 reasoning；不支持时自动回退为模型默认推理。
                {currentReasoningCapability
                  ? ` 当前：${currentReasoningCapability.status === 'verified' ? `已验证 ${currentReasoningCapability.effectiveEffort}` : '仅支持默认推理'}（${new Date(currentReasoningCapability.checkedAt).toLocaleString()}）。`
                  : ' 保存配置和密钥后，可通过“测试连接”执行能力探测。'}
              </p>
            )}

            <label className="provider-custom-instructions">
              <span>项目通用补充指令</span>
              <textarea
                rows={6}
                maxLength={20000}
                value={draft.customInstructions}
                onChange={(e) => setField('customInstructions', e.target.value)}
                placeholder="可填写作品特有的文风、译名或排版要求。不可覆盖软件内置的忠实边界。"
              />
              <small>会附加到预读、翻译和复核工位；不得增删、不得净化和角色知识边界始终优先。</small>
            </label>
          </section>

          {/* Action Bar */}
          <div className="provider-footer-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={Boolean(provider.busy)}
              onClick={() => void handleSave()}
            >
              <Check size={15} />
              <span>{provider.busy ? '正在保存…' : '保存此服务配置'}</span>
            </button>

            <button
              type="button"
              className="secondary-btn"
              disabled={!selected?.hasApiKey || Boolean(provider.busy)}
              title={!selected?.hasApiKey ? '请先输入并保存 API Key' : undefined}
              onClick={() => void provider.test(draft.profileId)}
            >
              <Unplug size={14} />
              {provider.busy === 'test' ? '正在连接并调用模型…' : '测试连接（会调用模型）'}
            </button>

            {selected && selected.profileId !== provider.snapshot?.activeProfileId && (
              <button
                type="button"
                className="secondary-btn"
                disabled={Boolean(provider.busy)}
                onClick={() => void provider.setActive(selected.profileId)}
              >
                设为当前全书主配置
              </button>
            )}

            {selected?.hasApiKey && (
              <button
                type="button"
                className="danger-quiet-btn"
                disabled={Boolean(provider.busy)}
                onClick={() => {
                  if (window.confirm('删除这个配置中保存的 API Key？')) void provider.clearApiKey(draft.profileId);
                }}
              >
                <KeyRound size={14} /> 删除保存的密钥
              </button>
            )}

            {(isDraftNew || (selected && profiles.length > 1)) && (
              <button
                type="button"
                className="danger-quiet-btn"
                disabled={Boolean(provider.busy)}
                onClick={() => void handleDelete()}
              >
                <Trash2 size={14} /> {isDraftNew ? '放弃新配置' : '删除此配置'}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
