import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  FileOutput,
  PencilLine,
  RotateCcw,
  Save,
} from 'lucide-react';
import type { ChapterContentBlock, ProjectChapterSummary, SaveBlockDraftResult } from '../../core/projects/models';
import type { ProjectLibrary } from '../projects/useProjectLibrary';
import { useChapterReader } from './useChapterReader';

const scriptLabel = (block: ChapterContentBlock) => {
  if (block.scriptKind === 'chinese') return '已有中文';
  if (block.scriptKind === 'japanese') return '日文原文';
  if (block.scriptKind === 'mixed') return '日中混合';
  if (block.scriptKind === 'text') return 'TXT 原文';
  return '结构文字';
};

interface BlockRowProps {
  readonly block: ChapterContentBlock;
  readonly saving: boolean;
  readonly onSave: (blockId: string, text: string | null) => Promise<SaveBlockDraftResult>;
}

const BlockRow = ({ block, saving, onSave }: BlockRowProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.draftText ?? block.sourceText);

  useEffect(() => {
    if (!editing) setDraft(block.draftText ?? block.sourceText);
  }, [block.draftText, block.sourceText, editing]);

  const save = async () => {
    const result = await onSave(block.blockId, draft);
    if (result.status === 'saved') setEditing(false);
  };

  return (
    <article className={`reading-block reading-block--${block.scriptKind}${block.draftText !== null ? ' has-draft' : ''}`}>
      <header>
        <span className="reading-block-number">{String(block.ordinal).padStart(5, '0')}</span>
        <span className="reading-kind">{scriptLabel(block)}</span>
        {block.pairedOrdinal && <span className="reading-pair">对应 {String(block.pairedOrdinal).padStart(5, '0')}</span>}
        {block.sourceLine && <span className="reading-line">源行 {block.sourceLine}</span>}
        {block.canEdit && !editing && (
          <button type="button" className="text-action" onClick={() => setEditing(true)}>
            <PencilLine size={13} /> {block.draftText === null ? '校改' : '继续修改'}
          </button>
        )}
      </header>
      <p className="reading-source" lang={block.language ?? undefined}>{block.sourceText}</p>
      {block.draftText !== null && !editing && (
        <div className="reading-draft"><span>校改稿</span><p>{block.draftText}</p></div>
      )}
      {editing && (
        <div className="reading-editor">
          <label htmlFor={`draft-${block.blockId}`}>校改后的中文</label>
          <textarea
            id={`draft-${block.blockId}`}
            value={draft}
            rows={Math.min(12, Math.max(4, Math.ceil(draft.length / 42)))}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div>
            <button type="button" className="save-draft" disabled={saving || !draft.trim()} onClick={() => void save()}>
              <Save size={14} /> {saving ? '保存中…' : '保存校改'}
            </button>
            {block.draftText !== null && (
              <button type="button" className="reset-draft" disabled={saving} onClick={() => void onSave(block.blockId, null).then((result) => result.status === 'saved' && setEditing(false))}>
                <RotateCcw size={14} /> 恢复原中文
              </button>
            )}
            <button type="button" className="cancel-draft" disabled={saving} onClick={() => { setDraft(block.draftText ?? block.sourceText); setEditing(false); }}>
              取消
            </button>
          </div>
        </div>
      )}
      {!block.canEdit && block.editRestriction && <p className="reading-restriction">{block.editRestriction}</p>}
    </article>
  );
};

type TocMode = 'both' | 'title' | 'href';

const formatWordCount = (chars: number) => {
  if (chars >= 10_000) return `${(chars / 10_000).toFixed(1)}万字`;
  if (chars > 0) return `${chars.toLocaleString()}字`;
  return '';
};

export const ChapterReader = ({ library }: { readonly library: ProjectLibrary }) => {
  const snapshot = library.activeProject;
  const reader = useChapterReader(snapshot);
  const content = reader.content;
  const pageStart = content && content.totalBlocks > 0 ? content.offset + 1 : 0;
  const pageEnd = content ? Math.min(content.totalBlocks, content.offset + content.blocks.length) : 0;
  const isEpub = snapshot?.project.sourceFormat === 'epub';
  const activeChapterButton = useRef<HTMLButtonElement | null>(null);

  const totalBookBlocks = useMemo(
    () => snapshot?.chapters.reduce((sum, c) => sum + c.paragraphCount, 0) ?? 0,
    [snapshot],
  );

  const accumulatedPriorBlocks = useMemo(() => {
    if (!snapshot || !content) return 0;
    let sum = 0;
    for (const chapter of snapshot.chapters) {
      if (chapter.chapterId === content.chapterId) break;
      sum += chapter.paragraphCount;
    }
    return sum;
  }, [snapshot, content]);

  const globalReadBlocks = accumulatedPriorBlocks + pageEnd;
  const globalProgressPercent = totalBookBlocks > 0
    ? Math.min(100, Math.round((globalReadBlocks / totalBookBlocks) * 100))
    : 0;

  const [tocMode, setTocMode] = useState<TocMode>(() => {
    try {
      return (localStorage.getItem('kitauji.toc.mode') as TocMode) || 'both';
    } catch {
      return 'both';
    }
  });
  const [searchQuery, setSearchQuery] = useState('');

  const handleTocModeChange = (mode: TocMode) => {
    setTocMode(mode);
    try {
      localStorage.setItem('kitauji.toc.mode', mode);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    activeChapterButton.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [content?.chapterId]);

  const visibleChapters = useMemo(() => {
    if (!snapshot) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return snapshot.chapters;
    return snapshot.chapters.filter((chapter) => {
      const matchTitle = chapter.title.toLowerCase().includes(query);
      const matchHref = (chapter.href ?? '').toLowerCase().includes(query);
      const matchOrdinal = chapter.ordinal.toString().includes(query);
      return matchTitle || matchHref || matchOrdinal;
    });
  }, [snapshot, searchQuery]);

  if (!snapshot) {
    return (
      <div className="chapter-reader-empty">
        <BookOpenText size={28} />
        <p className="eyebrow">章节与正文</p>
        <h1>先导入一部作品</h1>
        <p>导入 EPUB 或 TXT 后，可以在这里按原阅读顺序检查正文。</p>
      </div>
    );
  }

  return (
    <div className="chapter-workspace">
      <aside className="chapter-rail" aria-label="章节目录">
        <div className="chapter-rail-heading">
          <div className="chapter-rail-head-top">
            <div>
              <p className="eyebrow">目录与阅读顺序</p>
              <h2>{isEpub ? '书内项目' : '章节列表'}</h2>
            </div>
            <span className="chapter-total-count">{snapshot.chapters.length} 项</span>
          </div>

          {/* TOC Mode Switcher */}
          {isEpub && (
            <div className="chapter-toc-modes" role="group" aria-label="目录显示模式">
              <button
                type="button"
                className={tocMode === 'both' ? 'active' : ''}
                onClick={() => handleTocModeChange('both')}
                title="双显模式：同时显示章节标题与 XHTML 物理路径"
              >
                双显
              </button>
              <button
                type="button"
                className={tocMode === 'title' ? 'active' : ''}
                onClick={() => handleTocModeChange('title')}
                title="标题模式：仅显示章节主标题"
              >
                标题
              </button>
              <button
                type="button"
                className={tocMode === 'href' ? 'active' : ''}
                onClick={() => handleTocModeChange('href')}
                title="XHTML 模式：显示 EPUB 内部文件名路径"
              >
                XHTML
              </button>
            </div>
          )}

          {/* Search Box */}
          <div className="chapter-rail-search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索章节名或文件名…"
              aria-label="搜索目录"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} aria-label="清除搜索">
                ✕
              </button>
            )}
          </div>
        </div>

        <nav>
          {visibleChapters.length === 0 ? (
            <div className="chapter-rail-empty">
              <p>未找到匹配项</p>
            </div>
          ) : (
            visibleChapters.map((chapter: ProjectChapterSummary) => {
              const isActive = content?.chapterId === chapter.chapterId;
              const hasWordCount = chapter.characterCount > 0;
              return (
                <button
                  type="button"
                  key={chapter.chapterId}
                  ref={isActive ? activeChapterButton : undefined}
                  className={`chapter-item-btn${isActive ? ' active' : ''}${chapter.isNavigation ? ' is-nav' : ''}`}
                  onClick={() => void reader.openPage(chapter.chapterId, 0)}
                >
                  <span className="chapter-item-ord">{String(chapter.ordinal).padStart(2, '0')}</span>
                  <div className="chapter-item-info">
                    {tocMode === 'both' ? (
                      <>
                        <strong className="chapter-item-title" title={chapter.title}>
                          {chapter.title}
                        </strong>
                        {chapter.href && (
                          <span className="chapter-item-href" title={chapter.href}>
                            {chapter.href}
                          </span>
                        )}
                      </>
                    ) : tocMode === 'href' ? (
                      <strong className="chapter-item-title font-mono" title={chapter.href ?? chapter.title}>
                        {chapter.href ?? chapter.title}
                      </strong>
                    ) : (
                      <strong className="chapter-item-title" title={chapter.title}>
                        {chapter.title}
                      </strong>
                    )}

                    <div className="chapter-item-meta">
                      <span>{chapter.paragraphCount.toLocaleString()} 段</span>
                      {hasWordCount && <span>{formatWordCount(chapter.characterCount)}</span>}
                      {chapter.isNavigation && <span className="chapter-item-nav-tag">目次</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </nav>
      </aside>

      <section className="chapter-reading">
        <header className="chapter-reading-heading">
          <div>
            <p className="eyebrow">原文校读</p>
            <h1>{content?.chapterTitle ?? '正在打开正文…'}</h1>
            <p className="chapter-book-title">{snapshot.project.title}</p>
            <p className="chapter-source-path">{snapshot.project.sourcePath}</p>
          </div>
          <div className="chapter-export">
            <span>{reader.draftCount.toLocaleString()} 段已校改</span>
            <button
              type="button"
              disabled={!isEpub || reader.draftCount === 0 || reader.exporting}
              title={!isEpub ? 'TXT 导出将在翻译阶段接入' : reader.draftCount === 0 ? '先保存至少一段中文校改' : '从原 EPUB 快照生成新的校样副本'}
              onClick={() => void reader.exportEpub()}
            >
              <FileOutput size={15} /> {reader.exporting ? '校验并打包中…' : '导出 EPUB 校样'}
            </button>
          </div>
        </header>

        <div className="chapter-boundary-note">
          <CheckCircle2 size={16} />
          <p><strong>只改已有中文，日文原文不动</strong><span>普通中文段可保存校改；含 ruby、链接或强调的复杂段先锁定，避免扁平化破坏。</span></p>
        </div>

        {reader.notice && <p className="chapter-feedback chapter-feedback--success"><CheckCircle2 size={15} />{reader.notice}</p>}
        {reader.error && <p className="chapter-feedback chapter-feedback--error"><AlertTriangle size={15} />{reader.error}</p>}

        <div className="reading-page-status">
          <div className="reading-status-left">
            <span className="reading-status-badge">{content ? `第 ${content.chapterOrdinal} / ${snapshot.chapters.length} 节` : '读取中'}</span>
            <span className="reading-status-range">
              {content ? `本节 ${pageStart.toLocaleString()}–${pageEnd.toLocaleString()} / ${content.totalBlocks.toLocaleString()} 段` : '—'}
            </span>
          </div>
          <div className="reading-status-right">
            <span className="reading-global-percent">
              全书进度 <b>{globalProgressPercent}%</b>
            </span>
            <span className="reading-global-detail">
              ({globalReadBlocks.toLocaleString()} / {totalBookBlocks.toLocaleString()} 段)
            </span>
          </div>
        </div>
        <div className="reading-global-progress-bar">
          <div className="reading-global-progress-fill" style={{ width: `${globalProgressPercent}%` }} />
        </div>

        <div className="reading-blocks" aria-busy={reader.loading}>
          {reader.loading && !content ? <p className="reading-loading">正在读取正文…</p> : content?.blocks.map((block) => (
            <BlockRow
              key={block.blockId}
              block={block}
              saving={reader.savingBlockId === block.blockId}
              onSave={reader.saveDraft}
            />
          ))}
          {!reader.loading && content && content.blocks.length === 0 && (
            <p className="reading-loading">这个阅读项没有可校读的正文，可能只包含封面、插图或版式结构。</p>
          )}
        </div>

        {content && content.totalBlocks > reader.pageSize && (
          <footer className="reading-pagination">
            <button type="button" disabled={reader.loading || content.offset === 0} onClick={() => void reader.openPage(content.chapterId, Math.max(0, content.offset - reader.pageSize))}>
              <ArrowLeft size={14} /> 上一页
            </button>
            <span>{pageStart.toLocaleString()}–{pageEnd.toLocaleString()}</span>
            <button type="button" disabled={reader.loading || pageEnd >= content.totalBlocks} onClick={() => void reader.openPage(content.chapterId, content.offset + reader.pageSize)}>
              下一页 <ArrowRight size={14} />
            </button>
          </footer>
        )}
      </section>
    </div>
  );
};
