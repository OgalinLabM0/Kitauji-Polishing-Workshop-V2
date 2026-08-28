import { describe, expect, it } from 'vitest';
import { selectedWorkbenchDraft } from './workbenchDraftPolicy';

describe('workbench draft policy', () => {
  it('never presents an imported original translation as a generated final draft', () => {
    expect(selectedWorkbenchDraft({ selectedTranslation: null })).toBe('');
    expect(selectedWorkbenchDraft({ selectedTranslation: '正式润色成稿' })).toBe('正式润色成稿');
  });
});

