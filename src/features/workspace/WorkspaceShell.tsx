import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  BookOpenText,
  Database,
  FileOutput,
  Languages,
  Library,
  Network,
  PenLine,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { ChapterReader } from '../chapters/ChapterReader';
import { ProjectGlossary } from '../glossary/ProjectGlossary';
import { CharacterRelations } from '../knowledge/CharacterRelations';
import { MemoryLedger } from '../knowledge/MemoryLedger';
import { ReviewQueue } from '../review/ReviewQueue';
import { ReaderView } from '../reader/ReaderView';
import { ExportCenter } from '../export/ExportCenter';
import { BookshelfView } from '../projects/BookshelfView';
import { useProjectLibrary } from '../projects/useProjectLibrary';
import { SettingsPanel } from '../settings/SettingsPanel';
import { TranslationWorkbench } from '../workshop/TranslationWorkbench';
import type { useDisplaySettings } from '../settings/useDisplaySettings';
import { OverviewPanel } from './OverviewPanel';
import { guardWorkspaceView, parseWorkspaceHash, workspaceHash, type WorkspaceView } from './workspaceRoute';

import { KitaujiBrandLogo } from '../../components/brand/KitaujiBrandLogo';

interface WorkspaceShellProps {
  readonly onReturn: () => void;
  readonly display: ReturnType<typeof useDisplaySettings>;
}

const mainWorkNav = [
  { id: 'home', label: '作品总览', icon: BookMarked },
  { id: 'workshop', label: '润色 / 翻译工坊', icon: PenLine },
  { id: 'reader', label: '沉浸式阅读', icon: BookOpen },
] as const;

const knowledgeNav = [
  { id: 'glossary', label: '术语与专名', icon: Languages },
  { id: 'characters', label: '人物关系', icon: Users },
  { id: 'memory', label: '事件与记忆', icon: Network },
  { id: 'review', label: '复核队列', icon: ShieldCheck },
] as const;

export const WorkspaceShell = ({ onReturn, display }: WorkspaceShellProps) => {
  const projectLibrary = useProjectLibrary();
  const [view, setView] = useState<WorkspaceView>(() => parseWorkspaceHash(window.location.hash));
  const activeProject = projectLibrary.activeProject?.project;

  useEffect(() => {
    const onHashChange = () => setView(parseWorkspaceHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const guardedView = guardWorkspaceView(view, Boolean(activeProject), projectLibrary.loading);

  useEffect(() => {
    if (guardedView !== view) {
      window.location.hash = workspaceHash(guardedView);
      setView(guardedView);
    }
  }, [guardedView, view]);

  const selectView = (nextView: WorkspaceView) => {
    const next = guardWorkspaceView(nextView, Boolean(activeProject));
    window.location.hash = workspaceHash(next);
    setView(next);
  };

  const openProject = async (projectId: string) => {
    await projectLibrary.openProject(projectId);
    window.location.hash = workspaceHash('home');
    setView('home');
  };

  const pageTitle = useMemo(() => {
    if (guardedView === 'library') return '我的书架';
    if (guardedView === 'settings') return '应用设置';
    if (guardedView === 'export') return '导出成品';
    const item = [...mainWorkNav, ...knowledgeNav].find(({ id }) => id === guardedView);
    return item?.label ?? '作品';
  }, [guardedView]);

  const renderView = () => {
    if (guardedView === 'library') return <BookshelfView library={projectLibrary} onOpen={openProject} />;
    if (guardedView === 'settings') {
      return (
        <SettingsPanel
          settings={display.settings}
          onTextScaleChange={display.setTextScale}
          onReset={display.resetDisplaySettings}
        />
      );
    }
    if (guardedView === 'home') return <OverviewPanel library={projectLibrary} onNavigate={selectView} />;
    if (guardedView === 'proof') return <ReaderView library={projectLibrary} />;
    if (guardedView === 'glossary' && activeProject) {
      return <ProjectGlossary projectId={activeProject.projectId} projectTitle={activeProject.title} />;
    }
    if (guardedView === 'workshop') {
      return (
        <TranslationWorkbench
          library={projectLibrary}
          onNavigateTab={(tab) => {
            if (tab === 'overview') selectView('home');
            else if (tab === 'workbench') selectView('workshop');
            else if (tab === 'reader') selectView('reader');
            else if (tab === 'glossary') selectView('glossary');
            else if (tab === 'relations') selectView('characters');
            else if (tab === 'memory') selectView('memory');
            else if (tab === 'review') selectView('review');
            else if (tab === 'export') selectView('export');
          }}
        />
      );
    }
    if (guardedView === 'reader') {
      return <ReaderView library={projectLibrary} />;
    }
    if (guardedView === 'characters') {
      return activeProject ? <CharacterRelations projectId={activeProject.projectId} /> : null;
    }
    if (guardedView === 'memory') {
      return activeProject ? <MemoryLedger projectId={activeProject.projectId} /> : null;
    }
    if (guardedView === 'review') {
      return activeProject ? <ReviewQueue projectId={activeProject.projectId} /> : null;
    }
    return <ExportCenter library={projectLibrary} />;
  };

  return (
    <main className={`workspace-shell workspace-section-${guardedView}`}>
      <aside className="workspace-nav">
        <div className="workspace-brand">
          <div
            className="brand-mark"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              boxShadow: 'none',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <KitaujiBrandLogo size={36} />
          </div>
          <div>
            <strong>北宇治润色工坊</strong>
            <span>日中小说翻译与润色</span>
          </div>
        </div>

        <nav aria-label="工作区导航">
          <div className="nav-group">
            <span className="nav-group-label">作品库</span>
            <button
              className={guardedView === 'library' ? 'active' : ''}
              type="button"
              onClick={() => selectView('library')}
              title="查看所有书籍"
            >
              <Library size={18} />
              <span>我的书架</span>
            </button>
          </div>

          {activeProject && (
            <div className="nav-project-identity" title={activeProject.title}>
              <small>当前打开作品</small>
              <strong>{activeProject.title}</strong>
            </div>
          )}

          <div className="nav-group nav-group--project">
            <span className="nav-group-label">工坊与阅读</span>
            {mainWorkNav.map(({ id, label, icon: Icon }) => (
              <button
                className={guardedView === id ? 'active' : ''}
                type="button"
                key={id}
                disabled={!activeProject}
                title={activeProject ? label : '请先从书架打开一部作品'}
                onClick={() => selectView(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}

            <span className="nav-group-label" style={{ marginTop: '8px' }}>
              知识与审校
            </span>
            {knowledgeNav.map(({ id, label, icon: Icon }) => (
              <button
                className={guardedView === id ? 'active' : ''}
                type="button"
                key={id}
                disabled={!activeProject}
                title={activeProject ? label : '请先从书架打开一部作品'}
                onClick={() => selectView(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}

            <span className="nav-group-label" style={{ marginTop: '8px' }}>
              成书导出
            </span>
            <button
              className={guardedView === 'export' ? 'active' : ''}
              type="button"
              disabled={!activeProject}
              title={activeProject ? '导出 EPUB / TXT' : '请先从书架打开一部作品'}
              onClick={() => selectView('export')}
            >
              <FileOutput size={18} />
              <span>导出与成品</span>
            </button>
          </div>

          <div className="nav-group nav-group--application">
            <span className="nav-group-label">系统设置</span>
            <button
              className={guardedView === 'settings' ? 'active' : ''}
              type="button"
              onClick={() => selectView('settings')}
              title="配置模型与显示偏好"
            >
              <Settings size={18} />
              <span>应用设置</span>
            </button>
          </div>
        </nav>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div className="header-location">
            <button
              type="button"
              className="quiet-button"
              onClick={onReturn}
              title="返回起始欢迎页"
            >
              <ArrowLeft size={16} />
            </button>
            <span>
              {guardedView === 'library' || guardedView === 'settings'
                ? '北宇治润色工坊'
                : activeProject?.title}
            </span>
            <b>{pageTitle}</b>
          </div>
          <div className="header-actions">
            <span className="local-status">
              <Database size={14} /> 本地存储已就绪
            </span>
            <button
              type="button"
              className="start-button"
              disabled={!projectLibrary.available || projectLibrary.importing}
              onClick={() => void projectLibrary.importSource()}
            >
              <Plus size={15} /> {projectLibrary.importing ? '正在解析…' : '导入作品'}
            </button>
          </div>
        </header>
        {renderView()}
      </section>
    </main>
  );
};

