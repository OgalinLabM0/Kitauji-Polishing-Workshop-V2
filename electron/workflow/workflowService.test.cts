import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDatabase } from '../projects/projectDatabase.cjs';
import { parseTxtDocument } from '../projects/txtImport.cjs';
import { ProviderSettingsStore } from '../providers/providerSettings.cjs';
import { condensePieceSummaries, isTrivialOrBoilerplateTerm, WorkflowService } from './workflowService.cjs';

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('WorkflowService & Pre-read utilities', () => {
  it('condenses multiple piece summaries without sentence duplication', () => {
    const piece1 = '帝国军在莱茵战线遭遇突袭。第224魔导中队奋力抵抗。';
    const piece2 = '第224魔导中队奋力抵抗。谭雅作为援军指挥官赶赴战场接管指挥。';
    const piece3 = '谭雅作为援军指挥官赶赴战场接管指挥。敌军攻势被暂时遏制。';
    const condensed = condensePieceSummaries([piece1, piece2, piece3]);
    expect(condensed).toBe('帝国军在莱茵战线遭遇突袭。第224魔导中队奋力抵抗。谭雅作为援军指挥官赶赴战场接管指挥。敌军攻势被暂时遏制。');
  });

  it('filters out boilerplate epub metadata terms', () => {
    expect(isTrivialOrBoilerplateTerm('目次')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('CONTENTS')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('本電子書籍')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('あとがき')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('奥付')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('第1章')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('第壱章')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('こと')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('12345')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('敵')).toBe(true);
    expect(isTrivialOrBoilerplateTerm('兵士')).toBe(true);

    // Valid novel terms should NOT be filtered
    expect(isTrivialOrBoilerplateTerm('魔導師')).toBe(false);
    expect(isTrivialOrBoilerplateTerm('ターニャ')).toBe(false);
    expect(isTrivialOrBoilerplateTerm('帝国軍')).toBe(false);
    expect(isTrivialOrBoilerplateTerm('エレニウム九五式')).toBe(false);
  });

  it('does not start a new request after pause cancels an optional pre-read review', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-pause-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const sourceBytes = new Uint8Array(Buffer.from('第一章\n敵は前進した。', 'utf8'));
    const parsed = parseTxtDocument(sourceBytes);
    const projectId = 'project-pause-safe-point-001';
    const projectDatabase = new ProjectDatabase(databasePath);
    projectDatabase.persistTxtProject({
      project: {
        projectId, title: '暂停测试', sourcePath: 'D:\\暂停测试.txt', sourceFormat: 'txt',
        sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: 'a'.repeat(64),
        sourceSizeBytes: sourceBytes.length, chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
        importedAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', lastOpenedAt: '2026-08-27T00:00:00.000Z',
      },
      originalBytes: sourceBytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
    });
    projectDatabase.close();

    const settings = new ProviderSettingsStore(path.join(directory, 'settings'), {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
    });
    const profile = settings.getProfile('deepseek-official')!;
    settings.saveProfile({ ...profile, maxRetries: 0, timeoutSeconds: 30, apiKey: 'test-key' });
    settings.setActive(profile.profileId);

    const extraction = JSON.stringify({
      chapterSummary: '敌军前进。', entities: [], glossary: [],
      facts: [{
        kind: 'event', subjectKey: '未登録人物', objectKey: '', statement: '未登録人物观察到敌军前进。',
        evidenceExcerpt: '敵は前進した', confidence: 0.9,
      }],
      events: [], frames: [], styleDecisions: [], ambiguities: [],
    });
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: extraction }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }), { status: 200 });
      }
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new WorkflowService(databasePath, settings);
    try {
      const task = service.start({ projectId, taskType: 'pre-read' });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(service.pause(task.taskId).status).toBe('pausing');
      await vi.waitFor(() => {
        expect(service.overview(projectId).tasks.find((row) => row.taskId === task.taskId)?.status).toBe('paused');
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      service.close();
    }
  });

  it('runs multi-domain agents with full project context', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-domain-agent-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const sourceBytes = new Uint8Array(Buffer.from('第一章\\nターニャは前進した。', 'utf8'));
    const parsed = parseTxtDocument(sourceBytes);
    const projectId = 'project-agent-test-001';
    const projectDatabase = new ProjectDatabase(databasePath);
    projectDatabase.persistTxtProject({
      project: {
        projectId, title: 'Agent测试', sourcePath: 'D:\\\\Agent测试.txt', sourceFormat: 'txt',
        sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: 'b'.repeat(64),
        sourceSizeBytes: sourceBytes.length, chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
        importedAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', lastOpenedAt: '2026-08-27T00:00:00.000Z',
      },
      originalBytes: sourceBytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
    });
    projectDatabase.close();

    const settings = new ProviderSettingsStore(path.join(directory, 'settings'), {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
    });
    const profile = settings.getProfile('deepseek-official')!;
    settings.saveProfile({ ...profile, maxRetries: 0, timeoutSeconds: 30, apiKey: 'test-key' });
    settings.setActive(profile.profileId);

    const characterAgentResponse = JSON.stringify({
      summary: '已为谭雅添加别名并建立战友关系。',
      modifiedCharacters: [
        { sourceTerm: 'ターニャ', translatedTerm: '谭雅·提古雷查夫', gender: 'female', sense: '帝国第二O三航空魔导大队大队长', aliases: ['提古雷查夫', '白银'] }
      ],
      newRelationships: [
        { subject: 'ターニャ', predicate: '上下级', object: 'レルゲン', statement: '谭雅服从雷鲁根少校的作战调度指令', importance: 0.9 }
      ]
    });

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: characterAgentResponse }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 20 },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new WorkflowService(databasePath, settings);
    try {
      // 预先导入术语
      service.importGlossary(projectId, [
        { sourceTerm: 'ターニャ', canonicalChinese: '谭雅', category: 'character', note: '', pronunciation: '' }
      ], false);

      const result = await service.runDomainAgent('character', projectId, '为谭雅补充全名和与雷鲁根的关系');
      expect(result.summary).toContain('已为谭雅添加别名并建立战友关系');
      expect(result.appliedCount).toBeGreaterThanOrEqual(1);

      const facts = service.memory(projectId);
      expect(facts.some((f) => f.statement.includes('雷鲁根少校'))).toBe(true);
    } finally {
      service.close();
    }
  });
});
