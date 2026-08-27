import { useState } from 'react';
import { Check, FileOutput, Languages } from 'lucide-react';
import type { ProjectLibrary } from '../projects/useProjectLibrary';
import { useWorkflowOverview } from '../workflow/useWorkflowOverview';
import '../../styles/export.css';

type Mode = 'jp-cn' | 'cn-jp' | 'cn-only';
const options: readonly { mode: Mode; title: string; order: string; description: string }[] = [
  { mode: 'jp-cn', title: '日文 → 中文', order: 'JP / SC', description: '保留日文，成稿紧随其后；适合校对和双语阅读。' },
  { mode: 'cn-jp', title: '中文 → 日文', order: 'SC / JP', description: '成稿在前，日文原文在后；适合以中文阅读为主。' },
  { mode: 'cn-only', title: '纯中文', order: 'SC', description: '只保留中文成稿，并把语言元数据和可识别目录标题改为中文。' },
];

export const ExportCenter = ({ library }: { readonly library: ProjectLibrary }) => {
  const project = library.activeProject;
  const workflow = useWorkflowOverview(project?.project.projectId ?? null);
  const api = window.kitaujiDesktop?.workflow;
  const [mode, setMode] = useState<Mode>('jp-cn');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const counts = workflow.overview?.segmentCounts ?? {};
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const approved = counts.approved ?? 0;
  const ready = total > 0 && approved === total && (workflow.overview?.openReviewCount ?? 0) === 0;
  if (!project) return null;
  const exportNow = async () => {
    if (!api || !ready) return; setBusy(true); setResult(null);
    try {
      const output = await api.exportFinal(project.project.projectId, mode);
      if (output.status === 'error') setResult(output.message);
      else if (output.status === 'exported') setResult(`已导出：${output.outputPath}\n${output.documentCount} 个文档，${output.segmentCount} 个成稿段落${output.annotationCount ? `，${output.annotationCount} 条人工注释` : ''}。`);
    }
    finally { setBusy(false); }
  };
  return (
    <div className="export-page">
      <header>
        <FileOutput size={24} />
        <div>
          <p className="eyebrow">成书导出</p>
          <h1>生成标准电子书</h1>
          <p>将已润色定稿的小说导出为排版优美的标准 EPUB / TXT，支持双语对照与纯中文等多种版式。</p>
        </div>
      </header>

      <section className="export-readiness">
        <div>
          <span>已成稿</span>
          <strong>{approved.toLocaleString()} / {total.toLocaleString()} 段</strong>
        </div>
        <div>
          <span>待复核</span>
          <strong>{workflow.overview?.openReviewCount ?? 0} 项</strong>
        </div>
        <p className={ready ? 'ready' : ''}>
          {ready ? (
            <>
              <Check size={16} /> 所有章节段落均已定稿，可以开始导出成书。
            </>
          ) : (
            <>
              建议完成全部翻译与复核后再行导出；当前尚有 {(total - approved).toLocaleString()} 个段落未定稿、{workflow.overview?.openReviewCount ?? 0} 项待确认。
            </>
          )}
        </p>
      </section>

      <section className="export-modes">
        <header>
          <Languages size={18} />
          <div>
            <h2>排版版式选择</h2>
            <p>保留原书封面、插图、目录与格式样式。在术语表中填写的导出注释将作为读者注释优雅嵌入。</p>
          </div>
        </header>
        {options.map((option) => (
          <label key={option.mode} className={mode === option.mode ? 'active' : ''}>
            <input
              type="radio"
              name="export-mode"
              checked={mode === option.mode}
              onChange={() => setMode(option.mode)}
            />
            <b>{option.order}</b>
            <span>
              <strong>{option.title}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </section>

      {result && <pre className="export-result">{result}</pre>}

      <footer className="export-actions">
        <button type="button" disabled={!ready || busy} onClick={() => void exportNow()}>
          <FileOutput size={16} />
          {busy ? '正在生成并校验书籍…' : '选择导出路径并保存'}
        </button>
        <p>系统将自动校验 EPUB 结构完整性，确保各阅读器均能正常打开与阅读。</p>
      </footer>
    </div>
  );
};
