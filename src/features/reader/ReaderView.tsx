import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Columns2, FileText, Languages, Minus, Plus, Sparkles } from 'lucide-react';
import type { WorkbenchSegment } from '../../core/workflow/models';
import type { ProjectLibrary } from '../projects/useProjectLibrary';
import '../../styles/reader.css';

type ReaderMode = 'final' | 'bilingual' | 'source' | 'original';
type ReaderTheme = 'paper' | 'sepia' | 'gray' | 'dark';

interface ReaderPreferences {
  mode: ReaderMode;
  theme: ReaderTheme;
  fontSize: number;
  width: number;
  brightness: number;
}

const defaultPreferences: ReaderPreferences = {
  mode: 'final',
  theme: 'paper',
  fontSize: 18,
  width: 800,
  brightness: 100,
};

const loadPreferences = (): ReaderPreferences => {
  try {
    return {
      ...defaultPreferences,
      ...JSON.parse(localStorage.getItem('kitauji.reader.v1') ?? '{}'),
    };
  } catch {
    return defaultPreferences;
  }
};

export const ReaderView = ({ library }: { readonly library: ProjectLibrary }) => {
  const project = library.activeProject;
  const workflow = window.kitaujiDesktop?.workflow;
  const projects = window.kitaujiDesktop?.projects;
  const chapters = project?.chapters ?? [];
  const [chapterIndex, setChapterIndex] = useState(() =>
    Math.max(
      0,
      chapters.findIndex((chapter) => chapter.chapterId === project?.readingPosition?.chapterId),
    ),
  );
  const [segments, setSegments] = useState<readonly WorkbenchSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState(loadPreferences);
  const chapter = chapters[chapterIndex];
  const isBilingual =
    project?.project.contentMode === 'bilingual' ||
    segments.some((s) => Boolean(s.originalTranslation && s.originalTranslation.trim()));

  useEffect(() => {
    localStorage.setItem('kitauji.reader.v1', JSON.stringify(preferences));
  }, [preferences]);

  const load = useCallback(async () => {
    if (!project || !chapter) return;
    setLoading(true);
    try {
      const translated: WorkbenchSegment[] = [];
      if (workflow) {
        let offset = 0;
        while (true) {
          const page = await workflow.workbench(project.project.projectId, chapter.chapterId, offset, 200);
          translated.push(...page.segments);
          if (offset + page.limit >= page.total) break;
          offset += page.limit;
        }
      }
      if (translated.length) {
        setSegments(translated);
      } else if (projects) {
        const blocks = [] as NonNullable<
          Awaited<ReturnType<typeof projects.readChapter>>
        >['blocks'][number][];
        let sourceOffset = 0;
        while (true) {
          const source = await projects.readChapter(
            project.project.projectId,
            chapter.chapterId,
            sourceOffset,
            200,
          );
          if (!source) break;
          blocks.push(...source.blocks);
          if (sourceOffset + source.limit >= source.totalBlocks) break;
          sourceOffset += source.limit;
        }
        const byOrdinal = new Map(blocks.map((block) => [block.ordinal, block]));
        setSegments(
          blocks.flatMap((block) => {
            const pair = block.pairedOrdinal === null ? null : byOrdinal.get(block.pairedOrdinal);
            if (block.scriptKind === 'chinese' && pair?.scriptKind === 'japanese') return [];
            return [
              {
                segmentId: block.blockId,
                chapterId: chapter.chapterId,
                chapterOrdinal: chapter.ordinal,
                segmentOrdinal: block.ordinal,
                sourceText: block.sourceText,
                originalTranslation:
                  pair?.scriptKind === 'chinese'
                    ? pair.sourceText
                    : block.scriptKind === 'chinese'
                    ? block.sourceText
                    : null,
                selectedTranslation: block.draftText,
                status: 'pending' as const,
                versionCount: block.draftText ? 1 : 0,
                openReviewCount: 0,
              },
            ];
          }),
        );
      }
      await projects?.saveReadingPosition(project.project.projectId, chapter.chapterId, 1);
    } finally {
      setLoading(false);
    }
  }, [chapter, project, projects, workflow]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input,textarea,select,button')) return;
      if (event.key === 'ArrowLeft') setChapterIndex((value) => Math.max(0, value - 1));
      if (event.key === 'ArrowRight') setChapterIndex((value) => Math.min(chapters.length - 1, value + 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chapters.length]);

  const rendered = useMemo(
    () =>
      segments.map((segment) => {
        const finalText = segment.selectedTranslation ?? segment.originalTranslation;
        if (preferences.mode === 'source') return [{ kind: 'jp', text: segment.sourceText }];
        if (preferences.mode === 'original')
          return [{ kind: 'cn', text: segment.originalTranslation ?? '〔此段无既有中文〕' }];
        if (preferences.mode === 'final')
          return [{ kind: 'cn', text: finalText ?? '〔此段尚无润色成稿〕' }];
        return [
          { kind: 'jp', text: segment.sourceText },
          { kind: 'cn', text: finalText ?? '〔此段尚无润色成稿〕' },
        ];
      }),
    [preferences.mode, segments],
  );

  // Generate clean logical TOC from chapters
  const logicalToc = useMemo(() => {
    const map = new Map<string, { title: string; targetIndex: number; chapterIds: Set<string>; maxChars: number }>();
    chapters.forEach((chap, idx) => {
      const cleanTitle = chap.title
        .replace(/\s*\((?:扉页|插图|第\s*\d+\s*节|封面|版块\s*\d+)\)\s*$/u, '')
        .trim();
      const existing = map.get(cleanTitle);
      if (!existing) {
        map.set(cleanTitle, {
          title: cleanTitle,
          targetIndex: idx,
          chapterIds: new Set([chap.chapterId]),
          maxChars: chap.characterCount || 0,
        });
      } else {
        existing.chapterIds.add(chap.chapterId);
        if ((chap.characterCount || 0) > existing.maxChars) {
          existing.maxChars = chap.characterCount || 0;
          existing.targetIndex = idx;
        }
      }
    });
    return Array.from(map.values());
  }, [chapters]);

  const hasLogicalToc = logicalToc.length > 0 && logicalToc.length < chapters.length;
  const [useXhtmlMode, setUseXhtmlMode] = useState(false);

  if (!project || !chapter) return null;

  return (
    <div
      className={`reader-page reader-theme-${preferences.theme}`}
      style={
        {
          '--reader-font': `${preferences.fontSize}px`,
          '--reader-width': `${preferences.width}px`,
          '--reader-brightness': `${preferences.brightness}%`,
        } as React.CSSProperties
      }
    >
      <aside className="reader-toc">
        <header>
          <BookOpen size={18} />
          <strong title={project.project.title}>{project.project.title}</strong>
          {hasLogicalToc && (
            <button
              type="button"
              className="reader-toc-toggle"
              onClick={() => setUseXhtmlMode(!useXhtmlMode)}
              title={useXhtmlMode ? '切换为书内逻辑目录' : '切换为 XHTML 物理分卷'}
            >
              {useXhtmlMode ? 'XHTML' : '书内目录'}
            </button>
          )}
        </header>
        <nav>
          {hasLogicalToc && !useXhtmlMode
            ? logicalToc.map((item) => {
                const isActive = item.chapterIds.has(chapter.chapterId);
                return (
                  <button
                    type="button"
                    key={item.title}
                    className={isActive ? 'active' : ''}
                    onClick={() => setChapterIndex(item.targetIndex)}
                  >
                    <span className="toc-title">{item.title}</span>
                  </button>
                );
              })
            : chapters.map((item, index) => (
                <button
                  type="button"
                  key={item.chapterId}
                  className={index === chapterIndex ? 'active' : ''}
                  onClick={() => setChapterIndex(index)}
                >
                  <span className="toc-title">{item.title}</span>
                </button>
              ))}
        </nav>
      </aside>

      <main>
        <header className="reader-toolbar">
          <div className="reader-modes">
            <button
              type="button"
              className={preferences.mode === 'final' ? 'active' : ''}
              onClick={() => setPreferences({ ...preferences, mode: 'final' })}
            >
              <Sparkles size={14} /> {isBilingual ? '润色成稿' : '精译成稿'}
            </button>
            <button
              type="button"
              className={preferences.mode === 'bilingual' ? 'active' : ''}
              onClick={() => setPreferences({ ...preferences, mode: 'bilingual' })}
            >
              <Columns2 size={14} /> 日中对照
            </button>
            <button
              type="button"
              className={preferences.mode === 'source' ? 'active' : ''}
              onClick={() => setPreferences({ ...preferences, mode: 'source' })}
            >
              日文原文
            </button>
            {isBilingual && (
              <button
                type="button"
                className={preferences.mode === 'original' ? 'active' : ''}
                onClick={() => setPreferences({ ...preferences, mode: 'original' })}
              >
                <FileText size={14} /> 原译参考
              </button>
            )}
          </div>

          <div className="reader-controls">
            <select
              aria-label="阅读配色主题"
              value={preferences.theme}
              onChange={(event) =>
                setPreferences({ ...preferences, theme: event.target.value as ReaderTheme })
              }
            >
              <option value="paper">纸白 (日间)</option>
              <option value="sepia">羊皮纸 (护眼)</option>
              <option value="gray">柔灰 (沉浸)</option>
              <option value="dark">暗夜 (夜间)</option>
            </select>

            <div className="reader-range-group">
              <label className="reader-range">
                <span>版宽</span>
                <input
                  aria-label="正文版面宽度"
                  type="range"
                  min="560"
                  max="1100"
                  step="20"
                  value={preferences.width}
                  onChange={(event) =>
                    setPreferences({ ...preferences, width: Number(event.target.value) })
                  }
                />
              </label>

              <label className="reader-range">
                <span>亮度</span>
                <input
                  aria-label="阅读亮度"
                  type="range"
                  min="70"
                  max="110"
                  step="5"
                  value={preferences.brightness}
                  onChange={(event) =>
                    setPreferences({ ...preferences, brightness: Number(event.target.value) })
                  }
                />
              </label>
            </div>

            <div className="reader-font-controls">
              <button
                type="button"
                aria-label="缩小字号"
                onClick={() =>
                  setPreferences({ ...preferences, fontSize: Math.max(14, preferences.fontSize - 1) })
                }
              >
                <Minus size={14} />
              </button>
              <span className="font-size-val">{preferences.fontSize}px</span>
              <button
                type="button"
                aria-label="放大字号"
                onClick={() =>
                  setPreferences({ ...preferences, fontSize: Math.min(32, preferences.fontSize + 1) })
                }
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </header>

        <article className="reader-paper">
          <header>
            <p className="chapter-meta">第 {chapter.ordinal} 章</p>
            <h1>{chapter.title}</h1>
            <span className="mode-indicator">
              <Languages size={14} />
              {preferences.mode === 'bilingual'
                ? '日中双语对照阅读'
                : preferences.mode === 'source'
                ? '日文原版阅读'
                : preferences.mode === 'original'
                ? '参考原译阅读'
                : isBilingual
                ? '润色成稿阅读'
                : '精译成稿阅读'}
            </span>
          </header>

          {loading ? (
            <div className="reader-loading">
              <p>正在排版章节正文…</p>
            </div>
          ) : rendered.length === 0 ? (
            <div className="reader-loading">
              <p>此项为插图、扉页或排版结构，无文字段落。</p>
            </div>
          ) : (
            <div className="reader-body">
              {rendered.map((group, index) => (
                <section key={segments[index]?.segmentId ?? index}>
                  {group.map((line, lineIndex) => (
                    <p
                      key={lineIndex}
                      className={line.kind}
                      lang={line.kind === 'jp' ? 'ja' : 'zh-CN'}
                    >
                      {line.text}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          )}

          <footer>
            <button
              type="button"
              disabled={chapterIndex === 0}
              onClick={() => setChapterIndex(chapterIndex - 1)}
            >
              <ChevronLeft size={16} /> 上一章
            </button>
            <span>
              第 {chapterIndex + 1} 章 / 共 {chapters.length} 章
            </span>
            <button
              type="button"
              disabled={chapterIndex + 1 >= chapters.length}
              onClick={() => setChapterIndex(chapterIndex + 1)}
            >
              下一章 <ChevronRight size={16} />
            </button>
          </footer>
        </article>
      </main>
    </div>
  );
};

