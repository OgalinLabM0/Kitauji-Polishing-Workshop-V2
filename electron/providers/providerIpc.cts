import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ProviderService } from './providerService.cjs';

const CHANNELS = {
  get: 'providers:get', save: 'providers:save', active: 'providers:set-active',
  clearKey: 'providers:clear-key', delete: 'providers:delete',
  models: 'providers:list-models', test: 'providers:test',
} as const;

const assertTrustedSender = (event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null) => {
  const mainWindow = getMainWindow();
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('拒绝来自非主窗口的模型服务请求。');
};

const safe = async <T,>(action: () => T | Promise<T>) => {
  try { return { status: 'ok' as const, data: await action() }; }
  catch (error) { return { status: 'error' as const, message: error instanceof Error ? error.message : '模型服务操作失败。' }; }
};

export const registerProviderIpc = (service: ProviderService, getMainWindow: () => BrowserWindow | null) => {
  ipcMain.handle(CHANNELS.get, (event) => {
    assertTrustedSender(event, getMainWindow);
    return service.settings.snapshot();
  });
  ipcMain.handle(CHANNELS.save, (event, input: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.settings.saveProfile(input as never));
  });
  ipcMain.handle(CHANNELS.active, (event, profileId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.settings.setActive(String(profileId)));
  });
  ipcMain.handle(CHANNELS.clearKey, (event, profileId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.settings.clearApiKey(String(profileId)));
  });
  ipcMain.handle(CHANNELS.delete, (event, profileId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.settings.deleteProfile(String(profileId)));
  });
  ipcMain.handle(CHANNELS.models, (event, profileId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return safe(() => service.listModels(String(profileId)));
  });
  ipcMain.handle(CHANNELS.test, (event, profileId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return service.testConnection(String(profileId));
  });
};
