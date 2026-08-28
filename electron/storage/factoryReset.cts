import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resetPersistedProviderSettings } from '../providers/providerSettings.cjs';
import type { StorageManager } from './storageManager.cjs';

const FACTORY_RESET_MARKER = 'factory-reset-pending.json';
const WORKFLOW_LOG_FILE = 'workflow-terminal-logs.json';
const AUTOMATIC_BACKUP_DIRECTORY = '北宇治数据库备份';

interface FactoryResetMarker {
  readonly version: 1;
  readonly databasePath: string;
}

const samePath = (left: string, right: string) => process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right);

const markerPath = (userDataDirectory: string) => path.join(userDataDirectory, FACTORY_RESET_MARKER);

export const stageFactoryReset = (userDataDirectory: string, databasePath: string) => {
  if (!path.isAbsolute(databasePath)) throw new Error('项目数据库路径无效，已拒绝初始化。');
  const target = markerPath(userDataDirectory);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const marker: FactoryResetMarker = { version: 1, databasePath: path.resolve(databasePath) };
  writeFileSync(temporary, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  rmSync(target, { force: true });
  try {
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
};

export const applyPendingFactoryReset = (userDataDirectory: string, manager: StorageManager) => {
  const pendingPath = markerPath(userDataDirectory);
  if (!existsSync(pendingPath)) return null;
  const marker = JSON.parse(readFileSync(pendingPath, 'utf8')) as Partial<FactoryResetMarker>;
  if (marker.version !== 1 || typeof marker.databasePath !== 'string' || !path.isAbsolute(marker.databasePath)) {
    throw new Error('软件初始化标记无效。为避免误删文件，未执行任何清理。');
  }
  const databasePath = path.resolve(marker.databasePath);
  if (!samePath(databasePath, manager.configuredDatabasePath)) {
    throw new Error('软件初始化目标与当前项目库不一致。为避免误删文件，未执行任何清理。');
  }

  manager.resetForFactoryInitialization(databasePath);
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, path.join(path.dirname(databasePath), WORKFLOW_LOG_FILE)]) {
    rmSync(filePath, { force: true });
  }
  rmSync(path.join(path.dirname(databasePath), AUTOMATIC_BACKUP_DIRECTORY), { recursive: true, force: true });
  resetPersistedProviderSettings(userDataDirectory);
  rmSync(pendingPath, { force: true });
  return manager.defaultDatabasePath;
};

export const factoryResetConstantsForTest = {
  FACTORY_RESET_MARKER,
  WORKFLOW_LOG_FILE,
  AUTOMATIC_BACKUP_DIRECTORY,
} as const;
