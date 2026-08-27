import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDatabase } from '../projects/projectDatabase.cjs';
import { parseTxtDocument } from '../projects/txtImport.cjs';
import type { ModelResponse } from '../providers/models.cjs';
import { WorkflowRepository } from './workflowRepository.cjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const fakeResponse: ModelResponse = {
  text: 'ok', finishReason: 'completed', responseId: 'response-1', inputTokens: 10, outputTokens: 5,
  cachedInputTokens: 0, reasoningTokens: 2, rawStatus: 'completed', protocolUsed: 'responses',
};

describe('temporal narrative memory', () => {
  it('persists aliases, time-varying state, A→B roles and translation dependencies', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-narrative-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const sourceBytes = new Uint8Array(Buffer.from('第一章\nアキラはミナを助けた。\n第二章\n成長したアキラはミナから手紙をもらった。', 'utf8'));
    const parsed = parseTxtDocument(sourceBytes);
    const projectId = 'project-narrative-123456789012';
    const projectDatabase = new ProjectDatabase(databasePath);
    projectDatabase.persistTxtProject({
      project: {
        projectId, title: '叙事状态测试', sourcePath: 'D:\\叙事状态测试.txt', sourceFormat: 'txt',
        sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: 'a'.repeat(64),
        sourceSizeBytes: sourceBytes.length, chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
        importedAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', lastOpenedAt: '2026-08-27T00:00:00.000Z',
      },
      originalBytes: sourceBytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
    });
    projectDatabase.close();

    const repository = new WorkflowRepository(databasePath);
    repository.initializeSegments(projectId);
    const chapterOne = { ...parsed.chapters[0], chapterId: `${projectId}:c00001` };
    const chapterTwo = { ...parsed.chapters[1], chapterId: `${projectId}:c00002` };
    const entity = (sourceName: string, translatedName: string, appearance: string, chapter: number) => ({
      sourceName, canonicalSourceName: sourceName, translatedName, reading: '', kind: 'character',
      gender: sourceName === 'アキラ' ? 'male' : 'female', number: 'singular', confidence: 0.98, notes: '',
      evidence: [{ excerpt: chapter === 1 ? 'アキラはミナを助けた' : '成長したアキラ', kind: 'identity' }],
      aliases: sourceName === 'アキラ' ? [{
        sourceForm: 'アキ', translatedForm: '阿辉', aliasKind: 'nickname', validFromChapter: 1,
        validToChapter: null, evidenceExcerpt: 'アキラはミナを助けた', confidence: 0.95,
      }] : [],
      attributes: sourceName === 'アキラ' ? [{
        predicate: 'appearance', value: appearance, validFromChapter: chapter, validToChapter: null,
        readerVisibleFrom: chapter, evidenceExcerpt: chapter === 1 ? 'アキラはミナを助けた' : '成長したアキラ', confidence: 0.95,
      }] : [],
    });
    repository.savePreReadResult(projectId, chapterOne.chapterId, 1, {
      chapterSummary: '明帮助了美奈。', glossary: [],
      entities: [entity('アキラ', '明', '少年时期', 1), entity('ミナ', '美奈', '', 1)],
      facts: [{
        kind: 'relationship', predicate: 'protects', subjectKey: 'アキラ', objectKey: 'ミナ',
        value: { relation: 'protects' }, statement: '明保护美奈。', chapterStart: 1, chapterEnd: null,
        readerVisibleFrom: 1, characterKnowledge: { アキラ: { state: 'knows', knownFromChapter: 1 } },
        evidenceExcerpt: 'アキラはミナを助けた', confidence: 0.97,
      }],
      events: [{
        eventType: 'rescue', predicate: '助ける', agentKey: 'アキラ', patientKey: 'ミナ', recipientKey: '',
        statement: 'アキラがミナを助けた。', directionStatus: 'verified', chapterStart: 1, chapterEnd: null,
        readerVisibleFrom: 1, characterKnowledge: {}, evidenceExcerpt: 'アキラはミナを助けた', confidence: 0.99,
      }],
    });
    repository.savePreReadResult(projectId, chapterTwo.chapterId, 2, {
      chapterSummary: '成长后的明收到美奈来信。', glossary: [],
      entities: [entity('アキラ', '明', '成年后的高个青年', 2), entity('ミナ', '美奈', '', 2)],
      facts: [],
      events: [{
        eventType: 'receive-letter', predicate: 'もらう', agentKey: 'ミナ', patientKey: '手紙', recipientKey: 'アキラ',
        statement: '美奈把信给了明。', directionStatus: 'verified', chapterStart: 2, chapterEnd: null,
        readerVisibleFrom: 2, characterKnowledge: {}, evidenceExcerpt: 'アキラはミナから手紙をもらった', confidence: 0.96,
      }],
    });

    const pageOne = repository.workbench(projectId, chapterOne.chapterId, 0, 20);
    const targetOnePage = pageOne.segments.find((segment) => segment.sourceText.includes('助けた'))!;
    const targetOne = repository.getSegment(targetOnePage.segmentId)!;
    const contextOne = repository.contextForSegments(projectId, [targetOne]);
    expect(JSON.parse(contextOne.directionLedger)).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: '助ける', agent: 'アキラ', patient: 'ミナ' }),
    ]));
    expect(JSON.parse(contextOne.worldState)).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: 'appearance', value_json: '"少年时期"' }),
    ]));
    expect(JSON.parse(contextOne.characterKnowledge)).toEqual(expect.arrayContaining([
      expect.objectContaining({ character: 'アキラ', epistemic_state: 'knows' }),
    ]));

    const versionId = repository.saveTranslationVersion(targetOne, '明帮助了美奈。', 'initial', 'test-profile', 'test-model',
      contextOne.manifest, fakeResponse, 100, 'reviewing', [{
        id: targetOne.segmentId,
        propositions: [{ predicate: '助ける', agent: 'アキラ', patient: 'ミナ', recipient: '',
          sourceCue: 'アキラはミナを助けた', voice: 'active', confidence: 0.99, ambiguity: '' }],
      }]);
    const akiraGlossary = repository.glossary(projectId).find((item) => item.sourceTerm === 'アキラ')!;
    repository.updateGlossary(akiraGlossary.glossaryId, '阿明', 'locked', '人工修订规范译名', '', 'male');
    expect(repository.getSegment(targetOne.segmentId)?.status).toBe('needs-human');
    expect(repository.reviews(projectId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'identity', title: '世界状态更新后需重新核对' }),
    ]));
    repository.close();

    const database = new DatabaseSync(databasePath);
    expect((database.prepare('SELECT count(*) AS count FROM narrative_entities').get() as { count: number }).count).toBe(2);
    expect((database.prepare("SELECT count(*) AS count FROM narrative_aliases WHERE source_form = 'アキ'").get() as { count: number }).count).toBe(1);
    expect(database.prepare(`
      SELECT e.agent_key, e.patient_key, e.recipient_key, e.direction_status
      FROM narrative_events e WHERE e.predicate = '助ける'
    `).get()).toEqual({ agent_key: 'アキラ', patient_key: 'ミナ', recipient_key: null, direction_status: 'verified' });
    const appearances = database.prepare(`
      SELECT w.value_json, w.valid_from_chapter, w.valid_to_chapter, w.valid_to_segment, w.status
      FROM world_state_snapshots w JOIN narrative_entities e ON e.entity_id = w.entity_id
      WHERE e.canonical_source = 'アキラ' AND w.predicate = 'appearance' ORDER BY w.valid_from_chapter
    `).all();
    expect(appearances).toEqual([
      { value_json: '"少年时期"', valid_from_chapter: 1, valid_to_chapter: 2, valid_to_segment: 1, status: 'historical' },
      { value_json: '"成年后的高个青年"', valid_from_chapter: 2, valid_to_chapter: null, valid_to_segment: null, status: 'active' },
    ]);
    const dependency = database.prepare('SELECT direction_constraints_json FROM translation_dependencies WHERE translation_version_id = ?').get(versionId) as { direction_constraints_json: string };
    expect(JSON.parse(dependency.direction_constraints_json).currentSegment[0]).toMatchObject({ agent: 'アキラ', patient: 'ミナ' });
    database.close();
  });

  it('switches state and knowledge at an exact segment without leaking a later same-chapter reveal', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-segment-timeline-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const sourceBytes = new Uint8Array(Buffer.from('第一章\nユナの髪は長かった。\nユナは髪を切った。\n短い髪が揺れた。\nユナは部屋に戻った。', 'utf8'));
    const parsed = parseTxtDocument(sourceBytes);
    const projectId = 'project-segment-timeline-1234';
    const projectDatabase = new ProjectDatabase(databasePath);
    projectDatabase.persistTxtProject({
      project: {
        projectId, title: '同章状态测试', sourcePath: 'D:\\同章状态测试.txt', sourceFormat: 'txt',
        sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: 'b'.repeat(64),
        sourceSizeBytes: sourceBytes.length, chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
        importedAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', lastOpenedAt: '2026-08-27T00:00:00.000Z',
      },
      originalBytes: sourceBytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
    });
    projectDatabase.close();
    const repository = new WorkflowRepository(databasePath);
    repository.initializeSegments(projectId);
    const chapterId = `${projectId}:c00001`;
    repository.savePreReadResult(projectId, chapterId, 1, {
      chapterSummary: '优奈在本章剪短了头发。', glossary: [],
      entities: [{
        sourceName: 'ユナ', canonicalSourceName: 'ユナ', translatedName: '优奈', reading: '', kind: 'character',
        gender: 'unknown', number: 'singular', confidence: 0.98, notes: '',
        evidence: [{ excerpt: 'ユナの髪は長かった', kind: 'identity' }], aliases: [],
        attributes: [
          { predicate: 'appearance', value: '长发', worldlineKey: 'main', sceneKey: 'before-haircut',
            validFromChapter: 1, validFromSegment: 2,
            validToChapter: null, validToSegment: null, readerVisibleFrom: 1, readerVisibleFromSegment: 2,
            evidenceExcerpt: 'ユナの髪は長かった', evidenceSegment: 2, confidence: 0.99 },
          { predicate: 'appearance', value: '短发', worldlineKey: 'memory', sceneKey: 'haircut-memory',
            validFromChapter: 1, validFromSegment: 3,
            validToChapter: null, validToSegment: null, readerVisibleFrom: 1, readerVisibleFromSegment: 3,
            evidenceExcerpt: 'ユナは髪を切った', evidenceSegment: 3, confidence: 0.99 },
        ],
      }],
      facts: [{
        kind: 'secret', predicate: 'planned-haircut', subjectKey: 'ユナ', objectKey: '',
        worldlineKey: 'main', sceneKey: 'before-haircut', value: { planned: true },
        statement: '优奈早已决定剪发。', chapterStart: 1, chapterStartSegment: 2,
        chapterEnd: null, chapterEndSegment: null, readerVisibleFrom: 1, readerVisibleFromSegment: 3,
        characterKnowledge: { ユナ: { state: 'knows', knownFromChapter: 1, knownFromSegment: 2 } },
        evidenceExcerpt: 'ユナは髪を切った', evidenceSegment: 3, confidence: 0.96,
      }], events: [], frames: [
        { frameKind: 'main', worldlineKey: 'main', storyTimeKey: 'present', sceneKey: 'before-haircut',
          locationKey: 'room', viewpointKey: 'ユナ', narratorKey: '', participantKeys: ['ユナ'],
          validFromChapter: 1, validFromSegment: 2, validToChapter: 1, validToSegment: 2,
          evidenceExcerpt: 'ユナの髪は長かった', evidenceSegment: 2, confidence: 0.98 },
        { frameKind: 'flashback', worldlineKey: 'memory', storyTimeKey: 'earlier', sceneKey: 'haircut-memory',
          locationKey: 'room', viewpointKey: 'ユナ', narratorKey: '', participantKeys: ['ユナ'],
          validFromChapter: 1, validFromSegment: 3, validToChapter: 1, validToSegment: 4,
          evidenceExcerpt: 'ユナは髪を切った', evidenceSegment: 3, confidence: 0.95 },
        { frameKind: 'main', worldlineKey: 'main', storyTimeKey: 'present', sceneKey: 'after-memory',
          locationKey: 'room', viewpointKey: 'ユナ', narratorKey: '', participantKeys: ['ユナ'],
          validFromChapter: 1, validFromSegment: 5, validToChapter: null, validToSegment: null,
          evidenceExcerpt: 'ユナは部屋に戻った', evidenceSegment: 5, confidence: 0.98 },
      ],
    });
    const page = repository.workbench(projectId, chapterId, 0, 20);
    const before = repository.getSegment(page.segments.find((item) => item.segmentOrdinal === 2)!.segmentId)!;
    const after = repository.getSegment(page.segments.find((item) => item.segmentOrdinal === 4)!.segmentId)!;
    const restored = repository.getSegment(page.segments.find((item) => item.segmentOrdinal === 5)!.segmentId)!;
    const beforeContext = repository.contextForSegments(projectId, [before]);
    const afterContext = repository.contextForSegments(projectId, [after]);
    const restoredContext = repository.contextForSegments(projectId, [restored]);
    expect(JSON.parse(beforeContext.worldState)).toEqual(expect.arrayContaining([expect.objectContaining({ value_json: '"长发"' })]));
    expect(JSON.parse(beforeContext.worldState)).not.toEqual(expect.arrayContaining([expect.objectContaining({ value_json: '"短发"' })]));
    expect(JSON.parse(beforeContext.translatorKnowledge).claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: '优奈早已决定剪发。' }),
    ]));
    expect(JSON.parse(beforeContext.readerKnowledge).claims).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: '优奈早已决定剪发。' }),
    ]));
    expect(JSON.parse(afterContext.worldState)).toEqual(expect.arrayContaining([expect.objectContaining({ value_json: '"短发"' })]));
    expect(JSON.parse(restoredContext.worldState)).toEqual(expect.arrayContaining([expect.objectContaining({ value_json: '"长发"', worldline_key: 'main' })]));
    expect(JSON.parse(restoredContext.worldState)).not.toEqual(expect.arrayContaining([expect.objectContaining({ value_json: '"短发"' })]));
    expect(JSON.parse(afterContext.characterKnowledge)).toEqual(expect.arrayContaining([
      expect.objectContaining({ character: 'ユナ', statement: '优奈早已决定剪发。', epistemic_state: 'knows' }),
    ]));
    expect(JSON.parse(beforeContext.narrativeFrames)).toEqual(expect.arrayContaining([
      expect.objectContaining({ frame_kind: 'main', scene_key: 'before-haircut' }),
    ]));
    expect(JSON.parse(afterContext.narrativeFrames)).toEqual(expect.arrayContaining([
      expect.objectContaining({ frame_kind: 'flashback', worldline_key: 'memory' }),
    ]));
    expect(repository.narrativeBoundarySegments(projectId, [before, ...page.segments
      .filter((item) => item.segmentOrdinal > 2)
      .map((item) => repository.getSegment(item.segmentId)!)] )).toContain(3);
    repository.close();
  });
});
