import { describe, expect, it } from 'vitest';
import type { EpubAnnotationDraft, GlossaryEntry, GlossaryVariant } from './models';
import { decideAnnotationExport, GLOSSARY_POLICY, resolveGlossaryTerm } from './glossaryPolicy';

const entry: GlossaryEntry = {
  entryId: 'character-seki',
  sourceTerm: '関',
  sourceAliases: [],
  canonicalChinese: '关',
  category: 'character',
  referentKind: 'person',
  gender: { value: 'unknown', confidence: 'high', evidenceIds: [] },
  senseSummary: '角色姓名',
  status: 'locked',
  origin: 'manual',
  occurrenceCount: 37,
  firstSeenParagraphId: '001-001',
  confidence: 'confirmed',
  evidenceIds: ['ev-1'],
  exactMatch: true,
};

const nickname: GlossaryVariant = {
  variantId: 'seki-chan',
  entryId: entry.entryId,
  sourceForm: '関ちゃん',
  chineseForm: '小关',
  kind: 'nickname',
  scope: {
    speakerIds: ['character-a'],
    targetIds: ['character-seki'],
    relationshipStageIds: ['familiar'],
    atmosphereTags: ['private'],
  },
  status: 'approved',
  evidenceIds: ['ev-2'],
  confidence: 'high',
};

const context = {
  japanese: '関ちゃん、こっち。',
  paragraphId: '012-014',
  speakerId: 'character-a',
  targetId: 'character-seki',
  relationshipStageId: 'familiar',
  atmosphereTags: ['private'],
} as const;

describe('glossary policy', () => {
  it('只在当前日文实际出现术语时使用基础译名', () => {
    const matched = resolveGlossaryTerm(entry, [], { ...context, japanese: '関は頷いた。' });
    const absent = resolveGlossaryTerm(entry, [], { ...context, japanese: '少女は頷いた。' });

    expect(matched.decision).toBe('use-base');
    expect(matched.chineseForm).toBe('关');
    expect(absent.decision).toBe('skip');
    expect(GLOSSARY_POLICY.memoryCannotAuthorizeAbsentWords).toBe(true);
  });

  it('命中说话方向、关系阶段和场景后才使用称呼变体', () => {
    const matched = resolveGlossaryTerm(entry, [nickname], context);

    expect(matched.decision).toBe('use-variant');
    expect(matched.chineseForm).toBe('小关');
  });

  it('原文出现称呼但场景不符时进入复核而不是退化为全局替换', () => {
    const result = resolveGlossaryTerm(entry, [nickname], {
      ...context,
      atmosphereTags: ['formal'],
    });

    expect(result.decision).toBe('review');
    expect(GLOSSARY_POLICY.forbidGlobalTextReplacement).toBe(true);
  });

  it('候选译名在人工批准前不注入翻译', () => {
    const result = resolveGlossaryTerm({ ...entry, status: 'candidate' }, [], {
      ...context,
      japanese: '関は頷いた。',
    });

    expect(result.decision).toBe('skip');
  });

  it('EPUB 注释必须已批准、有证据、无剧透并遵守出现策略', () => {
    const annotation: EpubAnnotationDraft = {
      annotationId: 'note-1',
      entryId: entry.entryId,
      occurrenceId: 'occ-1',
      sourceForm: '関くーん',
      chineseAnchor: '关——君',
      kind: 'nickname',
      note: '原文在此故意拖长称呼，保留打趣语气。',
      placement: 'first-meaningful',
      status: 'approved',
      evidenceIds: ['ev-3'],
      readerKnowledgeStatus: 'safe',
    };

    expect(decideAnnotationExport(annotation, 1).exportable).toBe(true);
    expect(decideAnnotationExport(annotation, 2).exportable).toBe(false);
    expect(decideAnnotationExport({ ...annotation, readerKnowledgeStatus: 'spoiler' }, 1).exportable)
      .toBe(false);
  });
});
