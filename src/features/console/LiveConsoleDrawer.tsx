import React, { useEffect, useRef, useState } from 'react';
import {
  Terminal,
  Trash2,
  Copy,
  X,
  Play,
} from 'lucide-react';
import type { WorkflowLogEntry, WorkflowTaskSummary } from '../../core/workflow/models';

interface LiveConsoleDrawerProps {
  readonly activeTask?: WorkflowTaskSummary | null;
}

// Global in-memory log buffer that persists across page switches
const globalLogHistory: WorkflowLogEntry[] = [];
const logSubscribers = new Set<(entries: readonly WorkflowLogEntry[]) => void>();

let globalListenerRegistered = false;
const ensureGlobalLogListener = () => {
  if (globalListenerRegistered) return;
  const desktopApi = (window as unknown as {
    kitaujiDesktop?: {
      workflow?: {
        onLog?: (cb: (entry: WorkflowLogEntry) => void) => () => void;
        getRecentLogs?: () => Promise<readonly WorkflowLogEntry[]>;
      };
    };
  }).kitaujiDesktop;

  if (desktopApi?.workflow?.onLog) {
    globalListenerRegistered = true;
    desktopApi.workflow.onLog((entry) => {
      globalLogHistory.push(entry);
      if (globalLogHistory.length > 800) globalLogHistory.shift();
      logSubscribers.forEach((sub) => sub([...globalLogHistory]));
    });

    if (desktopApi.workflow.getRecentLogs && globalLogHistory.length === 0) {
      void desktopApi.workflow.getRecentLogs().then((recent) => {
        if (recent && recent.length) {
          globalLogHistory.push(...recent);
          logSubscribers.forEach((sub) => sub([...globalLogHistory]));
        }
      });
    }
  }
};

export const LiveConsoleDrawer: React.FC<LiveConsoleDrawerProps> = ({ activeTask }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<readonly WorkflowLogEntry[]>(() => {
    ensureGlobalLogListener();
    return [...globalLogHistory];
  });
  const [filter, setFilter] = useState<'all' | 'api' | 'error'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const isRunning = activeTask?.status === 'running';
  const errorLogsCount = logs.filter((l) => l.level === 'error' || l.level === 'warn').length;
  const apiLogsCount = logs.filter((l) => l.level === 'api').length;

  useEffect(() => {
    ensureGlobalLogListener();
    setLogs([...globalLogHistory]);

    const subscriber = (newLogs: readonly WorkflowLogEntry[]) => {
      setLogs(newLogs);
    };
    logSubscribers.add(subscriber);
    return () => {
      logSubscribers.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && isOpen && bodyRef.current) {
      const scroll = () => {
        if (bodyRef.current) {
          bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
      };
      requestAnimationFrame(scroll);
      const timer = setTimeout(scroll, 40);
      return () => clearTimeout(timer);
    }
  }, [logs, isOpen, autoScroll]);

  const handleClearLogs = () => {
    globalLogHistory.length = 0;
    setLogs([]);
    const desktopApi = (window as unknown as {
      kitaujiDesktop?: {
        workflow?: {
          clearLogs?: () => Promise<void>;
        };
      };
    }).kitaujiDesktop;
    if (desktopApi?.workflow?.clearLogs) {
      void desktopApi.workflow.clearLogs();
    }
  };

  const handleCopyLogs = async () => {
    const text = logs
      .map((l) => "[" + l.timestamp + "] [" + l.stage + "] [" + l.level.toUpperCase() + "] " + l.message + (l.details ? " " + l.details : ""))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const filteredLogs = logs.filter((l) => {
    if (filter === 'api') return l.level === 'api';
    if (filter === 'error') return l.level === 'error' || l.level === 'warn';
    return true;
  });

  return (
    <>
      <button
        type="button"
        className={"live-console-trigger " + (isOpen ? "open" : "")}
        onClick={() => setIsOpen(!isOpen)}
        title="打开/关闭实时运行终端"
      >
        <div className={"console-dot " + (isRunning ? "running" : errorLogsCount > 0 ? "error" : "")} />
        <Terminal size={14} />
        <span>运行终端</span>
        {errorLogsCount > 0 && <span className="console-badge-error">{errorLogsCount}</span>}
      </button>

      {isOpen && (
        <div className="live-console-drawer">
          <header className="live-console-header">
            <div className="live-console-title">
              <Terminal size={16} />
              <span>运行控制台 · 实时日志</span>
              {isRunning ? (
                <span style={{ color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Play size={10} fill="#22c55e" /> 执行中
                </span>
              ) : (
                <span style={{ color: '#71717a' }}>空闲</span>
              )}
            </div>

            <div className="live-console-filters">
              <button
                type="button"
                className={"console-filter-btn " + (filter === "all" ? "active" : "")}
                onClick={() => setFilter('all')}
              >
                全部 ({logs.length})
              </button>
              <button
                type="button"
                className={"console-filter-btn " + (filter === "api" ? "active" : "")}
                onClick={() => setFilter('api')}
              >
                API ({apiLogsCount})
              </button>
              <button
                type="button"
                className={"console-filter-btn " + (filter === "error" ? "active" : "")}
                onClick={() => setFilter('error')}
              >
                告警/错误 ({errorLogsCount})
              </button>
            </div>

            <div className="live-console-actions">
              <button
                type="button"
                className={"console-action-btn " + (autoScroll ? "active" : "")}
                onClick={() => setAutoScroll(!autoScroll)}
                title="切换自动滚动"
              >
                滚屏: {autoScroll ? '开' : '关'}
              </button>
              <button
                type="button"
                className="console-action-btn"
                onClick={handleCopyLogs}
                title="复制所有日志"
              >
                <Copy size={12} />
                <span>{copied ? '已复制' : '复制'}</span>
              </button>
              <button
                type="button"
                className="console-action-btn"
                onClick={handleClearLogs}
                title="清空日志"
              >
                <Trash2 size={12} />
                <span>清空</span>
              </button>
              <button
                type="button"
                className="console-close-btn"
                onClick={() => setIsOpen(false)}
                title="关闭控制台"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          <div className="live-console-body" ref={bodyRef}>
            {filteredLogs.length === 0 ? (
              <div className="console-empty">暂无运行日志，启动预读或润色任务后此处将实时输出执行轨迹...</div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="console-log-row">
                  <div className="console-log-main">
                    <span className="console-time">{log.timestamp}</span>
                    <span className={"console-stage console-stage--" + log.stage}>
                      {log.stage === 'pre-read' ? '预读' : log.stage === 'translate' ? '翻译' : log.stage === 'review' ? '复核' : '系统'}
                    </span>
                    <span className={"console-level console-level--" + log.level}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="console-msg">{log.message}</span>
                  </div>
                  {(log.details || log.model
                    || (log.inputTokens !== null && log.inputTokens !== undefined)
                    || (log.outputTokens !== null && log.outputTokens !== undefined)
                    || (log.elapsedMs !== null && log.elapsedMs !== undefined)) && (
                    <div className="console-log-details">
                      {log.details && <span className="console-detail-text">{log.details}</span>}
                      <div className="console-meta-list">
                        {log.model && <span className="console-meta">模型 {log.model}</span>}
                        {log.inputTokens !== null && log.inputTokens !== undefined && <span className="console-meta">输入 {log.inputTokens} tok</span>}
                        {log.outputTokens !== null && log.outputTokens !== undefined && <span className="console-meta">输出 {log.outputTokens} tok</span>}
                        {log.elapsedMs !== null && log.elapsedMs !== undefined && <span className="console-meta">耗时 {(log.elapsedMs / 1000).toFixed(1)}s</span>}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <footer className="live-console-footer">
            <span>日志总数: {logs.length} 条</span>
            {activeTask && (
              <span>当前任务: {activeTask.taskType} ({activeTask.completedItems} / {activeTask.totalItems})</span>
            )}
          </footer>
        </div>
      )}
    </>
  );
};
