import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_SETTINGS_STORAGE_KEY,
  normalizeTextScale,
  parseDisplaySettings,
  serializeDisplaySettings,
  stepTextScale,
  type DisplaySettings,
} from '../../core/settings/displaySettings';

const loadSavedSettings = () => {
  const queryText = window.location.hash.split('?')[1] ?? '';
  const requestedScale = Number(new URLSearchParams(queryText).get('displayScale'));
  if (Number.isFinite(requestedScale) && requestedScale > 0) {
    return { textScale: normalizeTextScale(requestedScale) };
  }
  try {
    return parseDisplaySettings(window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY));
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
};

const saveSettings = (settings: DisplaySettings) => {
  try {
    window.localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, serializeDisplaySettings(settings));
  } catch {
    // Sandboxed or privacy-restricted storage must not prevent the interface from working.
  }
};

export const useDisplaySettings = () => {
  const [settings, setSettings] = useState<DisplaySettings>(loadSavedSettings);

  const setTextScale = useCallback((textScale: number) => {
    setSettings({ textScale: normalizeTextScale(textScale) });
  }, []);

  const resetDisplaySettings = useCallback(() => setSettings(DEFAULT_DISPLAY_SETTINGS), []);

  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(settings.textScale));
    document.documentElement.dataset.textScale = String(Math.round(settings.textScale * 100));
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === '0') {
        event.preventDefault();
        resetDisplaySettings();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setSettings((current) => ({ textScale: stepTextScale(current.textScale, 1) }));
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setSettings((current) => ({ textScale: stepTextScale(current.textScale, -1) }));
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [resetDisplaySettings]);

  return { settings, setTextScale, resetDisplaySettings };
};
