import { describe, expect, it } from 'vitest';
import type { GlossaryImportRecord } from '../../core/glossary/glossaryImport';
import { buildImportedGlossaryItems } from './importedGlossaryItems';

const record: GlossaryImportRecord = {
  sourceTerm: '関',
  canonicalChinese: '关',
  category: 'character',
  note: '角色姓氏',
};

describe('imported glossary presentation items', () => {
  it('keeps user locked mappings source-bound and gender unknown without evidence', () => {
    const item = buildImportedGlossaryItems([record], 'locked')[0];
    expect(item.entry).toMatchObject({ status: 'locked', origin: 'imported', referentKind: 'person', exactMatch: true });
    expect(item.entry.gender).toMatchObject({ value: 'unknown', evidenceIds: [] });
    expect(item.reviewRoute.reason).toContain('当前日文实际命中');
  });

  it('routes non-locked imports to later source matching', () => {
    const item = buildImportedGlossaryItems([{ ...record, category: 'organization' }], 'verify')[0];
    expect(item.entry).toMatchObject({ status: 'review', referentKind: 'organization', firstSeenParagraphId: '待匹配原文' });
    expect(item.entry.gender.value).toBe('not-applicable');
    expect(item.reviewRoute.kind).toBe('model-review');
  });
});
