import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileCheck,
  History,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Replace,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Square,
  Users,
  Zap,
} from 'lucide-react';
import type { TranslationVersionRecord, WorkbenchPage, WorkbenchSegment } from '../../core/workflow/models';
import type { ProjectLibrary } from '../projects/useProjectLibrary';
import { ProjectHeading } from '../projects/ProjectHeading';
import { useWorkflowOverview } from '../workflow/useWorkflowOverview';
import { FindReplaceModal } from './FindReplaceModal';
import { LiveConsoleDrawer } from '../console/LiveConsoleDrawer';
import '../../styles/workshop.css';
import '../../styles/console.css';

interface TranslationWorkbenchProps {
  readonly library: ProjectLibrary;
  readonly onNavigateTab?: (tab: 'overview' | 'workbench' | 'reader' | 'glossary' | 'relations' | 'memory' | 'review' | 'export') => void;
}

const statusLabel: Record<string, string> = {
  pending: '待处理',
  translating: '生成中',
  reviewing: '质检中',
  approved: '已成稿',
  'needs-human': '待人工确认',
  failed: '处理失败',
  skipped: '已跳过',
};

const stageLabel: Record<string, string> = {
  initial: '模型初稿',
  'self-repair': '自纠修正稿',
  'independent-review': '独立复核稿',
  manual: '人工修改版',
  final: '最终定稿',
};

const SegmentEditor = ({
  segment,
  isBilingual,
  onSaved,
}: {
  segment: WorkbenchSegment;
  isBilingual: boolean;
  onSaved: () => Promise<void>;
}) => {
  const api = window.kitaujiDesktop?.workflow;
  const [text, setText] = useState(segment.selectedTranslation ?? segment.originalTranslation ?? '');
  const [isModified, setIsModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<readonly TranslationVersionRecord[]>([]);

  useEffect(() => {
    if (!isModified) {
      setText(segment.selectedTranslation ?? segment.originalTranslation ?? '');
    }
  }, [segment, isModified]);

  const changed = text !== (segment.selectedTranslation ?? segment.originalTranslation ?? '');

  const save = async () => {
    if (!api || !changed || !text.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveManual(segment.segmentId, text);
      if (result.status === 'error') {
        setMessage(result.message);
      } else {
        setMessage(result.data.issues.length ? `已保存，包含 ${result.data.issues.length} 条待核验项。` : '已保存修改。');
        setIsModified(false);
        await onSaved();
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  };

  const toggleHistory = async () => {
    if (!api) return;
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    try {
      const data = await api.versions(segment.segmentId);
      setVersions(data);
      setHistoryOpen(true);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '加载版本历史失败。');
    }
  };

  const restore = async (version: TranslationVersionRecord) => {
    if (!api || saving) return;
    setSaving(true);
    try {
      const result = await api.saveManual(segment.segmentId, version.text);
      if (result.status === 'error') {
        setMessage(result.message);
      } else {
        setText(version.text);
        setIsModified(false);
        setMessage(`已恢复至第 ${version.versionNumber} 版。`);
        await onSaved();
        const data = await api.versions(segment.segmentId);
        setVersions(data);
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '恢复版本失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`workbench-segment workbench-segment--${segment.status} ${segment.isTitle ? 'workbench-segment--title' : ''}`}>
      <header>
        <span className="segment-ordinal">
          {segment.sourceBlockId?.endsWith(':title')
            ? '📌 章节大标题'
            : segment.tagName && /^h[1-6]$/i.test(segment.tagName)
            ? `📌 标题 (${segment.tagName.toUpperCase()})`
            : `段落 #${segment.segmentOrdinal}`}
        </span>
        {segment.isTitle && (
          <span style={{ background: 'rgba(217, 119, 6, 0.15)', color: '#d97706', border: '1px solid rgba(217, 119, 6, 0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
            {segment.sourceBlockId?.endsWith(':title') ? '章节标题' : `${segment.tagName?.toUpperCase()} 标题`}
          </span>
        )}
        <span className={`segment-status-badge segment-status-badge--${segment.status}`}>
          {statusLabel[segment.status] ?? segment.status}
        </span>
        <small>
          {segment.versionCount} 个版本{segment.openReviewCount ? ` · ${segment.openReviewCount} 项待复核` : ''}
        </small>
      </header>

      <div className={`workbench-columns ${isBilingual ? 'workbench-columns--bilingual' : 'workbench-columns--dual'}`}>
        <div className="workbench-source" lang="ja">
          <span className="col-label col-label--ja">日文原文</span>
          <p>{segment.sourceText}</p>
        </div>

        {isBilingual && (
          <div className="workbench-original">
            <span className="col-label col-label--ref">原译 / 机翻参考</span>
            <p className={!segment.originalTranslation ? 'empty-ref' : ''}>
              {segment.originalTranslation ?? '无初始中文译文。'}
            </p>
          </div>
        )}

        <div className="workbench-final">
          <label htmlFor={`draft-${segment.segmentId}`} className="col-label col-label--edit">
            <Sparkles size={12} /> {isBilingual ? '润色成稿（可直接编辑）' : '精译成稿（可直接编辑）'}
          </label>
          <textarea
            id={`draft-${segment.segmentId}`}
            value={text}
            rows={Math.max(4, Math.ceil(text.length / (isBilingual ? 32 : 48)))}
            placeholder={
              isBilingual
                ? '任务润色后在此显示成稿；您也可以直接在此编辑。'
                : '任务精译后在此显示成稿；您也可以直接在此编辑。'
            }
            onChange={(event) => {
              setText(event.target.value);
              setIsModified(true);
              setMessage(null);
            }}
          />
        </div>
      </div>

      <footer>
        {message && (
          <p className={message.includes('失败') || message.includes('核验') ? 'msg-warning' : 'msg-success'}>
            <AlertTriangle size={14} />
            {message}
          </p>
        )}
        <div className="segment-actions">
          <button type="button" className="workbench-history-button" onClick={() => void toggleHistory()}>
            <History size={14} />
            {historyOpen ? '收起版本' : `历史版本 (${segment.versionCount})`}
          </button>
          <button
            type="button"
            className="save-btn"
            disabled={!changed || !text.trim() || saving}
            onClick={() => void save()}
          >
            <Save size={14} />
            {saving ? '正在保存…' : '保存修改'}
          </button>
        </div>
      </footer>

      {historyOpen && (
        <section className="workbench-history" aria-label="译文历史版本">
          {versions.length ? (
            versions.map((version) => (
              <article key={version.versionId} className={version.selected ? 'selected' : ''}>
                <header>
                  <b>第 {version.versionNumber} 版</b>
                  <span className="stage-tag">{stageLabel[version.stage] ?? version.stage}</span>
                  <time>{new Date(version.createdAt).toLocaleString()}</time>
                  {version.selected && <em className="current-badge">当前使用</em>}
                </header>
                <p>{version.text}</p>
                <footer>
                  <small>
                    {version.model ?? '人工编辑'}
                    {version.elapsedMs ? ` · ${(version.elapsedMs / 1000).toFixed(1)} 秒` : ''}
                    {version.inputTokens !== null || version.outputTokens !== null
                      ? ` · ${version.inputTokens ?? 0} / ${version.outputTokens ?? 0} tokens`
                      : ''}
                  </small>
                  <button type="button" disabled={version.selected || saving} onClick={() => void restore(version)}>
                    <RotateCcw size={13} /> 恢复此版本
                  </button>
                </footer>
              </article>
            ))
          ) : (
            <p className="no-history">暂无更多历史版本。</p>
          )}
        </section>
      )}
    </article>
  );
};

export const TranslationWorkbench = ({ library, onNavigateTab }: TranslationWorkbenchProps) => {
  const project = library.activeProject;
  const api = window.kitaujiDesktop?.workflow;
  const chapters = project?.chapters ?? [];
  const [chapterId, setChapterId] = useState<string>(() => chapters[0]?.chapterId ?? '');
  const [page, setPage] = useState<WorkbenchPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [chapterSearch, setChapterSearch] = useState('');
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isStopConfirming, setIsStopConfirming] = useState(false);

  const workflow = useWorkflowOverview(project?.project.projectId ?? null);
  const isBilingual = project?.project.contentMode === 'bilingual' || (page?.segments.some((s) => Boolean(s.originalTranslation && s.originalTranslation.trim())) ?? false);

  const visibleWorkbenchChapters = useMemo(() => {
    const q = chapterSearch.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.href ?? '').toLowerCase().includes(q) ||
      c.ordinal.toString().includes(q)
    );
  }, [chapters, chapterSearch]);

  useEffect(() => {
    if (!chapters.some((chapter) => chapter.chapterId === chapterId)) {
      setChapterId(chapters[0]?.chapterId ?? '');
    }
  }, [chapterId, chapters]);

  // Load data with quiet parameter to avoid flickering
  const load = useCallback(
    async (quiet = false) => {
      if (!api || !project || !chapterId) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const nextPage = await api.workbench(project.project.projectId, chapterId, offset, 60);
        setPage(nextPage);
      } catch (reason) {
        if (!quiet) setError(reason instanceof Error ? reason.message : '无法读取工作台段落。');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [api, chapterId, offset, project],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Silent polling every 3s without causing UI reload/flicker
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Active running task detection
  const runningTask = useMemo(() => {
    return workflow.overview?.tasks.find((task) => ['pending', 'running', 'pausing'].includes(task.status));
  }, [workflow.overview]);

  const pausedTask = useMemo(() => {
    return workflow.overview?.tasks.find((task) => ['paused', 'interrupted'].includes(task.status));
  }, [workflow.overview]);

  const failedTask = useMemo(() => {
    const latest = workflow.overview?.tasks[0];
    return latest?.status === 'failed' && latest.failedItems > 0 ? latest : undefined;
  }, [workflow.overview]);

  const displayTask = runningTask ?? pausedTask ?? failedTask;
  const hasCompletedPreRead = workflow.overview?.tasks.some((task) => task.taskType === 'pre-read' && task.status === 'completed') ?? false;

  // Segment counts from workflow overview
  const approvedCount = workflow.overview?.segmentCounts['approved'] ?? 0;
  const translatingCount = workflow.overview?.segmentCounts['translating'] ?? 0;
  const reviewingCount = workflow.overview?.segmentCounts['reviewing'] ?? 0;
  const failedCount = workflow.overview?.segmentCounts['failed'] ?? 0;
  const needsHumanCount = workflow.overview?.segmentCounts['needs-human'] ?? 0;
  const processingCount = translatingCount + reviewingCount;

  const totalParagraphs = useMemo(() => {
    if (workflow.overview?.segmentCounts) {
      const counts = Object.values(workflow.overview.segmentCounts);
      if (counts.length > 0) {
        return counts.reduce((a, b) => a + b, 0);
      }
    }
    return chapters.reduce((sum, ch) => sum + ch.paragraphCount, 0);
  }, [chapters, workflow.overview]);

  const progressPercent = totalParagraphs > 0 ? Math.min(100, Math.round((approvedCount / totalParagraphs) * 100)) : 0;

  // Filtered segments based on search query and status filter
  const visibleSegments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (
      page?.segments.filter((segment) => {
        const matchQuery =
          !normalized ||
          [segment.sourceText, segment.originalTranslation, segment.selectedTranslation].some((text) =>
            text?.toLocaleLowerCase().includes(normalized),
          );
        const matchStatus =
          filterStatus === 'all' ||
          (filterStatus === 'approved' && segment.status === 'approved') ||
          (filterStatus === 'processing' && ['translating', 'reviewing'].includes(segment.status)) ||
          (filterStatus === 'failed' && segment.status === 'failed') ||
          (filterStatus === 'needs-human' && segment.status === 'needs-human') ||
          (filterStatus === 'pending' && segment.status === 'pending');

        return matchQuery && matchStatus;
      }) ?? []
    );
  }, [filterStatus, page, query]);

  if (!project) return null;

  const currentChapter = chapters.find((chapter) => chapter.chapterId === chapterId);

  const handleStopTask = () => {
    if (!runningTask) return;
    if (isStopConfirming) {
      void workflow.cancel(runningTask.taskId);
      setIsStopConfirming(false);
    } else {
      setIsStopConfirming(true);
      window.setTimeout(() => setIsStopConfirming(false), 3500);
    }
  };

  return (
    <div className="workshop-page">
      <ProjectHeading library={library} />

      {/* 5-Step Workflow Stepper Banner */}
      <section className="workbench-stepper-card">
        <div className="stepper-title">
          <Sparkles size={16} className="stepper-sparkle" />
          <span>推荐作业顺序</span>
        </div>
        <div className="stepper-track">
          <button
            type="button"
            className={`step-node ${hasCompletedPreRead ? 'completed' : 'active'}`}
            onClick={() => onNavigateTab?.('glossary')}
          >
            <span className="step-num">1</span>
            <div className="step-text">
              <strong>提取术语与预读</strong>
              <small>{hasCompletedPreRead ? `${workflow.overview?.glossaryCount ?? 0} 词条已就绪` : '建立专名与记忆'}</small>
            </div>
          </button>

          <span className="step-arrow">➔</span>

          <button
            type="button"
            className={`step-node ${hasCompletedPreRead ? 'active' : ''}`}
            onClick={() => onNavigateTab?.('glossary')}
          >
            <span className="step-num">2</span>
            <div className="step-text">
              <strong>确认与锁定专名</strong>
              <small>锁定重点主角与称呼</small>
            </div>
          </button>

          <span className="step-arrow">➔</span>

          <div className={`step-node ${hasCompletedPreRead ? 'active current' : ''}`}>
            <span className="step-num">3</span>
            <div className="step-text">
              <strong>全书翻译与润色</strong>
              <small>{hasCompletedPreRead ? '带着专名表分章生成' : '等待全书预读完成'}</small>
            </div>
          </div>

          <span className="step-arrow">➔</span>

          <button
            type="button"
            className={`step-node ${workflow.overview?.openReviewCount ? 'alert' : ''}`}
            onClick={() => onNavigateTab?.('review')}
          >
            <span className="step-num">4</span>
            <div className="step-text">
              <strong>质量复核</strong>
              <small>{workflow.overview?.openReviewCount ? `${workflow.overview.openReviewCount} 项待裁定` : '查验分歧与多解'}</small>
            </div>
          </button>

          <span className="step-arrow">➔</span>

          <button
            type="button"
            className={`step-node ${progressPercent === 100 ? 'ready' : ''}`}
            onClick={() => onNavigateTab?.('export')}
          >
            <span className="step-num">5</span>
            <div className="step-text">
              <strong>成书导出</strong>
              <small>生成正式 EPUB / TXT</small>
            </div>
          </button>
        </div>
      </section>

      {/* Top Task Control Dashboard (继承旧版核心控制台) */}
      <section className="workbench-control-header">
        <div className="control-header-top">
          {/* Progress Bar & Live Status */}
          <div className="task-progress-zone">
            <div className="progress-labels">
              <span className="progress-phase">
                {runningTask ? (
                  <>
                    <Loader2 size={13} className="spin" />
                    {runningTask.taskType === 'pre-read' ? (
                      <span>
                        正在全书预读与深度分析设定
                        {runningTask.totalItems > 0
                          ? ` (已完成 ${runningTask.completedItems} / ${runningTask.totalItems} 章)`
                          : ' (正在解析第 1 章)…'}
                      </span>
                    ) : (
                      <span>
                        正在进行分章润色与翻译
                        {` (已成稿 ${approvedCount} / ${totalParagraphs} 段)`}
                      </span>
                    )}
                  </>
                ) : pausedTask ? (
                  <>
                    <Pause size={13} className="paused-icon" />
                    {pausedTask.status === 'interrupted'
                      ? '上次任务已中断（已完成进度与分片断点均已保存）'
                      : '任务已暂停（当前进度已妥善保存）'}
                  </>
                ) : failedTask ? (
                  <>
                    <RotateCcw size={13} />
                    {failedTask.taskType === 'pre-read'
                      ? `预读有 ${failedTask.failedItems} 章失败（已完成结果与章节分片断点均已保留）`
                      : `任务有 ${failedTask.failedItems} 项失败（已完成结果已保留）`}
                  </>
                ) : (
                  <>
                    <FileCheck size={13} /> 当前润色进度
                  </>
                )}
              </span>
              <span className="progress-counts">
                {displayTask?.taskType === 'pre-read' ? (
                  <b>
                    {displayTask.completedItems} / {displayTask.totalItems} 章
                    <span className="progress-percent">
                      {' '}
                      (
                      {displayTask.totalItems > 0
                        ? Math.round((displayTask.completedItems / displayTask.totalItems) * 100)
                        : 0}
                      %)
                    </span>
                  </b>
                ) : (
                  <>
                    {approvedCount.toLocaleString()} / {totalParagraphs.toLocaleString()} 段
                    <b className="progress-percent"> ({progressPercent}%)</b>
                  </>
                )}
              </span>
            </div>
            <div className="progress-track">
              <div
                className={`progress-fill ${
                  runningTask
                    ? runningTask.taskType === 'pre-read' && runningTask.completedItems === 0
                      ? 'running indeterminate'
                      : 'running'
                    : pausedTask
                    ? 'paused'
                    : failedTask
                    ? 'failed'
                    : 'idle'
                }`}
                style={{
                  width:
                    displayTask?.taskType === 'pre-read'
                      ? `${
                          displayTask.totalItems > 0
                            ? Math.max(5, Math.round((displayTask.completedItems / displayTask.totalItems) * 100))
                            : 10
                        }%`
                      : `${progressPercent}%`,
                }}
              />
            </div>
          </div>

          {/* Action Buttons Group */}
          <div className="task-actions-group">
            {runningTask ? (
              <>
                <button
                  type="button"
                  className="control-btn control-btn--pause"
                  onClick={() => void workflow.pause(runningTask.taskId)}
                  disabled={Boolean(workflow.busy)}
                >
                  <Pause size={16} /> 暂停任务
                </button>
                <button
                  type="button"
                  className={`control-btn control-btn--stop ${isStopConfirming ? 'confirming' : ''}`}
                  onClick={handleStopTask}
                  disabled={Boolean(workflow.busy)}
                >
                  <Square size={15} /> {isStopConfirming ? '确认停止?' : '停止'}
                </button>
              </>
            ) : pausedTask ? (
              <>
                <button
                  type="button"
                  className="control-btn control-btn--resume"
                  onClick={() => void workflow.resume(pausedTask.taskId)}
                  disabled={Boolean(workflow.busy)}
                >
                  <Play size={16} /> {pausedTask.status === 'interrupted' ? '从断点继续' : '继续执行'}
                </button>
                {pausedTask.failedItems > 0 && (
                  <button
                    type="button"
                    className="control-btn control-btn--retry"
                    onClick={() => void workflow.retryFailed(pausedTask.taskId)}
                    disabled={Boolean(workflow.busy)}
                    title="重试此暂停任务中失败的项目"
                  >
                    <RotateCcw size={15} /> 重试失败项 ({pausedTask.failedItems})
                  </button>
                )}
                <button
                  type="button"
                  className="control-btn control-btn--stop"
                  onClick={() => void workflow.cancel(pausedTask.taskId)}
                  disabled={Boolean(workflow.busy)}
                >
                  <Square size={15} /> 取消任务
                </button>
              </>
            ) : failedTask ? (
              <button
                type="button"
                className="control-btn control-btn--retry"
                onClick={() => void workflow.retryFailed(failedTask.taskId)}
                disabled={Boolean(workflow.busy)}
                title="已完成结果不重做；失败章节从内部断点继续"
              >
                <RotateCcw size={15} /> {failedTask.taskType === 'pre-read'
                  ? `从断点重试失败章节 (${failedTask.failedItems})`
                  : `重试失败项 (${failedTask.failedItems})`}
              </button>
            ) : (
              <>
                {!hasCompletedPreRead ? (
                  <button
                    type="button"
                    className="control-btn control-btn--preread"
                    onClick={() => void workflow.start('pre-read')}
                    disabled={Boolean(workflow.busy)}
                    title="通读全书提取人物、专名与设定记忆"
                  >
                    <BookOpen size={15} /> 1. 提取术语与预读
                  </button>
                ) : null}
                <button
                  type="button"
                  className="control-btn control-btn--start"
                  onClick={() => void workflow.start('translate')}
                  disabled={Boolean(workflow.busy) || !hasCompletedPreRead}
                  title={!hasCompletedPreRead ? '请先完成全书预读' : isBilingual ? '启动全书双语对照润色与纠偏' : '启动全书日文原著从零精译'}
                >
                  <Zap size={16} /> {approvedCount > 0 ? (isBilingual ? '继续对照润色' : '继续日文精译') : (isBilingual ? '开始对照润色' : '开始日文精译')}
                </button>
                {failedCount > 0 ? (
                  <button
                    type="button"
                    className="control-btn control-btn--retry"
                    onClick={() => void workflow.start('translate', { replaceApproved: false })}
                    disabled={Boolean(workflow.busy)}
                    title="仅针对失败或异常段落重新发起处理"
                  >
                    <RotateCcw size={15} /> 重试失败段落 ({failedCount})
                  </button>
                ) : workflow.overview?.tasks[0]?.failedItems && workflow.overview.tasks[0].failedItems > 0 ? (
                  <button
                    type="button"
                    className="control-btn control-btn--retry"
                    onClick={() => void workflow.retryFailed(workflow.overview!.tasks[0].taskId)}
                    disabled={Boolean(workflow.busy)}
                    title="一键重试上一次失败的任务项"
                  >
                    <RotateCcw size={15} /> 重试失败任务项 ({workflow.overview.tasks[0].failedItems})
                  </button>
                ) : null}
              </>
            )}

            <button
              type="button"
              className="control-btn control-btn--tool"
              onClick={() => setIsFindReplaceOpen(true)}
              title="全局查找与替换"
            >
              <Replace size={15} /> 查找替换
            </button>

            <button
              type="button"
              className="control-btn control-btn--export"
              onClick={() => onNavigateTab?.('export')}
              title="导出正式 EPUB 电子书"
            >
              <Download size={15} /> 导出成书
            </button>
          </div>
        </div>

        {/* Interactive Status Counters Bar */}
        <div className="status-badges-row">
          <div
            className={`status-badge status-badge--mode ${isBilingual ? 'mode--bilingual' : 'mode--japanese'}`}
            title={isBilingual ? '双语对照模式：以日文原文为基准深度纠偏原译/机翻' : '日文生肉模式：以日文原文为唯一原点从零精译'}
          >
            <Sparkles size={14} />
            <span>{isBilingual ? '双语对照润色' : '日文原著精译'}</span>
          </div>

          <div className="status-badge status-badge--total" title="全书总段落数">
            <Layers size={14} />
            <span>总段落</span>
            <b>{totalParagraphs}</b>
          </div>

          <div className="status-badge status-badge--approved" title="已完成成稿段落">
            <CheckCircle2 size={14} />
            <span>已成稿</span>
            <b>{approvedCount}</b>
          </div>

          {processingCount > 0 && (
            <div className="status-badge status-badge--processing" title="正在生成或质检中的段落">
              <Loader2 size={14} className="spin" />
              <span>处理中</span>
              <b>{processingCount}</b>
            </div>
          )}

          {failedCount > 0 && (
            <button
              type="button"
              className="status-badge status-badge--failed clickable"
              onClick={() => setFilterStatus(filterStatus === 'failed' ? 'all' : 'failed')}
              title="点击在列表中仅显示失败段落"
            >
              <AlertCircle size={14} />
              <span>失败项</span>
              <b>{failedCount}</b>
            </button>
          )}

          <button
            type="button"
            className="status-badge status-badge--review clickable"
            onClick={() => onNavigateTab?.('review')}
            title="点击前往质量复核队列"
          >
            <AlertTriangle size={14} />
            <span>待复核</span>
            <b>{workflow.overview?.openReviewCount ?? 0}</b>
          </button>

          <button
            type="button"
            className="status-badge status-badge--glossary clickable"
            onClick={() => onNavigateTab?.('glossary')}
            title="点击前往术语与专名表"
          >
            <Users size={14} />
            <span>专名术语</span>
            <b>{workflow.overview?.glossaryCount ?? 0}</b>
          </button>

          <button
            type="button"
            className="status-badge status-badge--memory clickable"
            onClick={() => onNavigateTab?.('memory')}
            title="点击前往全书事件记忆库"
          >
            <Database size={14} />
            <span>事件记忆</span>
            <b>{workflow.overview?.memoryFactCount ?? 0}</b>
          </button>
        </div>
      </section>

      {/* Main Translation Workbench Shell */}
      <section className="workbench-shell">
        <aside className="workbench-chapters">
          <header className="workbench-chapters-head">
            <div className="workbench-chapters-title">
              <strong>章节目录</strong>
              <span>{visibleWorkbenchChapters.length} / {chapters.length} 章</span>
            </div>
            <div className="workbench-chapters-search">
              <input
                type="text"
                value={chapterSearch}
                onChange={(e) => setChapterSearch(e.target.value)}
                placeholder="搜索章节或文件名…"
              />
              {chapterSearch && (
                <button type="button" onClick={() => setChapterSearch('')} aria-label="清除">✕</button>
              )}
            </div>
          </header>
          <nav>
            {visibleWorkbenchChapters.length === 0 ? (
              <div className="workbench-chapters-empty">未匹配到章节</div>
            ) : (
              visibleWorkbenchChapters.map((chapter) => (
                <button
                  type="button"
                  key={chapter.chapterId}
                  className={chapter.chapterId === chapterId ? 'active' : ''}
                  onClick={() => {
                    setChapterId(chapter.chapterId);
                    setOffset(0);
                  }}
                >
                  <span className="chapter-idx">{chapter.ordinal.toString().padStart(2, '0')}</span>
                  <div className="chapter-item-details">
                    <span className="chapter-name" title={chapter.title}>{chapter.title}</span>
                    {chapter.href && <span className="chapter-href" title={chapter.href}>{chapter.href}</span>}
                    <span className="chapter-seg-count">{chapter.paragraphCount > 0 ? `${chapter.paragraphCount} 段` : '0 段 (插图/扉页)'}</span>
                  </div>
                </button>
              ))
            )}
          </nav>
        </aside>

        <main className="workbench-main">
          <header className="workbench-toolbar">
            <div className="toolbar-info">
              <h2>{currentChapter?.title ?? '正文内容'}</h2>
              <p>{isBilingual ? '三栏对照阅读、润色与精修，修改后可随时保存并支持多版本回溯。' : '双栏对照阅读、精译与润色，修改后可随时保存并支持多版本回溯。'}</p>
            </div>

            <div className="toolbar-controls">
              {/* Segment Status Filter Tabs */}
              <div className="segment-filter-tabs">
                <button
                  type="button"
                  className={filterStatus === 'all' ? 'active' : ''}
                  onClick={() => setFilterStatus('all')}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={filterStatus === 'approved' ? 'active' : ''}
                  onClick={() => setFilterStatus('approved')}
                >
                  已成稿
                </button>
                <button
                  type="button"
                  className={filterStatus === 'processing' ? 'active' : ''}
                  onClick={() => setFilterStatus('processing')}
                >
                  处理中
                </button>
                <button
                  type="button"
                  className={filterStatus === 'failed' ? 'active' : ''}
                  onClick={() => setFilterStatus('failed')}
                >
                  失败
                </button>
                <button
                  type="button"
                  className={filterStatus === 'needs-human' ? 'active' : ''}
                  onClick={() => setFilterStatus('needs-human')}
                >
                  待人工
                </button>
              </div>

              <label className="workbench-search">
                <Search size={14} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索段落文本…"
                />
              </label>
            </div>
          </header>

          {error && <p className="workbench-error">{error}</p>}

          {loading ? (
            <p className="workbench-empty">正在加载章节段落…</p>
          ) : visibleSegments.length ? (
            <div className="workbench-segments">
              {visibleSegments.map((segment) => (
                <SegmentEditor key={segment.segmentId} segment={segment} isBilingual={isBilingual} onSaved={() => load(true)} />
              ))}
            </div>
          ) : (
            <div className="workbench-empty">
              {currentChapter && currentChapter.paragraphCount === 0 ? (
                <div className="workbench-empty-structure">
                  <BookOpen size={36} />
                  <h3>此项为插图、扉页或排版结构</h3>
                  <p>该文件（<code>{currentChapter.href}</code>）内没有可翻译的文字段落，显示为空白。</p>
                </div>
              ) : (
                <p>
                  {filterStatus !== 'all'
                    ? `当前筛选条件「${filterStatus}」下没有匹配的段落。`
                    : `当前章节尚未建立${isBilingual ? '润色' : '翻译'}段落。点击上方“${isBilingual ? '开始对照润色' : '开始日文精译'}”即可自动处理。`}
                </p>
              )}
            </div>
          )}

          {page && page.total > page.limit && (
            <footer className="workbench-pagination">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - page.limit))}
              >
                <ChevronLeft size={15} /> 上一页
              </button>
              <span>
                第 {offset + 1} – {Math.min(page.total, offset + page.limit)} 段 / 共 {page.total} 段
              </span>
              <button
                type="button"
                disabled={offset + page.limit >= page.total}
                onClick={() => setOffset(offset + page.limit)}
              >
                下一页 <ChevronRight size={15} />
              </button>
            </footer>
          )}
        </main>
      </section>

      {/* Global Find & Replace Modal */}
      <FindReplaceModal
        isOpen={isFindReplaceOpen}
        onClose={() => setIsFindReplaceOpen(false)}
        segments={page?.segments ?? []}
        onReplace={async (segmentId, newText) => {
          if (api) {
            await api.saveManual(segmentId, newText);
          }
        }}
        onRefresh={async () => {
          await load(true);
        }}
      />

      {/* Live Execution Console & Terminal */}
      <LiveConsoleDrawer activeTask={workflow.activeTasks.find((t) => t.status === 'running') ?? workflow.activeTasks[0] ?? null} />
    </div>
  );
};
