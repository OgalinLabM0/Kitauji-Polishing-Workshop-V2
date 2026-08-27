import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, ShieldCheck, X } from 'lucide-react';
import type { ReviewQueueRecord } from '../../core/workflow/models';
import { DomainAgentDrawer } from '../agent/DomainAgentDrawer';
import '../../styles/review.css';

const categoryLabel: Record<string, string> = { 'hard-rule': '忠实硬规则', semantic: '语义判断', glossary: '术语冲突', identity: '人物身份', 'knowledge-boundary': '知识边界', 'literary-choice': '文学多解', format: '格式结构', 'provider-refusal': '接口拒绝' };

const ReviewCard = ({ item, onResolved }: { item: ReviewQueueRecord; onResolved: () => Promise<void> }) => {
  const api = window.kitaujiDesktop?.workflow;
  const [text, setText] = useState(item.proposedText ?? item.currentTranslation ?? item.originalTranslation ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolve = async (action: 'accept' | 'reject') => {
    if (!api) return; setBusy(true); setError(null);
    try { const result = await api.resolveReview(item.reviewId, action, action === 'accept' ? text : undefined); if (result.status === 'error') setError(result.message); else await onResolved(); }
    finally { setBusy(false); }
  };
  return <article className={`review-card review-card--${item.severity}`}><header><span>{item.severity === 'must-human' ? '必须人工' : item.severity === 'blocking' ? '阻断' : '警告'}</span><b>{categoryLabel[item.category] ?? item.category}</b>{item.chapterOrdinal !== null && <small>第 {item.chapterOrdinal} 章 · 段 {item.segmentOrdinal}</small>}<time>{new Date(item.createdAt).toLocaleString()}</time></header><h2>{item.title}</h2><p className="review-explanation">{item.explanation}</p><div className="review-columns"><section><h3>日文原文</h3><p lang="ja">{item.sourceText ?? '无段落原文'}</p></section><section><h3>原译文</h3><p>{item.originalTranslation ?? '无既有译文'}</p></section><section><h3>当前 / 候选稿</h3><textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} /></section></div>{item.contextExcerpt && <details className="review-context"><summary>展开前后文与旧译</summary><pre>{item.contextExcerpt}</pre></details>}{error && <p className="review-error">{error}</p>}<footer><button type="button" disabled={busy || !text.trim()} onClick={() => void resolve('accept')}><Check size={14} />核对后接受</button><button type="button" disabled={busy} className="reject" onClick={() => void resolve('reject')}><X size={14} />驳回并重做</button></footer></article>;
};

export const ReviewQueue = ({ projectId }: { readonly projectId: string }) => {
  const api = window.kitaujiDesktop?.workflow;
  const [items, setItems] = useState<readonly ReviewQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="review-page">
      <header>
        <ShieldCheck size={22} />
        <div>
          <p className="eyebrow">质量复核</p>
          <h1>复核队列</h1>
          <p>查看并裁定需要人工介入的专名冲突、语义分歧与重要文学多解。</p>
        </div>
        <strong>{items.length}</strong>
        <div style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="glossary-agent-trigger-btn"
            onClick={() => setAgentOpen(true)}
          >
            <Bot size={15} />
            <span>AI 审校仲裁助理</span>
          </button>
        </div>
      </header>
      <main>
        {loading ? (
          <p className="review-empty">正在加载复核队列…</p>
        ) : items.length ? (
          items.map((item) => <ReviewCard key={item.reviewId} item={item} onResolved={load} />)
        ) : (
          <p className="review-empty">当前队列已清空，暂无待复核事项。</p>
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
