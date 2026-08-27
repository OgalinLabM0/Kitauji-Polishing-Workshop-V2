import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ProjectLibrary } from './useProjectLibrary';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

export const ProjectHeading = ({ library }: { readonly library: ProjectLibrary }) => {
  const snapshot = library.activeProject;
  const active = snapshot?.project;
  const isEpub = active?.sourceFormat === 'epub';
  const modeLabel =
    active?.contentMode === 'bilingual'
      ? '日中双语'
      : active?.contentMode === 'japanese'
      ? '日文原书'
      : '待识别';

  return (
    <section className="project-heading">
      <p className="eyebrow">当前作品</p>
      {library.loading ? (
        <h1>正在加载作品信息…</h1>
      ) : active ? (
        <>
          <h1>{active.title}</h1>
          <p className="project-path" title={active.sourcePath}>
            {active.sourcePath}
          </p>
          <div className="project-meta" aria-label="作品属性">
            <span>{active.sourceFormat.toUpperCase()}</span>
            {active.sourceEncoding && <span>{active.sourceEncoding.toUpperCase()}</span>}
            <span>{modeLabel}</span>
            {snapshot?.epub && <span>EPUB {snapshot.epub.packageVersion}</span>}
            <span>本地原文件已就绪</span>
          </div>
          <dl className="project-statline">
            <div>
              <dt>{isEpub ? '目录项' : '章节'}</dt>
              <dd>{active.chapterCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>正文段落</dt>
              <dd>{active.paragraphCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>总字数</dt>
              <dd>{active.characterCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>文件大小</dt>
              <dd>{formatBytes(active.sourceSizeBytes)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <h1>尚未选择作品</h1>
          <p className="project-empty-copy">
            请从书架中选择一部作品，或导入新的日文/双语 EPUB 与 TXT 小说。
          </p>
          <div className="project-meta">
            <span>EPUB</span>
            <span>TXT</span>
            <span>本地离线</span>
          </div>
        </>
      )}

      {library.notice && (
        <p className="project-feedback project-feedback--success">
          <CheckCircle2 size={16} />
          {library.notice}
        </p>
      )}
      {library.error && (
        <p className="project-feedback project-feedback--error">
          <AlertTriangle size={16} />
          {library.error}
        </p>
      )}
      {!library.available && !library.loading && (
        <p className="project-feedback project-feedback--error">
          <AlertTriangle size={16} />
          请在桌面应用程序中运行以完整访问本地文件系统。
        </p>
      )}
    </section>
  );
};

