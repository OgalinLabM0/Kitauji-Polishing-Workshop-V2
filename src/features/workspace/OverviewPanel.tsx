import { ArrowRight, BookOpen, BookOpenText, CheckCircle2, Download, Languages, Lock, PenLine, Play, RotateCcw, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { ProjectHeading } from '../projects/ProjectHeading';
import { ProjectSourceInspector } from '../projects/ProjectSourceInspector';
import type { ProjectLibrary } from '../projects/useProjectLibrary';
import type { WorkspaceView } from './workspaceRoute';
import { TaskCenter } from '../workflow/TaskCenter';
import { useWorkflowOverview } from '../workflow/useWorkflowOverview';

interface OverviewPanelProps {
  readonly library: ProjectLibrary;
  readonly onNavigate: (view: WorkspaceView) => void;
}

export const OverviewPanel = ({ library, onNavigate }: OverviewPanelProps) => {
  const project = library.activeProject;
  const workflow = useWorkflowOverview(project?.project.projectId ?? '');

  const glossaryCount = workflow.overview?.glossaryCount ?? 0;
  const approvedCount = workflow.overview?.segmentCounts['approved'] ?? 0;
  const failedCount = workflow.overview?.segmentCounts['failed'] ?? 0;
  const openReviewCount = workflow.overview?.openReviewCount ?? 0;
  const totalParagraphs = project?.chapters.reduce((sum, ch) => sum + ch.paragraphCount, 0) ?? 0;
  const hasCompletedPreRead = workflow.overview?.tasks.some((task) => task.taskType === 'pre-read' && task.status === 'completed') ?? false;
  const resumablePreRead = workflow.overview?.tasks.find((task) => task.taskType === 'pre-read' && ['paused', 'interrupted'].includes(task.status));
  const failedPreRead = workflow.overview?.tasks.find((task) => task.taskType === 'pre-read' && task.status === 'failed' && task.failedItems > 0);

  // Determine current active workflow step
  const currentStep = !hasCompletedPreRead ? 1 : approvedCount === 0 ? 2 : openReviewCount > 0 ? 4 : approvedCount >= totalParagraphs && totalParagraphs > 0 ? 5 : 3;

  return (
    <div className="workspace-scroll project-home-page">
      <ProjectHeading library={library} />

      <div className="project-home-layout">
        <main className="project-home-main">
          {/* 5-Step Linear Workflow Stepper */}
          <section className="project-next-step">
            <div className="next-step-header">
              <p className="eyebrow">标准推荐作业流</p>
              <h2>轻小说翻译与润色 5 步向导</h2>
              <p>为了保证整本书人物称呼、世界观专名与语气高度统一，请依序进行：</p>
            </div>

            <div className="workflow-stepper-grid">
              <button
                type="button"
                className={`step-item ${currentStep === 1 ? 'active' : hasCompletedPreRead ? 'done' : ''}`}
                onClick={() => {
                  if (resumablePreRead) void workflow.resume(resumablePreRead.taskId);
                  else if (failedPreRead) void workflow.retryFailed(failedPreRead.taskId);
                  else if (!hasCompletedPreRead) void workflow.start('pre-read');
                  else onNavigate('glossary');
                }}
              >
                <div className="step-badge">{hasCompletedPreRead ? <CheckCircle2 size={14} /> : '1'}</div>
                <div>
                  <strong>提取术语与预读</strong>
                  <small>{resumablePreRead
                    ? `已保存 ${resumablePreRead.completedItems}/${resumablePreRead.totalItems} 章，点击继续`
                    : failedPreRead
                    ? `${failedPreRead.failedItems} 章失败，章节断点已保留，点击重试`
                    : hasCompletedPreRead ? `已抽取 ${glossaryCount} 项` : '扫描全书设定与专名'}</small>
                </div>
              </button>

              <button
                type="button"
                className={`step-item ${currentStep === 2 ? 'active' : approvedCount > 0 ? 'done' : ''}`}
                onClick={() => onNavigate('glossary')}
              >
                <div className="step-badge">{approvedCount > 0 ? <CheckCircle2 size={14} /> : '2'}</div>
                <div>
                  <strong>核对与锁定专名</strong>
                  <small>确认角色与核心译名</small>
                </div>
              </button>

              <button
                type="button"
                className={`step-item ${currentStep === 3 ? 'active' : approvedCount >= totalParagraphs && totalParagraphs > 0 ? 'done' : ''}`}
                onClick={() => onNavigate('workshop')}
              >
                <div className="step-badge">{approvedCount >= totalParagraphs && totalParagraphs > 0 ? <CheckCircle2 size={14} /> : '3'}</div>
                <div>
                  <strong>全书翻译与润色</strong>
                  <small>{approvedCount > 0 ? `已成稿 ${approvedCount} 段` : '分章对照润色'}</small>
                </div>
              </button>

              <button
                type="button"
                className={`step-item ${currentStep === 4 ? 'active' : ''}`}
                onClick={() => onNavigate('review')}
              >
                <div className="step-badge">4</div>
                <div>
                  <strong>质量复核</strong>
                  <small>{openReviewCount > 0 ? `${openReviewCount} 项待裁定` : '查验文学多解'}</small>
                </div>
              </button>

              <button
                type="button"
                className={`step-item ${currentStep === 5 ? 'active' : ''}`}
                onClick={() => onNavigate('export')}
              >
                <div className="step-badge">5</div>
                <div>
                  <strong>成书导出</strong>
                  <small>导出标准 EPUB / TXT</small>
                </div>
              </button>
            </div>

            <div className="next-step-actions">
              {currentStep === 1 && (
                <>
                  <button type="button" className="secondary-btn" onClick={() => onNavigate('glossary')}>
                    导入已有术语表
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                       if (resumablePreRead) void workflow.resume(resumablePreRead.taskId);
                       else if (failedPreRead) void workflow.retryFailed(failedPreRead.taskId);
                       else void workflow.start('pre-read');
                      onNavigate('workshop');
                    }}
                  >
                    <Sparkles size={16} /> {resumablePreRead
                      ? '继续未完成的全书预读'
                      : failedPreRead ? `从断点重试失败章节 (${failedPreRead.failedItems})` : '一键开启全书预读 (提取术语)'}
                  </button>
                </>
              )}

              {currentStep === 2 && (
                <>
                  <button type="button" className="secondary-btn" onClick={() => onNavigate('characters')}>
                    查看人物关系图
                  </button>
                  <button type="button" className="primary-btn" onClick={() => onNavigate('glossary')}>
                    <Lock size={15} /> 前往确认并锁定专名
                  </button>
                </>
              )}

              {currentStep === 3 && (
                <>
                  <button type="button" className="secondary-btn" onClick={() => onNavigate('reader')}>
                    沉浸阅读试读
                  </button>
                  <button type="button" className="primary-btn" onClick={() => onNavigate('workshop')}>
                    <Zap size={16} /> 进入工坊开始润色翻译
                  </button>
                </>
              )}

              {currentStep === 4 && (
                <>
                  <button type="button" className="secondary-btn" onClick={() => onNavigate('workshop')}>
                    返回润色工坊
                  </button>
                  <button type="button" className="primary-btn" onClick={() => onNavigate('review')}>
                    <ShieldCheck size={16} /> 审查复核队列 ({openReviewCount} 项)
                  </button>
                </>
              )}

              {currentStep === 5 && (
                <button type="button" className="primary-btn" onClick={() => onNavigate('export')}>
                  <Download size={16} /> 立即导出正式成书
                </button>
              )}
            </div>
          </section>

          <section className="project-tools" aria-labelledby="project-tools-title">
            <header>
              <p className="eyebrow">快速导航</p>
              <h2 id="project-tools-title">常用工作入口</h2>
            </header>
            <button type="button" onClick={() => onNavigate('workshop')}>
              <PenLine size={20} />
              <span>
                <strong>润色 / 翻译工坊</strong>
                <small>工作台对照阅读、实时编辑与分段翻译</small>
              </span>
              <ArrowRight size={15} />
            </button>
            <button type="button" onClick={() => onNavigate('reader')}>
              <BookOpen size={20} />
              <span>
                <strong>沉浸式阅读器</strong>
                <small>支持日中对照、纯中文与日文原文多种阅读模式</small>
              </span>
              <ArrowRight size={15} />
            </button>
            <button type="button" onClick={() => onNavigate('glossary')}>
              <Languages size={20} />
              <span>
                <strong>术语与专名表</strong>
                <small>角色译名、专有名词、变体与注释管理</small>
              </span>
              <ArrowRight size={15} />
            </button>
            <button type="button" onClick={() => onNavigate('review')}>
              <ShieldCheck size={20} />
              <span>
                <strong>复核队列</strong>
                <small>查看需要人工裁定的专名分歧或文学多解</small>
              </span>
              <ArrowRight size={15} />
            </button>
          </section>

          {project && <TaskCenter projectId={project.project.projectId} compact />}
        </main>

        <ProjectSourceInspector library={library} />
      </div>
    </div>
  );
};
