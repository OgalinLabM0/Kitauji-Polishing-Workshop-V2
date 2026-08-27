import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  FileText,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { ReviewQueueRecord } from '../../core/workflow/models';
import { DomainAgentDrawer, DomainAgentTriggerButton } from '../agent/DomainAgentDrawer';
import '../../styles/review.css';

const categoryLabel: Record<string, string> = {
  'hard-rule': '忠实硬规则',
  semantic: '语义偏差',
  glossary: '术语冲突',
  identity: '人物称谓',
  'knowledge-boundary': '知识边界',
  'literary-choice': '文学多解',
  format: '格式排版',
  'provider-refusal': '模型拒绝',
};

const severityLabel: Record<string, { label: string; chipClass: string }> = {
  blocking: { label: '阻断 (必须解决)', chipClass: 'severity-blocking' },
  'must-human': { label: '人工裁定', chipClass: 'severity-must-human' },
  warning: { label: '优化建议', chipClass: 'severity-warning' },
};

const ReviewCard = ({
  item,
  onResolved,
}: {
  readonly item: ReviewQueueRecord;
  readonly onResolved: () => Promise<void>;
}) => {
  const api = window.kitaujiDesktop?.workflow;
  const [text, setText] = useState(
    item.proposedText ?? item.currentTranslation ?? item.originalTranslation ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  const resolve = async (action: 'accept' | 'reject') => {
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.resolveReview(item.reviewId, action, action === 'accept' ? text : undefined);
      if (result.status === 'error') setError(result.message);
      else await onResolved();
    } finally {
      setBusy(false);
    }
  };

  const sev = severityLabel[item.severity] ?? { label: item.severity, chipClass: 'severity-warning' };

  return (
    <article className={`review-card-item ${sev.chipClass}`}>
      <header className="review-card-head">
        <div className="review-card-head-left">
          <span className={`review-severity-pill ${sev.chipClass}`}>{sev.label}</span>
          <span className="review-category-chip">{categoryLabel[item.category] ?? item.category}</span>
          {item.chapterOrdinal !== null && (
            <span className="review-location-pill">
              第 {item.chapterOrdinal} 章 · 段 {item.segmentOrdinal}
            </span>
          )}
        </div>
        <time className="review-time">{new Date(item.createdAt).toLocaleDateString()}</time>
      </header>

      <div className="review-title-box">
        <h3>{item.title}</h3>
        <p className="review-explanation-text">{item.explanation}</p>
      </div>

      <div className="review-comparison-grid">
        <div className="review-pane review-pane--source">
          <div className="pane-title">
            <span>🇯🇵 日文原文</span>
          </div>
          <p className="pane-content" lang="ja">
            {item.sourceText ?? '（无段落原文）'}
          </p>
        </div>

        <div className="review-pane review-pane--original">
          <div className="pane-title">
            <span>📜 原译参考文</span>
          </div>
          <p className="pane-content">{item.originalTranslation ?? '（无既有译文）'}</p>
        </div>

        <div className="review-pane review-pane--target">
          <div className="pane-title">
            <span>✍️ 当前润色成稿 / 修正提案</span>
            <small>{text.length} 字</small>
          </div>
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="在此直接调整修正译文…"
          />
        </div>
      </div>

      {item.contextExcerpt && (
        <div className="review-context-accordion">
          <button
            type="button"
            className="context-toggle-btn"
            onClick={() => setContextOpen(!contextOpen)}
          >
            <FileText size={13} />
            <span>{contextOpen ? '收起前后文与旧译上下文' : '展开前后文与旧译上下文'}</span>
          </button>
          {contextOpen && (
            <pre className="context-content-box" lang="ja">
              {item.contextExcerpt}
            </pre>
          )}
        </div>
      )}

      {error && (
        <div className="review-error-box">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      <footer className="review-card-footer">
        <div className="review-actions-row">
          <button
            type="button"
            className="review-accept-btn"
            disabled={busy || !text.trim()}
            onClick={() => void resolve('accept')}
          >
            <Check size={14} />
            <span>{busy ? '保存中…' : '采纳并确认当前稿'}</span>
          </button>
          <button
            type="button"
            className="review-reject-btn"
            disabled={busy}
            onClick={() => void resolve('reject')}
          >
            <X size={14} />
            <span>驳回此条并重润色</span>
          </button>
        </div>
      </footer>
    </article>
  );
};

export const ReviewQueue = ({ projectId }: { readonly projectId: string }) => {
  const api = window.kitaujiDesktop?.workflow;
  const [items, setItems] = useState<readonly ReviewQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [agentOpen, setAgentOpen] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      setItems(await api.reviews(projectId));
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const blockingCount = useMemo(() => items.filter((i) => i.severity === 'blocking').length, [items]);
  const mustHumanCount = useMemo(() => items.filter((i) => i.severity === 'must-human').length, [items]);
  const warningCount = useMemo(() => items.filter((i) => i.severity === 'warning').length, [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.explanation.toLowerCase().includes(q) ||
        (item.sourceText && item.sourceText.toLowerCase().includes(q)) ||
        (item.currentTranslation && item.currentTranslation.toLowerCase().includes(q))
      );
    });
  }, [items, severityFilter, categoryFilter, query]);

  return (
    <div className="review-page">
      {/* 1. Header */}
      <header className="review-header">
        <div className="review-header-title">
          <div className="review-header-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <p className="eyebrow">质量复核</p>
            <h1>译文审校与仲裁队列</h1>
            <p className="review-meta-line">
              共 <strong>{items.length}</strong> 项待复核　/　
              <span className="count-blocking">{blockingCount} 项阻断</span>　/　
              <span className="count-must-human">{mustHumanCount} 项待人工</span>　/　
              <span className="count-warning">{warningCount} 项优化建议</span>
            </p>
          </div>
        </div>
        <div className="review-header-actions">
          <DomainAgentTriggerButton label="AI 审校仲裁助理" onClick={() => setAgentOpen(true)} />
        </div>
      </header>

      {/* 2. Filter Bar */}
      <div className="review-filter-bar">
        <div className="review-filter-groups">
          <div className="filter-group">
            <span>严重性：</span>
            {[
              { id: 'all', label: '全部' },
              { id: 'blocking', label: '阻断' },
              { id: 'must-human', label: '人工裁定' },
              { id: 'warning', label: '建议' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`filter-btn ${severityFilter === id ? 'active' : ''}`}
                onClick={() => setSeverityFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="filter-group">
            <span>规则分类：</span>
            {[
              { id: 'all', label: '全部分类' },
              { id: 'hard-rule', label: '忠实硬规则' },
              { id: 'glossary', label: '术语冲突' },
              { id: 'literary-choice', label: '文学多解' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`filter-btn ${categoryFilter === id ? 'active' : ''}`}
                onClick={() => setCategoryFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="review-search-wrap">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索复核问题、原文或译文…"
          />
        </div>
      </div>

      {/* 3. Review Cards Stream */}
      <main className="review-main-stream">
        {loading ? (
          <div className="review-loading-box">正在加载复核队列…</div>
        ) : filteredItems.length ? (
          filteredItems.map((item) => <ReviewCard key={item.reviewId} item={item} onResolved={load} />)
        ) : (
          <div className="review-empty-box">
            <ShieldCheck size={40} className="review-empty-icon" />
            <h3>当前复核队列全部清空</h3>
            <p>暂无待人工确认的术语冲突、翻译腔规则或硬规则警告。所有章节均处于健康定稿状态。</p>
          </div>
        )}
      </main>

      <DomainAgentDrawer
        projectId={projectId}
        domain="review"
        isOpen={agentOpen}
        onClose={() => setAgentOpen(false)}
        onUpdated={load}
      />
    </div>
  );
};
