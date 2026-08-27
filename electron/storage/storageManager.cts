import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '../projects/projectSchema.cjs';
import {
  assertRestorableDatabase,
  createVerifiedDatabaseCopy,
  restoreDatabaseFromStagedCopy,
} from './databaseSafety.cjs';
import type { ClearCacheResult, StorageDirectoryKind, StorageInfo } from './models.cjs';

const SETTINGS_FILE = 'storage-preferences.json';
const CACHE_FOLDER_NAME = '北宇治润色工坊缓存';
const CACHE_MARKER = '.kitauji-cache';
const DATABASE_FILE_NAME = 'kitauji-v2.sqlite';

interface StoragePreferences {
  readonly version: 3;
  readonly bookDirectory: string | null;
  readonly exportDirectory: string | null;
  readonly cacheDirectory: string | null;
  readonly databaseDirectory: string | null;
  readonly pendingDatabaseMove: { readonly targetDirectory: string | null } | null;
  readonly databaseMoveError: string | null;
  readonly pendingDatabaseRestore: { readonly sourceFileName: string } | null;
  readonly databaseRestoreError: string | null;
  readonly lastSafetyBackupPath: string | null;
}

const emptyPreferences = (): StoragePreferences => ({
  version: 3,
  bookDirectory: null,
  exportDirectory: null,
  cacheDirectory: null,
  databaseDirectory: null,
  pendingDatabaseMove: null,
  databaseMoveError: null,
  pendingDatabaseRestore: null,
  databaseRestoreError: null,
  lastSafetyBackupPath: null,
});

const validOptionalAbsolutePath = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && path.isAbsolute(value) && value.length <= 32_000);

const parsePreferences = (text: string): StoragePreferences => {
  const value = JSON.parse(text) as {
    readonly version?: number;
    readonly bookDirectory?: unknown;
    readonly exportDirectory?: unknown;
    readonly cacheDirectory?: unknown;
    readonly databaseDirectory?: unknown;
    readonly pendingDatabaseMove?: { readonly targetDirectory?: unknown } | null;
    readonly databaseMoveError?: unknown;
    readonly pendingDatabaseRestore?: { readonly sourceFileName?: unknown } | null;
    readonly databaseRestoreError?: unknown;
    readonly lastSafetyBackupPath?: unknown;
  } | null;
  if (!value || ![1, 2, 3].includes(Number(value.version))) throw new Error('存储设置版本无效。');
  if (!validOptionalAbsolutePath(value.bookDirectory) || !validOptionalAbsolutePath(value.exportDirectory) || !validOptionalAbsolutePath(value.cacheDirectory)) {
    throw new Error('存储设置包含无效路径。');
  }
  const databaseDirectory = Number(value.version) >= 2 ? value.databaseDirectory : null;
  const pendingTarget = Number(value.version) >= 2 ? value.pendingDatabaseMove?.targetDirectory : undefined;
  if (!validOptionalAbsolutePath(databaseDirectory) || (pendingTarget !== undefined && !validOptionalAbsolutePath(pendingTarget))) throw new Error('数据库位置设置无效。');
  const sourceFileName = Number(value.version) >= 3 ? value.pendingDatabaseRestore?.sourceFileName : undefined;
  if (sourceFileName !== undefined && (typeof sourceFileName !== 'string' || !sourceFileName.trim() || sourceFileName.length > 260 || /[\\/]/u.test(sourceFileName))) {
    throw new Error('待恢复数据库来源名称无效。');
  }
  const lastSafetyBackupPath = Number(value.version) >= 3 ? value.lastSafetyBackupPath : null;
  if (!validOptionalAbsolutePath(lastSafetyBackupPath)) throw new Error('数据库安全备份路径无效。');
  return {
    version: 3,
    bookDirectory: value.bookDirectory,
    exportDirectory: value.exportDirectory,
    cacheDirectory: value.cacheDirectory,
    databaseDirectory,
    pendingDatabaseMove: Number(value.version) >= 2 && value.pendingDatabaseMove ? { targetDirectory: pendingTarget ?? null } : null,
    databaseMoveError: Number(value.version) >= 2 && typeof value.databaseMoveError === 'string' ? value.databaseMoveError.slice(0, 2_000) : null,
    pendingDatabaseRestore: Number(value.version) >= 3 && value.pendingDatabaseRestore && sourceFileName
      ? { sourceFileName }
      : null,
    databaseRestoreError: Number(value.version) >= 3 && typeof value.databaseRestoreError === 'string' ? value.databaseRestoreError.slice(0, 2_000) : null,
    lastSafetyBackupPath,
  };
};

const directoryStats = (directory: string) => {
  if (!existsSync(directory)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        files += 1;
        continue;
      }
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files += 1;
        bytes += statSync(fullPath).size;
      }
    }
  };
  visit(directory);
  return { bytes, files };
};

const databaseBytes = (databasePath: string) => [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
  .reduce((sum, filePath) => sum + (existsSync(filePath) ? statSync(filePath).size : 0), 0);

const safeMessage = (error: unknown) => error instanceof Error ? error.message : '存储设置操作失败。';
const samePath = (left: string, right: string) => process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right);

export class StorageManager {
  readonly #settingsPath: string;
  readonly #defaultCacheDirectory: string;
  readonly #defaultDatabasePath: string;
  readonly #pendingRestorePath: string;
  #preferences: StoragePreferences;

  constructor(userDataDirectory: string, systemCacheDirectory: string) {
    this.#settingsPath = path.join(userDataDirectory, SETTINGS_FILE);
    this.#defaultCacheDirectory = path.join(systemCacheDirectory, 'kitauji-v2-cache');
    this.#defaultDatabasePath = path.join(userDataDirectory, DATABASE_FILE_NAME);
    this.#pendingRestorePath = path.join(userDataDirectory, 'database-restore-pending.sqlite');
    mkdirSync(userDataDirectory, { recursive: true });
    const settingsBackupPath = `${this.#settingsPath}.bak`;
    if (!existsSync(this.#settingsPath) && existsSync(settingsBackupPath)) renameSync(settingsBackupPath, this.#settingsPath);
    try {
      this.#preferences = existsSync(this.#settingsPath)
        ? parsePreferences(readFileSync(this.#settingsPath, 'utf8'))
        : emptyPreferences();
    } catch {
      this.#preferences = emptyPreferences();
    }
    this.#ensureCacheDirectory();
  }

  get bookDirectory() {
    return this.#preferences.bookDirectory;
  }

  get exportDirectory() {
    return this.#preferences.exportDirectory;
  }

  get cacheDirectory() {
    return this.#preferences.cacheDirectory ?? this.#defaultCacheDirectory;
  }

  get defaultDatabasePath() {
    return this.#defaultDatabasePath;
  }

  get configuredDatabasePath() {
    return this.#preferences.databaseDirectory
      ? path.join(this.#preferences.databaseDirectory, DATABASE_FILE_NAME)
      : this.#defaultDatabasePath;
  }

  #databasePathForDirectory(directory: string | null) {
    return directory === null ? this.#defaultDatabasePath : path.join(directory, DATABASE_FILE_NAME);
  }

  #ensureCacheDirectory() {
    mkdirSync(this.cacheDirectory, { recursive: true });
    const markerPath = path.join(this.cacheDirectory, CACHE_MARKER);
    if (!existsSync(markerPath)) writeFileSync(markerPath, '北宇治润色工坊专用缓存目录\n', { encoding: 'utf8', flag: 'wx' });
  }

  #save(next: StoragePreferences) {
    const temporaryPath = `${this.#settingsPath}.${randomUUID()}.tmp`;
    const backupPath = `${this.#settingsPath}.bak`;
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    rmSync(backupPath, { force: true });
    if (existsSync(this.#settingsPath)) renameSync(this.#settingsPath, backupPath);
    try {
      renameSync(temporaryPath, this.#settingsPath);
      rmSync(backupPath, { force: true });
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      if (!existsSync(this.#settingsPath) && existsSync(backupPath)) renameSync(backupPath, this.#settingsPath);
      throw error;
    }
    this.#preferences = next;
  }

  setDirectory(kind: StorageDirectoryKind, selectedDirectory: string | null) {
    if (kind === 'database') throw new Error('数据库目录必须通过安全迁移流程修改。');
    if (selectedDirectory !== null && (!path.isAbsolute(selectedDirectory) || selectedDirectory.length > 32_000)) {
      throw new Error('所选位置不是有效的绝对目录。');
    }
    const normalized = selectedDirectory === null ? null : path.resolve(selectedDirectory);
    if (normalized !== null) mkdirSync(normalized, { recursive: true });
    const cacheDirectory = kind === 'cache' && normalized !== null
      ? path.join(normalized, CACHE_FOLDER_NAME)
      : this.#preferences.cacheDirectory;
    const next: StoragePreferences = {
      ...this.#preferences,
      version: 3,
      bookDirectory: kind === 'books' ? normalized : this.#preferences.bookDirectory,
      exportDirectory: kind === 'exports' ? normalized : this.#preferences.exportDirectory,
      cacheDirectory: kind === 'cache' ? cacheDirectory : this.#preferences.cacheDirectory,
    };
    this.#save(next);
    this.#ensureCacheDirectory();
  }

  stageDatabaseDirectory(selectedDirectory: string | null, activeDatabasePath: string) {
    if (selectedDirectory !== null && (!path.isAbsolute(selectedDirectory) || selectedDirectory.length > 32_000)) throw new Error('所选数据库位置不是有效的绝对目录。');
    const normalized = selectedDirectory === null ? null : path.resolve(selectedDirectory);
    if (normalized !== null) mkdirSync(normalized, { recursive: true });
    const targetPath = path.resolve(this.#databasePathForDirectory(normalized));
    if (samePath(targetPath, activeDatabasePath)) {
      this.#save({ ...this.#preferences, pendingDatabaseMove: null, databaseMoveError: null });
      return false;
    }
    this.#save({ ...this.#preferences, pendingDatabaseMove: { targetDirectory: normalized }, databaseMoveError: null });
    return true;
  }

  async applyPendingDatabaseMove() {
    const sourcePath = path.resolve(this.configuredDatabasePath);
    const pending = this.#preferences.pendingDatabaseMove;
    if (!pending) {
      if (this.#preferences.databaseDirectory !== null && !existsSync(sourcePath)) throw new Error(`自定义项目数据库不存在：${sourcePath}。请确认磁盘已连接且文件未被移动。`);
      return sourcePath;
    }
    const targetPath = path.resolve(this.#databasePathForDirectory(pending.targetDirectory));
    if (samePath(targetPath, sourcePath)) {
      this.#save({ ...this.#preferences, pendingDatabaseMove: null, databaseMoveError: null });
      return sourcePath;
    }
    let migrationCommitted = false;
    try {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      if (existsSync(targetPath)) throw new Error(`目标目录已存在同名数据库：${targetPath}。为避免覆盖，已继续使用原位置。`);
      if (!existsSync(sourcePath)) throw new Error(`原项目数据库不存在：${sourcePath}。已停止迁移，避免创建空库。`);
      await createVerifiedDatabaseCopy(sourcePath, targetPath);
      try {
        this.#save({ ...this.#preferences, databaseDirectory: pending.targetDirectory, pendingDatabaseMove: null, databaseMoveError: null });
        migrationCommitted = true;
      } catch (error) {
        rmSync(targetPath, { force: true });
        throw error;
      }
      for (const filePath of [sourcePath, `${sourcePath}-wal`, `${sourcePath}-shm`]) rmSync(filePath, { force: true });
      return targetPath;
    } catch (error) {
      if (migrationCommitted) return targetPath;
      const message = safeMessage(error);
      try { this.#save({ ...this.#preferences, pendingDatabaseMove: null, databaseMoveError: message }); } catch { /* Keep the original database path if preferences cannot be updated. */ }
      if (!existsSync(sourcePath)) throw new Error(message);
      return sourcePath;
    }
  }

  async createDatabaseBackup(activeDatabasePath: string, destinationPath: string) {
    if (!path.isAbsolute(destinationPath) || destinationPath.length > 32_000) throw new Error('备份目标不是有效的绝对路径。');
    return createVerifiedDatabaseCopy(activeDatabasePath, destinationPath, { allowReplace: true });
  }

  async stageDatabaseRestore(sourcePath: string, activeDatabasePath: string) {
    if (!path.isAbsolute(sourcePath) || sourcePath.length > 32_000) throw new Error('所选备份不是有效的绝对路径。');
    if (samePath(sourcePath, activeDatabasePath)) throw new Error('不能把当前正在使用的数据库作为恢复来源。');
    const identity = assertRestorableDatabase(sourcePath, CURRENT_PROJECT_SCHEMA_VERSION);
    await createVerifiedDatabaseCopy(sourcePath, this.#pendingRestorePath, { allowReplace: true });
    this.#save({
      ...this.#preferences,
      pendingDatabaseRestore: { sourceFileName: path.basename(sourcePath) },
      databaseRestoreError: null,
    });
    return identity;
  }

  async applyPendingDatabaseRestore(activeDatabasePath: string) {
    const pending = this.#preferences.pendingDatabaseRestore;
    if (!pending) return activeDatabasePath;
    try {
      const result = await restoreDatabaseFromStagedCopy(this.#pendingRestorePath, activeDatabasePath, CURRENT_PROJECT_SCHEMA_VERSION);
      this.#save({
        ...this.#preferences,
        pendingDatabaseRestore: null,
        databaseRestoreError: null,
        lastSafetyBackupPath: result.safetyBackupPath,
      });
      rmSync(this.#pendingRestorePath, { force: true });
      return activeDatabasePath;
    } catch (error) {
      const message = safeMessage(error);
      try {
        this.#save({ ...this.#preferences, pendingDatabaseRestore: null, databaseRestoreError: message });
      } catch { /* The active database remains untouched if settings cannot be updated. */ }
      return activeDatabasePath;
    }
  }

  info(databasePath: string): StorageInfo {
    this.#ensureCacheDirectory();
    const cache = directoryStats(this.cacheDirectory);
    const markerPath = path.join(this.cacheDirectory, CACHE_MARKER);
    const markerBytes = existsSync(markerPath) ? statSync(markerPath).size : 0;
    return {
      bookDirectory: this.bookDirectory,
      exportDirectory: this.exportDirectory,
      databasePath,
      databaseSizeBytes: databaseBytes(databasePath),
      customDatabaseDirectory: this.#preferences.databaseDirectory !== null,
      pendingDatabasePath: this.#preferences.pendingDatabaseMove ? this.#databasePathForDirectory(this.#preferences.pendingDatabaseMove.targetDirectory) : null,
      databaseMoveError: this.#preferences.databaseMoveError,
      pendingDatabaseRestore: this.#preferences.pendingDatabaseRestore !== null,
      pendingRestoreSourceName: this.#preferences.pendingDatabaseRestore?.sourceFileName ?? null,
      databaseRestoreError: this.#preferences.databaseRestoreError,
      lastSafetyBackupPath: this.#preferences.lastSafetyBackupPath,
      cacheDirectory: this.cacheDirectory,
      cacheSizeBytes: Math.max(0, cache.bytes - markerBytes),
      cacheFileCount: Math.max(0, cache.files - 1),
      customCacheDirectory: this.#preferences.cacheDirectory !== null,
    };
  }

  clearCache(databasePath: string): ClearCacheResult {
    try {
      this.#ensureCacheDirectory();
      const target = path.resolve(this.cacheDirectory);
      const root = path.parse(target).root;
      if (target === root || !existsSync(path.join(target, CACHE_MARKER))) {
        throw new Error('缓存目录缺少专用标记，已拒绝清空。');
      }
      const before = directoryStats(target);
      let removedFileCount = 0;
      let removedBytes = 0;
      for (const entry of readdirSync(target, { withFileTypes: true })) {
        if (entry.name === CACHE_MARKER) continue;
        const fullPath = path.join(target, entry.name);
        const entryStats = entry.isDirectory() && !entry.isSymbolicLink()
          ? directoryStats(fullPath)
          : { bytes: entry.isFile() ? lstatSync(fullPath).size : 0, files: 1 };
        removedFileCount += entryStats.files;
        removedBytes += entryStats.bytes;
        rmSync(fullPath, { recursive: true, force: true });
      }
      if (removedFileCount > before.files) throw new Error('缓存统计异常。');
      return { status: 'cleared', removedFileCount, removedBytes, info: this.info(databasePath) };
    } catch (error) {
      return { status: 'error', message: safeMessage(error) };
    }
  }
}

export const storageConstantsForTest = { CACHE_FOLDER_NAME, CACHE_MARKER, DATABASE_FILE_NAME } as const;
