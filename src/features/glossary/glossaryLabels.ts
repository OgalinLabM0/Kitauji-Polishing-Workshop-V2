import type { GlossaryCategory, GlossaryReferentKind } from '../../core/glossary/models';

export const GLOSSARY_CATEGORY_OPTIONS: readonly { value: GlossaryCategory; label: string }[] = [
  { value: 'other', label: '未分类' },
  { value: 'character', label: '人物' },
  { value: 'animal', label: '动物' },
  { value: 'place', label: '地点' },
  { value: 'organization', label: '组织' },
  { value: 'event', label: '活动 / 事件' },
  { value: 'title', label: '称号 / 头衔' },
  { value: 'item', label: '物品 / 道具' },
  { value: 'ability', label: '能力 / 技能' },
  { value: 'species', label: '种族' },
  { value: 'concept', label: '概念' },
] as const;

export const glossaryCategoryLabel = (category: GlossaryCategory) =>
  GLOSSARY_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? '未分类';

export const categoryReferentKind = (category: GlossaryCategory): GlossaryReferentKind => {
  const mapping: Record<GlossaryCategory, GlossaryReferentKind> = {
    character: 'person',
    animal: 'animal',
    place: 'place',
    organization: 'organization',
    event: 'event',
    title: 'title',
    item: 'object',
    ability: 'ability',
    species: 'species',
    concept: 'concept',
    other: 'other',
  };
  return mapping[category];
};
