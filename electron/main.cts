import { app, BrowserWindow, dialog, safeStorage, session } from 'electron';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerProjectIpc } from './projects/projectIpc.cjs';
import { ProjectService } from './projects/projectService.cjs';
import { StorageManager } from './storage/storageManager.cjs';
import { registerStorageIpc } from './storage/storageIpc.cjs';
import { ProviderSettingsStore } from './providers/providerSettings.cjs';
import { ProviderService } from './providers/providerService.cjs';
import { registerProviderIpc } from './providers/providerIpc.cjs';
import { WorkflowService } from './workflow/workflowService.cjs';
import { registerWorkflowIpc } from './workflow/workflowIpc.cjs';

const argumentValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const projectDatabaseArgument = argumentValue('--project-db');
const diagnoseProviderArgument = argumentValue('--diagnose-provider');
const diagnoseProviderOutputArgument = argumentValue('--diagnose-output');
const seedTxtArgument = argumentValue('--import-txt');
const seedSourceArgument = argumentValue('--import-source');

const captureArgumentIndex = process.argv.indexOf('--capture-ui');
const captureOutputPath = captureArgumentIndex >= 0 ? process.argv[captureArgumentIndex + 1] : undefined;
const captureScrollArgumentIndex = process.argv.indexOf('--capture-scroll');
const requestedCaptureScrollTop = captureScrollArgumentIndex >= 0
  ? Number(process.argv[captureScrollArgumentIndex + 1])
  : 0;
const captureScrollTop = Number.isFinite(requestedCaptureScrollTop) && requestedCaptureScrollTop > 0
  ? Math.floor(requestedCaptureScrollTop)
  : 0;
const openWorkspaceForCapture = process.argv.includes('--workspace');
const openLibraryForCapture = process.argv.includes('--library');
const openLibraryClearForCapture = process.argv.includes('--library-clear');
const openChaptersForCapture = process.argv.includes('--chapters');
const openWorkshopForCapture = process.argv.includes('--workshop');
const openReaderForCapture = process.argv.includes('--reader');
const openSettingsForCapture = process.argv.includes('--settings');
const openStorageSettingsForCapture = process.argv.includes('--storage-settings');
const openProviderSettingsForCapture = process.argv.includes('--provider-settings');
const openCharactersForCapture = process.argv.includes('--characters');
const openMemoryForCapture = process.argv.includes('--memory');
const openReviewForCapture = process.argv.includes('--review');
const openExportForCapture = process.argv.includes('--export');
const openGlossaryImportSingleForCapture = process.argv.includes('--glossary-import-single');
const openGlossaryImportForCapture = process.argv.includes('--glossary-import') || openGlossaryImportSingleForCapture;
const openGlossaryForCapture = process.argv.includes('--glossary') || openGlossaryImportForCapture;
const glossaryEntryArgumentIndex = process.argv.indexOf('--glossary-entry');
const glossaryEntryForCapture = glossaryEntryArgumentIndex >= 0
  ? process.argv[glossaryEntryArgumentIndex + 1]
  : undefined;
const useNarrowCaptureWindow = process.argv.includes('--narrow');
const useCompactCaptureWindow = process.argv.includes('--compact');
const textScaleArgumentIndex = process.argv.indexOf('--text-scale');
const textScaleForCapture = textScaleArgumentIndex >= 0 ? process.argv[textScaleArgumentIndex + 1] : undefined;
const glossaryCaptureQuery = new URLSearchParams();
if (glossaryEntryForCapture) glossaryCaptureQuery.set('entry', glossaryEntryForCapture);
if (openGlossaryImportForCapture) glossaryCaptureQuery.set('import', openGlossaryImportSingleForCapture ? 'single' : 'batch-demo');
if (textScaleForCapture) glossaryCaptureQuery.set('displayScale', textScaleForCapture);
const displayCaptureQuery = textScaleForCapture ? `?displayScale=${encodeURIComponent(textScaleForCapture)}` : '';
const captureHash = openGlossaryForCapture
  ? `project/glossary${glossaryCaptureQuery.size > 0 ? `?${glossaryCaptureQuery.toString()}` : ''}`
  : openSettingsForCapture || openStorageSettingsForCapture || openProviderSettingsForCapture
    ? `settings?${new URLSearchParams({
        ...(textScaleForCapture ? { displayScale: textScaleForCapture } : {}),
        ...(openStorageSettingsForCapture ? { panel: 'storage' } : {}),
        ...(openProviderSettingsForCapture ? { panel: 'providers' } : {}),
      }).toString()}`
  : openChaptersForCapture
    ? `project/proof${displayCaptureQuery}`
  : openWorkshopForCapture
    ? `project/workshop${displayCaptureQuery}`
  : openReaderForCapture
    ? `project/reader${displayCaptureQuery}`
  : openCharactersForCapture
    ? `project/characters${displayCaptureQuery}`
  : openMemoryForCapture
    ? `project/memory${displayCaptureQuery}`
  : openReviewForCapture
    ? `project/review${displayCaptureQuery}`
  : openExportForCapture
    ? `project/export${displayCaptureQuery}`
  : openWorkspaceForCapture
    ? `project/home${displayCaptureQuery}`
  : openLibraryForCapture || openLibraryClearForCapture
    ? `library${openLibraryClearForCapture ? '?confirm=clear' : displayCaptureQuery}`
    : undefined;

let mainWindow: BrowserWindow | null = null;
let projectService: ProjectService | null = null;
let workflowService: WorkflowService | null = null;

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: useCompactCaptureWindow ? 720 : useNarrowCaptureWindow ? 1080 : 1440,
    height: useCompactCaptureWindow ? 680 : useNarrowCaptureWindow ? 720 : openGlossaryForCapture ? 1100 : 900,
    minWidth: 720,
    minHeight: 600,
    show: false,
    backgroundColor: '#fdfcf8',
    title: '北宇治润色工坊 Version 2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', async () => {
    if (!captureOutputPath) {
      window.show();
      return;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 2400));
      await window.webContents.executeJavaScript(`
        window.scrollTo(0, 0);
        document.querySelectorAll('.workspace-scroll, .glossary-scroll, .chapter-reading, .workshop-page, .reader-page > main, .settings-scroll, .knowledge-page, .review-page, .export-page').forEach((element) => {
          element.scrollTop = ${captureScrollTop};
          element.scrollLeft = 0;
        });
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      `);
      const layoutReport = await window.webContents.executeJavaScript(`(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return { top: bounds.top, height: bounds.height, width: bounds.width, scrollTop: element.scrollTop };
        };
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          documentWidth: document.documentElement.scrollWidth,
          shell: rect('.workspace-shell'),
          header: rect('.workspace-header'),
          workspaceScroll: rect('.workspace-scroll'),
          glossaryScroll: rect('.glossary-scroll'),
          chapterReading: rect('.chapter-reading'),
        };
      })()`);
      console.log('界面验收布局：', JSON.stringify(layoutReport));
      if (layoutReport.documentWidth > layoutReport.viewport.width + 1) {
        throw new Error(`界面出现横向溢出：${layoutReport.documentWidth}px > ${layoutReport.viewport.width}px`);
      }
      const image = await window.webContents.capturePage();
      await mkdir(path.dirname(captureOutputPath), { recursive: true });
      await writeFile(captureOutputPath, image.toPNG());
      app.quit();
    } catch (error) {
      console.error('界面截图失败：', error);
      app.exit(1);
    }
  });

  void window.loadFile(
    path.join(__dirname, '..', 'renderer', 'index.html'),
    captureHash ? { hash: captureHash } : undefined,
  );

  mainWindow = window;
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
};

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const providerService = new ProviderService(new ProviderSettingsStore(app.getPath('userData'), safeStorage));
  if (diagnoseProviderArgument) {
    const diagnosis = await providerService.diagnose(diagnoseProviderArgument);
    const diagnosisText = `${JSON.stringify(diagnosis, null, 2)}\n`;
    if (diagnoseProviderOutputArgument) await writeFile(path.resolve(diagnoseProviderOutputArgument), diagnosisText, 'utf8');
    else console.log(diagnosisText);
    app.quit();
    return;
  }
  const storageManager = new StorageManager(app.getPath('userData'), app.getPath('sessionData'));
  const movedDatabasePath = projectDatabaseArgument
    ? path.resolve(projectDatabaseArgument)
    : await storageManager.applyPendingDatabaseMove();
  const databasePath = projectDatabaseArgument
    ? movedDatabasePath
    : await storageManager.applyPendingDatabaseRestore(movedDatabasePath);
  projectService = new ProjectService(databasePath, storageManager.cacheDirectory);
  registerProjectIpc(projectService, () => mainWindow, storageManager);
  registerStorageIpc(storageManager, databasePath, projectService, () => mainWindow);
  registerProviderIpc(providerService, () => mainWindow);
  workflowService = new WorkflowService(databasePath, providerService.settings);
  registerWorkflowIpc(workflowService, () => mainWindow, storageManager);

  const seedArgument = seedSourceArgument ?? seedTxtArgument;
  if (seedArgument) {
    const result = seedSourceArgument
      ? await projectService.importSourceFile(path.resolve(seedArgument))
      : await projectService.importTxtFile(path.resolve(seedArgument));
    if (result.status === 'error') {
      console.error('测试作品导入失败：', result.message);
      app.exit(1);
      return;
    }
  }

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '项目库初始化失败。';
  console.error('桌面程序启动失败：', error);
  dialog.showErrorBox('北宇治润色工坊无法启动', message);
  app.exit(1);
});

app.once('before-quit', () => {
  workflowService?.close();
  workflowService = null;
  projectService?.close();
  projectService = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
