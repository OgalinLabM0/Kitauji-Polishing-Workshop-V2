/// <reference types="vite/client" />

import type { ProjectDesktopApi } from './core/projects/models';
import type { StorageDesktopApi } from './core/storage/models';
import type { ProviderDesktopApi } from './core/providers/models';
import type { WorkflowDesktopApi } from './core/workflow/models';

declare global {
  interface Window {
    readonly kitaujiDesktop?: {
      readonly platform: string;
      readonly versions: {
        readonly electron: string;
        readonly chrome: string;
      };
      readonly projects: ProjectDesktopApi;
      readonly storage: StorageDesktopApi;
      readonly providers: ProviderDesktopApi;
      readonly workflow: WorkflowDesktopApi;
    };
  }
}

export {};
