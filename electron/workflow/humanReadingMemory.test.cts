import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDatabase } from '../projects/projectDatabase.cjs';
import { parseTxtDocument } from '../projects/txtImport.cjs';
import { WorkflowRepository } from './workflowRepository.cjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('human-reading v3 memory', () => {
  it('keeps later same-segment state out of the segment-start reader state while supplying exact transition slices', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-human-v3-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const sourceLine = 'ユナは長い髪だったが、鏡の前で髪を切った。短い髪が揺れた。';
    const bytes = new Uint8Array(Buffer.from(`第一章\n${sourceLine}`, 'utf8'));
    const parsed = parseTxtDocument(bytes);
    const projectId = 'project-human-reading-v3-001';
    const projectDatabase = new ProjectDatabase(databasePath);
    projectDatabase.persistTxtProject({
      project: {
        projectId, title: '字符状态测试', sourcePath: 'D:\\字符状态测试.txt', sourceFormat: 'txt',
        sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: 'e'.repeat(64),
        sourceSizeBytes: bytes.length, chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
        importedAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', lastOpenedAt: '2026-08-27T00:00:00.000Z',
      },
      originalBytes: bytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
    });
    projectDatabase.close();

    const repository = new WorkflowRepository(databasePath);
    try {
      repository.initializeSegments(projectId);
      const chapterId = `${projectId}:c00001`;
      const page = repository.workbench(projectId, chapterId, 0, 20);
      const targetPage = page.segments.find((segment) => segment.sourceText === sourceLine)!;
      const target = repository.getSegment(targetPage.segmentId)!;
      const segmentOrdinal = target.segmentOrdinal;
      const cutOffset = sourceLine.indexOf('髪を切った');
      const shortOffset = sourceLine.indexOf('短い髪');
      repository.savePreReadResult(projectId, chapterId, 1, {
        chapterSummary: '优奈在镜前剪短了头发。', glossary: [],
        entities: [{
          sourceName: 'ユナ', canonicalSourceName: 'ユナ', translatedName: '优奈', reading: '', kind: 'character',
          gender: 'female', number: 'singular', confidence: 0.99, notes: '',
          evidence: [{ excerpt: 'ユナは長い髪だった', kind: 'identity' }], aliases: [],
          attributes: [
            { predicate: 'appearance', value: '长发', worldlineKey: 'main', sceneKey: 'mirror',
              validFromChapter: 1, validFromSegment: segmentOrdinal, validFromOffset: 0,
              validToChapter: null, validToSegment: null, validToOffset: null,
              readerVisibleFrom: 1, readerVisibleFromSegment: segmentOrdinal, readerVisibleFromOffset: 0,
              evidenceExcerpt: 'ユナは長い髪だった', evidenceSegment: segmentOrdinal, evidenceStartOffset: 0, confidence: 0.99 },
            { predicate: 'appearance', value: '短发', worldlineKey: 'main', sceneKey: 'mirror',
              validFromChapter: 1, validFromSegment: segmentOrdinal, validFromOffset: cutOffset,
              validToChapter: null, validToSegment: null, validToOffset: null,
              readerVisibleFrom: 1, readerVisibleFromSegment: segmentOrdinal, readerVisibleFromOffset: cutOffset,
              evidenceExcerpt: '髪を切った', evidenceSegment: segmentOrdinal, evidenceStartOffset: cutOffset, confidence: 0.99 },
          ],
        }], facts: [], events: [],
        frames: [
          { frameKey: 'main:mirror', parentFrameKey: '', frameKind: 'main', worldlineKey: 'main',
            storyTimeKey: 'present', sceneKey: 'mirror', locationKey: 'mirror', viewpointKey: 'ユナ', narratorKey: '',
            participantKeys: ['ユナ'], nestingDepth: 0, discourseMode: 'narration', quoteLevel: 0,
            speakerKey: '', addresseeKey: '', validFromChapter: 1, validFromSegment: segmentOrdinal,
            validFromOffset: 0, validToChapter: null, validToSegment: null, validToOffset: null,
            evidenceExcerpt: 'ユナは長い髪だった', evidenceSegment: segmentOrdinal, evidenceStartOffset: 0, confidence: 0.99 },
        ],
        styleDecisions: [{ ownerType: 'character', ownerKey: 'ユナ', decisionKind: 'pronoun',
          sourcePattern: 'ユナ', targetStrategy: '第三人称使用“她”', rationale: '性别与指代已有直接证据',
          validFromChapter: 1, validFromSegment: segmentOrdinal, validFromOffset: 0,
          validToChapter: null, validToSegment: null, validToOffset: null,
          evidenceExcerpt: 'ユナは長い髪だった', evidenceSegment: segmentOrdinal, evidenceStartOffset: 0, confidence: 0.96 }],
        ambiguities: [{ ambiguityKind: 'narrative', sourceExcerpt: '短い髪が揺れた',
          interpretations: ['现实中剪发后的状态', '镜像或想象中的状态'], preservationStrategy: 'review',
          revealChapter: null, revealSegment: null, revealOffset: null,
          evidenceSegment: segmentOrdinal, evidenceStartOffset: shortOffset, confidence: 0.88 }],
      });

      const context = repository.contextForSegments(projectId, [target]);
      expect(JSON.parse(context.worldState)).toEqual(expect.arrayContaining([
        expect.objectContaining({ predicate: 'appearance', value_json: '"长发"', valid_from_offset: 0 }),
      ]));
      expect(JSON.parse(context.worldState)).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ predicate: 'appearance', value_json: '"短发"' }),
      ]));
      const slices = JSON.parse(context.exactSlices)[0].slices as Array<Record<string, unknown>>;
      expect(slices.some((slice) => slice.startOffset === cutOffset
        && (slice.transitionsStartingHere as unknown[]).length > 0)).toBe(true);
      expect(JSON.parse(context.consolidatedMemories)).toEqual(expect.arrayContaining([
        expect.objectContaining({ summary: expect.stringContaining('长发'), maySurface: true }),
      ]));
      expect(JSON.parse(context.futureConsolidatedMemories)).toEqual(expect.arrayContaining([
        expect.objectContaining({ summary: expect.stringContaining('短发'), maySurface: false }),
      ]));
      expect(JSON.parse(context.styleMemories)).toEqual(expect.arrayContaining([
        expect.objectContaining({ target_strategy: '第三人称使用“她”' }),
      ]));
      expect(JSON.parse(context.ambiguities)).toEqual(expect.arrayContaining([
        expect.objectContaining({ ambiguity_kind: 'narrative', status: 'open' }),
      ]));
      expect(JSON.parse(context.readerFacts)).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ fact_kind: 'chapter-summary' }),
      ]));
    } finally {
      repository.close();
    }
  });

  it('inherits only confirmed memory from explicitly linked earlier volumes', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-series-v3-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'project.sqlite');
    const firstBytes = new Uint8Array(Buffer.from('第一巻\n魔導炉が起動した。', 'utf8'));
    const secondBytes = new Uint8Array(Buffer.from('第二巻\n魔導炉は再び唸った。', 'utf8'));
    const firstParsed = parseTxtDocument(firstBytes);
    const secondParsed = parseTxtDocument(secondBytes);
    const firstId = 'project-series-volume-one-001';
    const secondId = 'project-series-volume-two-002';
    const projectDatabase = new ProjectDatabase(databasePath);
    const persist = (projectId: string, title: string, hash: string, sourceBytes: Uint8Array,
      parsed: ReturnType<typeof parseTxtDocument>) => projectDatabase.persistTxtProject({
        project: { projectId, title, sourcePath: `D:\\${title}.txt`, sourceFormat: 'txt',
          sourceEncoding: parsed.encoding, contentMode: 'japanese', sourceHash: hash.repeat(64),
          sourceSizeBytes: sourceBytes.length, chapterCount: parsed.chapters.length,
          paragraphCount: parsed.paragraphCount, characterCount: parsed.characterCount,
          importedAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', lastOpenedAt: '2026-08-27T00:00:00.000Z' },
        originalBytes: sourceBytes, decodedText: parsed.text, newline: parsed.newline, chapters: parsed.chapters,
      });
    persist(firstId, '系列第一卷', 'a', firstBytes, firstParsed);
    persist(secondId, '系列第二卷', 'b', secondBytes, secondParsed);
    projectDatabase.close();

    const repository = new WorkflowRepository(databasePath);
    try {
      repository.initializeSegments(firstId);
      repository.initializeSegments(secondId);
      repository.importGlossary(firstId, [{ sourceTerm: '魔導炉', translatedTerm: '魔导炉',
        kind: 'other', note: '第一卷已确认', reading: 'まどうろ' }], true);
      const secondPage = repository.workbench(secondId, `${secondId}:c00001`, 0, 20);
      const secondTarget = repository.getSegment(secondPage.segments.find((item) => item.sourceText.includes('魔導炉'))!.segmentId)!;
      expect(JSON.parse(repository.contextForSegments(secondId, [secondTarget]).seriesContext).assignment).toBeNull();

      repository.assignSeries(firstId, '魔导炉纪事', 1, '第一卷', '测试系列');
      repository.assignSeries(secondId, '魔导炉纪事', 2, '第二卷', '');
      const secondSeries = JSON.parse(repository.contextForSegments(secondId, [secondTarget]).seriesContext);
      expect(secondSeries.priorVolumes).toEqual([expect.objectContaining({ project_id: firstId, volume_ordinal: 1 })]);
      expect(secondSeries.terms).toEqual(expect.arrayContaining([
        expect.objectContaining({ source_term: '魔導炉', translated_term: '魔导炉' }),
      ]));

      const firstPage = repository.workbench(firstId, `${firstId}:c00001`, 0, 20);
      const firstTarget = repository.getSegment(firstPage.segments.find((item) => item.sourceText.includes('魔導炉'))!.segmentId)!;
      expect(JSON.parse(repository.contextForSegments(firstId, [firstTarget]).seriesContext).priorVolumes ?? []).toHaveLength(0);
      repository.unassignSeries(secondId);
      expect(JSON.parse(repository.contextForSegments(secondId, [secondTarget]).seriesContext).assignment).toBeNull();
    } finally {
      repository.close();
    }
  });
});
