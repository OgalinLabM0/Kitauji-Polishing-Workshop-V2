import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_SETTINGS,
  parseDisplaySettings,
  serializeDisplaySettings,
  stepTextScale,
  textScalePercentage,
} from './displaySettings';

describe('display settings', () => {
  it('falls back safely when saved data is absent or malformed', () => {
    expect(parseDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings('{broken')).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings('[]')).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it('clamps and aligns saved text scale to five-percent steps', () => {
    expect(parseDisplaySettings('{"textScale":1.127}').textScale).toBe(1.15);
    expect(parseDisplaySettings('{"textScale":4}').textScale).toBe(1.4);
    expect(parseDisplaySettings('{"textScale":0.1}').textScale).toBe(0.85);
  });

  it('steps without crossing the supported range', () => {
    expect(stepTextScale(1, 1)).toBe(1.05);
    expect(stepTextScale(0.85, -1)).toBe(0.85);
    expect(stepTextScale(1.4, 1)).toBe(1.4);
  });

  it('serializes only normalized public settings', () => {
    expect(serializeDisplaySettings({ textScale: 1.234 })).toBe('{"textScale":1.25}');
    expect(textScalePercentage(1.149)).toBe('115%');
  });
});
