import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileText,
  Info,
  Image as ImageIcon,
  Languages,
  List,
  Maximize2,
  Minimize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import type { ProjectLibrary } from '../projects/useProjectLibrary';
import type { WorkbenchSegment } from '../../core/workflow/models';
import {
  useCalibreReader,
  type ReaderFontFamily,
  type ReaderLayout,
  type ReaderMode,
  type ReaderPreferences,
  type ReaderTheme,
} from './useCalibreReader';
import { mergeReaderSegments, readerModeNotice } from './readerContentPolicy';
import '../../styles/reader.css';

const DEFAULT_PREFERENCES: ReaderPreferences = {
  mode: 'final',
  layout: 'scroll',
  theme: 'ivory',
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.85,
  letterSpacing: 0.5,
  paragraphSpacing: 1.2,
  indent: true,
  width: 820,
};

const PREFS_STORAGE_KEY = 'kitauji_reader_prefs_v2';

const loadPreferences = (): ReaderPreferences => {
  try {
    const saved = localStorage.getItem(PREFS_STORAGE_KEY);
    if (saved) return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
  } catch (e) {
    console.warn('Failed to load reader preferences:', e);
  }
  return DEFAULT_PREFERENCES;
};

const modeLabels: Record<ReaderMode, { label: string; icon: typeof Sparkles; tip: string }> = {
  final: { label: '润色定稿', icon: Sparkles, tip: '纯中文精修定稿' },
  bilingual: { label: '双语精读', icon: Columns2, tip: '日中段落对称精读' },
  source: { label: '日文原著', icon: Languages, tip: '日文原版生肉（含振假名）' },
  original: { label: '原译参考', icon: FileText, tip: '既有旧译参考文' },
};

const themeLabels: Record<ReaderTheme, { label: string; color: string }> = {
  ivory: { label: '象牙暖白', color: '#faf7f2' },
  white: { label: '极简雅白', color: '#ffffff' },
  sepia: { label: '羊皮复古', color: '#f4ece1' },
  dark: { label: '北宇治褐', color: '#1c1917' },
  oled: { label: 'OLED纯黑', color: '#000000' },
};

export const ReaderView = ({ library }: { readonly library: ProjectLibrary }) => {
  const project = library.activeProject;
  const workflow = window.kitaujiDesktop?.workflow;
  const projects = window.kitaujiDesktop?.projects;
  const chapters = project?.chapters ?? [];

  const [chapterIndex, setChapterIndex] = useState(() => {
    if (!project?.readingPosition?.chapterId) return 0;
    const idx = chapters.findIndex((c) => c.chapterId === project.readingPosition!.chapterId);
    return idx >= 0 ? idx : 0;
  });

  const [segments, setSegments] = useState<readonly WorkbenchSegment[]>([]);
  const [preferences, setPreferences] = useState<ReaderPreferences>(loadPreferences);
  const [sidebarTab, setSidebarTab] = useState<'toc' | 'gallery' | 'stats'>('toc');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocSearch, setTocSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [segmentLoadError, setSegmentLoadError] = useState<string | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(true);

  const chapter = chapters[chapterIndex] ?? null;

  // Save preferences
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(preferences));
    } catch (e) {
      console.warn('Failed to save reader preferences:', e);
    }
  }, [preferences]);

  // Load segments for current chapter
  useEffect(() => {
    if (!project || !chapter) {
      setSegments([]);
      setSegmentsLoading(false);
      return;
    }
    let isMounted = true;

    setSegments([]);
    setSegmentLoadError(null);
    setSegmentsLoading(true);
    void (async () => {
      const collected: WorkbenchSegment[] = [];
      if (workflow) {
        let offset = 0;
        let total = 1;
        while (offset < total) {
          const page = await workflow.workbench(project.project.projectId, chapter.chapterId, offset, 200);
          collected.push(...page.segments);
          total = page.total;
          if (!page.segments.length) break;
          offset += page.segments.length;
        }
      }

      if (projects) {
        const blocks = [] as NonNullable<Awaited<ReturnType<typeof projects.readChapter>>>['blocks'][number][];
        let offset = 0;
        let total = 1;
        while (offset < total) {
          const page = await projects.readChapter(project.project.projectId, chapter.chapterId, offset, 200);
          if (!page) break;
          blocks.push(...page.blocks);
          total = page.totalBlocks;
          if (!page.blocks.length) break;
          offset += page.blocks.length;
        }
        if (isMounted) setSegments(mergeReaderSegments(blocks, collected, chapter.chapterId, chapter.ordinal));
      } else if (isMounted) {
        setSegments(collected);
      }
    })().catch((reason) => {
      if (isMounted) setSegmentLoadError(reason instanceof Error ? reason.message : '无法读取章节译文状态。');
    }).finally(() => {
      if (isMounted) setSegmentsLoading(false);
    });

    // Save reading position
    if (projects?.saveReadingPosition) {
      void projects.saveReadingPosition(project.project.projectId, chapter.chapterId, 1);
    }

    return () => {
      isMounted = false;
    };
  }, [project, chapter, workflow, projects]);

  // Calibre Reader Hook
  const {
    chapterHtml,
    loading: chapterLoading,
    renderError,
    gallery,
    lightboxImage,
    setLightboxImage,
    iframeRef,
  } = useCalibreReader(project, chapter, segments, preferences);
  const modeNotice = readerModeNotice(segments, preferences.mode);

  // Filtered TOC Chapters
  const filteredChapters = useMemo(() => {
    const q = tocSearch.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter(
      (c) => c.title.toLowerCase().includes(q) || String(c.ordinal).includes(q),
    );
  }, [chapters, tocSearch]);

  // Word count & Reading stats
  const chapterWordCount = useMemo(() => {
    return segments.reduce((sum, seg) => sum + (seg.selectedTranslation || seg.sourceText).length, 0);
  }, [segments]);

  const estimatedReadingMinutes = Math.max(1, Math.round(chapterWordCount / 350));

  // Toggle Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      void document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  return (
    <div className={`calibre-reader-app theme-${preferences.theme}`}>
      {/* 1. Top Calibre Navigation Toolbar */}
      <header className="calibre-toolbar">
        <div className="calibre-toolbar-left">
          <button
            type="button"
            className={`toolbar-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          >
            {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>

          <div className="toolbar-book-title" title={project?.project.title}>
            <BookOpen size={15} className="book-icon" />
            <span>{project?.project.title || '北宇治沉浸阅读器'}</span>
          </div>
        </div>

        <div className="calibre-toolbar-center">
          {/* 4 View Modes Segmented Control */}
          <div className="reader-mode-segmented">
            {(['final', 'bilingual', 'source', 'original'] as const).map((m) => {
              const info = modeLabels[m];
              const Icon = info.icon;
              return (
                <button
                  key={m}
                  type="button"
                  className={`mode-tab-btn ${preferences.mode === m ? 'active' : ''}`}
                  onClick={() => setPreferences((p) => ({ ...p, mode: m }))}
                  title={info.tip}
                >
                  <Icon size={14} />
                  <span>{info.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="calibre-toolbar-right">
          {/* Theme Quick Switcher */}
          <div className="theme-quick-pills">
            {(['ivory', 'white', 'sepia', 'dark', 'oled'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`theme-dot-btn ${preferences.theme === t ? 'active' : ''}`}
                style={{ backgroundColor: themeLabels[t].color }}
                onClick={() => setPreferences((p) => ({ ...p, theme: t }))}
                title={themeLabels[t].label}
              />
            ))}
          </div>

          {/* Typography Settings Button */}
          <div className="settings-popover-anchor">
            <button
              type="button"
              className={`toolbar-btn ${settingsOpen ? 'active' : ''}`}
              onClick={() => setSettingsOpen(!settingsOpen)}
              title="排版与字体设置"
            >
              <Type size={17} />
            </button>

            {/* Typography Floating Popover */}
            {settingsOpen && (
              <div className="calibre-settings-popover">
                <div className="popover-header">
                  <h4>出版级排版定制</h4>
                  <button type="button" onClick={() => setSettingsOpen(false)}>
                    <X size={14} />
                  </button>
                </div>

                <div className="popover-body">
                  {/* Font Family */}
                  <div className="setting-control-row">
                    <span>正文字体</span>
                    <div className="font-family-pills">
                      <button
                        type="button"
                        className={preferences.fontFamily === 'serif' ? 'active' : ''}
                        onClick={() => setPreferences((p) => ({ ...p, fontFamily: 'serif' }))}
                      >
                        宋体/明朝
                      </button>
                      <button
                        type="button"
                        className={preferences.fontFamily === 'sans' ? 'active' : ''}
                        onClick={() => setPreferences((p) => ({ ...p, fontFamily: 'sans' }))}
                      >
                        黑体
                      </button>
                      <button
                        type="button"
                        className={preferences.fontFamily === 'kaiti' ? 'active' : ''}
                        onClick={() => setPreferences((p) => ({ ...p, fontFamily: 'kaiti' }))}
                      >
                        楷体
                      </button>
                    </div>
                  </div>

                  {/* Font Size Stepper */}
                  <div className="setting-control-row">
                    <span>字号大小</span>
                    <div className="control-stepper">
                      <button
                        type="button"
                        onClick={() =>
                          setPreferences((p) => ({ ...p, fontSize: Math.max(12, p.fontSize - 1) }))
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <strong>{preferences.fontSize} px</strong>
                      <button
                        type="button"
                        onClick={() =>
                          setPreferences((p) => ({ ...p, fontSize: Math.min(36, p.fontSize + 1) }))
                        }
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Line Height Stepper */}
                  <div className="setting-control-row">
                    <span>正文行距</span>
                    <div className="control-stepper">
                      <button
                        type="button"
                        onClick={() =>
                          setPreferences((p) => ({
                            ...p,
                            lineHeight: Number(Math.max(1.4, p.lineHeight - 0.1).toFixed(2)),
                          }))
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <strong>{preferences.lineHeight.toFixed(1)}x</strong>
                      <button
                        type="button"
                        onClick={() =>
                          setPreferences((p) => ({
                            ...p,
                            lineHeight: Number(Math.min(2.8, p.lineHeight + 0.1).toFixed(2)),
                          }))
                        }
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Column Width */}
                  <div className="setting-control-row">
                    <span>版芯宽度</span>
                    <div className="width-slider-wrap">
                      <input
                        type="range"
                        min="600"
                        max="1300"
                        step="20"
                        value={preferences.width}
                        onChange={(e) =>
                          setPreferences((p) => ({ ...p, width: Number(e.target.value) }))
                        }
                      />
                      <small>{preferences.width}px</small>
                    </div>
                  </div>

                  {/* First-line Indent */}
                  <div className="setting-control-row">
                    <span>首行缩进 (2字符)</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={preferences.indent}
                        onChange={(e) => setPreferences((p) => ({ ...p, indent: e.target.checked }))}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Fullscreen Button */}
          <button
            type="button"
            className="toolbar-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏阅读 (F11)'}
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
      </header>

      {/* 2. Main Reader Body (Sidebar + Content View) */}
      <div className="calibre-reader-layout">
        {/* Left Calibre Sidebar */}
        {sidebarOpen && (
          <aside className="calibre-sidebar">
            {/* Sidebar Tabs */}
            <div className="sidebar-tabs-bar">
              <button
                type="button"
                className={`sidebar-tab-btn ${sidebarTab === 'toc' ? 'active' : ''}`}
                onClick={() => setSidebarTab('toc')}
                title="全书目录"
              >
                <List size={15} />
                <span>目录 ({chapters.length})</span>
              </button>

              <button
                type="button"
                className={`sidebar-tab-btn ${sidebarTab === 'gallery' ? 'active' : ''}`}
                onClick={() => setSidebarTab('gallery')}
                title="插画画廊"
              >
                <ImageIcon size={15} />
                <span>插画 ({gallery.length})</span>
              </button>

              <button
                type="button"
                className={`sidebar-tab-btn ${sidebarTab === 'stats' ? 'active' : ''}`}
                onClick={() => setSidebarTab('stats')}
                title="阅读数据"
              >
                <Sliders size={15} />
                <span>统计</span>
              </button>
            </div>

            {/* Tab 1: TOC List */}
            {sidebarTab === 'toc' && (
              <div className="sidebar-tab-content toc-tab">
                <div className="toc-search-box">
                  <Search size={13} />
                  <input
                    value={tocSearch}
                    onChange={(e) => setTocSearch(e.target.value)}
                    placeholder="搜索章节标题…"
                  />
                </div>

                <div className="toc-items-list">
                  {filteredChapters.map((c) => {
                    const isCurrent = c.chapterId === chapter?.chapterId;
                    return (
                      <button
                        key={c.chapterId}
                        type="button"
                        className={`toc-chapter-item ${isCurrent ? 'active' : ''}`}
                        onClick={() => {
                          const idx = chapters.findIndex((ch) => ch.chapterId === c.chapterId);
                          if (idx >= 0) setChapterIndex(idx);
                        }}
                      >
                        <div className="toc-ordinal-tag">{c.ordinal}</div>
                        <div className="toc-title-text">{c.title}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 2: Illustration Gallery */}
            {sidebarTab === 'gallery' && (
              <div className="sidebar-tab-content gallery-tab">
                {gallery.length ? (
                  <div className="gallery-grid">
                    {gallery.map((img) => (
                      <div
                        key={img.id}
                        className="gallery-thumb-card"
                        onClick={() => setLightboxImage(img.dataUrl)}
                        title="点击全屏查看原图"
                      >
                        <img src={img.dataUrl} alt={img.title} />
                        <span className="gallery-thumb-title">{img.title}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sidebar-empty-state">
                    <ImageIcon size={32} />
                    <p>当前作品未内嵌独立插画或正在解析中。</p>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Reading Stats */}
            {sidebarTab === 'stats' && (
              <div className="sidebar-tab-content stats-tab">
                <div className="stats-card">
                  <span className="stats-label">当前章节</span>
                  <strong>{chapter?.title}</strong>
                  <div className="stats-metric-row">
                    <div>
                      <small>字数规模</small>
                      <b>{chapterWordCount.toLocaleString()} 字</b>
                    </div>
                    <div>
                      <small>预估阅读时间</small>
                      <b>{estimatedReadingMinutes} 分钟</b>
                    </div>
                  </div>
                  <div className="stats-metric-row">
                    <div>
                      <small>全书进度</small>
                      <b>
                        {chapterIndex + 1} / {chapters.length} 章
                      </b>
                    </div>
                    <div>
                      <small>段落数</small>
                      <b>{segments.length} 段</b>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* Center Reading Container (Iframe Sandboxed) */}
        <main className="calibre-reading-container">
          {!segmentsLoading && (segmentLoadError || renderError || modeNotice) && (
            <div className={`reader-content-notice ${segmentLoadError || renderError ? 'is-error' : ''}`} role="status">
              <Info size={15} />
              <span>{segmentLoadError || renderError || modeNotice}</span>
            </div>
          )}
          {chapterLoading || segmentsLoading ? (
            <div className="reader-loading-card">
              <div className="reader-spinner" />
              <p>正在高保真渲染章节排版与原图插画…</p>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              srcDoc={chapterHtml}
              className="calibre-render-frame"
              title="Calibre Reading Frame"
              sandbox="allow-scripts"
            />
          )}

          {/* Bottom Floating Navigation HUD */}
          <footer className="calibre-bottom-hud">
            <button
              type="button"
              className="hud-nav-btn"
              disabled={chapterIndex <= 0}
              onClick={() => setChapterIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft size={16} />
              <span>上一章</span>
            </button>

            <div className="hud-center-info">
              <span className="hud-chapter-name">{chapter?.title}</span>
              <div className="hud-slider-wrap">
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, chapters.length - 1)}
                  value={chapterIndex}
                  onChange={(e) => setChapterIndex(Number(e.target.value))}
                />
                <span className="hud-progress-text">
                  第 {chapterIndex + 1} / {chapters.length} 章 (
                  {chapters.length > 0 ? Math.round(((chapterIndex + 1) / chapters.length) * 100) : 0}
                  %)
                </span>
              </div>
            </div>

            <button
              type="button"
              className="hud-nav-btn"
              disabled={chapterIndex >= chapters.length - 1}
              onClick={() => setChapterIndex((i) => Math.min(chapters.length - 1, i + 1))}
            >
              <span>下一章</span>
              <ChevronRight size={16} />
            </button>
          </footer>
        </main>
      </div>

      {/* 3. Illustration Fullscreen Lightbox Modal */}
      {lightboxImage && (
        <div className="calibre-lightbox-backdrop" onClick={() => setLightboxImage(null)}>
          <div className="lightbox-content-box" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="lightbox-close-btn"
              onClick={() => setLightboxImage(null)}
            >
              <X size={20} />
            </button>
            <img src={lightboxImage} alt="全屏插画原图" className="lightbox-full-img" />
          </div>
        </div>
      )}
    </div>
  );
};
