export const DISPLAY_SETTINGS_STORAGE_KEY = 'kitauji-v2.display-settings';
export const MIN_TEXT_SCALE = 0.85;
export const MAX_TEXT_SCALE = 1.4;
export const TEXT_SCALE_STEP = 0.05;

export interface DisplaySettings {
  readonly textScale: number;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  textScale: 1,
};

export const normalizeTextScale = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DISPLAY_SETTINGS.textScale;
  const clamped = Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, value));
  const stepped = Math.round(clamped / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
  return Number(stepped.toFixed(2));
};

export const parseDisplaySettings = (serialized: string | null | undefined): DisplaySettings => {
  if (!serialized) return DEFAULT_DISPLAY_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_DISPLAY_SETTINGS;
    return { textScale: normalizeTextScale((parsed as { textScale?: unknown }).textScale) };
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
};

export const serializeDisplaySettings = (settings: DisplaySettings) => JSON.stringify({
  textScale: normalizeTextScale(settings.textScale),
});

export const stepTextScale = (current: number, direction: -1 | 1) =>
  normalizeTextScale(current + direction * TEXT_SCALE_STEP);

export const textScalePercentage = (scale: number) => `${Math.round(normalizeTextScale(scale) * 100)}%`;
