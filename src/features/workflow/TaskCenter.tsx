import { AlertTriangle, Brain, Check, CirclePause, CirclePlay, Languages, RotateCcw, ShieldCheck, Square } from 'lucide-react';
import type { WorkflowTaskSummary, WorkflowTaskType } from '../../core/workflow/models';
import { useWorkflowOverview } from './useWorkflowOverview';

interface TaskCenterProps { readonly projectId: string; readonly compact?: boolean; }

const taskLabel: Record<WorkflowTaskType, string> = {
  'pre-read': '全书预读',
  translate: '翻译 / 润色',
  review: '质量复核',
  export: '成书导出',
};

const statusLabel = {
  pending: '排队中',
  running: '正在处理',
  pausing: '正在暂停',
  paused: '已暂停',
  completed: '已完成',
  failed: '处理失败',
  cancelled: '已取消',
  interrupted: '异常中断',
} as const;

const TaskRow = ({ task, workflow }: { task: WorkflowTaskSummary; workflow: ReturnType<typeof useWorkflowOverview> }) => {
  const progress = task.totalItems ? Math.round((task.completedItems / task.totalItems) * 100) : 0;
  const unit = task.taskType === 'pre-read' ? '章' : '项';
  return (
    <article className={`task-row task-row--${task.status}`}>
      <div className="task-row-title">
        <strong>{taskLabel[task.taskType]}</strong>
        <span className={`task-badge task-badge--${task.status}`}>{statusLabel[task.status]}</span>
      </div>
      <div className="task-progress">
        <i style={{ width: `${progress}%` }} />
      </div>
      <p>
        {task.completedItems.toLocaleString()} / {task.totalItems.toLocaleString()} {unit}完成 · {progress}%
        {task.failedItems ? ` · ${task.failedItems} 项失败` : ''}
        {task.warningItems ? ` · ${task.warningItems} 项待确认` : ''}
      </p>
      {task.errorMessage && <p className="task-error"><AlertTriangle size={14} />{task.errorMessage}</p>}
      <div className="task-row-actions">
        {['pending', 'running'].includes(task.status) && (
          <button type="button" disabled={Boolean(workflow.busy)} onClick={() => void workflow.pause(task.taskId)}>
            <CirclePause size={14} /> 暂停
          </button>
        )}
        {['paused', 'interrupted'].includes(task.status) && (
          <button type="button" disabled={Boolean(workflow.busy)} onClick={() => void workflow.resume(task.taskId)}>
            <CirclePlay size={14} /> 继续
          </button>
        )}
        {task.status === 'failed' && task.failedItems > 0 && (
          <button type="button" disabled={Boolean(workflow.busy)} onClick={() => void workflow.retryFailed(task.taskId)}>
            <RotateCcw size={14} /> {task.taskType === 'pre-read' ? '从断点重试失败章节' : '重试失败项'}
          </button>
        )}
        {['pending', 'running', 'pausing', 'paused', 'interrupted'].includes(task.status) && (
          <button
            type="button"
            className="task-cancel"
            disabled={Boolean(workflow.busy)}
            onClick={() => {
              if (window.confirm('确认取消此任务？已处理的章节和版本会妥善保留。')) void workflow.cancel(task.taskId);
            }}
          >
            <Square size={13} /> 取消
          </button>
        )}
      </div>
    </article>
  );
};

export const TaskCenter = ({ projectId, compact = false }: TaskCenterProps) => {
  const workflow = useWorkflowOverview(projectId);
  const recent = workflow.overview?.tasks.slice(0, compact ? 3 : 10) ?? [];
  const hasActiveTask = workflow.activeTasks.length > 0;
  const hasCompletedPreRead = workflow.overview?.tasks.some((task) => task.taskType === 'pre-read' && task.status === 'completed');
  const hasTranslations = (workflow.overview?.segmentCounts.approved ?? 0) + (workflow.overview?.segmentCounts['needs-human'] ?? 0) > 0;

  return (
    <section className={`task-center ${compact ? 'task-center--compact' : ''}`} aria-labelledby="task-center-title">
      <header>
        <div>
          <p className="eyebrow">任务控制</p>
          <h2 id="task-center-title">自动化处理</h2>
        </div>
        <button type="button" className="task-refresh" disabled={workflow.loading} onClick={() => void workflow.refresh()}>
          <RotateCcw size={14} /> 刷新
        </button>
      </header>

      {workflow.error && <p className="task-feedback task-feedback--error">{workflow.error}</p>}
      {workflow.notice && <p className="task-feedback task-feedback--success">{workflow.notice}</p>}

      <div className="task-start-actions">
        <button type="button" disabled={Boolean(workflow.busy) || hasActiveTask} onClick={() => void workflow.start('pre-read')}>
          <Brain size={18} />
          <span>
            <strong>{hasCompletedPreRead ? '重新全书预读' : '开始全书预读'}</strong>
            <small>建立角色关系、专有名词与行文记忆</small>
          </span>
        </button>

        <button type="button" disabled={Boolean(workflow.busy) || !hasCompletedPreRead || hasActiveTask} onClick={() => void workflow.start('translate')}>
          <Languages size={18} />
          <span>
            <strong>开始翻译 / 润色</strong>
            <small>{hasCompletedPreRead ? '按章节顺序润色并智能校验' : '建议先完成全书预读'}</small>
          </span>
        </button>

        <button type="button" disabled={Boolean(workflow.busy) || !hasTranslations || hasActiveTask} onClick={() => void workflow.start('review')}>
          <ShieldCheck size={18} />
          <span>
            <strong>质量复核</strong>
            <small>复核当前译文，检查专名与句意准确性</small>
          </span>
        </button>
      </div>

      <div className="task-history">
        {workflow.loading && !recent.length ? (
          <p className="task-empty">正在加载任务状态…</p>
        ) : recent.length ? (
          recent.map((task) => <TaskRow key={task.taskId} task={task} workflow={workflow} />)
        ) : (
          <p className="task-empty">暂无进行中的任务。点击上方按钮可开始全书预读或翻译润色。</p>
        )}
      </div>

      {workflow.overview && (
        <footer className="task-summary">
          <span><Check size={14} /> 成稿 {workflow.overview.segmentCounts.approved ?? 0} 段</span>
          <span>术语 {workflow.overview.glossaryCount} 条</span>
          <span>记忆条目 {workflow.overview.memoryFactCount} 条</span>
          <span>待复核 {workflow.overview.openReviewCount} 项</span>
        </footer>
      )}
    </section>
  );
};
