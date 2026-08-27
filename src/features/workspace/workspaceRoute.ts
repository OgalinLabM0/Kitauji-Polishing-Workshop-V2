export type WorkspaceView =
  | 'library'
  | 'home'
  | 'workshop'
  | 'proof'
  | 'reader'
  | 'glossary'
  | 'characters'
  | 'memory'
  | 'review'
  | 'export'
  | 'settings';

const projectViews = new Set<WorkspaceView>([
  'home',
  'workshop',
  'proof',
  'reader',
  'glossary',
  'characters',
  'memory',
  'review',
  'export',
]);

const legacyRoutes: Readonly<Record<string, WorkspaceView>> = {
  '#workspace': 'home',
  '#workspace/glossary': 'glossary',
  '#workspace/chapters': 'proof',
  '#workspace/settings': 'settings',
};

export const isProjectView = (view: WorkspaceView) => projectViews.has(view);

export const parseWorkspaceHash = (hash: string): WorkspaceView => {
  const routeHash = hash.split('?')[0];
  if (legacyRoutes[routeHash]) return legacyRoutes[routeHash];
  if (routeHash === '#library') return 'library';
  if (routeHash === '#settings') return 'settings';
  if (routeHash.startsWith('#project/')) {
    const candidate = routeHash.slice('#project/'.length) as WorkspaceView;
    if (projectViews.has(candidate)) return candidate;
  }
  return 'library';
};

export const workspaceHash = (view: WorkspaceView) => {
  if (view === 'library') return 'library';
  if (view === 'settings') return 'settings';
  return `project/${view}`;
};

export const guardWorkspaceView = (view: WorkspaceView, hasProject: boolean, libraryLoading = false): WorkspaceView => {
  if (libraryLoading) return view;
  return isProjectView(view) && !hasProject ? 'library' : view;
};
