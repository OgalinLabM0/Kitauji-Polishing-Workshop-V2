import { describe, expect, it } from 'vitest';
import {
  buildLongRangeMemoryPack,
  type LongRangeMemoryRequest,
  type NarrativeMemoryRecord,
} from './longRangeMemory';

const record = (
  overrides: Partial<NarrativeMemoryRecord> = {},
): NarrativeMemoryRecord => ({
  memoryId: 'memory-1',
  kind: 'character-state',
  summary: '角色当前状态',
  validFromParagraphOrdinal: 1,
  revealedToReaderAtParagraphOrdinal: 1,
  mayInformWithoutLeaking: false,
  characterIds: ['A'],
  chapterIds: ['chapter-1'],
  sceneIds: [],
  termIds: [],
  characterKnowledge: [],
  evidenceIds: ['chapter-1:p-1'],
  confidence: 'confirmed',
  ...overrides,
});

const request = (
  overrides: Partial<LongRangeMemoryRequest> = {},
): LongRangeMemoryRequest => ({
  paragraphOrdinal: 20,
  chapterId: 'chapter-1',
  sceneId: 'scene-2',
  characterIds: ['A', 'B'],
  directedRelation: { fromCharacterId: 'A', toCharacterId: 'B' },
  termIds: [],
  purpose: 'translate',
  limits: {
    readerSafe: 10,
    translatorOnly: 10,
    perCharacterKnowledge: 10,
    unresolved: 10,
  },
  ...overrides,
});

describe('long-range narrative memory pack', () => {
  it('把后文秘密放进禁止表面化的译者通道，不泄露给当前读者', () => {
    const futureSecret = record({
      memoryId: 'future-secret',
      kind: 'secret',
      summary: 'A 实际隐瞒了身份',
      validFromParagraphOrdinal: 100,
      revealedToReaderAtParagraphOrdinal: 100,
      mayInformWithoutLeaking: true,
      characterIds: ['A', 'B'],
    });

    const pack = buildLongRangeMemoryPack([futureSecret], request());

    expect(pack.readerSafe).toEqual([]);
    expect(pack.translatorOnly).toHaveLength(1);
    expect(pack.translatorOnly[0]).toMatchObject({
      record: { memoryId: 'future-secret' },
      mayGuideInterpretation: true,
      maySurfaceInTranslation: false,
    });
    expect(pack.memoryCannotAuthorizeSourceAbsentText).toBe(true);
  });

  it('关系检索区分 A 到 B 与 B 到 A 的方向', () => {
    const fromAToB = record({
      memoryId: 'A-to-B',
      kind: 'relationship-event',
      characterIds: ['A', 'B'],
      directedRelation: { fromCharacterId: 'A', toCharacterId: 'B' },
    });
    const fromBToA = record({
      memoryId: 'B-to-A',
      kind: 'relationship-event',
      characterIds: ['A', 'B'],
      directedRelation: { fromCharacterId: 'B', toCharacterId: 'A' },
    });

    const pack = buildLongRangeMemoryPack(
      [fromBToA, fromAToB],
      request({
        limits: {
          ...request().limits,
          readerSafe: 1,
        },
      }),
    );

    expect(pack.readerSafe.map((item) => item.memoryId)).toEqual(['A-to-B']);
  });

  it('人物声音和角色知识是长期记忆，不被塞进普通术语表', () => {
    const voice = record({
      memoryId: 'voice-A',
      kind: 'voice-profile',
      summary: 'A 语气冷淡，极少使用敬语',
      characterIds: ['A'],
    });
    const privateBelief = record({
      memoryId: 'belief-A',
      kind: 'secret',
      summary: 'A 误以为 B 已经知情',
      revealedToReaderAtParagraphOrdinal: 80,
      mayInformWithoutLeaking: true,
      characterIds: ['A', 'B'],
      characterKnowledge: [
        {
          characterId: 'A',
          knownFromParagraphOrdinal: 10,
          state: 'believes',
        },
      ],
    });

    const pack = buildLongRangeMemoryPack([voice, privateBelief], request());

    expect(pack.readerSafe.map((item) => item.memoryId)).toContain('voice-A');
    expect(pack.characterKnowledgeById.A?.map((item) => item.memoryId)).toContain('belief-A');
    expect(pack.characterKnowledgeById.B).toEqual([]);
    expect(pack.retrievalRule).toBe('entity-relation-time-first');
  });

  it('低置信度和未决问题进入单独复核层', () => {
    const unresolved = record({
      memoryId: 'unknown-speaker',
      kind: 'unresolved-question',
      summary: '说话人可能是 A 或 B',
      confidence: 'unknown',
      characterIds: ['A', 'B'],
    });

    const pack = buildLongRangeMemoryPack([unresolved], request());

    expect(pack.readerSafe).toEqual([]);
    expect(pack.translatorOnly).toEqual([]);
    expect(pack.unresolved.map((item) => item.memoryId)).toEqual(['unknown-speaker']);
  });

  it('没有原文证据的长期记忆不能作为已确认事实使用', () => {
    const unsupported = record({
      memoryId: 'unsupported-memory',
      evidenceIds: [],
    });

    const pack = buildLongRangeMemoryPack([unsupported], request());

    expect(pack.readerSafe).toEqual([]);
    expect(pack.unresolved.map((item) => item.memoryId)).toEqual(['unsupported-memory']);
  });
});
