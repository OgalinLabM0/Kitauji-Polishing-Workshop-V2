import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kitaujiDesktop', {
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
  projects: Object.freeze({
    list: () => ipcRenderer.invoke('projects:list'),
    getActive: () => ipcRenderer.invoke('projects:get-active'),
    importSource: () => ipcRenderer.invoke('projects:import-source'),
    open: (projectId: string) => ipcRenderer.invoke('projects:open', projectId),
    delete: (projectId: string) => ipcRenderer.invoke('projects:delete', projectId),
    clear: () => ipcRenderer.invoke('projects:clear'),
    readChapter: (projectId: string, chapterId: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke('projects:read-chapter', projectId, chapterId, offset, limit),
    saveBlockDraft: (projectId: string, blockId: string, draftText: string | null) =>
      ipcRenderer.invoke('projects:save-block-draft', projectId, blockId, draftText),
    saveReadingPosition: (projectId: string, chapterId: string, blockOrdinal: number) =>
      ipcRenderer.invoke('projects:save-reading-position', projectId, chapterId, blockOrdinal),
    readSourceFile: (projectId: string) => ipcRenderer.invoke('projects:read-source-file', projectId),
    exportEpub: (projectId: string) => ipcRenderer.invoke('projects:export-epub', projectId),
  }),
  storage: Object.freeze({
    info: () => ipcRenderer.invoke('storage:info'),
    chooseDirectory: (kind: 'books' | 'exports' | 'cache' | 'database') => ipcRenderer.invoke('storage:choose-directory', kind),
    resetDirectory: (kind: 'books' | 'exports' | 'cache' | 'database') => ipcRenderer.invoke('storage:reset-directory', kind),
    clearCache: () => ipcRenderer.invoke('storage:clear-cache'),
    backupDatabase: () => ipcRenderer.invoke('storage:backup-database'),
    restoreDatabase: () => ipcRenderer.invoke('storage:restore-database'),
    restartForDatabaseMove: () => ipcRenderer.invoke('storage:restart-for-database-move'),
  }),
  providers: Object.freeze({
    get: () => ipcRenderer.invoke('providers:get'),
    save: (input: unknown) => ipcRenderer.invoke('providers:save', input),
    setActive: (profileId: string) => ipcRenderer.invoke('providers:set-active', profileId),
    clearApiKey: (profileId: string) => ipcRenderer.invoke('providers:clear-key', profileId),
    delete: (profileId: string) => ipcRenderer.invoke('providers:delete', profileId),
    listModels: (profileId: string) => ipcRenderer.invoke('providers:list-models', profileId),
    test: (profileId: string) => ipcRenderer.invoke('providers:test', profileId),
  }),
  workflow: Object.freeze({
    overview: (projectId: string) => ipcRenderer.invoke('workflow:overview', projectId),
    start: (input: unknown) => ipcRenderer.invoke('workflow:start', input),
    pause: (taskId: string) => ipcRenderer.invoke('workflow:pause', taskId),
    resume: (taskId: string) => ipcRenderer.invoke('workflow:resume', taskId),
    retryFailed: (taskId: string) => ipcRenderer.invoke('workflow:retry-failed', taskId),
    cancel: (taskId: string) => ipcRenderer.invoke('workflow:cancel', taskId),
    workbench: (projectId: string, chapterId: string, offset?: number, limit?: number) => ipcRenderer.invoke('workflow:workbench', projectId, chapterId, offset, limit),
    versions: (segmentId: string) => ipcRenderer.invoke('workflow:versions', segmentId),
    restoreVersion: (segmentId: string, versionId: string) => ipcRenderer.invoke('workflow:restore-version', segmentId, versionId),
    saveManual: (segmentId: string, text: string) => ipcRenderer.invoke('workflow:save-manual', segmentId, text),
    glossary: (projectId: string) => ipcRenderer.invoke('workflow:glossary', projectId),
    memory: (projectId: string) => ipcRenderer.invoke('workflow:memory', projectId),
    seriesAssignment: (projectId: string) => ipcRenderer.invoke('workflow:series-assignment', projectId),
    listSeries: () => ipcRenderer.invoke('workflow:list-series'),
    assignSeries: (projectId: string, input: unknown) => ipcRenderer.invoke('workflow:assign-series', projectId, input),
    unassignSeries: (projectId: string) => ipcRenderer.invoke('workflow:unassign-series', projectId),
    ambiguities: (projectId: string) => ipcRenderer.invoke('workflow:ambiguities', projectId),
    resolveAmbiguity: (ambiguityId: string, input: unknown) => ipcRenderer.invoke('workflow:resolve-ambiguity', ambiguityId, input),
    reviews: (projectId: string) => ipcRenderer.invoke('workflow:reviews', projectId),
    resolveReview: (reviewId: string, action: 'accept' | 'reject', text?: string) => ipcRenderer.invoke('workflow:resolve-review', reviewId, action, text),
    importGlossary: (projectId: string, records: readonly unknown[], locked: boolean) => ipcRenderer.invoke('workflow:import-glossary', projectId, records, locked),
    updateGlossary: (glossaryId: string, input: unknown) => ipcRenderer.invoke('workflow:update-glossary', glossaryId, input),
    runGlossaryAgent: (projectId: string, instruction: string) => ipcRenderer.invoke('workflow:run-glossary-agent', projectId, instruction),
    runDomainAgent: (domain: string, projectId: string, instruction: string, options?: unknown) =>
      ipcRenderer.invoke('workflow:run-domain-agent', domain, projectId, instruction, options),
    exportFinal: (projectId: string, mode: 'jp-cn' | 'cn-jp' | 'cn-only') => ipcRenderer.invoke('workflow:export-final', projectId, mode),
    getRecentLogs: () => ipcRenderer.invoke('workflow:get-recent-logs'),
    clearLogs: () => ipcRenderer.invoke('workflow:clear-logs'),
    onLog: (callback: (log: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('workflow:log', listener);
      return () => ipcRenderer.removeListener('workflow:log', listener);
    },
  }),
});
