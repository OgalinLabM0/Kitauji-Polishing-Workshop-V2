import { CONTENT_TONE_FIDELITY_PROMPT_CONTRACT } from './contentToneFidelity';

export interface SourceFidelityPolicy {
  readonly japaneseSourceIsContentBoundary: true;
  readonly forbidUnsupportedAdditions: true;
  readonly forbidSourceOmissions: true;
  readonly forbidSanitization: true;
  readonly forbidUnjustifiedIntensification: true;
  readonly memoryCannotAuthorizeAdditions: true;
  readonly protectedFeatures: readonly string[];
}

export const SOURCE_FIDELITY_POLICY: SourceFidelityPolicy = Object.freeze({
  japaneseSourceIsContentBoundary: true,
  forbidUnsupportedAdditions: true,
  forbidSourceOmissions: true,
  forbidSanitization: true,
  forbidUnjustifiedIntensification: true,
  memoryCannotAuthorizeAdditions: true,
  protectedFeatures: Object.freeze([
    '人物与身份',
    '人物关系',
    '主语与指代',
    '性别词',
    '单复数描述',
    '称呼与称谓后缀',
    '动作与对象',
    '心理、原因与结果',
    '数字值与书写形式',
    '否定、条件与程度',
    '粗俗、露骨、激烈、冒犯与禁忌表达的细节和力度',
    '引号、口吃、乱码与颜文字',
  ]),
});

const SOURCE_CONTENT_BOUNDARY_PROMPT_CONTRACT = `
【最高规则：日文原文内容边界】
1. 日文原文没有的信息绝对不得添加。
2. 日文原文明示的信息绝对不得删减、弱化或中性化。
3. 人物记忆知道性别、人数、关系或结局，不构成向当前译文补写的授权。
4. 当前日文没有性别词、复数描述、称呼或主语时，中文也不得擅自添加。
5. 可以调整中文语序和句式，但译文的信息集合必须与日文原文完全相同。
`.trim();

export const SOURCE_FIDELITY_PROMPT_CONTRACT = `${SOURCE_CONTENT_BOUNDARY_PROMPT_CONTRACT}\n\n${CONTENT_TONE_FIDELITY_PROMPT_CONTRACT}`;
