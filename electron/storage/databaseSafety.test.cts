import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createPreMigrationSnapshot } from './databaseSafety.cjs';

describe('database safety snapshots', () => {
  it('creates and verifies a snapshot before an existing schema is upgraded', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kitauji-snapshot-test-'));
    const databasePath = path.join(root, 'kitauji-v2.sqlite');
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY) STRICT; INSERT INTO projects VALUES('preserved'); PRAGMA user_version = 5;");
    const snapshotPath = createPreMigrationSnapshot(database, databasePath, 6);
    database.close();
    expect(snapshotPath).toBeTruthy();
    expect(existsSync(snapshotPath!)).toBe(true);
    const snapshot = new DatabaseSync(snapshotPath!);
    expect(snapshot.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
    expect(snapshot.prepare('SELECT project_id FROM projects').get()).toEqual({ project_id: 'preserved' });
    snapshot.close();
  });
});
