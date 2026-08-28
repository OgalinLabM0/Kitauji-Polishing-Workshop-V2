import { useState } from 'react';
import {
  AlertTriangle,
  Cpu,
  Database,
  Download,
  FolderInput,
  HardDrive,
  Minus,
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
import { ProviderSettings } from './ProviderSettings';
import '../../styles/settings.css';

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

export const SettingsPanel = ({ settings, onTextScaleChange, onReset }: SettingsPanelProps) => {
  const [page, setPage] = useState<SettingsPage>(() => {
    const p = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('panel');
    return p === 'storage' ? 'storage' : p === 'providers' ? 'providers' : 'display';
  });
  const [factoryResetPhrase, setFactoryResetPhrase] = useState('');

  const storage = useStorageSettings();
  const info = storage.info;

  return (
    <div className="settings-workspace">
      {/* 1. Sidebar Navigation */}
      <aside className="settings-index" aria-label="设置分类">
        <div className="settings-index-head">
          <p className="eyebrow">应用设置</p>
          <h1>偏好设置</h1>
        </div>

        <nav className="settings-nav-list">
          <button
            type="button"
            className={`settings-nav-btn ${page === 'display' ? 'active' : ''}`}
            onClick={() => setPage('display')}
          >
            <Type size={16} />
            <div>
              <strong>显示与排版</strong>
              <small>字号缩放与工作页密度</small>
            </div>
          </button>

          <button
            type="button"
            className={`settings-nav-btn ${page === 'storage' ? 'active' : ''}`}
            onClick={() => setPage('storage')}
          >
            <HardDrive size={16} />
            <div>
              <strong>文件与缓存</strong>
              <small>目录路径、正文缓存与整库备份</small>
            </div>
          </button>

          <button
            type="button"
            className={`settings-nav-btn ${page === 'providers' ? 'active' : ''}`}
            onClick={() => setPage('providers')}
          >
            <Cpu size={16} />
            <div>
              <strong>模型与接口</strong>
              <small>4工位模型矩阵、服务连接与密钥</small>
            </div>
          </button>
        </nav>
      </aside>

      {/* 2. Scrollable Body Area */}
      <div className="settings-scroll">
        {page === 'providers' ? (
          <ProviderSettings />
        ) : page === 'display' ? (
          <div className="settings-page-content">
            <header className="settings-page-head">
              <div>
                <h1>全局显示与文字排版</h1>
                <p>调整整个应用的全局文字缩放比例；各小说阅读页保留独立的精细排版偏好。</p>
              </div>
              <button type="button" className="quiet-button" onClick={onReset}>
                <RotateCcw size={14} />
                <span>恢复默认</span>
              </button>
            </header>

            <section className="settings-document-card">
              <header className="card-header">
                <Type size={18} />
                <div>
                  <h2>界面字号缩放</h2>
                  <p>无损缩放工作区菜单、段落文字与检查器。</p>
                </div>
                <strong className="scale-preview-badge">
                  {textScalePercentage(settings.textScale)}%
                </strong>
              </header>

              <div className="scale-adjust-row">
                <div className="scale-stepper">
                  <button
                    type="button"
                    disabled={settings.textScale <= MIN_TEXT_SCALE}
                    onClick={() =>
                      onTextScaleChange(
                        Math.max(MIN_TEXT_SCALE, Number((settings.textScale - TEXT_SCALE_STEP).toFixed(2))),
                      )
                    }
                  >
                    <Minus size={14} />
                  </button>
                  <span className="scale-display">{textScalePercentage(settings.textScale)}%</span>
                  <button
                    type="button"
                    disabled={settings.textScale >= MAX_TEXT_SCALE}
                    onClick={() =>
                      onTextScaleChange(
                        Math.min(MAX_TEXT_SCALE, Number((settings.textScale + TEXT_SCALE_STEP).toFixed(2))),
                      )
                    }
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="scale-quick-pills">
                  {quickScales.map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      className={`scale-pill ${Math.abs(settings.textScale - scale) < 0.01 ? 'active' : ''}`}
                      onClick={() => onTextScaleChange(scale)}
                    >
                      {textScalePercentage(scale)}%
                    </button>
                  ))}
                </div>
              </div>
            </section>

          </div>
        ) : (
          /* File & Storage Tab */
          <div className="settings-page-content">
            <header className="settings-page-head">
              <div>
                <h1>文件存储与数据缓存</h1>
                <p>管理书籍导入起点、章节高速重建缓存与 SQLite 项目整库备份迁移。</p>
              </div>
            </header>

            {storage.error && (
              <div className="settings-alert-box alert-error">
                <span>{storage.error}</span>
              </div>
            )}
            {storage.notice && (
              <div className="settings-alert-box alert-success">
                <span>{storage.notice}</span>
              </div>
            )}

            {/* Storage Metric Gauges */}
            <div className="storage-gauges-grid">
              <div className="storage-gauge-card">
                <span className="gauge-label">章节正文缓存</span>
                <strong className="gauge-value">
                  {info ? formatBytes(info.cacheSizeBytes) : '—'}
                </strong>
                <small className="gauge-desc">
                  {info ? `${info.cacheFileCount.toLocaleString()} 个派生文件` : '统计中…'}
                </small>
              </div>

              <div className="storage-gauge-card">
                <span className="gauge-label">SQLite 项目数据库</span>
                <strong className="gauge-value">
                  {info ? formatBytes(info.databaseSizeBytes) : '—'}
                </strong>
                <small className="gauge-desc">保存原书副本、译文版本、记忆与复核</small>
              </div>
            </div>

            {/* Card 1: Directories */}
            <section className="settings-document-card">
              <header className="card-header">
                <FolderInput size={18} />
                <div>
                  <h2>默认文件交互位置</h2>
                  <p>设置导入与导出文件选择窗口的默认起始目录，原书文件不会被自动移动。</p>
                </div>
              </header>

              <div className="directory-rows-list">
                <div className="directory-row-item">
                  <div className="dir-info">
                    <strong>默认书籍目录</strong>
                    <p>导入 EPUB / TXT 时优先打开的位置</p>
                    <code>{info?.bookDirectory ?? '未固定（使用系统最近选择）'}</code>
                  </div>
                  <div className="dir-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={Boolean(storage.busy)}
                      onClick={() => void storage.choose('books')}
                    >
                      选择目录
                    </button>
                    {info?.bookDirectory && (
                      <button
                        type="button"
                        className="danger-quiet-btn"
                        disabled={Boolean(storage.busy)}
                        onClick={() => void storage.reset('books')}
                      >
                        清除固定
                      </button>
                    )}
                  </div>
                </div>

                <div className="directory-row-item">
                  <div className="dir-info">
                    <strong>默认成书导出目录</strong>
                    <p>正式 EPUB 校样与成品默认保存到这里</p>
                    <code>{info?.exportDirectory ?? '未固定（默认跟随书籍原目录）'}</code>
                  </div>
                  <div className="dir-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={Boolean(storage.busy)}
                      onClick={() => void storage.choose('exports')}
                    >
                      选择目录
                    </button>
                    {info?.exportDirectory && (
                      <button
                        type="button"
                        className="danger-quiet-btn"
                        disabled={Boolean(storage.busy)}
                        onClick={() => void storage.reset('exports')}
                      >
                        清除固定
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Card 2: Cache Management */}
            <section className="settings-document-card">
              <header className="card-header">
                <HardDrive size={18} />
                <div>
                  <h2>章节正文高速缓存</h2>
                  <p>
                    分页读取后缓存为高保真只读数据，加快来回切章响应；保存校改与删除项目时自动失效。
                  </p>
                </div>
              </header>

              <div className="directory-row-item">
                <div className="dir-info">
                  <strong>当前缓存目录</strong>
                  <p>{info ? `${info.cacheFileCount.toLocaleString()} 个可重建派生文件` : storage.loading ? '正在统计…' : '桌面存储服务不可用'}</p>
                  <code>{info?.cacheDirectory ?? '—'}</code>
                </div>
                <div className="dir-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={!storage.available || Boolean(storage.busy)}
                    onClick={() => void storage.choose('cache')}
                  >
                    {storage.busy === 'cache' ? '处理中…' : '更换缓存位置'}
                  </button>
                  {info?.customCacheDirectory && (
                    <button
                      type="button"
                      className="danger-quiet-btn"
                      disabled={Boolean(storage.busy)}
                      onClick={() => void storage.reset('cache')}
                    >
                      恢复系统默认
                    </button>
                  )}
                </div>
              </div>

              <div className="cache-management-box">
                <div className="cache-desc-text">
                  <p>
                    <strong>清理缓存绝对安全</strong>：清理操作仅删除本地章节预渲染派生文件，
                    <strong>
                      绝不会删除原 EPUB/TXT、SQLite 数据库、已润色译文、术语表或阅读进度
                    </strong>
                    。
                  </p>
                </div>
                <button
                  type="button"
                  className="danger-quiet-btn"
                  disabled={!storage.available || Boolean(storage.busy) || !info || info.cacheFileCount === 0}
                  onClick={() => void storage.clearCache()}
                >
                  <Trash2 size={14} />
                  <span>{storage.busy === 'clear' ? '正在清理…' : '一键安全清理正文缓存'}</span>
                </button>
              </div>
            </section>

            {/* Card 3: Database & Full Backup */}
            <section className="settings-document-card">
              <header className="card-header">
                <Database size={18} />
                <div>
                  <h2>项目整库备份与迁移</h2>
                  <p>备份包含全书原稿、已润色版本流、专名词典、长程叙事记忆与质量复核队列。</p>
                </div>
              </header>

              <div className="directory-row-item database-location-row">
                <div className="dir-info">
                  <strong>当前项目数据库</strong>
                  <p>保存原书副本、术语、长期记忆、译文版本、任务断点、复核与阅读位置</p>
                  <code>{info?.databasePath ?? '—'}</code>
                </div>
                <div className="dir-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={!storage.available || Boolean(storage.busy)}
                    onClick={() => void storage.choose('database')}
                  >
                    {storage.busy === 'database' ? '处理中…' : '迁移数据库位置'}
                  </button>
                  {(info?.customDatabaseDirectory || info?.pendingDatabasePath) && (
                    <button
                      type="button"
                      className="danger-quiet-btn"
                      disabled={Boolean(storage.busy)}
                      onClick={() => void storage.reset('database')}
                    >
                      {info?.pendingDatabasePath && !info.customDatabaseDirectory ? '取消待迁移' : '迁回系统默认'}
                    </button>
                  )}
                </div>
              </div>

              <div className="db-backup-actions-bar">
                <div className="db-backup-info">
                  <strong>整库备份导出与恢复 (.sqlite.bak)</strong>
                  <p>可安全迁移至其他设备，备份文件不包含你的私密 API Key。</p>
                </div>
                <div className="db-buttons-row">
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={!storage.available || Boolean(storage.busy)}
                    onClick={() => void storage.backupDatabase()}
                  >
                    <Download size={14} />
                    <span>{storage.busy === 'backup' ? '正在导出…' : '导出整库备份'}</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={!storage.available || Boolean(storage.busy)}
                    onClick={() => void storage.restoreDatabase()}
                  >
                    <Upload size={14} />
                    <span>{storage.busy === 'restore' ? '正在恢复…' : '从备份恢复整库'}</span>
                  </button>
                </div>
              </div>

              {info?.pendingDatabasePath && (
                <div className="database-pending-box">
                  <div><strong>等待重启迁移</strong><code>{info.pendingDatabasePath}</code><p>重启后先复制完整数据库，再核对完整性、schema 与项目数量；全部一致才切换。</p></div>
                  <button type="button" className="primary-btn" disabled={Boolean(storage.busy)} onClick={() => void storage.restartForDatabaseMove()}>
                    {storage.busy === 'restart' ? '正在重启…' : '立即重启并迁移'}
                  </button>
                </div>
              )}
              {info?.pendingDatabaseRestore && (
                <div className="database-pending-box">
                  <div><strong>等待重启恢复整库</strong><code>{info.pendingRestoreSourceName}</code><p>重启前会为当前库建立安全副本；恢复校验失败时仍使用当前数据库。</p></div>
                  <button type="button" className="primary-btn" disabled={Boolean(storage.busy)} onClick={() => void storage.restartForDatabaseMove()}>
                    {storage.busy === 'restart' ? '正在重启…' : '立即重启并恢复'}
                  </button>
                </div>
              )}
              {info?.databaseMoveError && <p className="database-operation-error"><strong>上次迁移未完成：</strong>{info.databaseMoveError} 软件仍在使用原数据库。</p>}
              {info?.databaseRestoreError && <p className="database-operation-error"><strong>上次恢复未完成：</strong>{info.databaseRestoreError} 软件仍在使用恢复前数据库。</p>}
              {info?.lastSafetyBackupPath && <p className="database-safety-path">最近一次恢复前安全副本：<code>{info.lastSafetyBackupPath}</code></p>}
            </section>

            <section className="settings-document-card settings-danger-card">
              <header className="card-header danger-card-header">
                <AlertTriangle size={18} />
                <div>
                  <h2>清空所有数据并初始化软件</h2>
                  <p>用于彻底回到首次启动状态；操作将在重启时执行，无法撤销。</p>
                </div>
              </header>

              <div className="factory-reset-box">
                <p>
                  将删除所有项目、原文副本、译文版本、术语/人物/事件记忆、任务与阅读进度、
                  API 配置和密钥、界面偏好、运行日志、缓存及自动安全备份。
                  <strong>不会删除你自行导出的 EPUB/TXT、手动导出的数据库备份或磁盘上的原始书籍文件。</strong>
                </p>
                <label>
                  <span>输入“初始化”以解锁按钮</span>
                  <input
                    value={factoryResetPhrase}
                    onChange={(event) => setFactoryResetPhrase(event.target.value)}
                    placeholder="初始化"
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className="factory-reset-button"
                  disabled={!storage.available || Boolean(storage.busy) || factoryResetPhrase !== '初始化'}
                  onClick={() => {
                    if (!window.confirm('最后确认：清空软件内的全部项目、译文、记忆、密钥和设置，并立即重启？')) return;
                    void storage.factoryReset();
                  }}
                >
                  <Trash2 size={14} />
                  <span>{storage.busy === 'factory-reset' ? '正在安排初始化并重启…' : '清空所有数据并重启'}</span>
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
