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

const providerKindLabel = (kind: ProviderKind) => {
  switch (kind) {
    case 'deepseek':
      return 'DeepSeek 官方直连';
    case 'kouri':
      return 'Kouri 模型网关';
    case 'command-code':
      return 'Command Code';
    default:
      return 'OpenAI 兼容接口';
  }
};

const numberValue = (value: string, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

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

  const handleSave = async () => {
    if (!draft) return;
    const savePayload: SaveProviderProfileInput = {
      ...draft,
      apiKey: draft.apiKey.trim() || undefined,
    };
    await provider.save(savePayload);
    if (!selectedId || selectedId !== draft.profileId) {
      setSelectedId(draft.profileId);
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
              </button>
            );
          })}
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
                  onChange={(e) => setField('kind', e.target.value as ProviderKind)}
                >
                  <option value="deepseek">DeepSeek 官方</option>
                  <option value="kouri">Kouri 模型网关</option>
                  <option value="openai-compatible">OpenAI 兼容接口</option>
                  <option value="command-code">Command Code</option>
                </select>
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
                    value={draft.apiKey}
                    onChange={(e) => setField('apiKey', e.target.value)}
                    placeholder={
                      selected?.hasApiKey ? '已保存安全密钥（输入新密钥以覆盖更新）' : 'sk-...'
                    }
                  />
                </div>
              </label>
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
                  value={draft.agentModel || draft.reviewModel || draft.model}
                  onChange={(e) => setField('agentModel', e.target.value)}
                  placeholder="如：deepseek-reasoner 或 gpt-4o"
                />
                <small>响应你在术语、人物、记忆、润色工坊各界面的自然语言指令</small>
              </label>
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
                  min="30"
                  max="1200"
                  value={draft.timeoutSeconds}
                  onChange={(e) => setField('timeoutSeconds', numberValue(e.target.value, 300))}
                />
              </label>

              <label className="field-group">
                <span>模型思考强度 (Reasoning Effort)</span>
                <select
                  value={draft.reasoningEffort}
                  onChange={(e) =>
                    setField('reasoningEffort', e.target.value as ReasoningEffort)
                  }
                >
                  <option value="none">不开启思考 (None)</option>
                  <option value="low">快速思考 (Low)</option>
                  <option value="medium">标准深度 (Medium)</option>
                  <option value="high">极致推理 (High · 推荐军政文)</option>
                </select>
              </label>

              <label className="field-group">
                <span>Agent 思考强度</span>
                <select
                  value={draft.agentReasoningEffort || 'low'}
                  onChange={(e) =>
                    setField('agentReasoningEffort', e.target.value as ReasoningEffort)
                  }
                >
                  <option value="none">关闭 (None)</option>
                  <option value="low">快速响应 (Low)</option>
                  <option value="medium">标准深度 (Medium)</option>
                  <option value="high">深度分析 (High)</option>
                </select>
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

            {selected && profiles.length > 1 && (
              <button
                type="button"
                className="danger-quiet-btn"
                disabled={Boolean(provider.busy)}
                onClick={() => void provider.deleteProfile(selected.profileId)}
              >
                <Trash2 size={14} /> 删除此配置
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
