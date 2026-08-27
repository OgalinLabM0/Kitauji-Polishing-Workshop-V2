import { describe, expect, it } from 'vitest';
import { SOURCE_FIDELITY_POLICY, SOURCE_FIDELITY_PROMPT_CONTRACT } from './sourceFidelity';

describe('source fidelity policy', () => {
  it('将禁止增译和漏译设为不可关闭的规则', () => {
    expect(SOURCE_FIDELITY_POLICY.forbidUnsupportedAdditions).toBe(true);
    expect(SOURCE_FIDELITY_POLICY.forbidSourceOmissions).toBe(true);
    expect(SOURCE_FIDELITY_POLICY.forbidSanitization).toBe(true);
    expect(SOURCE_FIDELITY_POLICY.forbidUnjustifiedIntensification).toBe(true);
    expect(SOURCE_FIDELITY_POLICY.memoryCannotAuthorizeAdditions).toBe(true);
  });

  it('明确覆盖性别词和单复数描述', () => {
    expect(SOURCE_FIDELITY_POLICY.protectedFeatures).toContain('性别词');
    expect(SOURCE_FIDELITY_POLICY.protectedFeatures).toContain('单复数描述');
    expect(SOURCE_FIDELITY_PROMPT_CONTRACT).toContain('当前日文没有性别词、复数描述');
  });

  it('把反净化规则纳入所有翻译任务共用的最高契约', () => {
    expect(SOURCE_FIDELITY_PROMPT_CONTRACT).toContain('不得因为内容');
    expect(SOURCE_FIDELITY_PROMPT_CONTRACT).toContain('净化、弱化、美化');
    expect(SOURCE_FIDELITY_PROMPT_CONTRACT).toContain('尺度和力度仍以当前日文原文为唯一边界');
  });
});
