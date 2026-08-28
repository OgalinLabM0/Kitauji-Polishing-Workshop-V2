import type { WorkbenchSegment } from '../../core/workflow/models';

/** Original/imported Chinese is reference material, never an editable final draft. */
export const selectedWorkbenchDraft = (segment: Pick<WorkbenchSegment, 'selectedTranslation'>): string =>
  segment.selectedTranslation ?? '';

