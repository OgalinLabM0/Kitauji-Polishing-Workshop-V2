import { useState } from 'react';
import { LandingPage } from './features/landing/LandingPage';
import { useDisplaySettings } from './features/settings/useDisplaySettings';
import { WorkspaceShell } from './features/workspace/WorkspaceShell';

type AppView = 'landing' | 'workspace';

export const App = () => {
  const display = useDisplaySettings();
  const [view, setView] = useState<AppView>(() =>
    window.location.hash ? 'workspace' : 'landing',
  );

  const enterWorkspace = () => {
    window.location.hash = 'library';
    setView('workspace');
  };

  const returnToLanding = () => {
    window.location.hash = '';
    setView('landing');
  };

  if (view === 'landing') {
    return <LandingPage onEnter={enterWorkspace} />;
  }

  return <WorkspaceShell onReturn={returnToLanding} display={display} />;
};
