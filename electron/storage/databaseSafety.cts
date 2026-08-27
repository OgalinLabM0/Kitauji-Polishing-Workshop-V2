import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export interface DatabaseIdentity {
  readonly schemaVersion: number;
  readonly projectCount: number;
}

const timestamp = () => new Date().toISOString().replace(/[:.]/gu, '-');

const inspectOpenDatabase = (database: DatabaseSync): DatabaseIdentity => {
  const integrity = (database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  if (integrity !== 'ok') throw new Error(`数据库完整性检查失败：${integrity}`);
  const schemaVersion = Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  const hasProjects = Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get());
  const projectCount = hasProjects
    ? Number((database.prepare('SELECT count(*) AS count FROM projects').get() as { count: number }).count)
    : 0;
  return { schemaVersion, projectCount };
};

export const inspectDatabaseFile = (databasePath: string): DatabaseIdentity => {
  if (!existsSync(databasePath)) throw new Error(`数据库文件不存在：${databasePath}`);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA busy_timeout = 5000;');
    return inspectOpenDatabase(database);
  } finally {
    database.close();
  }
};

export const assertRestorableDatabase = (databasePath: string, maximumSchemaVersion: number) => {
  const identity = inspectDatabaseFile(databasePath);
  if (identity.schemaVersion < 1) throw new Error('所选文件不是已初始化的 Version2 项目数据库。');
  if (identity.schemaVersion > maximumSchemaVersion) {
    throw new Error(`备份数据库版本 ${identity.schemaVersion} 高于当前软件支持版本 ${maximumSchemaVersion}，已拒绝降级覆盖。`);
  }
  const database = new DatabaseSync(databasePath);
  try {
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get()) {
      throw new Error('所选数据库缺少 projects 表，无法作为 Version2 整库备份恢复。');
    }
  } finally {
    database.close();
  }
  return identity;
};

const replaceFileAtomically = (temporaryPath: string, destinationPath: string, allowReplace: boolean) => {
  if (!existsSync(destinationPath)) {
    renameSync(temporaryPath, destinationPath);
    return;
  }
  if (!allowReplace) throw new Error(`目标文件已存在：${destinationPath}`);
  const priorPath = `${destinationPath}.${randomUUID()}.prior`;
  renameSync(destinationPath, priorPath);
  try {
    renameSync(temporaryPath, destinationPath);
    rmSync(priorPath, { force: true });
  } catch (error) {
    if (!existsSync(destinationPath) && existsSync(priorPath)) renameSync(priorPath, destinationPath);
    throw error;
  }
};

export const createVerifiedDatabaseCopy = async (
  sourcePath: string,
  destinationPath: string,
  options: { readonly allowReplace?: boolean } = {},
) => {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestination = path.resolve(destinationPath);
  if (resolvedSource.toLowerCase() === resolvedDestination.toLowerCase()) throw new Error('备份目标不能与当前数据库相同。');
  mkdirSync(path.dirname(resolvedDestination), { recursive: true });
  const temporaryPath = `${resolvedDestination}.${randomUUID()}.copying`;
  let source: DatabaseSync | null = null;
  let target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(resolvedSource);
    source.exec('PRAGMA busy_timeout = 5000;');
    const sourceIdentity = inspectOpenDatabase(source);
    await backup(source, temporaryPath);
    target = new DatabaseSync(temporaryPath);
    const targetIdentity = inspectOpenDatabase(target);
    if (targetIdentity.schemaVersion !== sourceIdentity.schemaVersion || targetIdentity.projectCount !== sourceIdentity.projectCount) {
      throw new Error('数据库副本的 schema 版本或项目数量与源数据库不一致。');
    }
    target.close(); target = null;
    source.close(); source = null;
    replaceFileAtomically(temporaryPath, resolvedDestination, options.allowReplace === true);
    return { path: resolvedDestination, ...targetIdentity };
  } catch (error) {
    target?.close();
    source?.close();
    rmSync(temporaryPath, { force: true });
    throw error;
  }
};

const automaticBackupDirectory = (databasePath: string) => path.join(path.dirname(databasePath), '北宇治数据库备份');

export const createPreMigrationSnapshot = (
  database: DatabaseSync,
  databasePath: string,
  currentSchemaVersion: number,
) => {
  const version = Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (version < 1 || version >= currentSchemaVersion) return null;
  const directory = automaticBackupDirectory(databasePath);
  mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${path.basename(databasePath, path.extname(databasePath))}.pre-v${version}-${timestamp()}.sqlite`);
  const escapedDestination = destination.replace(/'/gu, "''");
  database.exec(`VACUUM INTO '${escapedDestination}'`);
  const identity = inspectDatabaseFile(destination);
  if (identity.schemaVersion !== version) {
    rmSync(destination, { force: true });
    throw new Error('数据库升级前快照的 schema 版本校验失败，已停止升级。');
  }
  return destination;
};

export const createAutomaticDatabaseBackup = async (databasePath: string, label: 'pre-restore' | 'manual') => {
  const directory = automaticBackupDirectory(databasePath);
  const destination = path.join(directory, `${path.basename(databasePath, path.extname(databasePath))}.${label}-${timestamp()}.sqlite`);
  return createVerifiedDatabaseCopy(databasePath, destination);
};

export const restoreDatabaseFromStagedCopy = async (
  stagedPath: string,
  activeDatabasePath: string,
  maximumSchemaVersion: number,
) => {
  const stagedIdentity = assertRestorableDatabase(stagedPath, maximumSchemaVersion);
  const resolvedActive = path.resolve(activeDatabasePath);
  const safetyBackup = existsSync(resolvedActive)
    ? await createAutomaticDatabaseBackup(resolvedActive, 'pre-restore')
    : null;
  const replacementPath = `${resolvedActive}.${randomUUID()}.restoring`;
  const priorPath = `${resolvedActive}.${randomUUID()}.restore-prior`;
  let priorMoved = false;
  let replacementInstalled = false;
  try {
    await createVerifiedDatabaseCopy(stagedPath, replacementPath);
    if (existsSync(resolvedActive)) {
      const active = new DatabaseSync(resolvedActive);
      try { active.exec('PRAGMA busy_timeout = 5000; PRAGMA wal_checkpoint(TRUNCATE);'); }
      finally { active.close(); }
      renameSync(resolvedActive, priorPath);
      priorMoved = true;
      rmSync(`${resolvedActive}-wal`, { force: true });
      rmSync(`${resolvedActive}-shm`, { force: true });
    }
    renameSync(replacementPath, resolvedActive);
    replacementInstalled = true;
    const installedIdentity = assertRestorableDatabase(resolvedActive, maximumSchemaVersion);
    if (installedIdentity.schemaVersion !== stagedIdentity.schemaVersion || installedIdentity.projectCount !== stagedIdentity.projectCount) {
      throw new Error('恢复后的数据库与所选备份不一致。');
    }
    rmSync(priorPath, { force: true });
    return { ...installedIdentity, safetyBackupPath: safetyBackup?.path ?? null };
  } catch (error) {
    if (replacementInstalled) rmSync(resolvedActive, { force: true });
    rmSync(replacementPath, { force: true });
    if (priorMoved && existsSync(priorPath)) renameSync(priorPath, resolvedActive);
    throw error;
  }
};
