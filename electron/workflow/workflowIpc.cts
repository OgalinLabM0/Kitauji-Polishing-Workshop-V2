import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowService } from './workflowService.cjs';
import type { StartWorkflowInput } from './models.cjs';
import type { StorageManager } from '../storage/storageManager.cjs';

const CHANNELS = {
  overview: 'workflow:overview', start: 'workflow:start', pause: 'workflow:pause',
  resume: 'workflow:resume', cancel: 'workflow:cancel', retryFailed: 'workflow:retry-failed',
  workbench: 'workflow:workbench', saveManual: 'workflow:save-manual', glossary: 'workflow:glossary',
  memory: 'workflow:memory', reviews: 'workflow:reviews', resolveReview: 'workflow:resolve-review',
  importGlossary: 'workflow:import-glossary', updateGlossary: 'workflow:update-glossary',
  exportFinal: 'workflow:export-final', versions: 'workflow:versions', restoreVersion: 'workflow:restore-version',
  getRecentLogs: 'workflow:get-recent-logs', clearLogs: 'workflow:clear-logs',
  runGlossaryAgent: 'workflow:run-glossary-agent',
  runDomainAgent: 'workflow:run-domain-agent',
  seriesAssignment: 'workflow:series-assignment', listSeries: 'workflow:list-series',
  assignSeries: 'workflow:assign-series', unassignSeries: 'workflow:unassign-series',
  ambiguities: 'workflow:ambiguities', resolveAmbiguity: 'workflow:resolve-ambiguity',
} as const;

const assertTrustedSender = (event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null) => {
  const mainWindow = getMainWindow();
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('拒绝来自非主窗口的任务请求。');
};

const safe = async <T,>(action: () => T | Promise<T>) => {
  try { return { status: 'ok' as const, data: await action() }; }
  catch (error) { return { status: 'error' as const, message: error instanceof Error ? error.message : '任务操作失败。' }; }
};

export const registerWorkflowIpc = (service: WorkflowService, getMainWindow: () => BrowserWindow | null, storage: StorageManager) => {
  service.onLog((entry) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('workflow:log', entry);
    }
  });

  ipcMain.handle(CHANNELS.getRecentLogs, (event) => {
    assertTrustedSender(event, getMainWindow);
    return service.getRecentLogs();
  });

  ipcMain.handle(CHANNELS.clearLogs, (event) => {
    assertTrustedSender(event, getMainWindow);
    service.clearLogs();
    return true;
  });

  ipcMain.handle(CHANNELS.runGlossaryAgent, (event, projectId: unknown, instruction: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.runGlossaryAgent(String(projectId), String(instruction));
  });

  ipcMain.handle(CHANNELS.runDomainAgent, (event, domain: unknown, projectId: unknown, instruction: unknown, options: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.runDomainAgent(String(domain) as any, String(projectId), String(instruction), options as any);
  });

  ipcMain.handle(CHANNELS.overview, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.overview(String(projectId));
  });
  ipcMain.handle(CHANNELS.start, (event, input: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.start(input as StartWorkflowInput));
  });
  ipcMain.handle(CHANNELS.pause, (event, taskId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.pause(String(taskId)));
  });
  ipcMain.handle(CHANNELS.resume, (event, taskId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.resume(String(taskId)));
  });
  ipcMain.handle(CHANNELS.retryFailed, (event, taskId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.retryFailed(String(taskId)));
  });
  ipcMain.handle(CHANNELS.cancel, (event, taskId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.cancel(String(taskId)));
  });
  ipcMain.handle(CHANNELS.workbench, (event, projectId: unknown, chapterId: unknown, offset: unknown, limit: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.workbench(String(projectId), String(chapterId), Number(offset) || 0, Number(limit) || 60);
  });
  ipcMain.handle(CHANNELS.saveManual, (event, segmentId: unknown, text: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.saveManual(String(segmentId), String(text)));
  });
  ipcMain.handle(CHANNELS.versions, (event, segmentId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.versions(String(segmentId));
  });
  ipcMain.handle(CHANNELS.restoreVersion, (event, segmentId: unknown, versionId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.restoreVersion(String(segmentId), String(versionId)));
  });
  ipcMain.handle(CHANNELS.glossary, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.glossary(String(projectId));
  });
  ipcMain.handle(CHANNELS.memory, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.memory(String(projectId));
  });
  ipcMain.handle(CHANNELS.seriesAssignment, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.seriesAssignment(String(projectId));
  });
  ipcMain.handle(CHANNELS.listSeries, (event) => {
    assertTrustedSender(event, getMainWindow);
    return service.listSeries();
  });
  ipcMain.handle(CHANNELS.assignSeries, (event, projectId: unknown, input: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { status: 'error', message: '系列设置无效。' };
    return safe(() => service.assignSeries(String(projectId), input as Record<string, unknown>));
  });
  ipcMain.handle(CHANNELS.unassignSeries, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.unassignSeries(String(projectId)));
  });
  ipcMain.handle(CHANNELS.ambiguities, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.ambiguities(String(projectId));
  });
  ipcMain.handle(CHANNELS.resolveAmbiguity, (event, ambiguityId: unknown, input: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { status: 'error', message: '歧义裁定内容无效。' };
    return safe(() => service.resolveAmbiguity(String(ambiguityId), input as Record<string, unknown>));
  });
  ipcMain.handle(CHANNELS.reviews, (event, projectId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.reviews(String(projectId));
  });
  ipcMain.handle(CHANNELS.resolveReview, (event, reviewId: unknown, action: unknown, text: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (action !== 'accept' && action !== 'reject') return { status: 'error', message: '复核操作无效。' };
    return safe(() => service.resolveReview(String(reviewId), action, typeof text === 'string' ? text : undefined));
  });
  ipcMain.handle(CHANNELS.importGlossary, (event, projectId: unknown, records: unknown, locked: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (!Array.isArray(records) || records.length > 50_000) return { status: 'error', message: '术语导入数据无效或过多。' };
    return safe(() => service.importGlossary(String(projectId), records as Record<string, unknown>[], Boolean(locked)));
  });
  ipcMain.handle(CHANNELS.updateGlossary, (event, glossaryId: unknown, input: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (!input || typeof input !== 'object') return { status: 'error', message: '术语修改内容无效。' };
    return safe(() => service.updateGlossary(String(glossaryId), input as Record<string, unknown>));
  });
  ipcMain.handle(CHANNELS.exportFinal, async (event, projectId: unknown, mode: unknown) => {
    assertTrustedSender(event, getMainWindow);
    if (mode !== 'jp-cn' && mode !== 'cn-jp' && mode !== 'cn-only') return { status: 'error', message: '导出模式无效。' };
    const mainWindow = getMainWindow();
    if (!mainWindow) return { status: 'error', message: '主窗口尚未就绪。' };
    try {
      // Perform an authoritative, cheap readiness check before showing a save dialog.
      service.assertFinalExportReady(String(projectId));
      const title = service.projectTitle(String(projectId));
      const suffix = mode === 'cn-only' ? 'SC' : mode === 'cn-jp' ? 'SC&JP' : 'JP&SC';
      const selection = await dialog.showSaveDialog(mainWindow, {
        title: '导出正式 EPUB 成品', buttonLabel: '导出成品',
        defaultPath: path.join(storage.exportDirectory ?? storage.bookDirectory ?? '', `${suffix}-${title.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.epub`),
        filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
      });
      if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
      const built = await service.buildFinalEpub(String(projectId), mode);
      const temporaryPath = `${selection.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, built.bytes, { flag: 'wx' });
      await rm(selection.filePath, { force: true });
      await rename(temporaryPath, selection.filePath);
      return { status: 'exported', outputPath: selection.filePath, outputSizeBytes: built.bytes.byteLength, documentCount: built.documentCount, segmentCount: built.segmentCount, annotationCount: built.annotationCount, mode: built.mode };
    } catch (error) { return { status: 'error', message: error instanceof Error ? error.message : '正式 EPUB 导出失败。' }; }
  });
};
