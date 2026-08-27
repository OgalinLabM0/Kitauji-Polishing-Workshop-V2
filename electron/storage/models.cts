export interface StorageInfo {
  readonly bookDirectory: string | null;
  readonly exportDirectory: string | null;
  readonly databasePath: string;
  readonly databaseSizeBytes: number;
  readonly customDatabaseDirectory: boolean;
  readonly pendingDatabasePath: string | null;
  readonly databaseMoveError: string | null;
  readonly pendingDatabaseRestore: boolean;
  readonly pendingRestoreSourceName: string | null;
  readonly databaseRestoreError: string | null;
  readonly lastSafetyBackupPath: string | null;
  readonly cacheDirectory: string;
  readonly cacheSizeBytes: number;
  readonly cacheFileCount: number;
  readonly customCacheDirectory: boolean;
}

export type StorageDirectoryKind = 'books' | 'exports' | 'cache' | 'database';

export type ChooseStorageDirectoryResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'saved'; readonly info: StorageInfo }
  | { readonly status: 'restart-required'; readonly info: StorageInfo }
  | { readonly status: 'error'; readonly message: string };

export type ClearCacheResult =
  | { readonly status: 'cleared'; readonly removedFileCount: number; readonly removedBytes: number; readonly info: StorageInfo }
  | { readonly status: 'error'; readonly message: string };

export type DatabaseBackupResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'saved'; readonly path: string; readonly schemaVersion: number; readonly projectCount: number }
  | { readonly status: 'error'; readonly message: string };

export type DatabaseRestoreResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'restart-required'; readonly sourceFileName: string; readonly schemaVersion: number; readonly projectCount: number; readonly info: StorageInfo }
  | { readonly status: 'error'; readonly message: string };
