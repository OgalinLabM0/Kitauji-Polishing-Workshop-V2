import { useState } from 'react';
import {
  Check,
  Database,
  Download,
  FolderInput,
  FolderOutput,
  HardDrive,
  Cpu,
  Minus,
  Monitor,
  Plus,
  RotateCcw,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import {
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  TEXT_SCALE_STEP,
  textScalePercentage,
  type DisplaySettings,
} from '../../core/settings/displaySettings';
import type { StorageDirectoryKind } from '../../core/storage/models';
import { useStorageSettings } from './useStorageSettings';
import '../../styles/settings.css';
import { ProviderSettings } from './ProviderSettings';

interface SettingsPanelProps {
  readonly settings: DisplaySettings;
  readonly onTextScaleChange: (scale: number) => void;
  readonly onReset: () => void;
}

const quickScales = [0.9, 1, 1.15, 1.3] as const;
type SettingsPage = 'display' | 'storage' | 'providers';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

interface DirectoryRowProps {
  readonly kind: StorageDirectoryKind;
  readonly title: string;
  readonly description: string;
  readonly path: string | null;
  readonly icon: typeof FolderInput;
  readonly busy: boolean;
  readonly onChoose: () => void;
  readonly onReset: () => void;
  readonly resetLabel?: string;
  readonly showReset?: boolean;
}

const DirectoryRow = ({ kind, title, description, path, icon: Icon, busy, onChoose, onReset, resetLabel = '取消固定', showReset = Boolean(path) }: DirectoryRowProps) => (
  <section className="storage-row">
    <Icon size={19} />
    <div className="storage-row-copy">
      <h3>{title}</h3><p>{description}</p>
      <code>{path ?? (kind === 'books' ? '未固定；打开文件窗口时使用系统位置' : '未固定；默认跟随原书所在目录')}</code>
    </div>
    <div className="storage-row-actions">
      <button type="button" disabled={busy} onClick={onChoose}>{busy ? '处理中…' : '选择位置'}</button>
      {showReset && <button type="button" className="link-action" disabled={busy} onClick={onReset}>{resetLabel}</button>}
    </div>
  </section>
);

export const SettingsPanel = ({ settings, onTextScaleChange, onReset }: SettingsPanelProps) => {
  const [page, setPage] = useState<SettingsPage>(() => (
    new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('panel') === 'storage'
      ? 'storage'
      : new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('panel') === 'providers' ? 'providers' : 'display'
  ));
  const storage = useStorageSettings();
  const info = storage.info;

  return (
    <div className="settings-workspace">
      <aside className="settings-index" aria-label="设置分类">
        <p className="eyebrow">应用设置</p>
        <h1>设置</h1>
        <button type="button" className={page === 'display' ? 'active' : ''} onClick={() => setPage('display')}><Type size={16} /><span><strong>显示与排版</strong><small>字号、窗口与阅读密度</small></span></button>
        <button type="button" className={page === 'storage' ? 'active' : ''} onClick={() => setPage('storage')}><HardDrive size={16} /><span><strong>文件与缓存</strong><small>目录、容量与清理</small></span></button>
        <button type="button" className={page === 'providers' ? 'active' : ''} onClick={() => setPage('providers')}><Cpu size={16} /><span><strong>模型与接口</strong><small>服务地址、模型与密钥</small></span></button>
      </aside>

      <div className="settings-scroll">
        {page === 'providers' ? <ProviderSettings /> : page === 'display' ? (
          <>
            <header className="settings-page-head">
              <div><h1>显示与排版</h1><p>调整整个应用的文字比例；各工作页保留自己的阅读节奏。</p></div>
              <button type="button" className="quiet-button" onClick={onReset}><RotateCcw size={14} />恢复默认</button>
            </header>

            <section className="settings-document" aria-labelledby="text-size-title">
              <header className="settings-document-title">
                <Type size={19} /><div><h2 id="text-size-title">界面文字</h2><p>立即生效，关闭软件后保留。</p></div><output htmlFor="text-scale">{textScalePercentage(settings.textScale)}</output>
              </header>

              <div className="text-scale-control">
                <button type="button" aria-label="缩小文字" disabled={settings.textScale <= MIN_TEXT_SCALE} onClick={() => onTextScaleChange(settings.textScale - TEXT_SCALE_STEP)}><Minus size={15} /></button>
                <input id="text-scale" type="range" min={MIN_TEXT_SCALE} max={MAX_TEXT_SCALE} step={TEXT_SCALE_STEP} value={settings.textScale} aria-valuetext={textScalePercentage(settings.textScale)} onChange={(event) => onTextScaleChange(Number(event.target.value))} />
                <button type="button" aria-label="放大文字" disabled={settings.textScale >= MAX_TEXT_SCALE} onClick={() => onTextScaleChange(settings.textScale + TEXT_SCALE_STEP)}><Plus size={15} /></button>
              </div>

              <div className="text-scale-presets" aria-label="常用文字大小">
                {quickScales.map((scale) => <button type="button" key={scale} className={settings.textScale === scale ? 'active' : ''} onClick={() => onTextScaleChange(scale)}>{settings.textScale === scale && <Check size={12} />}{textScalePercentage(scale)}</button>)}
              </div>

              <div className="display-preview" aria-label="文字大小预览">
                <span>正文预览</span><p lang="ja">「関さん、次のページを見て」</p><p>“关同学，请看下一页。”</p><small>工作台、表单和正文按比例放大；最左侧主导航维持稳定尺度，标题也不会无上限膨胀。</small>
              </div>
              <p className="settings-shortcut">快捷键：Ctrl + 加号 / 减号调整，Ctrl + 0 恢复 100%。</p>
            </section>

            <section className="settings-document settings-window-sheet" aria-labelledby="window-layout-title">
              <header className="settings-document-title"><Monitor size={19} /><div><h2 id="window-layout-title">窗口布局</h2><p>宽屏保留目录和检查器，小窗口改为上下布局或图标轨道。</p></div><span className="settings-state"><Check size={12} />自动</span></header>
              <dl><div><dt>工作页</dt><dd>书架、编辑、阅读和设置使用不同结构</dd></div><div><dt>长文件名与路径</dt><dd>完整换行，不以省略号隐藏</dd></div><div><dt>最小窗口</dt><dd>720 × 600</dd></div></dl>
            </section>
          </>
        ) : (
          <>
            <header className="settings-page-head">
              <div><h1>文件与缓存</h1><p>控制文件窗口默认位置与派生缓存。原书和项目数据不会被缓存清理删除。</p></div>
            </header>

            {storage.error && <p className="storage-feedback storage-feedback--error">{storage.error}</p>}
            {storage.notice && <p className="storage-feedback storage-feedback--success">{storage.notice}</p>}

            <section className="settings-document storage-document" aria-labelledby="file-location-title">
              <header className="settings-document-title"><FolderInput size={19} /><div><h2 id="file-location-title">文件位置</h2><p>这里只改变文件窗口的默认起点，不移动或重命名原书。</p></div></header>
              <DirectoryRow kind="books" title="默认书籍目录" description="导入 EPUB/TXT 时优先从这里打开。" path={info?.bookDirectory ?? null} icon={FolderInput} busy={storage.busy === 'books'} onChoose={() => void storage.choose('books')} onReset={() => void storage.reset('books')} />
              <DirectoryRow kind="exports" title="默认导出目录" description="校样和后续成品默认保存到这里。" path={info?.exportDirectory ?? null} icon={FolderOutput} busy={storage.busy === 'exports'} onChoose={() => void storage.choose('exports')} onReset={() => void storage.reset('exports')} />
            </section>

            <section className="settings-document storage-document" aria-labelledby="cache-title">
              <header className="settings-document-title"><HardDrive size={19} /><div><h2 id="cache-title">正文缓存</h2><p>章节分页读取后保存为可重建缓存，加快来回切章；保存校改、删除项目时会自动失效。</p></div><strong className="storage-size">{info ? formatBytes(info.cacheSizeBytes) : '—'}</strong></header>
              <section className="storage-row storage-row--cache">
                <HardDrive size={19} />
                <div className="storage-row-copy"><h3>缓存目录</h3><p>{info ? `${info.cacheFileCount.toLocaleString()} 个派生文件` : storage.loading ? '正在统计…' : '桌面程序不可用'}</p><code>{info?.cacheDirectory ?? '—'}</code></div>
                <div className="storage-row-actions"><button type="button" disabled={!storage.available || Boolean(storage.busy)} onClick={() => void storage.choose('cache')}>{storage.busy === 'cache' ? '处理中…' : '更换位置'}</button>{info?.customCacheDirectory && <button type="button" className="link-action" disabled={Boolean(storage.busy)} onClick={() => void storage.reset('cache')}>恢复默认</button>}</div>
              </section>
              <div className="cache-clear-line"><p><strong>清理缓存不会删除</strong>原 EPUB/TXT、SQLite 项目、校改草稿、术语或阅读进度。</p><button type="button" disabled={!storage.available || Boolean(storage.busy) || !info || info.cacheFileCount === 0} onClick={() => void storage.clearCache()}><Trash2 size={14} />{storage.busy === 'clear' ? '清理中…' : '清理缓存'}</button></div>
            </section>

            <section className="settings-document database-location" aria-labelledby="database-title">
              <header className="settings-document-title"><Database size={19} /><div><h2 id="database-title">项目数据库</h2><p>保存原书副本、术语、长期记忆、译文版本、任务、复核与阅读位置。</p></div><strong className="storage-size">{info ? formatBytes(info.databaseSizeBytes) : '—'}</strong></header>
              <DirectoryRow kind="database" title="当前数据库" description="可以迁移到 D 盘或其他固定目录。迁移会在重启时完成，原库保持可用直到新库通过校验。" path={info?.databasePath ?? null} icon={Database} busy={storage.busy === 'database'} onChoose={() => void storage.choose('database')} onReset={() => void storage.reset('database')} resetLabel={info?.pendingDatabasePath && !info.customDatabaseDirectory ? '取消待迁移位置' : '迁回系统默认'} showReset={Boolean(info?.customDatabaseDirectory || info?.pendingDatabasePath)} />
              <div className="database-backup-actions">
                <div><strong>整库备份与恢复</strong><p>备份包含原书、术语、长期记忆、译文、任务断点、复核和阅读进度；不包含 API Key。</p></div>
                <div><button type="button" disabled={!storage.available || Boolean(storage.busy)} onClick={() => void storage.backupDatabase()}><Download size={14} />{storage.busy === 'backup' ? '正在校验备份…' : '导出整库备份'}</button><button type="button" disabled={!storage.available || Boolean(storage.busy)} onClick={() => void storage.restoreDatabase()}><Upload size={14} />{storage.busy === 'restore' ? '正在校验…' : '从备份恢复'}</button></div>
              </div>
              {info?.pendingDatabasePath && <div className="database-pending"><div><strong>等待重启迁移</strong><code>{info.pendingDatabasePath}</code><p>重启后先复制完整数据库，再核对完整性、schema 版本和项目数量；全部一致才切换并移除原位置文件。</p></div><button type="button" disabled={Boolean(storage.busy)} onClick={() => void storage.restartForDatabaseMove()}>{storage.busy === 'restart' ? '正在重启…' : '立即重启并迁移'}</button></div>}
              {info?.pendingDatabaseRestore && <div className="database-pending"><div><strong>等待重启恢复整库</strong><code>{info.pendingRestoreSourceName}</code><p>重启后会先为当前数据库建立完整安全副本，再安装并复验所选备份；恢复失败时继续使用当前库。</p></div><button type="button" disabled={Boolean(storage.busy)} onClick={() => void storage.restartForDatabaseMove()}>{storage.busy === 'restart' ? '正在重启…' : '立即重启并恢复'}</button></div>}
              {info?.databaseMoveError && <p className="database-move-error"><strong>上次迁移没有完成：</strong>{info.databaseMoveError}<br />软件仍在使用上方显示的原数据库，请选择另一个空目录后重试。</p>}
              {info?.databaseRestoreError && <p className="database-move-error"><strong>上次恢复没有完成：</strong>{info.databaseRestoreError}<br />软件仍在使用恢复前的数据库。</p>}
              {info?.lastSafetyBackupPath && <p>最近一次恢复前安全副本：<code>{info.lastSafetyBackupPath}</code></p>}
              <p>只有项目数据库移动到自定义位置；用于记住该位置的极小设置文件仍由 Windows 保存在当前用户配置目录。目标目录若已存在同名数据库，软件不会覆盖。</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
