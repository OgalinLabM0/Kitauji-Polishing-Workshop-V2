import React, { useEffect, useState } from 'react';
import {
  Bot,
  Sparkles,
  Send,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  Users,
  Network,
  PenLine,
  ShieldCheck,
  Languages,
} from 'lucide-react';

export type AgentDomain = 'glossary' | 'character' | 'memory' | 'workshop' | 'review';

export interface DomainAgentResult {
  readonly summary: string;
  readonly appliedCount: number;
  readonly details?: readonly string[];
  readonly updates?: readonly Record<string, unknown>[];
}

export interface DomainAgentDrawerProps {
  readonly projectId: string;
  readonly domain: AgentDomain;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
  readonly activeChapterId?: string;
  readonly activeSegmentIds?: readonly string[];
}

interface DomainConfig {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: React.FC<{ size?: number; className?: string }>;
  readonly quickPrompts: readonly string[];
}

const DOMAIN_CONFIGS: Record<AgentDomain, DomainConfig> = {
  glossary: {
    title: 'AI 术语审查助理',
    subtitle: '调取全书记忆与章节上下文，批量审查规范专名、校正性别、处理别名或剔除噪音词',
    icon: Languages,
    quickPrompts: [
      '一键确认所有全书复现专名（频次 ≥ 2 次），将单次孤立词设为待观察',
      '规范所有章节标题译名，严格保留原著『』二重引号（如将“胜利”纠正为『胜利』）',
      '将 ハーゼンクレファー 统一修改为“哈森克勒佛”，设为男性并锁定',
      '排除所有无意义的普通日常词与战术常识词（如“時間”、“人間”、“少女”等）',
    ],
  },
  character: {
    title: 'AI 人物关系助理',
    subtitle: '调取全书事实与正文证据，智能梳理角色档案、建立阵营归属、规范称谓阶级并合并别名',
    icon: Users,
    quickPrompts: [
      '根据第 1~5 章战役与士官学校剧情，梳理并绑定谭雅与各教官、同僚的上下级关系',
      '将所有涉及“提古雷查夫”单姓及绰号安全归并在主角“谭雅·提古雷查夫”名下',
      '梳理登场魔导师的军衔晋升时间线，规范“长官 / 阁下 / 前辈”等称呼矩阵',
      '为配角（如马洛里、莉莉）补充从军背景与所属部队设定',
    ],
  },
  memory: {
    title: 'AI 记忆管理助理',
    subtitle: '调取全书长程事实库，精炼核心主线、重估事实重要度、归并同类事件并裁定歧义',
    icon: Network,
    quickPrompts: [
      '一键提高全书核心主线事件与转生辩论的重要度，将杂兵战斗琐事设为情节细节',
      '自动归并重复的同类战役事实，消除叙述冗余并保留关键证据引用',
      '锁定第 3 章涉及“存在X”神学辩论的所有关键事实与世界线设定',
      '审查所有待后文印证的假说（hypothesis），根据最新章节证据转为确认状态',
    ],
  },
  workshop: {
    title: 'AI 翻译润色助理',
    subtitle: '调取当前场景、在场人物性别、历史记忆与术语字典，批量重润色段落并彻底去除翻译腔',
    icon: PenLine,
    quickPrompts: [
      '按照最新人物关系与严肃军政文风，批量重润色当前章节已成稿段落',
      '自然省略所有生硬多余的第三人称代词（“他/她”），被动语态一律文学化意合重构',
      '100% 还原日文原著标点（『』独白、「」对话、——破折号），杜绝 ASCII 引号',
      '消除本章所有“为了做某事”、“进行了……”等机械句式，提升出版级阅读质感',
    ],
  },
  review: {
    title: 'AI 审校仲裁助理',
    subtitle: '调取全书专名与长程世界线，批量裁定复核项、解决术语冲突并修复硬规则警告',
    icon: ShieldCheck,
    quickPrompts: [
      '结合全书记忆与标准专名表，批量裁定所有待人工确认的术语冲突并自动接受',
      '自动核对所有被模型拒绝或未通过忠实检查的段落，生成合规备选译文',
      '一键清除非阻断性文学多解提醒，保留最契合原著语境的成稿版本',
      '对包含双关与谐音的复核段落，选择保留原文多解或补充精简译注',
    ],
  },
};

export const DomainAgentDrawer: React.FC<DomainAgentDrawerProps> = ({
  projectId,
  domain,
  isOpen,
  onClose,
  onUpdated,
  activeChapterId,
  activeSegmentIds,
}) => {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DomainAgentResult | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const config = DOMAIN_CONFIGS[domain];
  const IconComponent = config.icon;

  const handleExecute = async (promptToUse?: string) => {
    const text = (promptToUse ?? instruction).trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const desktopApi = (window as unknown as {
      kitaujiDesktop?: {
        workflow?: {
          runDomainAgent?: (
            domain: AgentDomain,
            projectId: string,
            instruction: string,
            options?: { activeChapterId?: string; activeSegmentIds?: readonly string[] },
          ) => Promise<DomainAgentResult>;
          runGlossaryAgent?: (
            projectId: string,
            instruction: string,
          ) => Promise<DomainAgentResult>;
        };
      };
    }).kitaujiDesktop;

    if (!desktopApi?.workflow) {
      setError('桌面 API 不可用，请在桌面端运行。');
      setLoading(false);
      return;
    }

    try {
      let res: DomainAgentResult;
      if (desktopApi.workflow.runDomainAgent) {
        res = await desktopApi.workflow.runDomainAgent(domain, projectId, text, {
          activeChapterId,
          activeSegmentIds,
        });
      } else if (domain === 'glossary' && desktopApi.workflow.runGlossaryAgent) {
        res = await desktopApi.workflow.runGlossaryAgent(projectId, text);
      } else {
        throw new Error(`当前环境尚未注册 ${config.title} 服务通道。`);
      }

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
    <div className="glossary-agent-overlay domain-agent-overlay" onClick={onClose}>
      <div
        className="glossary-agent-panel domain-agent-panel"
        role="dialog"
        aria-modal="true"
        aria-label={config.title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="glossary-agent-header">
          <div className="glossary-agent-title">
            <div className="glossary-agent-icon">
              <IconComponent size={18} />
            </div>
            <div>
              <h3>{config.title}</h3>
              <p>{config.subtitle}</p>
            </div>
          </div>
          <button type="button" className="glossary-agent-close" onClick={onClose} title="关闭助理">
            <X size={16} />
          </button>
        </header>

        <div className="glossary-agent-body">
          <div className="glossary-agent-quick-prompts">
            <div className="glossary-agent-section-title">
              <Sparkles size={13} />
              <span>常用快捷指令</span>
            </div>
            <div className="glossary-agent-chips">
              {config.quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="glossary-agent-chip"
                  onClick={() => handleExecute(prompt)}
                  disabled={loading}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="glossary-agent-custom-input">
            <div className="glossary-agent-section-title">
              <Bot size={13} />
              <span>自定义自然语言指令</span>
            </div>
            <div className="glossary-agent-input-wrap">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={`向 ${config.title} 描述你的要求（如：“把某人物设为某阵营”、“重新润色当前段落”等）...`}
                rows={4}
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleExecute();
                  }
                }}
              />
              <button
                type="button"
                className="glossary-agent-send-btn"
                onClick={() => void handleExecute()}
                disabled={loading || !instruction.trim()}
              >
                {loading ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
                <span>{loading ? '思考处理中...' : '发送指令 (Ctrl+Enter)'}</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="glossary-agent-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="glossary-agent-result">
              <div className="glossary-agent-result-header">
                <CheckCircle2 size={16} />
                <strong>执行完成：应用了 {result.appliedCount} 处改动</strong>
              </div>
              <p className="glossary-agent-summary">{result.summary}</p>
              {result.details && result.details.length > 0 && (
                <ul className="glossary-agent-diff-list">
                  {result.details.map((detail, idx) => (
                    <li key={idx} className="glossary-agent-diff-item">
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const DomainAgentTriggerButton = ({
  label,
  onClick,
  className = '',
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly className?: string;
}) => (
  <button
    type="button"
    className={`kitauji-agent-btn ${className}`}
    onClick={onClick}
    title={`打开 ${label}`}
  >
    <Bot size={14} className="kitauji-agent-btn-icon" />
    <span>{label}</span>
  </button>
);
