import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { StorageManager, storageConstantsForTest } from './storageManager.cjs';

const tempRoot = () => mkdtempSync(path.join(os.tmpdir(), 'kitauji-storage-test-'));

describe('storage manager', () => {
  it('uses a dedicated marked cache directory and reports database/cache sizes', () => {
    const root = tempRoot();
    const userData = path.join(root, 'user-data');
    const systemCache = path.join(root, 'system-cache');
    const databasePath = path.join(userData, 'kitauji-v2.sqlite');
    const manager = new StorageManager(userData, systemCache);
    writeFileSync(databasePath, Buffer.alloc(32));
    writeFileSync(path.join(manager.cacheDirectory, 'page.json'), Buffer.alloc(17));
    const info = manager.info(databasePath);
    expect(info).toMatchObject({ databaseSizeBytes: 32, cacheFileCount: 1 });
    expect(info.cacheSizeBytes).toBeGreaterThanOrEqual(17);
    expect(readFileSync(path.join(manager.cacheDirectory, storageConstantsForTest.CACHE_MARKER), 'utf8')).toContain('专用缓存目录');
  });

  it('stores custom book/export folders and nests cache in a dedicated child', () => {
    const root = tempRoot();
    const manager = new StorageManager(path.join(root, 'user-data'), path.join(root, 'system-cache'));
    const books = path.join(root, 'books');
    const exports = path.join(root, 'exports');
    const cacheBase = path.join(root, 'fast-disk');
    manager.setDirectory('books', books);
    manager.setDirectory('exports', exports);
    manager.setDirectory('cache', cacheBase);
    const info = manager.info(path.join(root, 'db.sqlite'));
    expect(info.bookDirectory).toBe(books);
    expect(info.exportDirectory).toBe(exports);
    expect(info.cacheDirectory).toBe(path.join(cacheBase, storageConstantsForTest.CACHE_FOLDER_NAME));
    expect(info.customCacheDirectory).toBe(true);
  });

  it('clears only marked cache contents and keeps the cache directory usable', () => {
    const root = tempRoot();
    const manager = new StorageManager(path.join(root, 'user-data'), path.join(root, 'system-cache'));
    writeFileSync(path.join(manager.cacheDirectory, 'one.json'), '12345');
    const cleared = manager.clearCache(path.join(root, 'db.sqlite'));
    expect(cleared).toMatchObject({ status: 'cleared', removedFileCount: 1, removedBytes: 5 });
    expect(manager.info(path.join(root, 'db.sqlite'))).toMatchObject({ cacheFileCount: 0, cacheSizeBytes: 0 });
  });

  it('moves the complete project database to a custom directory and removes the old file only after verification', async () => {
    const root = tempRoot();
    const userData = path.join(root, 'user-data');
    const manager = new StorageManager(userData, path.join(root, 'system-cache'));
    const sourcePath = manager.defaultDatabasePath;
    const source = new DatabaseSync(sourcePath);
    source.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY) STRICT; INSERT INTO projects VALUES('project-one'); PRAGMA user_version = 5;");
    source.close();
    const targetDirectory = path.join(root, 'd-drive', 'novel-database');
    expect(manager.stageDatabaseDirectory(targetDirectory, sourcePath)).toBe(true);
    expect(manager.info(sourcePath).pendingDatabasePath).toBe(path.join(targetDirectory, storageConstantsForTest.DATABASE_FILE_NAME));
    const movedPath = await manager.applyPendingDatabaseMove();
    expect(movedPath).toBe(path.join(targetDirectory, storageConstantsForTest.DATABASE_FILE_NAME));
    expect(existsSync(sourcePath)).toBe(false);
    const moved = new DatabaseSync(movedPath);
    expect(moved.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(moved.prepare('SELECT count(*) AS count FROM projects').get()).toEqual({ count: 1 });
    moved.close();
    const restored = new StorageManager(userData, path.join(root, 'system-cache'));
    expect(restored.configuredDatabasePath).toBe(movedPath);
    expect(restored.info(movedPath)).toMatchObject({ customDatabaseDirectory: true, pendingDatabasePath: null, databaseMoveError: null });
  });

  it('does not overwrite an existing database at the chosen destination', async () => {
    const root = tempRoot();
    const manager = new StorageManager(path.join(root, 'user-data'), path.join(root, 'system-cache'));
    const sourcePath = manager.defaultDatabasePath;
    const source = new DatabaseSync(sourcePath);
    source.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY) STRICT; INSERT INTO projects VALUES('source-project');");
    source.close();
    const targetDirectory = path.join(root, 'occupied');
    manager.stageDatabaseDirectory(targetDirectory, sourcePath);
    writeFileSync(path.join(targetDirectory, storageConstantsForTest.DATABASE_FILE_NAME), 'already here');
    expect(await manager.applyPendingDatabaseMove()).toBe(sourcePath);
    expect(existsSync(sourcePath)).toBe(true);
    expect(manager.info(sourcePath).databaseMoveError).toContain('避免覆盖');
  });

  it('creates a verified whole-database backup', async () => {
    const root = tempRoot();
    const manager = new StorageManager(path.join(root, 'user-data'), path.join(root, 'system-cache'));
    const sourcePath = manager.defaultDatabasePath;
    const source = new DatabaseSync(sourcePath);
    source.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY) STRICT; INSERT INTO projects VALUES('project-one'); PRAGMA user_version = 6;");
    source.close();
    const destination = path.join(root, 'exports', 'library.sqlite');
    const result = await manager.createDatabaseBackup(sourcePath, destination);
    expect(result).toMatchObject({ path: destination, schemaVersion: 6, projectCount: 1 });
    const copied = new DatabaseSync(destination);
    expect(copied.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(copied.prepare('SELECT project_id FROM projects').get()).toEqual({ project_id: 'project-one' });
    copied.close();
  });

  it('stages and restores a verified database while retaining a pre-restore safety backup', async () => {
    const root = tempRoot();
    const userData = path.join(root, 'user-data');
    const manager = new StorageManager(userData, path.join(root, 'system-cache'));
    const activePath = manager.defaultDatabasePath;
    const active = new DatabaseSync(activePath);
    active.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY) STRICT; INSERT INTO projects VALUES('before-restore'); PRAGMA user_version = 6;");
    active.close();
    const selectedBackup = path.join(root, 'selected.sqlite');
    const selected = new DatabaseSync(selectedBackup);
    selected.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY) STRICT; INSERT INTO projects VALUES('from-backup'); PRAGMA user_version = 5;");
    selected.close();

    await manager.stageDatabaseRestore(selectedBackup, activePath);
    expect(manager.info(activePath)).toMatchObject({ pendingDatabaseRestore: true, pendingRestoreSourceName: 'selected.sqlite' });
    await manager.applyPendingDatabaseRestore(activePath);

    const restored = new DatabaseSync(activePath);
    expect(restored.prepare('SELECT project_id FROM projects').get()).toEqual({ project_id: 'from-backup' });
    restored.close();
    const info = manager.info(activePath);
    expect(info.pendingDatabaseRestore).toBe(false);
    expect(info.lastSafetyBackupPath).toBeTruthy();
    expect(existsSync(info.lastSafetyBackupPath!)).toBe(true);
    const safety = new DatabaseSync(info.lastSafetyBackupPath!);
    expect(safety.prepare('SELECT project_id FROM projects').get()).toEqual({ project_id: 'before-restore' });
    safety.close();
  });
});
