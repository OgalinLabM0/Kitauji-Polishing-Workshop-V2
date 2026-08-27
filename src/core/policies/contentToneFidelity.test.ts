import { describe, expect, it } from 'vitest';
import {
  auditContentToneFidelity,
  CONTENT_TONE_FIDELITY_POLICY,
  CONTENT_TONE_FIDELITY_PROMPT_CONTRACT,
  type ToneFidelityAxis,
  type ToneAxisAssessment,
} from './contentToneFidelity';

const assessment = (
  overrides: Partial<ToneAxisAssessment> = {},
): ToneAxisAssessment => ({
  axis: 'explicitness',
  sourceLevel: 3,
  translationLevel: 3,
  sourceEvidenceIds: ['chapter-1:p-12'],
  ...overrides,
});

const completeAssessment = (
  overrides: Partial<ToneAxisAssessment> = {},
): readonly ToneAxisAssessment[] => {
  const targetAxis = overrides.axis ?? 'explicitness';
  return CONTENT_TONE_FIDELITY_POLICY.auditedAxes.map((axis) =>
    axis === targetAxis
      ? assessment({ ...overrides, axis })
      : assessment({ axis, sourceLevel: 0, translationLevel: 0 }),
  );
};

describe('content tone fidelity policy', () => {
  it('把反净化与禁止反向加码同时设为强制规则', () => {
    expect(CONTENT_TONE_FIDELITY_POLICY.forbidSanitization).toBe(true);
    expect(CONTENT_TONE_FIDELITY_POLICY.forbidEuphemization).toBe(true);
    expect(CONTENT_TONE_FIDELITY_POLICY.forbidUnjustifiedIntensification).toBe(true);
    expect(CONTENT_TONE_FIDELITY_PROMPT_CONTRACT).toContain('善意改写');
    expect(CONTENT_TONE_FIDELITY_PROMPT_CONTRACT).toContain('不得反向添油加醋');
  });

  it('阻止弱化原作尺度', () => {
    expect(
      auditContentToneFidelity(completeAssessment({ translationLevel: 1 })),
    ).toContainEqual({
      axis: 'explicitness',
      code: 'TONE_WEAKENED',
      blocksExport: true,
    });
  });

  it('阻止超出原作尺度的擅自强化', () => {
    expect(
      auditContentToneFidelity(
        completeAssessment({ axis: 'vulgarity', sourceLevel: 1, translationLevel: 4 }),
      ),
    ).toContainEqual({
      axis: 'vulgarity',
      code: 'TONE_INTENSIFIED',
      blocksExport: true,
    });
  });

  it('未知判断和无原文证据不能静默通过', () => {
    const assessments = completeAssessment({ translationLevel: 'unknown' }).map((item) =>
      item.axis === 'aggression' ? assessment({ axis: 'aggression', sourceEvidenceIds: [] }) : item,
    );
    const findings = auditContentToneFidelity(assessments);

    expect(findings.map((finding) => finding.code)).toEqual([
      'TONE_ASSESSMENT_UNKNOWN',
      'TONE_EVIDENCE_MISSING',
    ]);
    expect(findings.every((finding) => finding.blocksExport)).toBe(true);
  });

  it('七项尺度有任一项未评估时不能绕过质量门', () => {
    const incomplete = completeAssessment().filter(
      (item) => item.axis !== ('taboo-directness' satisfies ToneFidelityAxis),
    );

    expect(auditContentToneFidelity(incomplete)).toContainEqual({
      axis: 'taboo-directness',
      code: 'TONE_ASSESSMENT_MISSING',
      blocksExport: true,
    });
  });
});
