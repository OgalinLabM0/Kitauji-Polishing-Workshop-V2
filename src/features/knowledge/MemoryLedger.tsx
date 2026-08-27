import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Check, GitBranch, Link2, Network, Search, Unlink } from 'lucide-react';
import type { AmbiguityRecord, MemoryFactRecord, SeriesAssignmentRecord, SeriesSummaryRecord } from '../../core/workflow/models';
import { DomainAgentDrawer } from '../agent/DomainAgentDrawer';
import '../../styles/knowledge.css';

const factLabel: Record<string, string> = { character: '人物状态', event: '事件', relationship: '关系变化', address: '称呼', voice: '说话风格', viewpoint: '叙述视角', setting: '场景设定', secret: '秘密', foreshadowing: '伏笔', pun: '双关 / 谐音', 'scene-summary': '场景摘要', 'chapter-summary': '章节摘要' };
const statusLabel: Record<string, string> = { confirmed: '已确认', locked: '已锁定', hypothesis: '待后文印证', conflict: '证据冲突', consolidated: '已巩固', candidate: '候选', archived: '已归档', superseded: '历史状态' };
const memoryClassLabel: Record<string, string> = { canon: '作品设定', character: '人物模型', relationship: '关系模型', event: '关键事件', state: '时间状态', 'episode-detail': '情节细节' };
const ambiguityLabel: Record<string, string> = { pun: '双关', identity: '身份', referent: '指代', scope: '作用域', role: '动作方向', voice: '语态', temporal: '时间', narrative: '叙事层', other: '其他' };
const strategyLabel: Record<string, string> = { preserve: '保留原文多解', resolve: '选择确定解释', transliterate: '音译保留', annotate: '译注说明', review: '继续人工复核' };

const AmbiguityRow = ({ item, onSaved }: { readonly item: AmbiguityRecord; readonly onSaved: () => Promise<void> }) => {
  const api = window.kitaujiDesktop?.workflow;
  const [strategy, setStrategy] = useState(item.preservationStrategy);
  const [selected, setSelected] = useState(item.selectedInterpretation ?? '');
  const [note, setNote] = useState(item.resolutionNote);
  const [lock, setLock] = useState(item.status === 'locked');
  const [message, setMessage] = useState('');
  const save = async () => {
    if (!api) return;
    const result = await api.resolveAmbiguity(item.ambiguityId, {
      preservationStrategy: strategy as 'preserve' | 'resolve' | 'transliterate' | 'annotate' | 'review',
      selectedInterpretation: selected || null, note, lock,
    });
    if (result.status === 'error') setMessage(result.message);
    else { setMessage('裁定已保存；已有译文会进入重新核对。'); await onSaved(); }
  };
  return <article className="ambiguity-row">
    <header>
      <span className="knowledge-chip">{ambiguityLabel[item.ambiguityKind] ?? item.ambiguityKind}</span>
      <strong>第 {item.chapterOrdinal} 章 · 段 {item.segmentOrdinal}{item.sourceStartOffset !== null ? ` · Offset ${item.sourceStartOffset}–${item.sourceEndOffset}` : ''}</strong>
      <em>{statusLabel[item.status] ?? item.status} · {Math.round(item.confidence * 100)}%</em>
    </header>
    <blockquote lang="ja">{item.sourceExcerpt}</blockquote>
    <div className="ambiguity-options">
      {item.interpretations.map((interpretation, index) => <label key={`${item.ambiguityId}:${index}`}>
        <input type="radio" name={item.ambiguityId} value={interpretation} checked={selected === interpretation}
          onChange={() => setSelected(interpretation)} disabled={strategy !== 'resolve'} />
        <span>{interpretation}</span>
      </label>)}
    </div>
    <footer>
      <label><span>处理策略</span><select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{Object.entries(strategyLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="ambiguity-note"><span>裁定说明</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明保留或选择这一策略的证据…" /></label>
      <label className="ambiguity-lock"><input type="checkbox" checked={lock} onChange={(event) => setLock(event.target.checked)} />锁定</label>
      <button type="button" onClick={() => void save()}><Check size={14} />保存裁定</button>
    </footer>
    {message && <p className="knowledge-message">{message}</p>}
  </article>;
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
  const [kind, setKind] = useState('all');
  const [view, setView] = useState<'memory' | 'ambiguity'>('memory');
  const [agentOpen, setAgentOpen] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    const [nextFacts, nextAmbiguities, nextAssignment, nextSeries] = await Promise.all([
      api.memory(projectId), api.ambiguities(projectId), api.seriesAssignment(projectId), api.listSeries(),
    ]);
    setFacts(nextFacts); setAmbiguities(nextAmbiguities); setAssignment(nextAssignment); setSeries(nextSeries);
    if (nextAssignment) { setSeriesName(nextAssignment.name); setVolumeOrdinal(String(nextAssignment.volumeOrdinal)); }
  }, [api, projectId]);
  useEffect(() => { void load(); }, [load]);
  const kinds = useMemo(() => [...new Set(facts.map((fact) => fact.factKind))], [facts]);
  const visible = useMemo(() => facts.filter((fact) => (kind === 'all' || fact.factKind === kind) && (!query.trim() || [fact.statement, fact.subjectKey, fact.objectKey, fact.evidenceExcerpt].some((value) => value?.includes(query.trim())))), [facts, kind, query]);
  const saveSeries = async () => {
    if (!api) return;
    const result = await api.assignSeries(projectId, { name: seriesName, volumeOrdinal: Number(volumeOrdinal) });
    if (result.status === 'error') setSeriesMessage(result.message);
    else { setSeriesMessage('系列归属已保存；只会继承更早卷中已确认且无冲突的记忆。'); await load(); }
  };
  const removeSeries = async () => {
    if (!api) return;
    const result = await api.unassignSeries(projectId);
    if (result.status === 'error') setSeriesMessage(result.message);
    else { setAssignment(null); setSeriesName(''); setSeriesMessage('已解除系列归属，跨卷记忆不会再进入提示词。'); await load(); }
  };
  return <div className="knowledge-page memory-page">
    <header>
      <Network size={22} />
      <div>
        <p className="eyebrow">事件与记忆</p>
        <h1>人类阅读记忆库</h1>
        <p>按证据、时间、读者知识和保留等级巩固作品认知；旧状态保留为历史，不会被新事实直接删除。</p>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <button
          type="button"
          className="glossary-agent-trigger-btn"
          onClick={() => setAgentOpen(true)}
        >
          <Bot size={15} />
          <span>AI 记忆管理助理</span>
        </button>
      </div>
    </header>
    <section className="series-rail">
      <header><GitBranch size={17} /><div><strong>跨卷系列记忆</strong><span>{assignment ? `${assignment.name} · ${assignment.volumeLabel}` : '未关联系列：当前作品保持完全隔离'}</span></div></header>
      <div className="series-fields">
        <label><span>系列名称</span><input list="known-series" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="必须由你明确填写，不自动猜书名" /></label>
        <datalist id="known-series">{series.map((item) => <option key={item.seriesId} value={item.name}>{item.volumeCount} 卷</option>)}</datalist>
        <label className="series-volume"><span>卷序</span><input type="number" min="1" max="10000" value={volumeOrdinal} onChange={(event) => setVolumeOrdinal(event.target.value)} /></label>
        <button type="button" onClick={() => void saveSeries()}><Link2 size={14} />保存关联</button>
        {assignment && <button type="button" className="quiet" onClick={() => void removeSeries()}><Unlink size={14} />解除</button>}
      </div>
      {seriesMessage && <p className="knowledge-message">{seriesMessage}</p>}
    </section>
    <nav className="knowledge-view-tabs" aria-label="记忆视图">
      <button type="button" className={view === 'memory' ? 'active' : ''} onClick={() => setView('memory')}>分层记忆 <span>{facts.length}</span></button>
      <button type="button" className={view === 'ambiguity' ? 'active' : ''} onClick={() => setView('ambiguity')}>歧义工作台 <span>{ambiguities.filter((item) => ['open', 'candidate'].includes(item.status)).length}</span></button>
    </nav>
    {view === 'memory' ? <>
      <div className="memory-toolbar"><label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事实或原文证据…" /></label><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">全部类别</option>{kinds.map((value) => <option key={value} value={value}>{factLabel[value] ?? value}</option>)}</select></div>
      <main className="memory-ledger">{visible.length ? visible.map((fact) => <article key={fact.factId}><header><span>{factLabel[fact.factKind] ?? fact.factKind}</span><b>{Math.round(fact.confidence * 100)}%</b><em>{statusLabel[fact.consolidationStatus ?? fact.status] ?? fact.consolidationStatus ?? fact.status}</em></header><div><strong>{fact.subjectKey ?? '全局'}{fact.objectKey ? ` → ${fact.objectKey}` : ''}</strong><p>{fact.statement}</p><div className="memory-chips"><span>{memoryClassLabel[fact.memoryClass ?? ''] ?? fact.memoryClass ?? '未分类'}</span><span>重要度 {Math.round((fact.importance ?? 0.5) * 100)}</span><span>{fact.retentionPolicy ?? 'episodic'}</span><span>{fact.retrievalScope ?? 'volume'}</span></div></div><footer><span>生效：第 {fact.chapterStart} 章{fact.chapterStartSegment ? ` · 段 ${fact.chapterStartSegment}` : ''}{fact.chapterStartOffset !== null && fact.chapterStartOffset !== undefined ? ` · Offset ${fact.chapterStartOffset}` : ''}</span><span>读者可知：第 {fact.readerVisibleFrom} 章</span></footer><blockquote lang="ja">{fact.evidenceExcerpt}</blockquote></article>) : <p className="knowledge-empty">暂无事件与记忆记录。完成新版全书预读后将按场景、章节和卷自动巩固。</p>}</main>
    </> : <main className="ambiguity-workbench">
      <header><AlertTriangle size={17} /><div><strong>多解、双关与指向裁定</strong><p>候选解释不会自动成为事实。选择“保留原文多解”时，翻译模型被禁止擅自选边。</p></div></header>
      {ambiguities.length ? ambiguities.map((item) => <AmbiguityRow key={item.ambiguityId} item={item} onSaved={load} />) : <p className="knowledge-empty">暂无需要裁定的歧义。新版预读会把双关、指代、动作方向和叙事层多解单独保存。</p>}
    </main>}
    <DomainAgentDrawer
      projectId={projectId}
      domain="memory"
      isOpen={agentOpen}
      onClose={() => setAgentOpen(false)}
      onUpdated={load}
    />
  </div>;
};
