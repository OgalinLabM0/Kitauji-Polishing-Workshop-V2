import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { ProjectService } from '../projects/projectService.cjs';
import type { StorageDirectoryKind } from './models.cjs';
import type { StorageManager } from './storageManager.cjs';
import { stageFactoryReset } from './factoryReset.cjs';

const STORAGE_CHANNELS = {
  info: 'storage:info',
  chooseDirectory: 'storage:choose-directory',
  resetDirectory: 'storage:reset-directory',
  clearCache: 'storage:clear-cache',
  backupDatabase: 'storage:backup-database',
  restoreDatabase: 'storage:restore-database',
  restartForDatabaseMove: 'storage:restart-for-database-move',
  factoryReset: 'storage:factory-reset',
} as const;

const assertTrustedSender = (event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null) => {
  const mainWindow = getMainWindow();
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('拒绝来自非主窗口的存储请求。');
};

const isDirectoryKind = (value: unknown): value is StorageDirectoryKind => value === 'books' || value === 'exports' || value === 'cache' || value === 'database';

const labelForKind = (kind: StorageDirectoryKind) => {
  if (kind === 'books') return { title: '选择默认书籍目录', buttonLabel: '使用此目录' };
  if (kind === 'exports') return { title: '选择默认导出目录', buttonLabel: '使用此目录' };
  if (kind === 'database') return { title: '选择项目数据库所在目录', buttonLabel: '迁移到此目录' };
  return { title: '选择缓存所在磁盘或目录', buttonLabel: '放置缓存' };
};

const safeMessage = (error: unknown) => error instanceof Error ? error.message : '存储位置没有保存。';
const backupFileName = () => `北宇治润色工坊-整库备份-${new Date().toISOString().slice(0, 19).replace(/[:T]/gu, '-')}.sqlite`;

export const registerStorageIpc = (
  manager: StorageManager,
  databasePath: string,
  projectService: ProjectService,
  getMainWindow: () => BrowserWindow | null,
) => {
  ipcMain.handle(STORAGE_CHANNELS.info, (event) => {
    assertTrustedSender(event, getMainWindow);
    return manager.info(databasePath);
  });

  ipcMain.handle(STORAGE_CHANNELS.chooseDirectory, async (event, kind: unknown) => {
    assertTrustedSender(event, getMainWindow);
    const mainWindow = getMainWindow();
    if (!mainWindow || !isDirectoryKind(kind)) return { status: 'error', message: '存储目录类型无效。' };
    const labels = labelForKind(kind);
    const selection = await dialog.showOpenDialog(mainWindow, {
      ...labels,
      defaultPath: kind === 'books' ? manager.bookDirectory ?? undefined : kind === 'exports' ? manager.exportDirectory ?? undefined : kind === 'database' ? path.dirname(databasePath) : manager.cacheDirectory,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || selection.filePaths.length !== 1) return { status: 'cancelled' };
    try {
      if (kind === 'database') {
        const restartRequired = manager.stageDatabaseDirectory(selection.filePaths[0], databasePath);
        return { status: restartRequired ? 'restart-required' : 'saved', info: manager.info(databasePath) };
      }
      manager.setDirectory(kind, selection.filePaths[0]);
      if (kind === 'cache') projectService.setCacheDirectory(manager.cacheDirectory);
      return { status: 'saved', info: manager.info(databasePath) };
    } catch (error) {
      return { status: 'error', message: safeMessage(error) };
    }
  });

  ipcMain.handle(STORAGE_CHANNELS.resetDirectory, (event, kind: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (!isDirectoryKind(kind)) return { status: 'error', message: '存储目录类型无效。' };
    try {
      if (kind === 'database') {
        const restartRequired = manager.stageDatabaseDirectory(null, databasePath);
        return { status: restartRequired ? 'restart-required' : 'saved', info: manager.info(databasePath) };
      }
      manager.setDirectory(kind, null);
      if (kind === 'cache') projectService.setCacheDirectory(manager.cacheDirectory);
      return { status: 'saved', info: manager.info(databasePath) };
    } catch (error) {
      return { status: 'error', message: safeMessage(error) };
    }
  });

  ipcMain.handle(STORAGE_CHANNELS.clearCache, (event) => {
    assertTrustedSender(event, getMainWindow);
    return manager.clearCache(databasePath);
  });

  ipcMain.handle(STORAGE_CHANNELS.backupDatabase, async (event) => {
    assertTrustedSender(event, getMainWindow);
    const mainWindow = getMainWindow();
    if (!mainWindow) return { status: 'error', message: '主窗口不可用。' };
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: '导出完整项目数据库备份',
      buttonLabel: '保存整库备份',
      defaultPath: path.join(manager.exportDirectory ?? path.dirname(databasePath), backupFileName()),
      filters: [{ name: 'Version2 SQLite 整库备份', extensions: ['sqlite'] }],
    });
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
    try {
      const result = await manager.createDatabaseBackup(databasePath, selection.filePath);
      return { status: 'saved', ...result };
    } catch (error) {
      return { status: 'error', message: safeMessage(error) };
    }
  });

  ipcMain.handle(STORAGE_CHANNELS.restoreDatabase, async (event) => {
    assertTrustedSender(event, getMainWindow);
    const mainWindow = getMainWindow();
    if (!mainWindow) return { status: 'error', message: '主窗口不可用。' };
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Version2 整库备份',
      buttonLabel: '校验并准备恢复',
      defaultPath: manager.exportDirectory ?? path.dirname(databasePath),
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['sqlite', 'db'] }],
    });
    if (selection.canceled || selection.filePaths.length !== 1) return { status: 'cancelled' };
    try {
      const sourcePath = selection.filePaths[0];
      const result = await manager.stageDatabaseRestore(sourcePath, databasePath);
      return { status: 'restart-required', sourceFileName: path.basename(sourcePath), ...result, info: manager.info(databasePath) };
    } catch (error) {
      return { status: 'error', message: safeMessage(error) };
    }
  });

  ipcMain.handle(STORAGE_CHANNELS.restartForDatabaseMove, (event) => {
    assertTrustedSender(event, getMainWindow);
    app.relaunch();
    app.quit();
  });

  ipcMain.handle(STORAGE_CHANNELS.factoryReset, async (event) => {
    assertTrustedSender(event, getMainWindow);
    stageFactoryReset(app.getPath('userData'), databasePath);
    await Promise.all([
      session.defaultSession.clearStorageData(),
      session.defaultSession.clearCache(),
    ]);
    app.relaunch();
    app.quit();
    return { status: 'restart-required' } as const;
  });
};
