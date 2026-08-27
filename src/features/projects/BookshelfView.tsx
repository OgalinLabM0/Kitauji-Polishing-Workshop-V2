import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  FileText,
  FolderOpen,
  Languages,
  LayoutGrid,
  Library,
  List,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ProjectSummary } from '../../core/projects/models';
import type { ProjectLibrary } from './useProjectLibrary';

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
};

const modeLabel = (project: ProjectSummary) => {
  if (project.contentMode === 'bilingual') return '日中双语';
  if (project.contentMode === 'japanese') return '日文原书';
  return '待识别';
};

type ViewMode = 'grid' | 'list';
type SortOrder = 'recent' | 'title' | 'size';
type Confirmation =
  | { readonly kind: 'delete'; readonly project: ProjectSummary }
  | { readonly kind: 'clear' }
  | null;

interface BookshelfViewProps {
  readonly library: ProjectLibrary;
  readonly onOpen: (projectId: string) => Promise<void>;
}

export const BookshelfView = ({ library, onOpen }: BookshelfViewProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent');
  const [confirmation, setConfirmation] = useState<Confirmation>(() =>
    new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('confirm') === 'clear'
      ? { kind: 'clear' }
      : null,
  );
  const [clearPhrase, setClearPhrase] = useState('');

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    const filtered = normalized
      ? library.projects.filter((project) =>
          `${project.title}\n${project.sourcePath}`.toLocaleLowerCase('zh-CN').includes(normalized),
        )
      : [...library.projects];
    return filtered.sort((left, right) => {
      if (sortOrder === 'title') return left.title.localeCompare(right.title, 'zh-CN');
      if (sortOrder === 'size') return right.sourceSizeBytes - left.sourceSizeBytes;
      return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
    });
  }, [library.projects, query, sortOrder]);

  const closeConfirmation = () => {
    if (library.mutating) return;
    setConfirmation(null);
    setClearPhrase('');
  };

  const confirmAction = async () => {
    if (!confirmation) return;
    const succeeded =
      confirmation.kind === 'delete'
        ? await library.deleteProject(confirmation.project.projectId)
        : await library.clearProjects();
    if (succeeded) {
      setConfirmation(null);
      setClearPhrase('');
    }
  };

  return (
    <div className="workspace-scroll bookshelf-page">
      <header className="bookshelf-head">
        <div>
          <p className="eyebrow">作品库</p>
          <h1>我的书架</h1>
          <p>管理你的小说项目。导入、翻译润色与沉浸式阅读都从这里开启。</p>
        </div>
        <div className="bookshelf-head-actions">
          {library.projects.length > 0 && (
            <button
              type="button"
              className="danger-quiet"
              disabled={library.mutating}
              onClick={() => setConfirmation({ kind: 'clear' })}
            >
              <Trash2 size={15} /> 清空书架
            </button>
          )}
          <button
            type="button"
            className="start-button"
            disabled={!library.available || library.importing}
            onClick={() => void library.importSource()}
          >
            <Plus size={16} /> {library.importing ? '正在解析作品…' : '导入 EPUB / TXT'}
          </button>
        </div>
      </header>

      {library.error && <p className="library-message library-message--error">{library.error}</p>}
      {library.notice && <p className="library-message library-message--success">{library.notice}</p>}

      {library.projects.length > 0 && (
        <div className="bookshelf-toolbar">
          <div className="bookshelf-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索书名或文件位置…"
              aria-label="搜索书架"
            />
            {query && (
              <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="bookshelf-toolbar-controls">
            <span>
              {visibleProjects.length} / {library.projects.length} 部作品
            </span>

            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as SortOrder)}
              aria-label="书架排序"
            >
              <option value="recent">最近打开</option>
              <option value="title">按书名排序</option>
              <option value="size">按文件大小</option>
            </select>

            <div className="view-mode-toggle" role="group" aria-label="视图模式">
              <button
                type="button"
                className={viewMode === 'grid' ? 'active' : ''}
                title="网格视图"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                className={viewMode === 'list' ? 'active' : ''}
                title="列表视图"
                onClick={() => setViewMode('list')}
              >
                <List size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {library.loading ? (
        <div className="bookshelf-empty">
          <Library size={36} />
          <h2>正在加载书架…</h2>
          <p>正在读取作品库与章节索引</p>
        </div>
      ) : library.projects.length === 0 ? (
        <section className="bookshelf-empty">
          <Library size={42} />
          <h2>书架还是空的</h2>
          <p>导入日文原书或日中双语小说，开启全书预读、高质量翻译与沉浸式阅读体验。</p>
          <button
            type="button"
            className="start-button"
            disabled={!library.available || library.importing}
            onClick={() => void library.importSource()}
          >
            <FolderOpen size={16} /> 选择 EPUB 或 TXT 文件
          </button>
        </section>
      ) : visibleProjects.length === 0 ? (
        <section className="bookshelf-empty">
          <Search size={36} />
          <h2>未找到匹配的作品</h2>
          <p>换一个关键词搜索，或清除筛选条件。</p>
          <button type="button" className="quiet-button" onClick={() => setQuery('')}>
            清除搜索
          </button>
        </section>
      ) : viewMode === 'grid' ? (
        <div className="bookshelf-grid" aria-label="作品卡片列表">
          {visibleProjects.map((project) => (
            <article
              className={`book-card${
                project.projectId === library.activeProject?.project.projectId ? ' book-card--active' : ''
              }`}
              key={project.projectId}
              onClick={() => void onOpen(project.projectId)}
            >
              <div className="book-card-cover">
                <span className="book-card-badge">
                  {project.sourceFormat.toUpperCase()} · {modeLabel(project)}
                </span>
                {project.coverDataUrl ? (
                  <img
                    src={project.coverDataUrl}
                    alt={project.title}
                    className="book-card-cover-img"
                    loading="lazy"
                  />
                ) : (
                  <div className="book-card-placeholder">
                    {project.sourceFormat === 'epub' ? (
                      <BookOpen size={36} />
                    ) : (
                      <FileText size={36} />
                    )}
                    <span>{project.title}</span>
                  </div>
                )}
              </div>

              <div className="book-card-body">
                <h2 className="book-card-title" title={project.title}>
                  {project.title}
                </h2>

                <div className="book-card-meta">
                  <span>
                    {project.chapterCount} 章 · {project.paragraphCount.toLocaleString()} 段
                  </span>
                  <span>{formatBytes(project.sourceSizeBytes)}</span>
                </div>

                <div className="book-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="open-btn"
                    onClick={() => void onOpen(project.projectId)}
                  >
                    <Sparkles size={13} /> 进入工坊 <ArrowRight size={13} />
                  </button>
                  <button
                    type="button"
                    className="delete-btn"
                    aria-label={`从书架删除《${project.title}》`}
                    title="从书架删除"
                    onClick={() => setConfirmation({ kind: 'delete', project })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}

          {/* Upload Card (Placed to the right of existing books) */}
          <div
            className="book-upload-card"
            role="button"
            tabIndex={0}
            onClick={() => void library.importSource()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') void library.importSource();
            }}
          >
            <Plus size={32} />
            <strong>导入新作品</strong>
            <span>支持 EPUB / TXT</span>
          </div>
        </div>
      ) : (
        <section className="bookshelf-list" aria-label="作品列表">
          <div className="bookshelf-list-head" aria-hidden="true">
            <span />
            <span>作品</span>
            <span>内容模式</span>
            <span>规模</span>
            <span>最近打开</span>
            <span />
          </div>
          {visibleProjects.map((project) => (
            <article
              className={
                project.projectId === library.activeProject?.project.projectId ? 'active' : ''
              }
              key={project.projectId}
            >
              <div className="book-spine" aria-hidden="true">
                {project.sourceFormat === 'epub' ? <BookOpen size={20} /> : <FileText size={20} />}
              </div>
              <div className="book-identity">
                <h2>{project.title}</h2>
                <p>{project.sourcePath}</p>
              </div>
              <div className="book-kind">
                <strong>{project.sourceFormat.toUpperCase()}</strong>
                <span>
                  <Languages size={12} />
                  {modeLabel(project)}
                </span>
              </div>
              <div className="book-scale">
                <strong>
                  {project.chapterCount} 章 · {project.paragraphCount.toLocaleString()} 段
                </strong>
                <span>{formatBytes(project.sourceSizeBytes)}</span>
              </div>
              <time dateTime={project.lastOpenedAt}>{formatDate(project.lastOpenedAt)}</time>
              <div className="book-row-actions">
                <button
                  type="button"
                  className="delete-book"
                  aria-label={`删除《${project.title}》`}
                  title="从书架删除"
                  onClick={() => setConfirmation({ kind: 'delete', project })}
                >
                  <Trash2 size={14} />
                </button>
                <button
                  type="button"
                  className="open-book"
                  onClick={() => void onOpen(project.projectId)}
                >
                  打开作品
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {confirmation && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={closeConfirmation}>
          <section
            className="destructive-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <AlertTriangle size={22} />
              <div>
                <p className="eyebrow">书架管理</p>
                <h2 id="delete-title">
                  {confirmation.kind === 'delete'
                    ? '从书架移除这部作品？'
                    : '确认清空整个书架？'}
                </h2>
              </div>
            </header>
            {confirmation.kind === 'delete' ? (
              <>
                <strong className="delete-target">{confirmation.project.title}</strong>
                <p>
                  将从书架移除该作品及其本地译文草稿与阅读记录。磁盘上的原始文件不会受到任何影响。
                </p>
              </>
            ) : (
              <>
                <p>
                  将移除书架中的 {library.projects.length} 部作品记录。磁盘上的原始文件不会受到任何影响。
                </p>
                <label className="clear-confirm-label">
                  请输入“清空”以确认操作：
                  <input
                    autoFocus
                    value={clearPhrase}
                    onChange={(event) => setClearPhrase(event.target.value)}
                    placeholder="输入 清空"
                  />
                </label>
              </>
            )}
            <footer>
              <button
                type="button"
                className="cancel-dialog"
                disabled={library.mutating}
                onClick={closeConfirmation}
              >
                取消
              </button>
              <button
                type="button"
                className="confirm-delete"
                disabled={
                  library.mutating ||
                  (confirmation.kind === 'clear' && clearPhrase.trim() !== '清空')
                }
                onClick={() => void confirmAction()}
              >
                {library.mutating
                  ? '正在处理…'
                  : confirmation.kind === 'delete'
                  ? '确认移除'
                  : '确认清空'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
};

