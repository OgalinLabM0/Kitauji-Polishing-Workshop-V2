import { useMemo, useState } from 'react';
import { Filter, Import, ScanSearch, Search, ShieldCheck } from 'lucide-react';
import type { GlossaryReviewStatus } from '../../core/glossary/models';
import { GlossaryImportDialog } from './GlossaryImportDialog';
import { GlossaryInspector, type GlossaryReviewDecision } from './GlossaryInspector';
import { buildImportedGlossaryItems, type GlossaryImportHandling } from './importedGlossaryItems';
import { GLOSSARY_DEMO_ITEMS, type GlossaryDemoItem } from './sampleGlossaryData';
import '../../styles/glossary.css';

type StatusFilter = 'all' | GlossaryReviewStatus;

interface EntryReviewState {
  readonly selectedCandidate: string;
  readonly selectedResolution: string;
  readonly decision: GlossaryReviewDecision;
}

const statusFilters: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'review', label: '未定' },
  { value: 'locked', label: '锁定' },
  { value: 'conflict', label: '冲突' },
  { value: 'rejected', label: '排除' },
] as const;

export const GlossaryWorkshop = () => {
  const hashQuery = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? ''), []);
  const initialImportMode = hashQuery.get('import');
  const [importedItems, setImportedItems] = useState<readonly GlossaryDemoItem[]>([]);
  const [importOpen, setImportOpen] = useState(initialImportMode === 'single' || initialImportMode === 'batch-demo');
  const [importFeedback, setImportFeedback] = useState('');
  const items = useMemo(() => [...GLOSSARY_DEMO_ITEMS, ...importedItems], [importedItems]);
  const [selectedId, setSelectedId] = useState(() => {
    const requestedEntry = hashQuery.get('entry');
    return GLOSSARY_DEMO_ITEMS.some((item) => item.entry.entryId === requestedEntry)
      ? requestedEntry as string
      : GLOSSARY_DEMO_ITEMS[0].entry.entryId;
  });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [reviewState, setReviewState] = useState<Record<string, EntryReviewState>>(() =>
    Object.fromEntries(GLOSSARY_DEMO_ITEMS.map((item) => [
      item.entry.entryId,
      {
        selectedCandidate: item.entry.canonicalChinese || item.candidates[0] || '',
        selectedResolution: item.wordplays[0]?.proposedChineseRenderings[0] ?? '',
        decision: item.entry.status === 'locked' || item.entry.status === 'approved'
          ? 'approved'
          : item.entry.status === 'rejected'
            ? 'excluded'
            : 'pending',
      },
    ])),
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const matchesStatus = status === 'all' || item.entry.status === status;
      const haystack = [
        item.entry.sourceTerm,
        item.entry.canonicalChinese,
        item.entry.senseSummary,
        item.reviewRoute.label,
        item.reviewRoute.reason,
        ...item.entry.sourceAliases,
        ...item.wordplays.flatMap((wordplay) => [
          wordplay.heardOrAlternateForm,
          wordplay.narrativeMeaning,
          ...wordplay.proposedChineseRenderings,
        ]),
        ...item.evidence.flatMap((occurrence) => [
          occurrence.japaneseExcerpt,
          occurrence.translatedChineseExcerpt ?? '',
          occurrence.renderedChineseForm ?? '',
          occurrence.sceneLabel,
        ]),
      ].join('\n').toLocaleLowerCase();
      return matchesStatus && (normalizedQuery.length === 0 || haystack.includes(normalizedQuery));
    });
  }, [items, query, status]);

  const selectedItem = filteredItems.find((item) => item.entry.entryId === selectedId)
    ?? filteredItems[0]
    ?? items[0];
  const selectedReviewState = reviewState[selectedItem.entry.entryId] ?? {
    selectedCandidate: selectedItem.entry.canonicalChinese || selectedItem.candidates[0] || '',
    selectedResolution: selectedItem.wordplays[0]?.proposedChineseRenderings[0] ?? '',
    decision: 'pending',
  };

  const updateSelectedReview = (update: Partial<EntryReviewState>) => {
    setReviewState((current) => ({
      ...current,
      [selectedItem.entry.entryId]: { ...selectedReviewState, ...update },
    }));
  };

  const humanCount = items.filter((item) => item.reviewRoute.kind === 'human').length;
  const modelReviewCount = items.filter((item) => item.reviewRoute.kind === 'model-review').length;
  const settledCount = items.length - humanCount - modelReviewCount;

  const importRecords = (records: Parameters<typeof buildImportedGlossaryItems>[0], handling: GlossaryImportHandling) => {
    const nextItems = buildImportedGlossaryItems(records, handling, importedItems.length);
    setImportedItems((current) => [...current, ...nextItems]);
    setImportOpen(false);
    setStatus('all');
    setQuery('');
    if (nextItems[0]) setSelectedId(nextItems[0].entry.entryId);
    setImportFeedback(`已加入 ${nextItems.length} 个词条 · 本次会话`);
  };

  return (
    <div className="glossary-scroll">
      <header className="glossary-page-head">
        <div>
          <h1>术语表</h1>
          <p>样例项目　/　{items.length} 个词条　/　{humanCount} 项待处理</p>
        </div>
        <div className="glossary-page-actions">
          <button className="quiet-button" type="button" onClick={() => setImportOpen(true)}><Import size={14} />导入</button>
          <button className="start-button" type="button" disabled title="尚未连接作品"><ScanSearch size={14} />扫描原文</button>
        </div>
      </header>

      <div className="glossary-runline">
        <div>
          <span>已处理 <strong className="tabular-number">{settledCount}</strong></span>
          <span>模型复核 <strong className="tabular-number">{modelReviewCount}</strong></span>
          <span>待人工 <strong className="tabular-number">{humanCount}</strong></span>
        </div>
        <small>{importFeedback || '样例数据 · 不保存'}</small>
      </div>

      <section className="glossary-editor">
        <div className="glossary-list-panel">
          <header className="glossary-toolbar">
            <label className="glossary-search">
              <Search size={14} />
              <span className="sr-only">搜索术语</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索词条、译名或原句" />
            </label>
            <div className="glossary-filters" aria-label="状态筛选">
              <Filter size={13} />
              {statusFilters.map((filter) => (
                <button key={filter.value} type="button" className={status === filter.value ? 'active' : ''} onClick={() => setStatus(filter.value)}>
                  {filter.label}
                </button>
              ))}
            </div>
          </header>

          <div className="glossary-table" role="table" aria-label="术语候选">
            <div className="glossary-row glossary-row--header" role="row">
              <span>处理</span><span>原词 / 说明</span><span>中文</span><span>实体</span><span>出现</span>
            </div>
            {filteredItems.map((item) => (
              <button
                type="button"
                role="row"
                className={`glossary-row ${selectedItem.entry.entryId === item.entry.entryId ? 'selected' : ''}`}
                key={item.entry.entryId}
                onClick={() => setSelectedId(item.entry.entryId)}
              >
                <span className={`glossary-status glossary-status--route-${item.reviewRoute.kind}`}>{item.reviewRoute.label}</span>
                <span className="glossary-term-cell">
                  <strong lang="ja">{item.entry.sourceTerm}</strong>
                  <small>{item.entry.senseSummary}</small>
                </span>
                <span className="glossary-chinese">{item.entry.canonicalChinese || '—'}</span>
                <span>{item.categoryLabel}</span>
                <span className="tabular-number">{item.entry.occurrenceCount}</span>
              </button>
            ))}
            {filteredItems.length === 0 && <p className="glossary-empty">没有结果。</p>}
          </div>

          <footer className="glossary-list-footer">
            <ShieldCheck size={14} />
            <span>自动结果可抽查、可改判；漏译、增译和结构错误不能由模型放行。</span>
          </footer>
        </div>

        <GlossaryInspector
          item={selectedItem}
          selectedCandidate={selectedReviewState.selectedCandidate}
          selectedResolution={selectedReviewState.selectedResolution}
          reviewDecision={selectedReviewState.decision}
          onSelectCandidate={(candidate) => updateSelectedReview({ selectedCandidate: candidate, decision: 'pending' })}
          onSelectResolution={(resolution) => updateSelectedReview({ selectedResolution: resolution, decision: 'pending' })}
          onReviewDecision={(decision) => updateSelectedReview({ decision })}
        />
      </section>
      <GlossaryImportDialog
        open={importOpen}
        existingMappings={items.map((item) => ({ sourceTerm: item.entry.sourceTerm, canonicalChinese: item.entry.canonicalChinese }))}
        initialTab={initialImportMode === 'batch-demo' ? 'batch' : 'single'}
        initialBatchText={initialImportMode === 'batch-demo' ? '麗奈 => 丽奈\n黄前久美子 => 黄前久美子\nソルフェージュ => 视唱练耳' : ''}
        onClose={() => setImportOpen(false)}
        onImport={importRecords}
      />
    </div>
  );
};
