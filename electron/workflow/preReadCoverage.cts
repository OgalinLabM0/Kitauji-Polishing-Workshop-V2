interface EntityReference {
  readonly sourceName?: string;
  readonly canonicalSourceName?: string;
  readonly translatedName?: string;
  readonly evidence?: readonly { readonly excerpt?: string }[];
  readonly aliases?: readonly { readonly sourceForm?: string; readonly translatedForm?: string; readonly evidenceExcerpt?: string }[];
}

interface GlossaryReference {
  readonly sourceTerm?: string;
}

interface FactReference {
  readonly subjectKey?: string;
  readonly objectKey?: string;
  readonly characterKnowledge?: Readonly<Record<string, unknown>>;
}

interface EventReference {
  readonly agentKey?: string;
  readonly patientKey?: string;
  readonly recipientKey?: string;
  readonly characterKnowledge?: Readonly<Record<string, unknown>>;
}

interface FrameReference {
  readonly locationKey?: string;
  readonly viewpointKey?: string;
  readonly narratorKey?: string;
  readonly participantKeys?: readonly string[];
  readonly speakerKey?: string;
  readonly addresseeKey?: string;
}

interface StyleReference {
  readonly ownerType?: string;
  readonly ownerKey?: string;
}

export interface PreReadCoverageInput {
  readonly entities: readonly EntityReference[];
  readonly glossary: readonly GlossaryReference[];
  readonly knownReferenceKeys?: readonly string[];
  readonly facts: readonly FactReference[];
  readonly events: readonly EventReference[];
  readonly frames: readonly FrameReference[];
  readonly styleDecisions?: readonly StyleReference[];
}

export interface PreReadCoverageAudit {
  readonly referencedKeys: readonly string[];
  readonly resolvableKeys: readonly string[];
  readonly genericKeys: readonly string[];
  readonly unresolvedKeys: readonly string[];
  readonly issues: readonly string[];
}

export interface PreReadCoveragePatch {
  readonly addedEntities: readonly EntityReference[];
  readonly addedGlossary: readonly GlossaryReference[];
  readonly keyRewrites: readonly { readonly from: string; readonly to: string }[];
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const add = (set: Set<string>, value: unknown) => {
  const key = clean(value);
  if (key) set.add(key);
};

const GENERIC_REFERENCE_KEYS = new Set([
  // 代词与疑问词（第一、二、三人称）
  '私', 'わたし', 'わたくし', '僕', 'ぼく', '俺', 'おれ', '自分',
  '貴様', 'お前', '君', 'きみ', 'あなた', 'あんた', 'あいつ', 'やつ', '奴', '此奴',
  '彼', '彼女', '彼ら', '彼女ら', '誰', '誰か', '何者', '何者か', '何', 'これ', 'それ', 'あれ',
  // 泛称人物、群体与群众
  '敵', '敵兵', '敵軍', '味方', '友軍', '兵士', '将兵', '兵隊', '新兵', '古参兵', '老兵',
  '人', '人々', '人間', '人物', '相手', '仲間', '一同', '全員', '皆',
  '男', '女', '男性', '女性', '少女', '少年', '青年', '老人', '子供', '大人',
  '部下', '上官', '同僚', '隊員', '乗員', '市民', '住民', '民間人', '群衆', '部隊', '軍隊',
  // 通用军衔、职能与战斗编制（非特定人物）
  '中隊長', '小隊長', '大隊長', '連隊長', '師団長', '司令官', '指揮官', '士官', '将校',
  '大佐', '中佐', '少佐', '大尉', '中尉', '少尉', '准尉', '曹長', '軍曹', '伍長', '兵長',
  '上等兵', '一等兵', '二等兵', '下士官', '通信士官', '先任士官', '観測班', '歩兵', '砲兵', '騎兵', '工兵',
]);

/** Unnamed generic references belong in prose, not in the persistent terminology graph. */
export const isGenericPreReadReference = (value: unknown): boolean => GENERIC_REFERENCE_KEYS.has(clean(value));

const rewriteKnowledge = (knowledge: Readonly<Record<string, unknown>> | undefined, rewrites: ReadonlyMap<string, string>) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(knowledge ?? {})) {
    const rewritten = rewrites.has(key) ? clean(rewrites.get(key)) : key;
    if (rewritten) output[rewritten] = value;
  }
  return output;
};

/** Applies a compact chapter-level repair without asking the model to repeat the whole chapter JSON. */
export const applyPreReadCoveragePatch = <T extends PreReadCoverageInput>(result: T, patch: PreReadCoveragePatch): T => {
  const rewrites = new Map<string, string>();
  for (const row of patch.keyRewrites) {
    const from = clean(row.from);
    if (from) rewrites.set(from, clean(row.to));
  }
  const rewrite = (value: unknown) => {
    const key = clean(value);
    return rewrites.has(key) ? clean(rewrites.get(key)) : key;
  };
  return {
    ...result,
    entities: [...result.entities, ...patch.addedEntities],
    glossary: [...result.glossary, ...patch.addedGlossary],
    facts: result.facts.map((fact) => ({
      ...fact,
      subjectKey: rewrite(fact.subjectKey),
      objectKey: rewrite(fact.objectKey),
      characterKnowledge: rewriteKnowledge(fact.characterKnowledge, rewrites),
    })),
    events: result.events.map((event) => ({
      ...event,
      agentKey: rewrite(event.agentKey),
      patientKey: rewrite(event.patientKey),
      recipientKey: rewrite(event.recipientKey),
      characterKnowledge: rewriteKnowledge(event.characterKnowledge, rewrites),
    })),
    frames: result.frames.map((frame) => ({
      ...frame,
      locationKey: rewrite(frame.locationKey),
      viewpointKey: rewrite(frame.viewpointKey),
      narratorKey: rewrite(frame.narratorKey),
      speakerKey: rewrite(frame.speakerKey),
      addresseeKey: rewrite(frame.addresseeKey),
      participantKeys: [...new Set((frame.participantKeys ?? []).map(rewrite).filter(Boolean))],
    })),
    styleDecisions: result.styleDecisions?.map((decision) => ({
      ...decision,
      ownerKey: rewrite(decision.ownerKey),
    })),
  } as T;
};

export const clearGenericPreReadReferences = <T extends PreReadCoverageInput>(result: T): T => {
  const genericKeys = auditPreReadEntityCoverage(result).genericKeys;
  return genericKeys.length
    ? applyPreReadCoveragePatch(result, {
        addedEntities: [], addedGlossary: [],
        keyRewrites: genericKeys.map((from) => ({ from, to: '' })),
      })
    : result;
};

/**
 * Every non-empty semantic key is a persistent entity reference, not an arbitrary
 * English slug or a prose description. Keeping this check outside the model prompt
 * prevents an apparently successful pre-read from silently degrading A→B roles.
 */
export const auditPreReadEntityCoverage = (result: PreReadCoverageInput): PreReadCoverageAudit => {
  const resolvable = new Set<string>();
  for (const key of result.knownReferenceKeys ?? []) {
    if (!isGenericPreReadReference(key)) add(resolvable, key);
  }
  for (const entity of result.entities) {
    const hasIdentity = clean(entity.translatedName) && (entity.evidence ?? []).some((evidence) => clean(evidence.excerpt));
    if (hasIdentity) {
      if (!isGenericPreReadReference(entity.sourceName)) add(resolvable, entity.sourceName);
      if (!isGenericPreReadReference(entity.canonicalSourceName)) add(resolvable, entity.canonicalSourceName);
    }
    for (const alias of entity.aliases ?? []) {
      if (clean(alias.translatedForm) && clean(alias.evidenceExcerpt) && !isGenericPreReadReference(alias.sourceForm)) add(resolvable, alias.sourceForm);
    }
  }
  for (const glossary of result.glossary) {
    if (!isGenericPreReadReference(glossary.sourceTerm)) add(resolvable, glossary.sourceTerm);
  }

  const referenced = new Set<string>();
  for (const fact of result.facts) {
    add(referenced, fact.subjectKey);
    add(referenced, fact.objectKey);
    for (const key of Object.keys(fact.characterKnowledge ?? {})) add(referenced, key);
  }
  for (const event of result.events) {
    add(referenced, event.agentKey);
    add(referenced, event.patientKey);
    add(referenced, event.recipientKey);
    for (const key of Object.keys(event.characterKnowledge ?? {})) add(referenced, key);
  }
  for (const frame of result.frames) {
    add(referenced, frame.locationKey);
    add(referenced, frame.viewpointKey);
    add(referenced, frame.narratorKey);
    add(referenced, frame.speakerKey);
    add(referenced, frame.addresseeKey);
    for (const key of frame.participantKeys ?? []) add(referenced, key);
  }
  for (const decision of result.styleDecisions ?? []) {
    if (decision.ownerType === 'character' || decision.ownerType === 'narrator') add(referenced, decision.ownerKey);
  }

  const genericKeys = [...referenced].filter(isGenericPreReadReference).sort((a, b) => a.localeCompare(b, 'ja'));
  // Unresolved keys MUST NOT include generic keys (such as pronouns or common ranks), which belong in prose narration!
  const unresolved = [...referenced].filter((key) => !resolvable.has(key) && !isGenericPreReadReference(key)).sort((a, b) => a.localeCompare(b, 'ja'));
  return {
    referencedKeys: [...referenced].sort((a, b) => a.localeCompare(b, 'ja')),
    resolvableKeys: [...resolvable].sort((a, b) => a.localeCompare(b, 'ja')),
    genericKeys,
    unresolvedKeys: unresolved,
    issues: unresolved.map((key) => `引用键“${key}”没有对应的 entities 规范名/别名或 glossary 词条。`),
  };
};

export const terminologyEntryCount = (result: Pick<PreReadCoverageInput, 'entities' | 'glossary'>): number => {
  const terms = new Set<string>();
  for (const entity of result.entities) {
    const term = entity.sourceName || entity.canonicalSourceName;
    if (!isGenericPreReadReference(term)) add(terms, term);
  }
  for (const glossary of result.glossary) {
    if (!isGenericPreReadReference(glossary.sourceTerm)) add(terms, glossary.sourceTerm);
  }
  return terms.size;
};
