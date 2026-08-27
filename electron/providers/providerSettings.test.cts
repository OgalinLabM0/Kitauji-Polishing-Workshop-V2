import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderSettingsStore, providerSettingsConstantsForTest, validateProviderProfile } from './providerSettings.cjs';

const directories: string[] = [];
const fakeEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`encrypted:${text}`, 'utf8'),
  decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^encrypted:/u, ''),
};

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('provider settings store', () => {
  it('never writes the API key into ordinary settings and never returns it', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-provider-'));
    directories.push(directory);
    const store = new ProviderSettingsStore(directory, fakeEncryption);
    const profile = store.snapshot().profiles[0];
    store.saveProfile({ ...profile, apiKey: 'sk-super-secret-value' });
    const settingsText = readFileSync(path.join(directory, providerSettingsConstantsForTest.SETTINGS_FILE), 'utf8');
    expect(settingsText).not.toContain('sk-super-secret-value');
    expect(store.snapshot().profiles[0]).toMatchObject({ hasApiKey: true, apiKeyHint: '••••alue' });
    expect(JSON.stringify(store.snapshot())).not.toContain('sk-super-secret-value');
  });

  it('refuses to save a key without OS encryption', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-provider-'));
    directories.push(directory);
    const store = new ProviderSettingsStore(directory, { ...fakeEncryption, isEncryptionAvailable: () => false });
    const profile = store.snapshot().profiles[0];
    expect(() => store.saveProfile({ ...profile, apiKey: 'secret' })).toThrow('拒绝保存 API Key');
  });

  it('adds the required v1 path for the Kouri root endpoint', () => {
    const profile = providerSettingsConstantsForTest.defaultProfiles()[1];
    expect(validateProviderProfile({ ...profile, baseUrl: 'https://api.kourichat.com' }).baseUrl).toBe('https://api.kourichat.com/v1');
  });

  it('normalizes Command Code roots and forces per-model automatic protocol mode', () => {
    const profile = providerSettingsConstantsForTest.defaultProfiles().find((item) => item.kind === 'command-code')!;
    expect(validateProviderProfile({
      ...profile, baseUrl: 'https://commandcode.ai/', protocol: 'anthropic-messages', zeroDataRetention: true,
    })).toMatchObject({
      baseUrl: 'https://api.commandcode.ai/provider/v1', protocol: 'chat-completions', zeroDataRetention: true,
    });
  });

  it('adds the built-in Command Code profile to existing settings without changing the active provider', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-provider-'));
    directories.push(directory);
    const oldProfile = providerSettingsConstantsForTest.defaultProfiles()[0];
    writeFileSync(path.join(directory, providerSettingsConstantsForTest.SETTINGS_FILE), JSON.stringify({
      version: 1, activeProfileId: oldProfile.profileId, profiles: [oldProfile],
    }));
    const store = new ProviderSettingsStore(directory, fakeEncryption);
    expect(store.snapshot().activeProfileId).toBe(oldProfile.profileId);
    expect(store.snapshot().profiles.some((item) => item.kind === 'command-code')).toBe(true);
  });

  it('does not resurrect a Command Code profile deleted after settings migration', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-provider-'));
    directories.push(directory);
    const retainedProfile = providerSettingsConstantsForTest.defaultProfiles()[0];
    writeFileSync(path.join(directory, providerSettingsConstantsForTest.SETTINGS_FILE), JSON.stringify({
      version: 2, activeProfileId: retainedProfile.profileId, profiles: [retainedProfile],
    }));
    const store = new ProviderSettingsStore(directory, fakeEncryption);
    expect(store.snapshot().profiles.map((item) => item.profileId)).toEqual([retainedProfile.profileId]);
  });

  it('forces every Command Code profile back to parameter-free default reasoning', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-provider-'));
    directories.push(directory);
    const profiles = providerSettingsConstantsForTest.defaultProfiles().map((profile) => profile.kind === 'command-code'
      ? { ...profile, reasoningEffort: 'max' as const, agentReasoningEffort: 'high' as const,
          commandCodeReasoningCapabilities: [{
            model: profile.model, protocol: 'chat-completions' as const, status: 'verified' as const,
            requestedEffort: 'max' as const, effectiveEffort: 'high' as const,
            checkedAt: '2026-08-27T00:00:00.000Z', message: 'legacy probe',
          }] }
      : profile);
    writeFileSync(path.join(directory, providerSettingsConstantsForTest.SETTINGS_FILE), JSON.stringify({
      version: 4, activeProfileId: 'deepseek-official', profiles,
    }));
    const store = new ProviderSettingsStore(directory, fakeEncryption);
    expect(store.snapshot().profiles.find((item) => item.kind === 'command-code')).toMatchObject({
      reasoningEffort: 'none', agentReasoningEffort: 'none',
    });
    expect(readFileSync(path.join(directory, providerSettingsConstantsForTest.SETTINGS_FILE), 'utf8')).not.toContain('commandCodeReasoningCapabilities');
  });

  it('raises only the built-in Command Code 8192 output limit to 18432', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-provider-'));
    directories.push(directory);
    const profiles = providerSettingsConstantsForTest.defaultProfiles().map((profile) => profile.kind === 'command-code'
      ? { ...profile, maxOutputTokens: 8_192 }
      : profile);
    writeFileSync(path.join(directory, providerSettingsConstantsForTest.SETTINGS_FILE), JSON.stringify({
      version: 3, activeProfileId: 'command-code-goat', profiles,
    }));
    const store = new ProviderSettingsStore(directory, fakeEncryption);
    expect(store.snapshot().profiles.find((item) => item.kind === 'command-code')?.maxOutputTokens).toBe(18_432);
    expect(store.snapshot().profiles.find((item) => item.kind === 'deepseek')?.maxOutputTokens).toBe(8_192);
    expect(store.snapshot().profiles.find((item) => item.kind === 'kouri')?.maxOutputTokens).toBe(8_192);
  });

  it('persists Kouri reasoning capability without exposing a secret', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-provider-'));
    directories.push(directory);
    const store = new ProviderSettingsStore(directory, fakeEncryption);
    const profile = store.snapshot().profiles.find((item) => item.kind === 'kouri')!;
    store.saveKouriReasoningCapability(profile.profileId, {
      model: profile.model, protocol: 'responses', status: 'verified', requestedEffort: 'high',
      effectiveEffort: 'high', checkedAt: '2026-08-27T00:00:00.000Z', message: 'verified',
    });
    const reopened = new ProviderSettingsStore(directory, fakeEncryption);
    expect(reopened.getKouriReasoningCapability(profile.profileId, profile.model, 'responses')).toMatchObject({
      status: 'verified', effectiveEffort: 'high',
    });
  });
});
