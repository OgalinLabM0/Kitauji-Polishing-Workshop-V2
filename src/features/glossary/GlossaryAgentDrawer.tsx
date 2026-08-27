import React, { useState } from 'react';
import { Bot, Sparkles, Send, CheckCircle2, AlertCircle, RefreshCw, X, ArrowRight } from 'lucide-react';

interface GlossaryAgentDrawerProps {
  readonly projectId: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
}

interface AgentResult {
  readonly summary: string;
  readonly appliedCount: number;
  readonly updates: Array<{
    readonly glossaryId?: string;
    readonly sourceTerm?: string;
    readonly translatedTerm?: string;
    readonly gender?: string;
    readonly status?: string;
    readonly notes?: string;
  }>;
}

const QUICK_PROMPTS = [
  '一键确认所有全书复现专名（频次 ≥ 2 次），将单次孤立词设为待观察',
  '规范所有章节标题译名，严格保留原著『』二重引号（如将“胜利”纠正为『胜利』）',
  '将 ハーゼンクレファー 统一修改为“哈森克勒佛”，设为男性并锁定',
  '排除所有无意义的普通日常词（如“時間”、“人間”、“少女”等）',
];

export const GlossaryAgentDrawer: React.FC<GlossaryAgentDrawerProps> = ({
  projectId,
  isOpen,
  onClose,
  onUpdated,
}) => {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResult | null>(null);

  if (!isOpen) return null;

  const handleExecute = async (promptToUse?: string) => {
    const text = (promptToUse ?? instruction).trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const desktopApi = (window as unknown as {
      kitaujiDesktop?: {
        workflow?: {
          runGlossaryAgent?: (
            projectId: string,
            instruction: string,
          ) => Promise<AgentResult>;
        };
      };
    }).kitaujiDesktop;

    if (!desktopApi?.workflow?.runGlossaryAgent) {
      setError('桌面 API 不可用，请在桌面端运行。');
      setLoading(false);
      return;
    }

    try {
      const res = await desktopApi.workflow.runGlossaryAgent(projectId, text);
      setResult(res);
      setInstruction('');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent 执行失败，请检查模型服务配置。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glossary-agent-overlay" onClick={onClose}>
      <div className="glossary-agent-panel" onClick={(e) => e.stopPropagation()}>
        <header className="glossary-agent-header">
          <div className="glossary-agent-title">
            <div className="glossary-agent-icon">
              <Bot size={18} />
            </div>
            <div>
              <h3>AI 术语审查助理 (Agent)</h3>
              <p>直接对 Agent 提出修改要求，自动批量审查、统一译名、规范性别或剔除噪音</p>
            </div>
          </div>
          <button type="button" className="glossary-agent-close" onClick={onClose} title="关闭助理">
            <X size={16} />
          </button>
        </header>

        <div className="glossary-agent-body">
          <div className="glossary-agent-quick-prompts">
            <span className="quick-prompt-label">💡 快捷指令：</span>
            {QUICK_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                className="quick-prompt-btn"
                disabled={loading}
                onClick={() => {
                  setInstruction(prompt);
                  void handleExecute(prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>

          <form
            className="glossary-agent-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleExecute();
            }}
          >
            <textarea
              rows={3}
              className="glossary-agent-input"
              placeholder="例如：把哈森克雷费尔全部改成哈森克勒佛并锁定；把泽图亚设为男；排除所有日常词汇..."
              value={instruction}
              disabled={loading}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleExecute();
                }
              }}
            />
            <div className="glossary-agent-form-footer">
              <span className="shortcut-hint">按 Ctrl + Enter 发送</span>
              <button
                type="submit"
                className="glossary-agent-submit-btn"
                disabled={!instruction.trim() || loading}
              >
                {loading ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    <span>正在分析并修改...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>执行指令</span>
                    <Send size={14} />
                  </>
                )}
              </button>
            </div>
          </form>

          {error && (
            <div className="glossary-agent-message glossary-agent-message--error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="glossary-agent-result">
              <div className="result-header">
                <CheckCircle2 size={16} className="text-success" />
                <strong>执行完成：{result.summary}</strong>
                <span className="result-badge">已自动更新 {result.appliedCount} 条</span>
              </div>

              {result.updates.length > 0 && (
                <div className="result-list">
                  {result.updates.map((item, index) => (
                    <div key={index} className="result-item">
                      <div className="result-item-term">
                        <span className="source-term">{item.sourceTerm}</span>
                        <ArrowRight size={12} />
                        <span className="translated-term">{item.translatedTerm}</span>
                      </div>
                      <div className="result-item-tags">
                        {item.gender && item.gender !== 'unknown' && (
                          <span className="tag tag-gender">
                            {item.gender === 'male' ? '男' : item.gender === 'female' ? '女' : '不适用'}
                          </span>
                        )}
                        {item.status && (
                          <span className={"tag tag-status tag-status--" + item.status}>
                            {item.status === 'locked' ? '已锁定' : item.status === 'confirmed' ? '已确认' : '已排除'}
                          </span>
                        )}
                        {item.notes && <span className="item-note">{item.notes}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
