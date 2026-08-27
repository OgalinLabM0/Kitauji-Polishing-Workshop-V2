import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  HelpCircle,
  Import,
  Info,
  Lock,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { GlossaryRecord } from '../../core/workflow/models';
import type { GlossaryImportHandling } from './importedGlossaryItems';
import { GlossaryImportDialog } from './GlossaryImportDialog';
import { GlossaryAgentDrawer } from './GlossaryAgentDrawer';
import '../../styles/glossary.css';

interface ProjectGlossaryProps {
  readonly projectId: string;
  readonly projectTitle: string;
}

const statusLabel: Record<string, string> = {
  candidate: '待核对',
  confirmed: '已确认',
  locked: '已锁定',
  conflict: '冲突',
  rejected: '已排除',
};

const kindLabel: Record<string, string> = {
  character: '人物',
  animal: '动物',
  place: '地点',
  organization: '组织',
  item: '物品',
  ability: '能力',
  concept: '概念',
  other: '其他',
};

const genderLabel: Record<string, string> = {
  unknown: '未知',
  male: '男',
  female: '女',
  nonbinary: '非二元',
  'not-applicable': '不适用',
};

export const ProjectGlossary = ({ projectId, projectTitle }: ProjectGlossaryProps) => {
  const api = window.kitaujiDesktop?.workflow;
  const [items, setItems] = useState<readonly GlossaryRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState({ translatedTerm: '', notes: '', epubNote: '' });
  const [showStatusHelp, setShowStatusHelp] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const next = await api.glossary(projectId);
      setItems(next);
      setSelectedId((current) =>
        next.some((item) => item.glossaryId === current) ? current : next[0]?.glossaryId ?? '',
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '无法读取术语表。');
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const [minFrequency, setMinFrequency] = useState<number>(2);

  const selected = items.find((item) => item.glossaryId === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setDraft({
        translatedTerm: selected.translatedTerm,
        notes: selected.notes,
        epubNote: selected.epubNote,
      });
    }
  }, [selected]);

  const recurringCount = useMemo(() => items.filter((item) => item.occurrenceCount >= 2).length, [items]);
  const singleCount = useMemo(() => items.filter((item) => item.occurrenceCount === 1).length, [items]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (minFrequency > 1 && item.status !== 'locked' && item.status !== 'confirmed') {
        if (item.occurrenceCount < minFrequency) return false;
      }
      if (!normalized) return true;
      return [
        item.sourceTerm,
        item.translatedTerm,
        item.reading,
        item.sense,
        item.notes,
        ...item.evidence.map((evidence) => evidence.sourceExcerpt),
      ].some((value) => value?.toLocaleLowerCase().includes(normalized));
    });
  }, [items, query, minFrequency]);

  const update = async (status: 'candidate' | 'confirmed' | 'locked' | 'rejected') => {
    if (!api || !selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.updateGlossary(selected.glossaryId, { ...draft, status });
      if (result.status === 'error') {
        setMessage(result.message);
      } else {
        setMessage(
          status === 'locked'
            ? '译名已锁定（最高保护），AI 预读无法覆盖修改。'
            : status === 'confirmed'
              ? '术语已确认为正式标准。'
              : '术语状态已更新。',
        );
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const importRecords = async (
    records: readonly {
      sourceTerm: string;
      canonicalChinese: string;
      category?: string;
      note?: string;
      pronunciation?: string;
    }[],
    handling: GlossaryImportHandling,
  ) => {
    if (!api) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.importGlossary(projectId, records, handling === 'locked');
      if (result.status === 'error') {
        setMessage(result.message);
      } else {
        setMessage(`已写入 ${result.data.imported} 个术语。`);
        setImportOpen(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const isLocked = selected?.status === 'locked';
  const isConfirmed = selected?.status === 'confirmed';

  return (
    <div className="glossary-scroll project-glossary">
      <header className="glossary-page-head">
        <div>
          <h1>术语与专名</h1>
          <p>
            {projectTitle}　/　{items.length} 个词条　/　
            <strong style={{ color: '#15803d' }}>{recurringCount}</strong> 个复现术语 (≥2次)　/　
            <span style={{ color: '#8c8580' }}>{singleCount}</span> 个单次候选 (1次)　/　
            {items.filter((item) => ['candidate', 'conflict'].includes(item.status)).length} 项待核对
          </p>
        </div>
        <div className="glossary-page-actions">
          <button
            className="glossary-agent-btn"
            type="button"
            onClick={() => setAgentOpen(true)}
            title="通过自然语言与 AI 助理交互，批量审查、规范译名与人物性别"
          >
            <Bot size={15} /> 🤖 AI 术语审阅助理 (Agent)
          </button>
          <button
            className="quiet-button"
            type="button"
            onClick={() => setShowStatusHelp(!showStatusHelp)}
            title="查看锁定与确认状态的规则说明"
          >
            <Info size={14} /> 状态说明
          </button>
          <button className="quiet-button" type="button" onClick={() => setImportOpen(true)}>
            <Import size={14} /> 导入术语
          </button>
        </div>
      </header>

      {/* Glossary Status Legend Card */}
      {showStatusHelp && (
        <div className="glossary-status-guide-card">
          <div className="guide-header">
            <strong>💡 术语分级保护机制说明</strong>
            <button type="button" onClick={() => setShowStatusHelp(false)}>✕</button>
          </div>
          <div className="guide-grid">
            <div className="guide-item guide-item--locked">
              <span className="guide-badge"><Lock size={12} /> 已锁定 (强保护)</span>
              <p>最高人工保护级别。任何 AI 全书预读或重新分析均<strong>绝对无法覆盖或修改</strong>此条目。在翻译润色时享有最高排他优先级。随时可点击「解除锁定」。</p>
            </div>
            <div className="guide-item guide-item--confirmed">
              <span className="guide-badge"><CheckCircle2 size={12} /> 已确认 (有效标准)</span>
              <p>人工审核通过的有效译名。在翻译和复核时作为权威词汇表直接注入给模型，保持全书译名严密统一。</p>
            </div>
            <div className="guide-item guide-item--candidate">
              <span className="guide-badge"><HelpCircle size={12} /> 待核对 (AI 候选)</span>
              <p>由全书预读自动提取生成的初稿候选。若重新运行全书预读，可能会被更新的分析结果刷新。</p>
            </div>
          </div>
        </div>
      )}

      {message && <p className="project-glossary-message">{message}</p>}

      <div className="glossary-freq-filter-bar">
        <div className="glossary-freq-filter-group">
          <span>频次筛选标准：</span>
          <button
            type="button"
            className={`freq-btn ${minFrequency === 2 ? 'active' : ''}`}
            onClick={() => setMinFrequency(2)}
            title="推荐模式：仅展示全书出现 2 次及以上的复现专名，排除仅出现 1 次的孤立词"
          >
            ⚡ 推荐 (≥2次 · 过滤孤立词)
          </button>
          <button
            type="button"
            className={`freq-btn ${minFrequency === 1 ? 'active' : ''}`}
            onClick={() => setMinFrequency(1)}
            title="全部展示：包含仅出现 1 次的所有候选专名"
          >
            全部 (≥1次)
          </button>
          <button
            type="button"
            className={`freq-btn ${minFrequency === 3 ? 'active' : ''}`}
            onClick={() => setMinFrequency(3)}
            title="高频核心：仅展示全书出现 3 次及以上的高频核心专名"
          >
            高频 (≥3次)
          </button>
        </div>
        <small style={{ color: '#88807a', fontSize: '12px' }}>
          {minFrequency > 1 ? `已过滤单次孤立词（当前显示 ${filtered.length} / ${items.length} 个条目）` : `当前显示全部 ${items.length} 个条目`}
        </small>
      </div>

      <section className="project-glossary-layout">
        <div className="project-glossary-list">
          <label>
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索原词、译名、语境…"
            />
          </label>
          <header>
            <span>状态</span>
            <span>日文 / 中文</span>
            <span>频次 / 类别</span>
          </header>
          <div className="project-glossary-items">
            {loading ? (
              <p>正在加载词条…</p>
            ) : filtered.length ? (
              filtered.map((item) => (
                <button
                  type="button"
                  key={item.glossaryId}
                  className={`${item.glossaryId === selectedId ? 'active' : ''} item-status--${item.status}`}
                  onClick={() => setSelectedId(item.glossaryId)}
                >
                  <b className={`status-tag status-tag--${item.status}`}>
                    {item.status === 'locked' && <Lock size={10} />}
                    {statusLabel[item.status] ?? item.status}
                  </b>
                  <span>
                    <strong lang="ja">{item.sourceTerm}</strong>
                    <small>{item.translatedTerm}</small>
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <span className={`glossary-occurrence-badge ${item.occurrenceCount >= 3 ? 'glossary-occurrence-badge--high' : item.occurrenceCount === 1 ? 'glossary-occurrence-badge--single' : ''}`}>
                      {item.occurrenceCount >= 2 ? `⚡ ${item.occurrenceCount}次` : `${item.occurrenceCount}次`}
                    </span>
                    <em>{kindLabel[item.entityKind] ?? item.entityKind}</em>
                  </div>
                </button>
              ))
            ) : (
              <p className="empty-hint">暂无符合当前频次条件的专名术语。</p>
            )}
          </div>
        </div>

        {selected ? (
          <article className="project-glossary-inspector">
            <header>
              <div>
                <p lang="ja">{selected.sourceTerm}</p>
                <h2>{selected.translatedTerm}</h2>
              </div>
              <div className="inspector-top-badges">
                <span className={`status-pill status-pill--${selected.status}`}>
                  {selected.status === 'locked' && <Lock size={12} />}
                  {statusLabel[selected.status] ?? selected.status}
                </span>
                <span className="confidence-pill">{Math.round(selected.confidence * 100)}% 置信度</span>
              </div>
            </header>

            {/* Contextual Status Card */}
            {isLocked ? (
              <div className="glossary-status-card status-card--locked">
                <Lock size={16} />
                <div>
                  <strong>已锁定（最高保护）</strong>
                  <p>该条目受强保护，任何 AI 预读重跑均无法修改或覆盖。在翻译时享有最高强制优先级。随时可点击下方「解除锁定」。</p>
                </div>
              </div>
            ) : isConfirmed ? (
              <div className="glossary-status-card status-card--confirmed">
                <CheckCircle2 size={16} />
                <div>
                  <strong>已确认为正式术语</strong>
                  <p>人工已审核认可的术语，翻译润色阶段将作为正式标准注入给模型。若需防止未来重跑预读影响，可点击「锁定译名」。</p>
                </div>
              </div>
            ) : (
              <div className="glossary-status-card status-card--candidate">
                <HelpCircle size={16} />
                <div>
                  <strong>待人工核对（AI 提取候选）</strong>
                  <p>由全书预读自动生成的初稿。核对或修改译名后，请点击「确认译名」或「锁定译名」将其固化为正式标准。</p>
                </div>
              </div>
            )}

            <dl>
              <div>
                <dt>读音</dt>
                <dd lang="ja">{selected.reading || '未记录'}</dd>
              </div>
              <div>
                <dt>实体类型</dt>
                <dd>{kindLabel[selected.entityKind] ?? selected.entityKind}</dd>
              </div>
              <div>
                <dt>性别设定</dt>
                <dd>{genderLabel[selected.gender] ?? selected.gender}</dd>
              </div>
              <div>
                <dt>人数单复</dt>
                <dd>
                  {selected.grammaticalNumber === 'not-applicable'
                    ? '不适用'
                    : selected.grammaticalNumber === 'unknown'
                      ? '未知'
                      : selected.grammaticalNumber}
                </dd>
              </div>
              <div>
                <dt>适用语境</dt>
                <dd>{selected.sense}</dd>
              </div>
              <div>
                <dt>全书出现频次</dt>
                <dd>
                  <span className={`glossary-occurrence-badge ${selected.occurrenceCount >= 3 ? 'glossary-occurrence-badge--high' : selected.occurrenceCount === 1 ? 'glossary-occurrence-badge--single' : ''}`}>
                    {selected.occurrenceCount >= 2 ? `⚡ 全书共出现 ${selected.occurrenceCount} 次 (复现专名)` : `全书仅出现 ${selected.occurrenceCount} 次 (单次孤立词)`}
                  </span>
                </dd>
              </div>
            </dl>

            <section className="glossary-edit-fields">
              <label>
                中文译名
                <input
                  value={draft.translatedTerm}
                  onChange={(event) => setDraft({ ...draft, translatedTerm: event.target.value })}
                />
              </label>
              <label>
                判断备注
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  placeholder="记录该译名的考据来源或特殊语境说明…"
                />
              </label>
              <label>
                导出书籍注释（选填）
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={draft.epubNote}
                  onChange={(event) => setDraft({ ...draft, epubNote: event.target.value })}
                  placeholder="可选。若需要在导出 EPUB 时添加读者注释（例如日文谐音双关或文化背景解释），可在此填写。"
                />
              </label>
            </section>

            <section className="glossary-real-evidence">
              <h3>正文出现证据</h3>
              {selected.evidence.length ? (
                selected.evidence.map((evidence, index) => (
                  <article key={`${evidence.chapterId}-${index}`}>
                    <span>{evidence.chapterId}</span>
                    <p lang="ja">{evidence.sourceExcerpt}</p>
                    <p>{evidence.translationExcerpt ?? '该处尚无中文成稿。'}</p>
                  </article>
                ))
              ) : (
                <p className="empty-hint">该词条暂未关联到正文段落证据。</p>
              )}
            </section>

            <footer>
              {isLocked ? (
                <>
                  <button
                    type="button"
                    className="btn-save"
                    disabled={busy}
                    onClick={() => void update('locked')}
                    title="保存对当前锁定条目的修改并继续保持锁定"
                  >
                    <Save size={14} /> 保存修改
                  </button>
                  <button
                    type="button"
                    className="btn-unlock"
                    disabled={busy}
                    onClick={() => void update('confirmed')}
                    title="解除强锁定保护，降为已确认状态"
                  >
                    <Unlock size={14} /> 解除锁定
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-confirm"
                    disabled={busy}
                    onClick={() => void update('confirmed')}
                    title="确认此译名，作为正式术语"
                  >
                    <Save size={14} /> 确认译名
                  </button>
                  <button
                    type="button"
                    className="btn-lock"
                    disabled={busy}
                    onClick={() => void update('locked')}
                    title="锁定此译名（强保护，重跑预读绝对不被覆盖）"
                  >
                    <Lock size={14} /> 锁定译名
                  </button>
                </>
              )}
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void update('rejected')}
                title="排除此项，翻译模型将忽略该词条"
              >
                <Trash2 size={14} /> 排除此项
              </button>
            </footer>
          </article>
        ) : (
          <div className="project-glossary-inspector project-glossary-inspector--empty">
            <ShieldCheck size={24} />
            <p>请从左侧选择词条，查看原文、译名、释义与正文出处。</p>
          </div>
        )}
      </section>
      <GlossaryImportDialog
        open={importOpen}
        existingMappings={items.map((item) => ({
          sourceTerm: item.sourceTerm,
          canonicalChinese: item.translatedTerm,
        }))}
        onClose={() => setImportOpen(false)}
        onImport={(records, handling) => void importRecords(records, handling)}
      />
      <GlossaryAgentDrawer
        projectId={projectId}
        isOpen={agentOpen}
        onClose={() => setAgentOpen(false)}
        onUpdated={() => void load()}
      />
    </div>
  );
};
