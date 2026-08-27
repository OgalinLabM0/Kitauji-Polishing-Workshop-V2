import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  GitBranch,
  HelpCircle,
  Link2,
  Lock,
  Network,
  Search,
  Sparkles,
  Unlink,
} from 'lucide-react';
import type {
  AmbiguityRecord,
  MemoryFactRecord,
  SeriesAssignmentRecord,
  SeriesSummaryRecord,
} from '../../core/workflow/models';
import { DomainAgentDrawer, DomainAgentTriggerButton } from '../agent/DomainAgentDrawer';
import '../../styles/knowledge.css';

const factLabel: Record<string, string> = {
  character: '人物状态',
  event: '关键事件',
  relationship: '关系变化',
  address: '称呼习惯',
  voice: '说话风格',
  viewpoint: '叙述视角',
  setting: '场景设定',
  secret: '隐秘真相',
  foreshadowing: '重要伏笔',
  pun: '双关/谐音',
  'scene-summary': '场景摘要',
  'chapter-summary': '章节摘要',
};

const statusLabel: Record<string, string> = {
  confirmed: '已确认',
  locked: '已锁定',
  hypothesis: '待后文印证',
  conflict: '证据冲突',
  consolidated: '已巩固',
  candidate: 'AI 候选',
  archived: '已归档',
  superseded: '历史状态',
};

const memoryClassLabel: Record<string, string> = {
  canon: '作品主设定',
  character: '人物核心模型',
  relationship: '人际关系模型',
  event: '剧情关键事件',
  state: '时态世界状态',
  'episode-detail': '章节情节细节',
};

const ambiguityLabel: Record<string, string> = {
  pun: '双关',
  identity: '身份',
  referent: '指代',
  scope: '作用域',
  role: '动作方向',
  voice: '语态',
  temporal: '时间',
  narrative: '叙事层',
  other: '其他',
};

const strategyLabel: Record<string, string> = {
  preserve: '保留原文多解',
  resolve: '选择确定解释',
  transliterate: '音译保留',
  annotate: '译注说明',
  review: '继续人工复核',
};

const AmbiguityCard = ({
  item,
  onSaved,
}: {
  readonly item: AmbiguityRecord;
  readonly onSaved: () => Promise<void>;
}) => {
  const api = window.kitaujiDesktop?.workflow;
  const [strategy, setStrategy] = useState(item.preservationStrategy);
  const [selected, setSelected] = useState(item.selectedInterpretation ?? '');
  const [note, setNote] = useState(item.resolutionNote);
  const [lock, setLock] = useState(item.status === 'locked');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.resolveAmbiguity(item.ambiguityId, {
        preservationStrategy: strategy as 'preserve' | 'resolve' | 'transliterate' | 'annotate' | 'review',
        selectedInterpretation: selected || null,
        note,
        lock,
      });
      if (result.status === 'error') setMessage(result.message);
      else {
        setMessage('裁定已生效，相关译文段落已更新。');
        await onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="ambiguity-card-item">
      <header className="ambiguity-card-head">
        <div className="ambiguity-head-left">
          <span className="ambiguity-type-chip">{ambiguityLabel[item.ambiguityKind] ?? item.ambiguityKind}</span>
          <strong>
            第 {item.chapterOrdinal} 章 · 段 {item.segmentOrdinal}
          </strong>
        </div>
        <span className={`status-pill status-${item.status}`}>
          {statusLabel[item.status] ?? item.status} · 置信度 {Math.round(item.confidence * 100)}%
        </span>
      </header>

      <blockquote className="ambiguity-excerpt" lang="ja">
        “{item.sourceExcerpt}”
      </blockquote>

      <div className="ambiguity-options-group">
        <span className="ambiguity-group-label">候选释义多解项：</span>
        <div className="ambiguity-options-list">
          {item.interpretations.map((interpretation, index) => (
            <label
              key={`${item.ambiguityId}:${index}`}
              className={`ambiguity-radio-label ${selected === interpretation ? 'active' : ''}`}
            >
              <input
                type="radio"
                name={item.ambiguityId}
                value={interpretation}
                checked={selected === interpretation}
                onChange={() => setSelected(interpretation)}
                disabled={strategy !== 'resolve'}
              />
              <span>{interpretation}</span>
            </label>
          ))}
        </div>
      </div>

      <footer className="ambiguity-card-footer">
        <div className="ambiguity-controls-row">
          <label className="ambiguity-control-item">
            <span>处理策略</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              {Object.entries(strategyLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="ambiguity-control-item flex-1">
            <span>裁定说明 / 证据</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="说明保留或选择该释义的文本依据…"
            />
          </label>

          <label className="ambiguity-lock-checkbox">
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
            <span>锁定</span>
          </label>

          <button type="button" className="ambiguity-save-btn" disabled={busy} onClick={() => void save()}>
            <Check size={14} />
            <span>{busy ? '保存中…' : '保存裁定'}</span>
          </button>
        </div>

        {message && <p className="ambiguity-msg">{message}</p>}
      </footer>
    </article>
  );
};

export const MemoryLedger = ({ projectId }: { readonly projectId: string }) => {
  const api = window.kitaujiDesktop?.workflow;
  const [facts, setFacts] = useState<readonly MemoryFactRecord[]>([]);
  const [ambiguities, setAmbiguities] = useState<readonly AmbiguityRecord[]>([]);
  const [assignment, setAssignment] = useState<SeriesAssignmentRecord | null>(null);
  const [series, setSeries] = useState<readonly SeriesSummaryRecord[]>([]);
  const [seriesName, setSeriesName] = useState('');
  const [volumeOrdinal, setVolumeOrdinal] = useState('1');
  const [seriesMessage, setSeriesMessage] = useState('');
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [tabView, setTabView] = useState<'memory' | 'ambiguity' | 'series'>('memory');
  const [agentOpen, setAgentOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [nextFacts, nextAmbiguities, nextAssignment, nextSeries] = await Promise.all([
        api.memory(projectId),
        api.ambiguities(projectId),
        api.seriesAssignment(projectId),
        api.listSeries(),
      ]);
      setFacts(nextFacts);
      setAmbiguities(nextAmbiguities);
      setAssignment(nextAssignment);
      setSeries(nextSeries);
      if (nextAssignment) {
        setSeriesName(nextAssignment.name);
        setVolumeOrdinal(String(nextAssignment.volumeOrdinal));
      }
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleFacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facts.filter((fact) => {
      if (classFilter !== 'all' && (fact.memoryClass || 'canon') !== classFilter) return false;
      if (!q) return true;
      return (
        fact.statement.toLowerCase().includes(q) ||
        (fact.subjectKey && fact.subjectKey.toLowerCase().includes(q)) ||
        (fact.objectKey && fact.objectKey.toLowerCase().includes(q)) ||
        (fact.evidenceExcerpt && fact.evidenceExcerpt.toLowerCase().includes(q))
      );
    });
  }, [facts, classFilter, query]);

  const confirmedCount = useMemo(
    () => facts.filter((f) => ['confirmed', 'locked', 'consolidated'].includes(f.status)).length,
    [facts],
  );

  const hypothesisCount = useMemo(
    () => facts.filter((f) => f.status === 'hypothesis' || f.status === 'candidate').length,
    [facts],
  );

  const saveSeries = async () => {
    if (!api) return;
    const result = await api.assignSeries(projectId, {
      name: seriesName.trim(),
      volumeOrdinal: Number(volumeOrdinal),
    });
    if (result.status === 'error') setSeriesMessage(result.message);
    else {
      setSeriesMessage('系列归属已绑定；当前作品会自动继承同系列前卷已确认且无冲突的记忆。');
      await load();
    }
  };

  const removeSeries = async () => {
    if (!api) return;
    const result = await api.unassignSeries(projectId);
    if (result.status === 'error') setSeriesMessage(result.message);
    else {
      setAssignment(null);
      setSeriesName('');
      setSeriesMessage('已解除系列绑定，跨卷记忆将不再注入模型提示词。');
      await load();
    }
  };

  return (
    <div className="knowledge-page memory-page">
      {/* 1. Header */}
      <header className="knowledge-header">
        <div className="knowledge-header-title">
          <div className="knowledge-header-icon">
            <Network size={22} />
          </div>
          <div>
            <p className="eyebrow">长程记忆</p>
            <h1>作品设定与叙事记忆库</h1>
            <p className="knowledge-meta-line">
              共记录 <strong>{facts.length}</strong> 条叙事事实　/　
              <span style={{ color: '#15803d' }}>{confirmedCount}</span> 条已确认设定　/　
              <span style={{ color: '#b45309' }}>{hypothesisCount}</span> 条待印证假说　/　
              <span>{ambiguities.length}</span> 处文学歧义
            </p>
          </div>
        </div>
        <div className="knowledge-header-actions">
          <DomainAgentTriggerButton label="AI 记忆管理助理" onClick={() => setAgentOpen(true)} />
        </div>
      </header>

      {/* 2. Top Segmented View Switcher & Filter Bar */}
      <div className="memory-tabs-bar">
        <div className="memory-tabs-group">
          <button
            type="button"
            className={`tab-btn ${tabView === 'memory' ? 'active' : ''}`}
            onClick={() => setTabView('memory')}
          >
            <Sparkles size={14} />
            <span>长程事实时间线 ({facts.length})</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${tabView === 'ambiguity' ? 'active' : ''}`}
            onClick={() => setTabView('ambiguity')}
          >
            <HelpCircle size={14} />
            <span>文学歧义裁定箱 ({ambiguities.length})</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${tabView === 'series' ? 'active' : ''}`}
            onClick={() => setTabView('series')}
          >
            <GitBranch size={14} />
            <span>系列跨卷记忆 ({assignment ? `第 ${assignment.volumeOrdinal} 卷` : '未绑定'})</span>
          </button>
        </div>

        {tabView === 'memory' && (
          <div className="knowledge-search-wrap">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索叙事事实、人物、台词证据…"
            />
          </div>
        )}
      </div>

      {/* 3. Sub-filter bar for memory class */}
      {tabView === 'memory' && (
        <div className="memory-class-filter-bar">
          <span>设定分类：</span>
          {[
            { id: 'all', label: '全部记忆' },
            { id: 'canon', label: '作品主设定' },
            { id: 'character', label: '人物模型' },
            { id: 'relationship', label: '关系模型' },
            { id: 'event', label: '关键事件' },
            { id: 'state', label: '时态状态' },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`filter-btn ${classFilter === id ? 'active' : ''}`}
              onClick={() => setClassFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 4. Tab Contents */}
      <main className="memory-main-content">
        {tabView === 'memory' && (
          <div className="memory-fact-stream">
            {loading ? (
              <div className="knowledge-loading">正在调取全书长程记忆…</div>
            ) : visibleFacts.length ? (
              visibleFacts.map((fact) => (
                <article key={fact.factId} className="fact-card-item">
                  <header className="fact-card-head">
                    <div className="fact-head-badges">
                      <span className="chapter-pill">第 {fact.chapterStart} 章</span>
                      <span className={`memory-class-badge class-${fact.memoryClass || 'canon'}`}>
                        {memoryClassLabel[fact.memoryClass || 'canon'] || '作品设定'}
                      </span>
                      <span className="fact-kind-tag">{factLabel[fact.factKind] ?? fact.factKind}</span>
                      {fact.readerVisibleFrom > fact.chapterStart && (
                        <span className="visibility-pill">
                          第 {fact.readerVisibleFrom} 章后读者可知
                        </span>
                      )}
                    </div>
                    <span className={`status-pill status-${fact.status}`}>
                      {fact.status === 'locked' && <Lock size={11} />}
                      {statusLabel[fact.status] ?? fact.status} · 置信度 {Math.round(fact.confidence * 100)}%
                    </span>
                  </header>

                  <div className="fact-statement-box">
                    <p className="fact-statement-text">
                      {fact.subjectKey && <strong className="entity-highlight">{fact.subjectKey}</strong>}
                      {fact.objectKey && <span className="entity-arrow"> ➔ {fact.objectKey}</span>}
                      <span className="fact-desc">：{fact.statement}</span>
                    </p>
                  </div>

                  {fact.evidenceExcerpt && (
                    <blockquote className="fact-evidence-quote" lang="ja">
                      “{fact.evidenceExcerpt}”
                    </blockquote>
                  )}
                </article>
              ))
            ) : (
              <div className="knowledge-empty-placeholder">
                <Network size={36} />
                <p>全书预读完成后将在此自动呈现长程设定事实与世界线状态。</p>
              </div>
            )}
          </div>
        )}

        {tabView === 'ambiguity' && (
          <div className="ambiguity-stream">
            {ambiguities.length ? (
              ambiguities.map((item) => (
                <AmbiguityCard key={item.ambiguityId} item={item} onSaved={load} />
              ))
            ) : (
              <div className="knowledge-empty-placeholder">
                <HelpCircle size={36} />
                <p>当前作品未发现需要特殊保留或裁定的文学多义与双关歧义项。</p>
              </div>
            )}
          </div>
        )}

        {tabView === 'series' && (
          <div className="series-binding-container">
            <div className="series-banner-card">
              <div className="series-banner-icon">
                <GitBranch size={28} />
              </div>
              <div className="series-banner-info">
                <h3>系列跨卷长程记忆</h3>
                <p>
                  将属于同一长篇轻小说的多卷作品绑定至同一系列名下。在翻译后卷时，AI 将自动继承前卷中已经由人工确认锁定的专名、角色性别与世界观事实，实现全系列跨卷零冲突。
                </p>
              </div>
            </div>

            <div className="series-form-card">
              <h4>当前作品系列归属设置</h4>
              <div className="series-inputs-row">
                <label className="series-input-label">
                  <span>系列名称</span>
                  <input
                    value={seriesName}
                    onChange={(e) => setSeriesName(e.target.value)}
                    placeholder="如：幼女战记、吹响吧！上低音号…"
                  />
                </label>
                <label className="series-input-label width-small">
                  <span>第几卷 (卷序)</span>
                  <input
                    type="number"
                    min="1"
                    value={volumeOrdinal}
                    onChange={(e) => setVolumeOrdinal(e.target.value)}
                  />
                </label>
              </div>

              <div className="series-actions-row">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={!seriesName.trim()}
                  onClick={() => void saveSeries()}
                >
                  <Link2 size={14} /> 保存系列归属
                </button>
                {assignment && (
                  <button type="button" className="danger-quiet-btn" onClick={() => void removeSeries()}>
                    <Unlink size={14} /> 解除系列绑定
                  </button>
                )}
              </div>

              {seriesMessage && <p className="series-feedback">{seriesMessage}</p>}
            </div>

            {series.length > 0 && (
              <div className="series-existing-card">
                <h4>工作区已有系列总览</h4>
                <div className="series-chips-list">
                  {series.map((s) => (
                    <button
                      key={s.seriesId}
                      type="button"
                      className="series-chip-item"
                      onClick={() => {
                        setSeriesName(s.name);
                        setVolumeOrdinal(String(s.volumeCount + 1));
                      }}
                    >
                      <strong>{s.name}</strong>
                      <span>已录入 {s.volumeCount} 卷</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <DomainAgentDrawer
        projectId={projectId}
        domain="memory"
        isOpen={agentOpen}
        onClose={() => setAgentOpen(false)}
        onUpdated={load}
      />
    </div>
  );
};
