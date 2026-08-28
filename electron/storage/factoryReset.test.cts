import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerSettingsConstantsForTest } from '../providers/providerSettings.cjs';
import { applyPendingFactoryReset, factoryResetConstantsForTest, stageFactoryReset } from './factoryReset.cjs';
import { StorageManager } from './storageManager.cjs';

const tempRoot = () => mkdtempSync(path.join(os.tmpdir(), 'kitauji-factory-reset-test-'));

describe('factory reset', () => {
  it('clears application-owned data on restart while preserving user exports and source files', () => {
    const root = tempRoot();
    const userData = path.join(root, 'user-data');
    const manager = new StorageManager(userData, path.join(root, 'session-data'));
    const databasePath = manager.defaultDatabasePath;
    const exportDirectory = path.join(root, 'exports');
    const sourceDirectory = path.join(root, 'books');
    manager.setDirectory('exports', exportDirectory);
    manager.setDirectory('books', sourceDirectory);
    mkdirSync(exportDirectory, { recursive: true });
    mkdirSync(sourceDirectory, { recursive: true });

    const exportedBook = path.join(exportDirectory, 'finished.epub');
    const manualBackup = path.join(exportDirectory, 'manual.sqlite');
    const originalBook = path.join(sourceDirectory, 'original.epub');
    for (const filePath of [exportedBook, manualBackup, originalBook]) writeFileSync(filePath, 'keep');
    for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) writeFileSync(filePath, 'database');
    writeFileSync(path.join(path.dirname(databasePath), factoryResetConstantsForTest.WORKFLOW_LOG_FILE), 'logs');
    writeFileSync(path.join(manager.cacheDirectory, 'page.json'), 'cache');
    const autoBackupDirectory = path.join(path.dirname(databasePath), factoryResetConstantsForTest.AUTOMATIC_BACKUP_DIRECTORY);
    mkdirSync(autoBackupDirectory, { recursive: true });
    writeFileSync(path.join(autoBackupDirectory, 'automatic.sqlite'), 'automatic backup');
    writeFileSync(path.join(userData, providerSettingsConstantsForTest.SETTINGS_FILE), '{}');
    writeFileSync(path.join(userData, providerSettingsConstantsForTest.SECRETS_FILE), 'secret');

    stageFactoryReset(userData, databasePath);
    expect(applyPendingFactoryReset(userData, manager)).toBe(manager.defaultDatabasePath);

    for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) expect(existsSync(filePath)).toBe(false);
    expect(existsSync(autoBackupDirectory)).toBe(false);
    expect(existsSync(path.join(userData, providerSettingsConstantsForTest.SETTINGS_FILE))).toBe(false);
    expect(existsSync(path.join(userData, providerSettingsConstantsForTest.SECRETS_FILE))).toBe(false);
    expect(existsSync(path.join(userData, factoryResetConstantsForTest.FACTORY_RESET_MARKER))).toBe(false);
    expect(manager.info(manager.defaultDatabasePath)).toMatchObject({
      bookDirectory: null,
      exportDirectory: null,
      cacheFileCount: 0,
      customCacheDirectory: false,
      customDatabaseDirectory: false,
    });
    expect(existsSync(exportedBook)).toBe(true);
    expect(existsSync(manualBackup)).toBe(true);
    expect(existsSync(originalBook)).toBe(true);
    expect(applyPendingFactoryReset(userData, manager)).toBeNull();
  });

  it('refuses a marker targeting a database other than the configured application database', () => {
    const root = tempRoot();
    const userData = path.join(root, 'user-data');
    const manager = new StorageManager(userData, path.join(root, 'session-data'));
    const unrelated = path.join(root, 'unrelated.sqlite');
    writeFileSync(unrelated, 'must survive');
    stageFactoryReset(userData, unrelated);
    expect(() => applyPendingFactoryReset(userData, manager)).toThrow(/不一致/u);
    expect(existsSync(unrelated)).toBe(true);
  });
});
