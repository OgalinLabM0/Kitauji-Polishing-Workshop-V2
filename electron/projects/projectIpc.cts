import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { ProjectService } from './projectService.cjs';
import type { StorageManager } from '../storage/storageManager.cjs';

const PROJECT_CHANNELS = {
  list: 'projects:list',
  active: 'projects:get-active',
  importSource: 'projects:import-source',
  open: 'projects:open',
  delete: 'projects:delete',
  clear: 'projects:clear',
  readChapter: 'projects:read-chapter',
  saveBlockDraft: 'projects:save-block-draft',
  saveReadingPosition: 'projects:save-reading-position',
  exportEpub: 'projects:export-epub',
} as const;

const assertTrustedSender = (event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null) => {
  const mainWindow = getMainWindow();
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('拒绝来自非主窗口的项目请求。');
  }
};

export const registerProjectIpc = (
  service: ProjectService,
  getMainWindow: () => BrowserWindow | null,
  storage: StorageManager,
) => {
  ipcMain.handle(PROJECT_CHANNELS.list, (event) => {
    assertTrustedSender(event, getMainWindow);
    return service.listProjects();
  });

  ipcMain.handle(PROJECT_CHANNELS.active, (event) => {
    assertTrustedSender(event, getMainWindow);
    return service.getActiveProject();
  });

  ipcMain.handle(PROJECT_CHANNELS.importSource, async (event) => {
    assertTrustedSender(event, getMainWindow);
    const mainWindow = getMainWindow();
    if (!mainWindow) return { status: 'error', message: '主窗口尚未就绪。' };

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '导入 TXT 或 EPUB',
      buttonLabel: '导入作品',
      properties: ['openFile'],
      defaultPath: storage.bookDirectory ?? undefined,
      filters: [
        { name: 'EPUB 电子书', extensions: ['epub'] },
        { name: '文本文件', extensions: ['txt'] },
        { name: '支持的作品文件', extensions: ['epub', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (selection.canceled || selection.filePaths.length !== 1) return { status: 'cancelled' };
    return service.importSourceFile(selection.filePaths[0]);
  });

  ipcMain.handle(PROJECT_CHANNELS.open, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (typeof projectId !== 'string') return null;
    return service.openProject(projectId);
  });

  ipcMain.handle(PROJECT_CHANNELS.delete, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (typeof projectId !== 'string') return { status: 'not-found' };
    return service.deleteProject(projectId);
  });

  ipcMain.handle(PROJECT_CHANNELS.clear, (event) => {
    assertTrustedSender(event, getMainWindow);
    return service.clearProjects();
  });

  ipcMain.handle(PROJECT_CHANNELS.readChapter, (event, projectId: unknown, chapterId: unknown, offset: unknown, limit: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (typeof projectId !== 'string' || typeof chapterId !== 'string') return null;
    return service.readChapter(
      projectId,
      chapterId,
      typeof offset === 'number' ? offset : undefined,
      typeof limit === 'number' ? limit : undefined,
    );
  });

  ipcMain.handle(PROJECT_CHANNELS.saveBlockDraft, (event, projectId: unknown, blockId: unknown, draftText: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (typeof projectId !== 'string' || typeof blockId !== 'string' || (typeof draftText !== 'string' && draftText !== null)) {
      return { status: 'error', message: '校改内容无效。' };
    }
    return service.saveBlockDraft(projectId, blockId, draftText as string | null);
  });

  ipcMain.handle(PROJECT_CHANNELS.saveReadingPosition, (event, projectId: unknown, chapterId: unknown, blockOrdinal: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (typeof projectId !== 'string' || typeof chapterId !== 'string' || typeof blockOrdinal !== 'number') return false;
    return service.saveReadingPosition(projectId, chapterId, blockOrdinal);
  });

  ipcMain.handle(PROJECT_CHANNELS.exportEpub, async (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    const mainWindow = getMainWindow();
    if (!mainWindow || typeof projectId !== 'string') return { status: 'error', message: 'EPUB 导出请求无效。' };
    const project = service.listProjects().find((item) => item.projectId === projectId && item.sourceFormat === 'epub');
    if (!project) return { status: 'error', message: '没有找到可导出的 EPUB 项目。' };
    const originalName = path.basename(project.sourcePath, path.extname(project.sourcePath));
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: '导出 EPUB 校样副本',
      buttonLabel: '导出校样',
      defaultPath: path.join(storage.exportDirectory ?? path.dirname(project.sourcePath), `校样_${originalName}.epub`),
      filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
    return service.exportEpubToFile(projectId, selection.filePath);
  });
};
