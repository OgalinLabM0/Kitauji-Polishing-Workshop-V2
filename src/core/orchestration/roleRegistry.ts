import type { AiWorkstationId } from '../domain/models';

export type MemoryReadScope =
  | 'source-text'
  | 'local-context'
  | 'character-snapshots'
  | 'relationship-snapshots'
  | 'scene-snapshots'
  | 'knowledge-boundaries'
  | 'narrative-memory'
  | 'terminology'
  | 'glossary-entries'
  | 'glossary-occurrences'
  | 'translation-candidates';

export type CandidateWriteScope =
  | 'character-candidates'
  | 'relationship-candidates'
  | 'scene-candidates'
  | 'glossary-candidates'
  | 'glossary-translation-candidates'
  | 'annotation-drafts'
  | 'translation-candidates'
  | 'review-findings'
  | 'recheck-tasks';

export interface AiWorkstationDefinition {
  readonly id: AiWorkstationId;
  readonly label: string;
  readonly purpose: string;
  readonly reads: readonly MemoryReadScope[];
  readonly proposes: readonly CandidateWriteScope[];
  readonly mayCommitFinalText: false;
  readonly requiresSourceEvidence: true;
}

export const AI_WORKSTATIONS: Readonly<Record<AiWorkstationId, AiWorkstationDefinition>> = {
  'book-pre-reader': {
    id: 'book-pre-reader',
    label: '全书预读',
    purpose: '按剧情顺序建立人物、事件、关系和证据候选。',
    reads: ['source-text', 'character-snapshots', 'relationship-snapshots', 'knowledge-boundaries', 'narrative-memory'],
    proposes: ['character-candidates', 'relationship-candidates'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'term-extractor': {
    id: 'term-extractor',
    label: '专名提取',
    purpose: '扫描全书并聚合同一候选的全部原文出现位置，只提交专名与领域术语候选。',
    reads: ['source-text', 'local-context', 'character-snapshots', 'knowledge-boundaries', 'glossary-entries'],
    proposes: ['glossary-candidates'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'term-translation-proposer': {
    id: 'term-translation-proposer',
    label: '术语译名提案',
    purpose: '结合全部出现语境提出基础译名、语义身份、称呼变体及姓名谐音/误读假设。',
    reads: ['source-text', 'character-snapshots', 'relationship-snapshots', 'knowledge-boundaries', 'narrative-memory', 'glossary-entries', 'glossary-occurrences'],
    proposes: ['glossary-translation-candidates', 'annotation-drafts'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'scene-analyst': {
    id: 'scene-analyst',
    label: '场景分析',
    purpose: '识别场景边界、氛围、说话人和受话人候选。',
    reads: ['source-text', 'local-context', 'character-snapshots', 'relationship-snapshots', 'narrative-memory'],
    proposes: ['scene-candidates'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'faithful-translator': {
    id: 'faithful-translator',
    label: '忠实初译',
    purpose: '在禁止增译、漏译、净化、弱化和无依据强化的约束下生成带源文覆盖审计的中文草稿。',
    reads: ['source-text', 'local-context', 'character-snapshots', 'relationship-snapshots', 'scene-snapshots', 'knowledge-boundaries', 'narrative-memory', 'glossary-entries', 'glossary-occurrences'],
    proposes: ['translation-candidates'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'chinese-editor': {
    id: 'chinese-editor',
    label: '中文编辑',
    purpose: '在信息集合完全不变的前提下改善中文节奏和角色声音。',
    reads: ['source-text', 'local-context', 'character-snapshots', 'scene-snapshots', 'knowledge-boundaries', 'narrative-memory', 'translation-candidates'],
    proposes: ['translation-candidates'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'fidelity-reviewer': {
    id: 'fidelity-reviewer',
    label: '忠实审校',
    purpose: '检查漏译、增译、净化、弱化、无依据强化、性别词、单复数、数字、否定和意义反转。',
    reads: ['source-text', 'local-context', 'knowledge-boundaries', 'narrative-memory', 'translation-candidates', 'glossary-entries', 'glossary-occurrences'],
    proposes: ['review-findings', 'recheck-tasks'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'relationship-reviewer': {
    id: 'relationship-reviewer',
    label: '关系称呼审校',
    purpose: '检查原文明示称呼在当前关系阶段和场景中的中文呈现。',
    reads: ['source-text', 'character-snapshots', 'relationship-snapshots', 'scene-snapshots', 'knowledge-boundaries', 'narrative-memory', 'translation-candidates'],
    proposes: ['review-findings', 'recheck-tasks'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'glossary-auditor': {
    id: 'glossary-auditor',
    label: '术语生效审校',
    purpose: '检查基础专名、实体类型、场景变体和姓名读法是否有证据并在译文中正确生效。',
    reads: ['source-text', 'local-context', 'narrative-memory', 'glossary-entries', 'glossary-occurrences', 'scene-snapshots', 'translation-candidates'],
    proposes: ['review-findings', 'recheck-tasks'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
  'trajectory-reviewer': {
    id: 'trajectory-reviewer',
    label: '全书轨迹审校',
    purpose: '复核人物声音、关系事件、称呼轨迹和术语在全书中的有依据变化。',
    reads: ['source-text', 'character-snapshots', 'relationship-snapshots', 'knowledge-boundaries', 'narrative-memory', 'glossary-entries', 'glossary-occurrences', 'translation-candidates'],
    proposes: ['review-findings', 'recheck-tasks'],
    mayCommitFinalText: false,
    requiresSourceEvidence: true,
  },
};

export const AI_WORKSTATION_LIST = Object.values(AI_WORKSTATIONS);
