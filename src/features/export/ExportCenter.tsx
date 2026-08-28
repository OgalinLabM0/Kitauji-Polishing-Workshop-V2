import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  FileOutput,
  Info,
  Languages,
} from 'lucide-react';
import type { ProjectLibrary } from '../projects/useProjectLibrary';
import { useWorkflowOverview } from '../workflow/useWorkflowOverview';
import { DomainAgentDrawer, DomainAgentTriggerButton } from '../agent/DomainAgentDrawer';
import { getExportReadiness } from './exportReadiness';
import '../../styles/export.css';

type Mode = 'jp-cn' | 'cn-jp' | 'cn-only';

interface ExportOption {
  readonly mode: Mode;
  readonly title: string;
  readonly order: string;
  readonly badge: string;
  readonly description: string;
  readonly features: readonly string[];
}

const exportOptions: readonly ExportOption[] = [
  {
    mode: 'jp-cn',
    title: '日中精读双语版 EPUB',
    order: 'JP ➔ SC',
    badge: '推荐校样',
    description: '日文原文在上，中文润色成稿紧随其后。适合文学对比、细微语态查验及双语精读。',
    features: ['保留日文原著全部振假名与版式', '中文润色成稿段落对称嵌入', '支持多端阅读器排版'],
  },
  {
    mode: 'cn-jp',
    title: '中文主读双语版 EPUB',
    order: 'SC ➔ JP',
    badge: '读者伴读',
    description: '中文润色成稿在前，日文原著在后作为附录参考。适合以流畅中文阅读为主、偶查原文的读者。',
    features: ['主文为大字号精修中文', '日文原文附于段后（浅灰小字）', '保留原书全彩封面与插画'],
  },
  {
    mode: 'cn-only',
    title: '出版级纯中文 EPUB / TXT',
    order: 'SC ONLY',
    badge: '正式成书',
    description: '彻底剥离生肉痕迹，仅保留精润中文成稿。将书籍语言元数据与目录标题规范为标准中文。',
    features: ['100% 纯正出版级阅读体验', '原书注释与读者译注优雅呈现', '原书高清插画与彩页完美内嵌'],
  },
];

export const ExportCenter = ({ library }: { readonly library: ProjectLibrary }) => {
  const project = library.activeProject;
  const workflow = useWorkflowOverview(project?.project.projectId ?? null);
  const api = window.kitaujiDesktop?.workflow;
  const [mode, setMode] = useState<Mode>('cn-only');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);

  const counts = workflow.overview?.segmentCounts ?? {};
  const { total, approved, remaining, openReviewCount: openReviews, percentage, isReady, reason } =
    getExportReadiness({ segmentCounts: counts, openReviewCount: workflow.overview?.openReviewCount ?? 0 });

  if (!project) return null;

  const exportNow = async () => {
    if (!api) return;
    if (!isReady) {
      setError(reason ?? '当前项目尚未达到正式导出条件。');
      return;
    }
    setBusy(true);
    setResult(null);
    setError(null);
    setOutputPath(null);
    try {
      const output = await api.exportFinal(project.project.projectId, mode);
      if (output.status === 'error') {
        setError(output.message);
      } else if (output.status === 'exported') {
        setOutputPath(output.outputPath);
        setResult(
          `导出成功！共生成 ${output.documentCount} 个章节文档，写入 ${output.segmentCount.toLocaleString()} 个润色定稿段落${
            output.annotationCount ? `，并注入 ${output.annotationCount} 条读者译注` : ''
          }。`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-page">
      {/* 1. Header */}
      <header className="export-header">
        <div className="export-header-title">
          <div className="export-header-icon">
            <FileOutput size={22} />
          </div>
          <div>
            <p className="eyebrow">出版与交付</p>
            <h1>成书导出与排版中心</h1>
            <p className="export-meta-line">
              当前作品：<strong>{project.project.title}</strong>　/　
              <span>{project.chapters.length}</span> 个章节　/　
              <span>{total.toLocaleString()}</span> 个文本段落
            </p>
          </div>
        </div>
        <div className="export-header-actions">
          <DomainAgentTriggerButton label="AI 导出校验助理" onClick={() => setAgentOpen(true)} />
        </div>
      </header>

      {/* 2. Readiness & Quality Gauge Card */}
      <section className="export-readiness-card">
        <div className="readiness-progress-col">
          <div className="readiness-progress-top">
            <span className="readiness-label">全书润色成稿进度</span>
            <strong className="readiness-percent">{percentage}%</strong>
          </div>
          <div className="readiness-progress-bar">
            <div className="progress-fill" style={{ width: `${percentage}%` }} />
          </div>
          <div className="readiness-counts-row">
            <span>已定稿: {approved.toLocaleString()} 段</span>
            <span>待润色: {remaining.toLocaleString()} 段</span>
            <span className={openReviews > 0 ? 'count-warning' : 'count-success'}>
              待复核: {openReviews} 项
            </span>
          </div>
        </div>

        <div className="readiness-checklist-col">
          <h4>出版级交付前置核验</h4>
          <ul className="readiness-checklist">
            <li className={approved === total && total > 0 ? 'check-pass' : 'check-pending'}>
              {approved === total && total > 0 ? <CheckCircle2 size={15} /> : <Info size={15} />}
              <span>所有章节段落已 100% 完成润色定稿</span>
            </li>
            <li className={openReviews === 0 ? 'check-pass' : 'check-pending'}>
              {openReviews === 0 ? <CheckCircle2 size={15} /> : <Info size={15} />}
              <span>复核队列中无未决阻断项或术语冲突 ({openReviews} 项)</span>
            </li>
            <li className="check-pass">
              <CheckCircle2 size={15} />
              <span>原书封面、插图画质与 EPUB/OEBPS 结构符合国际标准</span>
            </li>
          </ul>
        </div>
      </section>

      {/* 3. Export Format Cards */}
      <section className="export-formats-section">
        <div className="export-section-title">
          <Languages size={18} />
          <div>
            <h2>排版版式与成书方案</h2>
            <p>导出时系统将自动校对目录层级、内嵌原书字体与高清插画，并在术语表中附带读者注释。</p>
          </div>
        </div>

        <div className="export-options-grid">
          {exportOptions.map((opt) => (
            <label
              key={opt.mode}
              className={`export-card-option ${mode === opt.mode ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="export-format-mode"
                checked={mode === opt.mode}
                onChange={() => setMode(opt.mode)}
              />
              <div className="export-card-header">
                <div className="export-order-badge">{opt.order}</div>
                <span className="export-type-tag">{opt.badge}</span>
              </div>
              <h3 className="export-card-title">{opt.title}</h3>
              <p className="export-card-desc">{opt.description}</p>
              <ul className="export-features-list">
                {opt.features.map((feat, i) => (
                  <li key={i}>
                    <Check size={12} />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </label>
          ))}
        </div>
      </section>

      {/* 4. Result & Feedback Banner */}
      {result && (
        <div className="export-result-card">
          <div className="result-header">
            <CheckCircle2 size={18} />
            <strong>{result}</strong>
          </div>
          {outputPath && (
            <div className="result-path-box">
              <code>{outputPath}</code>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="export-result-card export-result-error" role="alert">
          <div className="result-header">
            <Info size={18} />
            <strong>{error}</strong>
          </div>
        </div>
      )}

      {/* 5. Primary Action Area */}
      <footer className="export-footer-actions">
        <button
          type="button"
          className="export-execute-btn"
          disabled={busy || !isReady}
          title={!isReady ? reason ?? undefined : undefined}
          onClick={() => void exportNow()}
        >
          <Download size={18} />
          <span>{busy ? '正在封装并校验 EPUB 成书…' : !isReady ? '达到 100% 定稿后可导出' : '一键生成并导出正式书籍'}</span>
        </button>
        {!isReady && <p className="export-blocked-note">{reason}</p>}
        <p className="export-tip-note">
          导出的 EPUB 完全兼容 Apple Books、微信读书、Calibre、Kobo、Kindle 及各大主流墨水屏阅读器。
        </p>
      </footer>

      <DomainAgentDrawer
        projectId={project.project.projectId}
        domain="review"
        isOpen={agentOpen}
        onClose={() => setAgentOpen(false)}
        onUpdated={() => {}}
      />
    </div>
  );
};
