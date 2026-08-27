import { BookOpenText, CheckCircle2, FileText } from 'lucide-react';
import type { ProjectLibrary } from './useProjectLibrary';

export const ProjectSourceInspector = ({ library }: { readonly library: ProjectLibrary }) => {
  const snapshot = library.activeProject;
  const epub = snapshot?.epub;
  const otherProjects = library.projects.filter(({ projectId }) => projectId !== snapshot?.project.projectId);

  return (
    <aside className="memory-inspector source-inspector" aria-labelledby="source-title">
      <div className="section-heading section-heading--compact">
        <div>
          <p className="eyebrow">{epub ? 'EPUB 结构' : '原文目录'}</p>
          <h2 id="source-title">{snapshot ? (epub ? '阅读顺序' : '已识别章节') : '等待原文'}</h2>
        </div>
        <FileText size={21} />
      </div>

      {snapshot ? (
        <ol className="chapter-list">
          {snapshot.chapters.slice(0, 8).map((chapter) => (
            <li key={chapter.chapterId}>
              <span className="chapter-number">{String(chapter.ordinal).padStart(2, '0')}</span>
              <div><strong>{chapter.title}</strong><span>{chapter.paragraphCount} {epub ? '文本块' : '段'} · {chapter.characterCount.toLocaleString()} 字符</span></div>
            </li>
          ))}
          {snapshot.chapters.length > 8 && <li className="chapter-more">另有 {snapshot.chapters.length - 8} {epub ? '项' : '章'}</li>}
        </ol>
      ) : (
        <p className="inspector-copy">导入后，这里会显示从原文识别出的章节顺序。没有明确标题时整份文本会保留为“正文”，不会猜造章节。</p>
      )}

      {epub && (
        <dl className="epub-structure-facts">
          <div><dt>目录</dt><dd>{epub.navigationKind === 'both' ? 'NAV + NCX' : epub.navigationKind.toUpperCase()}</dd></div>
          <div><dt>双语排列</dt><dd>{epub.bilingualLayout === 'alternating-lang' ? '中文 / 日文 lang' : epub.bilingualLayout === 'alternating-opacity' ? '中文 / 淡色日文' : epub.bilingualLayout === 'mixed' ? '混合规则' : '未发现'}</dd></div>
          <div><dt>日中对应</dt><dd>{epub.bilingualPairCount.toLocaleString()} 对</dd></div>
          <div><dt>Ruby</dt><dd>{epub.rubyCount.toLocaleString()} 处</dd></div>
          <div><dt>图片</dt><dd>{epub.imageCount.toLocaleString()} 项</dd></div>
          <div className="epub-opf-row"><dt>OPF</dt><dd>{epub.opfPath}</dd></div>
        </dl>
      )}

      {epub && epub.warnings.length > 0 && (
        <div className="epub-warning-list" aria-label="结构提醒">
          {epub.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      {otherProjects.length > 0 && (
        <div className="recent-projects">
          <h3>项目库中的其他作品</h3>
          {otherProjects.map((project) => (
            <button type="button" key={project.projectId} onClick={() => void library.openProject(project.projectId)}>
              <strong>{project.title}</strong>
              <span>{project.sourcePath}</span>
            </button>
          ))}
        </div>
      )}

      <div className="source-boundary">
        <CheckCircle2 size={18} />
        <p><strong>原文内容不经改写</strong><span>{epub ? '保存完整 EPUB 原包与稳定 DOM 路径；脚本和外部资源不会在界面执行。' : '保存原始文件字节与解码文本；后续译文始终能追溯到原文段落。'}</span></p>
      </div>
      <div className="source-inspector-footnote"><BookOpenText size={14} /> 支持 EPUB 与日文 TXT</div>
    </aside>
  );
};
