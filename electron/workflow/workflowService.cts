import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProviderProfile } from '../providers/models.cjs';
import { ProviderAdapter, ProviderRequestError } from '../providers/providerAdapter.cjs';
import type { ProviderSettingsStore } from '../providers/providerSettings.cjs';
import type { ClaimedTaskItem, StartWorkflowInput, TranslationSegmentRecord, WorkflowLogEntry, WorkflowTaskSummary } from './models.cjs';
import {
  polishingSystemPrompt,
  preReadEntityRepairSystemPrompt,
  preReadReviewSystemPrompt,
  preReadSystemPrompt,
  reviewSystemPrompt,
  semanticRoleSystemPrompt,
  translationSystemPrompt,
} from './prompts.cjs';
import { validateTranslationCandidate } from './translationValidation.cjs';
import { WorkflowRepository } from './workflowRepository.cjs';
import { buildFormalEpub, type FormalExportMode } from './formalEpubExport.cjs';
import type { SegmentSemanticRoles } from './narrativeModels.cjs';
import { acceptedModelPolicy, memoryPolicyFor } from './memoryPolicy.cjs';
import { adjudicateSemanticRoles } from './japaneseSyntaxEvidence.cjs';
import {
  applyPreReadCoveragePatch,
  auditPreReadEntityCoverage,
  clearGenericPreReadReferences,
  isGenericPreReadReference,
  terminologyEntryCount,
} from './preReadCoverage.cjs';
import { canSplitTruncatedPreReadPiece, decidePreReadRecovery, summarizePreReadCheckpoint } from './preReadRecovery.cjs';

const MAX_PREREAD_CHARS = 1_800;
const PREREAD_OVERLAP_CHARS = 150;
const MIN_ADAPTIVE_PREREAD_CHARS = 240;
const REQUEST_HEARTBEAT_MS = 30_000;

interface RequestTrace {
  readonly stage: WorkflowLogEntry['stage'];
  readonly label: string;
  readonly sourceChars?: number;
}

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分${seconds.toString().padStart(2, '0')}秒`;
};
const allowedEntityKinds = new Set(['character', 'animal', 'place', 'organization', 'item', 'ability', 'concept', 'other']);
const allowedGenders = new Set(['unknown', 'male', 'female', 'nonbinary', 'not-applicable']);
const allowedNumbers = new Set(['unknown', 'singular', 'plural', 'collective', 'not-applicable']);
const allowedFactKinds = new Set(['character', 'event', 'relationship', 'address', 'voice', 'viewpoint', 'setting', 'secret', 'foreshadowing', 'pun', 'scene-summary', 'chapter-summary']);
const allowedAliasKinds = new Set(['canonical', 'family-name', 'given-name', 'title', 'nickname', 'codename', 'old-name', 'misnomer', 'other']);
const allowedAttributePredicates = new Set(['gender', 'number', 'age', 'appearance', 'occupation', 'affiliation', 'injury', 'identity', 'other']);
const allowedDirectionStatus = new Set(['verified', 'ambiguous', 'unresolved']);
const allowedVoices = new Set(['active', 'passive', 'causative', 'causative-passive', 'giving-receiving', 'state', 'ambiguous']);
const allowedFrameKinds = new Set(['main', 'flashback', 'flashforward', 'dream', 'hypothetical', 'fiction-within-fiction', 'unreliable', 'unknown']);
const allowedMemoryClasses = new Set(['canon', 'character', 'relationship', 'event', 'state', 'episode-detail']);
const allowedMemoryScopes = new Set(['series', 'volume', 'chapter', 'scene']);
const allowedOwnerTypes = new Set(['series', 'narrator', 'character', 'relationship', 'scene']);
const allowedStyleKinds = new Set(['register', 'pronoun', 'address', 'syntax', 'rhythm', 'punctuation', 'dialect', 'catchphrase', 'profanity', 'ambiguity-policy']);
const allowedDiscourseModes = new Set(['narration', 'direct-quote', 'indirect-quote', 'free-indirect', 'monologue', 'unknown']);
const allowedAmbiguityKinds = new Set(['pun', 'identity', 'referent', 'scope', 'role', 'voice', 'temporal', 'narrative', 'other']);
const allowedPreservationStrategies = new Set(['preserve', 'resolve', 'transliterate', 'annotate', 'review']);

const asRecord = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const asArray = (value: unknown) => Array.isArray(value) ? value : [];
const clippedConfidence = (value: unknown) => Math.max(0, Math.min(1, typeof value === 'number' && Number.isFinite(value) ? value : 0));
const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const segmentValue = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.floor(number) : null;
};
const offsetValue = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.floor(number) : null;
};

const parseJson = (text: string) => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  try { return JSON.parse(trimmed) as unknown; }
  catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
      } catch { /* try next */ }
    }
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as unknown;
      } catch { /* try next */ }
    }
    throw new Error('模型没有返回可解析的 JSON 结构。');
  }
};

const BOILERPLATE_TERMS = new Set([
  '目次', 'CONTENTS', 'contents', 'Contents', '前書き', 'まえがき', 'あとがき', '後書き',
  '奥付', '電子版', '電子書籍', '扉', 'カバー', '口絵', '挿絵', 'イラスト', '付録',
  '第1章', '第2章', '第3章', '第4章', '第5章', '第6章', '第7章', '第8章', '第9章', '第10章',
  '第壱章', '第弐章', '第参章', '第肆章', '第伍章', '第陸章', '第漆章', '第捌章', '第玖章', '第拾章',
  'プロローグ', 'エピローグ', '終章', '序章', '間章', '幕間', 'モノローグ',
  'イメージ画像', '注釈', '発行', '株式会社', '版権', '著作权', '著作権',
  'ダウンロード', '端末', 'ビューア', 'フォント', '明朝', 'ゴシック',
  'ルビ', '底本', '初出', '禁無断転載', '電子版特典',
  '文庫', '新書', '単行本',
  'こと', 'もの', 'とき', 'ため', 'よう', 'ほう', 'どこ', 'だれ', 'なに', 'これ', 'それ', 'あれ',
]);

export const isTrivialOrBoilerplateTerm = (term: string): boolean => {
  const clean = term.trim();
  if (!clean || clean.length < 2) return true;
  if (isGenericPreReadReference(clean)) return true;
  if (BOILERPLATE_TERMS.has(clean)) return true;
  if (/^(本電子書籍|電子書籍|リーディングシステム|縦書き|横書き|サムネイル|注釈|目次|奥付|表紙|ページ|イラスト|カバー)/u.test(clean)) return true;
  if (/^[0-9０-９一二三四五六七八九十百千万]+$/u.test(clean)) return true;
  return false;
};

export const condensePieceSummaries = (pieceSummaries: readonly string[]): string => {
  const seenSentences = new Set<string>();
  const sentences: string[] = [];
  for (const piece of pieceSummaries) {
    const cleaned = String(piece ?? '').trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/(?<=[。！？\n])/u).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (!seenSentences.has(part) && part.length >= 2) {
        seenSentences.add(part);
        sentences.push(part);
      }
    }
  }
  return sentences.join('');
};

const normalizePreRead = (value: unknown, fallbackChapter: number) => {
  const root = asRecord(value);
  if (!root) throw new Error('预读结果不是 JSON 对象。');
  const entities = asArray(root.entities).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({
    sourceName: stringValue(item.sourceName), canonicalSourceName: stringValue(item.canonicalSourceName) || stringValue(item.sourceName),
    translatedName: stringValue(item.translatedName), reading: stringValue(item.reading),
    kind: allowedEntityKinds.has(String(item.kind)) ? String(item.kind) : 'other',
    gender: allowedGenders.has(String(item.gender)) ? String(item.gender) : 'unknown',
    number: allowedNumbers.has(String(item.number)) ? String(item.number) : 'unknown',
    confidence: clippedConfidence(item.confidence), notes: stringValue(item.notes),
    evidence: asArray(item.evidence).map(asRecord).filter((evidence): evidence is Record<string, unknown> => Boolean(evidence)).map((evidence) => ({
      excerpt: stringValue(evidence.excerpt), kind: stringValue(evidence.kind) || 'occurrence',
    })).filter((evidence) => evidence.excerpt),
    aliases: asArray(item.aliases).map(asRecord).filter((alias): alias is Record<string, unknown> => Boolean(alias)).map((alias) => ({
      sourceForm: stringValue(alias.sourceForm), translatedForm: stringValue(alias.translatedForm),
      aliasKind: allowedAliasKinds.has(String(alias.aliasKind)) ? String(alias.aliasKind) as 'canonical' : 'other' as const,
      validFromChapter: Math.max(1, Math.floor(Number(alias.validFromChapter) || fallbackChapter)),
      validFromSegment: segmentValue(alias.validFromSegment),
      validFromOffset: offsetValue(alias.validFromOffset),
      validToChapter: alias.validToChapter === null || alias.validToChapter === undefined ? null : Math.max(1, Math.floor(Number(alias.validToChapter) || fallbackChapter)),
      validToSegment: segmentValue(alias.validToSegment),
      validToOffset: offsetValue(alias.validToOffset),
      readerVisibleFrom: Math.max(1, Math.floor(Number(alias.readerVisibleFrom) || Number(alias.validFromChapter) || fallbackChapter)),
      readerVisibleFromSegment: segmentValue(alias.readerVisibleFromSegment),
      readerVisibleFromOffset: offsetValue(alias.readerVisibleFromOffset),
      evidenceExcerpt: stringValue(alias.evidenceExcerpt), evidenceSegment: segmentValue(alias.evidenceSegment),
      evidenceStartOffset: offsetValue(alias.evidenceStartOffset), confidence: clippedConfidence(alias.confidence),
    })).filter((alias) => alias.sourceForm && alias.translatedForm && alias.evidenceExcerpt),
    attributes: asArray(item.attributes).map(asRecord).filter((attribute): attribute is Record<string, unknown> => Boolean(attribute)).map((attribute) => ({
      predicate: allowedAttributePredicates.has(String(attribute.predicate)) ? String(attribute.predicate) as 'other' : 'other' as const,
      value: attribute.value ?? '',
      worldlineKey: stringValue(attribute.worldlineKey) || 'main', sceneKey: stringValue(attribute.sceneKey),
      validFromChapter: Math.max(1, Math.floor(Number(attribute.validFromChapter) || fallbackChapter)),
      validFromSegment: segmentValue(attribute.validFromSegment),
      validFromOffset: offsetValue(attribute.validFromOffset),
      validToChapter: attribute.validToChapter === null || attribute.validToChapter === undefined ? null : Math.max(1, Math.floor(Number(attribute.validToChapter) || fallbackChapter)),
      validToSegment: segmentValue(attribute.validToSegment),
      validToOffset: offsetValue(attribute.validToOffset),
      readerVisibleFrom: Math.max(1, Math.floor(Number(attribute.readerVisibleFrom) || fallbackChapter)),
      readerVisibleFromSegment: segmentValue(attribute.readerVisibleFromSegment),
      readerVisibleFromOffset: offsetValue(attribute.readerVisibleFromOffset),
      evidenceExcerpt: stringValue(attribute.evidenceExcerpt), evidenceSegment: segmentValue(attribute.evidenceSegment),
      evidenceStartOffset: offsetValue(attribute.evidenceStartOffset), confidence: clippedConfidence(attribute.confidence),
    })).filter((attribute) => attribute.evidenceExcerpt),
  })).filter((item) => item.sourceName && item.translatedName && !isTrivialOrBoilerplateTerm(item.sourceName));
  const glossary = asArray(root.glossary).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({
    sourceTerm: stringValue(item.sourceTerm), translatedTerm: stringValue(item.translatedTerm), reading: stringValue(item.reading),
    kind: allowedEntityKinds.has(String(item.kind)) ? String(item.kind) : 'other',
    gender: allowedGenders.has(String(item.gender)) ? String(item.gender) : 'unknown',
    number: allowedNumbers.has(String(item.number)) ? String(item.number) : 'unknown',
    sense: stringValue(item.sense), confidence: clippedConfidence(item.confidence), notes: stringValue(item.notes),
    evidenceExcerpt: stringValue(item.evidenceExcerpt),
  })).filter((item) => item.sourceTerm && item.translatedTerm && item.sense && item.evidenceExcerpt && !isTrivialOrBoilerplateTerm(item.sourceTerm));
  const facts = asArray(root.facts).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => {
    const kind = allowedFactKinds.has(String(item.kind)) ? String(item.kind) : 'event';
    const predicate = stringValue(item.predicate) || stringValue(item.kind) || 'event';
    const statement = stringValue(item.statement);
    const confidence = clippedConfidence(item.confidence);
    const policy = acceptedModelPolicy(memoryPolicyFor(kind, predicate, statement, confidence),
      allowedMemoryClasses.has(String(item.memoryClass)) ? String(item.memoryClass) : null,
      item.importance, allowedMemoryScopes.has(String(item.retrievalScope)) ? String(item.retrievalScope) : null);
    return {
      kind, predicate, subjectKey: stringValue(item.subjectKey), objectKey: stringValue(item.objectKey),
      worldlineKey: stringValue(item.worldlineKey) || 'main', sceneKey: stringValue(item.sceneKey),
      value: item.value ?? { statement }, statement,
      chapterStart: Math.max(1, Math.floor(Number(item.chapterStart) || fallbackChapter)),
      chapterStartSegment: segmentValue(item.chapterStartSegment), chapterStartOffset: offsetValue(item.chapterStartOffset),
      chapterEnd: item.chapterEnd === null || item.chapterEnd === undefined ? null : Math.max(1, Math.floor(Number(item.chapterEnd) || fallbackChapter)),
      chapterEndSegment: segmentValue(item.chapterEndSegment), chapterEndOffset: offsetValue(item.chapterEndOffset),
      readerVisibleFrom: Math.max(1, Math.floor(Number(item.readerVisibleFrom) || fallbackChapter)),
      readerVisibleFromSegment: segmentValue(item.readerVisibleFromSegment), readerVisibleFromOffset: offsetValue(item.readerVisibleFromOffset),
      characterKnowledge: asRecord(item.characterKnowledge) ?? {}, evidenceExcerpt: stringValue(item.evidenceExcerpt),
      evidenceSegment: segmentValue(item.evidenceSegment), evidenceStartOffset: offsetValue(item.evidenceStartOffset),
      memoryClass: policy.memoryClass, importance: policy.importance, retrievalScope: policy.retrievalScope, confidence,
    };
  }).filter((item) => item.statement && item.evidenceExcerpt);
  const events = asArray(root.events).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => {
    const eventType = stringValue(item.eventType) || 'plot-event';
    const predicate = stringValue(item.predicate) || eventType || 'event';
    const statement = stringValue(item.statement);
    const confidence = clippedConfidence(item.confidence);
    const policy = acceptedModelPolicy(memoryPolicyFor('event', predicate, statement, confidence),
      allowedMemoryClasses.has(String(item.memoryClass)) ? String(item.memoryClass) : null,
      item.importance, allowedMemoryScopes.has(String(item.retrievalScope)) ? String(item.retrievalScope) : null);
    return {
      eventType, predicate, agentKey: stringValue(item.agentKey), patientKey: stringValue(item.patientKey),
      recipientKey: stringValue(item.recipientKey), worldlineKey: stringValue(item.worldlineKey) || 'main',
      sceneKey: stringValue(item.sceneKey), statement,
      directionStatus: allowedDirectionStatus.has(String(item.directionStatus)) ? String(item.directionStatus) as 'verified' : 'unresolved' as const,
      chapterStart: Math.max(1, Math.floor(Number(item.chapterStart) || fallbackChapter)),
      chapterStartSegment: segmentValue(item.chapterStartSegment), chapterStartOffset: offsetValue(item.chapterStartOffset),
      chapterEnd: item.chapterEnd === null || item.chapterEnd === undefined ? null : Math.max(1, Math.floor(Number(item.chapterEnd) || fallbackChapter)),
      chapterEndSegment: segmentValue(item.chapterEndSegment), chapterEndOffset: offsetValue(item.chapterEndOffset),
      readerVisibleFrom: Math.max(1, Math.floor(Number(item.readerVisibleFrom) || fallbackChapter)),
      readerVisibleFromSegment: segmentValue(item.readerVisibleFromSegment), readerVisibleFromOffset: offsetValue(item.readerVisibleFromOffset),
      characterKnowledge: asRecord(item.characterKnowledge) ?? {}, evidenceExcerpt: stringValue(item.evidenceExcerpt),
      evidenceSegment: segmentValue(item.evidenceSegment), evidenceStartOffset: offsetValue(item.evidenceStartOffset),
      memoryClass: policy.memoryClass, importance: policy.importance, retrievalScope: policy.retrievalScope, confidence,
    };
  }).filter((item) => item.statement && item.evidenceExcerpt);
  const frames = asArray(root.frames).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({
    frameKey: stringValue(item.frameKey) || `${stringValue(item.sceneKey) || 'scene'}:${segmentValue(item.validFromSegment) ?? 1}`,
    parentFrameKey: stringValue(item.parentFrameKey),
    frameKind: allowedFrameKinds.has(String(item.frameKind)) ? String(item.frameKind) as 'main' : 'unknown' as const,
    worldlineKey: stringValue(item.worldlineKey) || 'main', storyTimeKey: stringValue(item.storyTimeKey) || 'unknown',
    sceneKey: stringValue(item.sceneKey), locationKey: stringValue(item.locationKey),
    viewpointKey: stringValue(item.viewpointKey), narratorKey: stringValue(item.narratorKey),
    participantKeys: asArray(item.participantKeys).map(stringValue).filter(Boolean),
    nestingDepth: Math.max(0, Math.floor(Number(item.nestingDepth) || 0)),
    discourseMode: allowedDiscourseModes.has(String(item.discourseMode)) ? String(item.discourseMode) as 'narration' : 'unknown' as const,
    quoteLevel: Math.max(0, Math.floor(Number(item.quoteLevel) || 0)),
    speakerKey: stringValue(item.speakerKey), addresseeKey: stringValue(item.addresseeKey),
    validFromChapter: Math.max(1, Math.floor(Number(item.validFromChapter) || fallbackChapter)),
    validFromSegment: segmentValue(item.validFromSegment) ?? segmentValue(item.evidenceSegment) ?? 1,
    validFromOffset: offsetValue(item.validFromOffset),
    validToChapter: item.validToChapter === null || item.validToChapter === undefined ? null : Math.max(1, Math.floor(Number(item.validToChapter) || fallbackChapter)),
    validToSegment: segmentValue(item.validToSegment), validToOffset: offsetValue(item.validToOffset), evidenceExcerpt: stringValue(item.evidenceExcerpt),
    evidenceSegment: segmentValue(item.evidenceSegment) ?? segmentValue(item.validFromSegment) ?? 1,
    evidenceStartOffset: offsetValue(item.evidenceStartOffset),
    confidence: clippedConfidence(item.confidence),
  })).filter((item) => item.sceneKey && item.evidenceExcerpt);
  const styleDecisions = asArray(root.styleDecisions).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({
    ownerType: allowedOwnerTypes.has(String(item.ownerType)) ? String(item.ownerType) as 'character' : 'scene' as const,
    ownerKey: stringValue(item.ownerKey),
    decisionKind: allowedStyleKinds.has(String(item.decisionKind)) ? String(item.decisionKind) as 'register' : 'syntax' as const,
    sourcePattern: stringValue(item.sourcePattern), targetStrategy: stringValue(item.targetStrategy),
    rationale: stringValue(item.rationale),
    validFromChapter: Math.max(1, Math.floor(Number(item.validFromChapter) || fallbackChapter)),
    validFromSegment: segmentValue(item.validFromSegment), validFromOffset: offsetValue(item.validFromOffset),
    validToChapter: item.validToChapter === null || item.validToChapter === undefined ? null : Math.max(1, Math.floor(Number(item.validToChapter) || fallbackChapter)),
    validToSegment: segmentValue(item.validToSegment), validToOffset: offsetValue(item.validToOffset),
    evidenceExcerpt: stringValue(item.evidenceExcerpt), evidenceSegment: segmentValue(item.evidenceSegment),
    evidenceStartOffset: offsetValue(item.evidenceStartOffset), confidence: clippedConfidence(item.confidence),
  })).filter((item) => item.ownerKey && item.sourcePattern && item.targetStrategy && item.evidenceExcerpt);
  const ambiguities = asArray(root.ambiguities).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({
    ambiguityKind: allowedAmbiguityKinds.has(String(item.ambiguityKind)) ? String(item.ambiguityKind) as 'other' : 'other' as const,
    sourceExcerpt: stringValue(item.sourceExcerpt), interpretations: asArray(item.interpretations).map(stringValue).filter(Boolean),
    preservationStrategy: allowedPreservationStrategies.has(String(item.preservationStrategy)) ? String(item.preservationStrategy) as 'review' : 'review' as const,
    revealChapter: item.revealChapter === null || item.revealChapter === undefined ? null : Math.max(1, Math.floor(Number(item.revealChapter) || fallbackChapter)),
    revealSegment: segmentValue(item.revealSegment), revealOffset: offsetValue(item.revealOffset),
    evidenceSegment: segmentValue(item.evidenceSegment) ?? 1, evidenceStartOffset: offsetValue(item.evidenceStartOffset),
    confidence: clippedConfidence(item.confidence),
  })).filter((item) => item.sourceExcerpt && item.interpretations.length >= 2);
  return { chapterSummary: stringValue(root.chapterSummary), entities, glossary, facts, events, frames, styleDecisions, ambiguities };
};

const splitMaterial = (material: string, maxChars = MAX_PREREAD_CHARS, overlap = PREREAD_OVERLAP_CHARS) => {
  if (material.length <= maxChars) return [material];
  const parts: string[] = [];
  let start = 0;
  while (start < material.length) {
    let end = Math.min(material.length, start + maxChars);
    if (end < material.length) {
      const boundaryDouble = material.lastIndexOf('\n\n', end);
      const boundarySingle = material.lastIndexOf('\n', end);
      const boundary = boundaryDouble > start + maxChars * 0.4 ? boundaryDouble : boundarySingle > start + maxChars * 0.4 ? boundarySingle : end;
      end = boundary;
    }
    const chunk = material.slice(start, end).trim();
    if (chunk) parts.push(chunk);
    if (end >= material.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return parts.length ? parts : [material];
};

const mergePreReadPieces = (
  pieceA: ReturnType<typeof normalizePreRead>,
  pieceB: ReturnType<typeof normalizePreRead>,
) => ({
  chapterSummary: [pieceA.chapterSummary, pieceB.chapterSummary].filter(Boolean).join('\n'),
  entities: [...pieceA.entities, ...pieceB.entities],
  glossary: [...pieceA.glossary, ...pieceB.glossary],
  facts: [...pieceA.facts, ...pieceB.facts],
  events: [...pieceA.events, ...pieceB.events],
  frames: [...pieceA.frames, ...pieceB.frames],
  styleDecisions: [...pieceA.styleDecisions, ...pieceB.styleDecisions],
  ambiguities: [...pieceA.ambiguities, ...pieceB.ambiguities],
});

interface PreReadCheckpoint {
  readonly version: 1;
  readonly pieceCount: number;
  readonly nextPieceIndex: number;
  readonly aggregate: ReturnType<typeof normalizePreRead>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly revisedPiece: boolean;
  readonly adaptiveCharLimit: number;
}

const restorePreReadCheckpoint = (value: unknown, chapterOrdinal: number, pieceCount: number): PreReadCheckpoint | null => {
  const root = asRecord(value);
  if (!root || root.version !== 1 || Number(root.pieceCount) !== pieceCount) return null;
  const nextPieceIndex = Math.floor(Number(root.nextPieceIndex));
  if (!Number.isInteger(nextPieceIndex) || nextPieceIndex < 0 || nextPieceIndex > pieceCount) return null;
  try {
    return {
      version: 1,
      pieceCount,
      nextPieceIndex,
      aggregate: normalizePreRead(root.aggregate, chapterOrdinal),
      inputTokens: Math.max(0, Math.floor(Number(root.inputTokens) || 0)),
      outputTokens: Math.max(0, Math.floor(Number(root.outputTokens) || 0)),
      revisedPiece: Boolean(root.revisedPiece),
      adaptiveCharLimit: Math.max(
        MIN_ADAPTIVE_PREREAD_CHARS,
        Math.min(MAX_PREREAD_CHARS, Math.floor(Number(root.adaptiveCharLimit) || MAX_PREREAD_CHARS)),
      ),
    };
  } catch {
    return null;
  }
};

const translationMap = (text: string, expectedIds: readonly string[]) => {
  const root = asRecord(parseJson(text));
  const rows = asArray(root?.translations).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const result = new Map(rows.map((item) => [stringValue(item.id), stringValue(item.translation)]));
  if (result.size !== expectedIds.length || expectedIds.some((id) => !result.has(id))) throw new Error('模型返回的段落 ID 不完整或发生错位。');
  return result;
};

interface ReviewDecision { id: string; verdict: 'pass' | 'revise' | 'must-human'; confidence: number; issues: string[]; revisedTranslation: string; }
const reviewMap = (text: string, expectedIds: readonly string[]) => {
  const root = asRecord(parseJson(text));
  const decisions = asArray(root?.reviews).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item): ReviewDecision => ({
    id: stringValue(item.id),
    verdict: ['pass', 'revise', 'must-human'].includes(String(item.verdict)) ? String(item.verdict) as ReviewDecision['verdict'] : 'must-human',
    confidence: clippedConfidence(item.confidence),
    issues: asArray(item.issues).map(stringValue).filter(Boolean),
    revisedTranslation: stringValue(item.revisedTranslation),
  }));
  const result = new Map(decisions.map((item) => [item.id, item]));
  if (result.size !== expectedIds.length || expectedIds.some((id) => !result.has(id))) throw new Error('复核模型返回的段落 ID 不完整或发生错位。');
  return result;
};

const translationInput = (segments: readonly TranslationSegmentRecord[]) => JSON.stringify(segments.map((segment) => ({
  id: segment.segmentId,
  jp: segment.sourceText,
  existingCn: segment.originalTranslation,
  mode: segment.originalTranslation ? 'polish-existing-translation' : 'translate-from-japanese',
})), null, 2);

const semanticRoleMap = (text: string, segments: readonly TranslationSegmentRecord[]): readonly SegmentSemanticRoles[] => {
  const root = asRecord(parseJson(text));
  const sourceById = new Map(segments.map((segment) => [segment.segmentId, segment.sourceText]));
  const rows = asArray(root?.segments).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const mapped = rows.map((item): SegmentSemanticRoles => {
    const id = stringValue(item.id);
    const source = sourceById.get(id) ?? '';
    const propositions = asArray(item.propositions).map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row)).map((row) => {
      const sourceCue = stringValue(row.sourceCue);
      const requestedOffset = offsetValue(row.sourceStartOffset);
      const firstOffset = sourceCue ? source.indexOf(sourceCue) : -1;
      const repeated = firstOffset >= 0 && source.indexOf(sourceCue, firstOffset + Math.max(1, sourceCue.length)) >= 0;
      const sourceStartOffset = requestedOffset !== null && source.slice(requestedOffset, requestedOffset + sourceCue.length) === sourceCue
        ? requestedOffset : repeated ? null : firstOffset >= 0 ? firstOffset : null;
      const evidenceValid = Boolean(sourceCue && sourceStartOffset !== null);
      return {
        predicate: stringValue(row.predicate),
        agent: evidenceValid ? stringValue(row.agent) : '',
        patient: evidenceValid ? stringValue(row.patient) : '',
        recipient: evidenceValid ? stringValue(row.recipient) : '',
        speaker: evidenceValid ? stringValue(row.speaker) : '',
        addressee: evidenceValid ? stringValue(row.addressee) : '',
        speechAct: evidenceValid ? stringValue(row.speechAct) : '',
        sourceCue,
        sourceStartOffset,
        sourceEndOffset: sourceStartOffset === null ? null : sourceStartOffset + sourceCue.length,
        voice: allowedVoices.has(String(row.voice)) ? String(row.voice) as 'active' : 'ambiguous' as const,
        confidence: evidenceValid ? clippedConfidence(row.confidence) : 0,
        ambiguity: evidenceValid ? stringValue(row.ambiguity) : 'sourceCue 不能在本段原文中逐字定位，方向证据已降为未决。',
      };
    }).filter((row) => row.predicate && row.sourceCue);
    return { id, propositions };
  });
  const byId = new Map(mapped.map((item) => [item.id, item]));
  if (segments.some((segment) => !byId.has(segment.segmentId))) throw new Error('语义角色分析没有返回全部段落 ID。');
  return segments.map((segment) => byId.get(segment.segmentId)!);
};

const tokenValue = (value: number | null) => value ?? 0;
const systemWithCustomInstructions = (base: string, profile: ProviderProfile) => profile.customInstructions.trim()
  ? `${base}\n\n【用户补充指令——不得覆盖上述忠实边界】\n${profile.customInstructions.trim()}`
  : base;

export class WorkflowService {
  readonly #repository: WorkflowRepository;
  readonly #providerSettings: ProviderSettingsStore;
  readonly #running = new Set<string>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #stopIntent = new Map<string, 'paused' | 'cancelled'>();
  readonly #logListeners = new Set<(entry: WorkflowLogEntry) => void>();
  readonly #logFilePath: string;
  #saveTimer: NodeJS.Timeout | null = null;
  #closing = false;

  constructor(databasePath: string, providerSettings: ProviderSettingsStore) {
    this.#repository = new WorkflowRepository(databasePath);
    this.#providerSettings = providerSettings;
    this.#logFilePath = path.join(path.dirname(databasePath), 'workflow-terminal-logs.json');
    try {
      if (fs.existsSync(this.#logFilePath)) {
        const raw = fs.readFileSync(this.#logFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.#recentLogs = parsed.slice(-800);
        }
      }
    } catch { /* ignore */ }
  }

  #adapter(profile: ProviderProfile, key: string) {
    return new ProviderAdapter(profile, key, {
      getKouriReasoningCapability: (model, protocol) => this.#providerSettings.getKouriReasoningCapability(profile.profileId, model, protocol),
      saveKouriReasoningCapability: (capability) => this.#providerSettings.saveKouriReasoningCapability(profile.profileId, capability),
    });
  }

  #recentLogs: WorkflowLogEntry[] = [];

  onLog(listener: (entry: WorkflowLogEntry) => void) {
    this.#logListeners.add(listener);
    return () => { this.#logListeners.delete(listener); };
  }

  getRecentLogs(): readonly WorkflowLogEntry[] {
    return this.#recentLogs;
  }

  clearLogs() {
    this.#recentLogs = [];
    try {
      if (fs.existsSync(this.#logFilePath)) fs.unlinkSync(this.#logFilePath);
    } catch { /* ignore */ }
  }

  #scheduleSaveLogs() {
    if (this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      try {
        fs.writeFileSync(this.#logFilePath, JSON.stringify(this.#recentLogs, null, 2), 'utf8');
      } catch { /* ignore */ }
    }, 500);
  }

  #emitLog(
    level: WorkflowLogEntry['level'],
    stage: WorkflowLogEntry['stage'],
    message: string,
    meta?: { details?: string | null; model?: string | null; inputTokens?: number | null; outputTokens?: number | null; elapsedMs?: number | null },
  ) {
    const entry: WorkflowLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      stage,
      message,
      details: meta?.details ?? null,
      model: meta?.model ?? null,
      inputTokens: meta?.inputTokens ?? null,
      outputTokens: meta?.outputTokens ?? null,
      elapsedMs: meta?.elapsedMs ?? null,
    };
    this.#recentLogs.push(entry);
    if (this.#recentLogs.length > 800) this.#recentLogs.shift();
    this.#scheduleSaveLogs();
    this.#logListeners.forEach((listener) => {
      try { listener(entry); } catch { /* ignore */ }
    });
  }

  close() {
    if (this.#closing) return;
    this.#closing = true;
    this.#controllers.forEach((controllers) => controllers.forEach((controller) => controller.abort()));
    this.#repository.interruptActiveTasks('软件已关闭；已保存任务与分片断点，可在下次启动后继续。');
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    try { fs.writeFileSync(this.#logFilePath, JSON.stringify(this.#recentLogs, null, 2), 'utf8'); } catch { /* ignore */ }
    this.#repository.close();
  }
  overview(projectId: string) { return this.#repository.overview(projectId); }
  workbench(projectId: string, chapterId: string, offset = 0, limit = 60) {
    this.#repository.initializeSegments(projectId);
    return this.#repository.workbench(projectId, chapterId, offset, limit);
  }
  versions(segmentId: string) { return this.#repository.versions(segmentId); }
  glossary(projectId: string) { return this.#repository.glossary(projectId); }
  memory(projectId: string) { return this.#repository.memory(projectId); }
  seriesAssignment(projectId: string) { return this.#repository.seriesAssignment(projectId); }
  listSeries() { return this.#repository.listSeries(); }
  assignSeries(projectId: string, input: Record<string, unknown>) {
    return this.#repository.assignSeries(projectId, stringValue(input.name), Number(input.volumeOrdinal),
      stringValue(input.volumeLabel), stringValue(input.description));
  }
  unassignSeries(projectId: string) { return this.#repository.unassignSeries(projectId); }
  ambiguities(projectId: string) { return this.#repository.ambiguities(projectId); }
  resolveAmbiguity(ambiguityId: string, input: Record<string, unknown>) {
    return this.#repository.resolveAmbiguity(ambiguityId,
      input.selectedInterpretation == null ? null : stringValue(input.selectedInterpretation),
      stringValue(input.preservationStrategy), stringValue(input.note), Boolean(input.lock));
  }
  reviews(projectId: string) { return this.#repository.reviews(projectId); }
  assertFinalExportReady(projectId: string) { this.#repository.assertFormalExportReady(projectId); }
  async buildFinalEpub(projectId: string, mode: FormalExportMode) { return buildFormalEpub(this.#repository.formalExportData(projectId), mode); }
  projectTitle(projectId: string) { return this.#repository.projectTitle(projectId); }

  saveManual(segmentId: string, text: string) {
    const segment = this.#repository.getSegment(segmentId);
    const normalized = text.trim();
    if (!segment) throw new Error('没有找到要编辑的段落。');
    if (!normalized) throw new Error('成稿不能为空。');
    const issues = validateTranslationCandidate(segment.sourceText, normalized);
    const status = issues.length ? 'needs-human' : 'approved';
    this.#repository.saveManualVersion(segment, normalized, status);
    if (status === 'approved') this.#repository.closeSegmentReviews(segment.segmentId, 'auto-resolved', '人工在翻译工作台保存了通过忠实门的新版本。');
    if (issues.length) this.#repository.createReviewItem(segment, 'hard-rule', 'blocking', '人工版本未通过忠实规则', issues.map((issue) => issue.message).join('；'), { source: segment.sourceText, candidate: normalized }, normalized);
    return { status, issues: issues.map((issue) => issue.message) };
  }

  restoreVersion(segmentId: string, versionId: string) {
    const segment = this.#repository.getSegment(segmentId);
    if (!segment) throw new Error('没有找到要恢复的段落。');
    const version = this.#repository.versions(segmentId).find((item) => item.versionId === versionId);
    if (!version) throw new Error('历史版本不存在。');
    const issues = validateTranslationCandidate(segment.sourceText, version.text);
    if (issues.length) throw new Error(`这个历史版本不再满足忠实规则：${issues.map((issue) => issue.message).join('；')}`);
    const restored = this.#repository.restoreVersion(segment, versionId);
    this.#repository.closeSegmentReviews(segment.segmentId, 'auto-resolved', '人工恢复了一个通过当前忠实门的历史版本。');
    return { versionId: restored };
  }

  resolveReview(reviewId: string, action: 'accept' | 'reject', text?: string) {
    const review = this.#repository.getReview(reviewId);
    if (!review || review.status !== 'open') throw new Error('复核事项不存在或已经处理。');
    if (action === 'reject') {
      this.#repository.resolveReview(reviewId, 'rejected', '人工驳回候选。');
      if (review.segment_id) this.#repository.setSegmentStatus(review.segment_id, 'failed');
      return { reviewId };
    }
    if (!review.segment_id) throw new Error('这个复核事项没有可接受的正文段落。');
    const candidate = (text ?? review.proposed_text ?? '').trim();
    if (!candidate) throw new Error('接受前需要提供完整候选译文。');
    const segment = this.#repository.getSegment(review.segment_id);
    if (!segment) throw new Error('复核事项对应的正文段落不存在。');
    const issues = validateTranslationCandidate(segment.sourceText, candidate);
    if (issues.length) throw new Error(`候选仍违反硬性忠实规则：${issues.map((issue) => issue.message).join('；')}`);
    this.#repository.saveManualVersion(segment, candidate, 'approved');
    this.#repository.resolveReview(reviewId, 'accepted', '人工核对原文与语境后接受。');
    this.#repository.closeSegmentReviews(segment.segmentId, 'superseded', '人工已经裁定同一段落的新版本。', reviewId);
    return { reviewId };
  }

  importGlossary(projectId: string, inputs: readonly Record<string, unknown>[], locked: boolean) {
    const kindMap: Readonly<Record<string, string>> = { person: 'character', character: 'character', animal: 'animal', place: 'place', organization: 'organization', event: 'concept', title: 'other', item: 'item', ability: 'ability', species: 'concept', concept: 'concept', other: 'other' };
    const records = inputs.map((input) => ({
      sourceTerm: stringValue(input.sourceTerm), translatedTerm: stringValue(input.canonicalChinese),
      kind: kindMap[String(input.category)] ?? 'other', note: stringValue(input.note), reading: stringValue(input.pronunciation),
    })).filter((record) => record.sourceTerm && record.translatedTerm);
    if (!records.length) throw new Error('没有可导入的日中术语对应。');
    return { imported: this.#repository.importGlossary(projectId, records, locked) };
  }

  updateGlossary(glossaryId: string, input: Record<string, unknown>) {
    const translatedTerm = stringValue(input.translatedTerm);
    const status = stringValue(input.status);
    const notes = stringValue(input.notes);
    const epubNote = stringValue(input.epubNote).slice(0, 2_000);
    const gender = typeof input.gender === 'string' ? input.gender : undefined;
    if (!translatedTerm) throw new Error('中文译名不能为空。');
    if (!['candidate', 'confirmed', 'locked', 'rejected'].includes(status)) throw new Error('术语状态无效。');
    this.#repository.updateGlossary(glossaryId, translatedTerm, status, notes, epubNote, gender);
    return { glossaryId };
  }

  async runGlossaryAgent(projectId: string, instruction: string) {
    const snapshot = this.#providerSettings.snapshot();
    const profile = this.#providerSettings.getProfile(snapshot.activeProfileId);
    const key = this.#providerSettings.getApiKey(snapshot.activeProfileId);
    if (!profile || !key) throw new Error('请先在“设置 → 模型与接口”保存并启用可用模型服务。');

    const entries = this.#repository.glossary(projectId);
    const compactGlossary = entries.map((e) => ({
      glossaryId: e.glossaryId,
      sourceTerm: e.sourceTerm,
      translatedTerm: e.translatedTerm,
      reading: e.reading,
      kind: e.entityKind,
      gender: e.gender,
      status: e.status,
      notes: e.notes,
    }));

    const adapter = this.#adapter(profile, key);
    const systemPrompt = `你是一个轻小说/文学作品专名术语与知识库的自动化审查与批量处理 Agent。
用户将给出自然语言修改指令，你需要分析指令并对给出的术语表条目进行精准修改、统一译名、规范性别、调整锁定状态或排除废词。

【可执行的修改动作】
1. 修改中文译名 (translatedTerm)
2. 修改/确认性别 (gender: 'male' | 'female' | 'unknown' | 'not-applicable')
3. 修改状态 (status: 'locked' | 'confirmed' | 'rejected' | 'candidate')
4. 补充备注 (notes)

只输出一个合法的 JSON 对象，格式如下：
{
  "summary": "简短向用户说明你执行了哪些修改与分析",
  "updates": [
    {
      "glossaryId": "条目的 glossaryId",
      "sourceTerm": "日文原名",
      "translatedTerm": "修改后的中文译名",
      "gender": "male|female|unknown|not-applicable",
      "status": "locked|confirmed|rejected|candidate",
      "notes": "修改理由或备注"
    }
  ]
}`;

    const startedAt = Date.now();
    const agentModel = profile.agentModel?.trim() || profile.reviewModel?.trim() || profile.model;
    const agentReasoning = profile.agentReasoningEffort || 'low';
    this.#emitLog('api', 'system', `🤖 AI 知识/审校 Agent (${agentModel} · 思考: ${agentReasoning}) 正在分析指令：“${instruction}”...`);

    const response = await adapter.request({
      model: agentModel,
      reasoningEffort: agentReasoning,
      system: systemPrompt,
      user: `【当前项目术语表（共 ${compactGlossary.length} 条）】\n${JSON.stringify(compactGlossary, null, 2)}\n\n【用户指令】\n${instruction}`,
      responseFormat: 'json',
      temperature: 0.1,
    });

    const parsed = parseJson(response.text) as { summary?: string; updates?: Array<Record<string, unknown>> };
    const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
    const summary = String(parsed?.summary ?? `已处理 ${updates.length} 项修改。`);

    let appliedCount = 0;
    for (const update of updates) {
      const id = String(update.glossaryId ?? '');
      const item = entries.find((e) => e.glossaryId === id || e.sourceTerm === String(update.sourceTerm ?? ''));
      if (item) {
        const translatedTerm = String(update.translatedTerm ?? item.translatedTerm).trim();
        const status = String(update.status ?? 'locked');
        const notes = String(update.notes ?? item.notes);
        const gender = String(update.gender ?? item.gender);
        this.#repository.updateGlossary(item.glossaryId, translatedTerm, status, notes, item.epubNote, gender);
        appliedCount += 1;
      }
    }

    const elapsed = Date.now() - startedAt;
    this.#emitLog('success', 'system', `🤖 术语审查 Agent 执行完成：${summary} (耗时: ${(elapsed / 1000).toFixed(1)}s · 修改 ${appliedCount} 条)`);

    return {
      summary,
      appliedCount,
      updates,
    };
  }

  async runDomainAgent(
    domain: 'glossary' | 'character' | 'memory' | 'workshop' | 'review',
    projectId: string,
    instruction: string,
    options?: { activeChapterId?: string; activeSegmentIds?: readonly string[] },
  ) {
    if (domain === 'glossary') {
      return this.runGlossaryAgent(projectId, instruction);
    }

    const snapshot = this.#providerSettings.snapshot();
    const profile = this.#providerSettings.getProfile(snapshot.activeProfileId);
    const key = this.#providerSettings.getApiKey(snapshot.activeProfileId);
    if (!profile || !key) throw new Error('请先在“设置 → 模型与接口”保存并启用可用模型服务。');

    const globalCtx = this.#repository.getProjectGlobalContext(projectId);
    const adapter = this.#adapter(profile, key);
    const startedAt = Date.now();
    const agentModel = profile.agentModel?.trim() || profile.reviewModel?.trim() || profile.model;
    const agentReasoning = profile.agentReasoningEffort || 'low';

    // 格式化全景上下文概要
    const globalContextSummary = `
【全书全局专名与术语概览（共 ${globalCtx.glossary.length} 条）】
${JSON.stringify(globalCtx.glossary.slice(0, 100).map((g) => ({ id: g.glossaryId, source: g.sourceTerm, cn: g.translatedTerm, kind: g.entityKind, gender: g.gender, status: g.status })), null, 2)}

【全书核心人物档案与别名】
${JSON.stringify(globalCtx.entities.slice(0, 40), null, 2)}

【长程世界线与事件记忆事实（精选前 80 条）】
${JSON.stringify(globalCtx.facts.slice(0, 80).map((f) => ({ id: f.factId, kind: f.factKind, sub: f.subjectKey, obj: f.objectKey, stmt: f.statement, ch: f.chapterStart, imp: f.importance, status: f.status })), null, 2)}

【章节大纲与篇幅】
${JSON.stringify(globalCtx.chapters, null, 2)}

【统一文风决策】
${JSON.stringify(globalCtx.styleDecisions, null, 2)}
`.trim();

    if (domain === 'character') {
      this.#emitLog('api', 'system', `👥 AI 人物关系 Agent (${agentModel} · 思考: ${agentReasoning}) 正在分析指令：“${instruction}”...`);
      const systemPrompt = `你是一个轻小说/文学作品人物关系与角色档案的专属 AI 助理。
你拥有全书所有术语、记忆事实、章节和文风的全景数据视界。
你的任务是根据用户指令和全书剧情证据，精准梳理角色档案、建立阵营归属、规范称谓阶级、绑定多形态别名或新建人物关系事实。

【输出格式】
只输出一个合法的 JSON 对象，格式如下：
{
  "summary": "向用户说明你梳理与修改了哪些人物、别名或关系",
  "modifiedCharacters": [
    {
      "sourceTerm": "角色的日文原名（必须存在于术语表中）",
      "translatedTerm": "修正后的中文全名（可选）",
      "gender": "male|female|unknown|not-applicable（可选）",
      "sense": "更新后的人物身份、从军背景或设定概要（可选）",
      "notes": "备注说明（可选）",
      "status": "confirmed|locked（可选）",
      "aliases": ["别名1", "别名2"]
    }
  ],
  "newRelationships": [
    {
      "subject": "主体人物日文名或全名",
      "predicate": "关系类型（如 上下级 / 战友 / 敌对 / 崇敬 / 称呼）",
      "object": "客体人物日文名或全名",
      "statement": "中文关系陈述（如：谭雅对雷鲁根少校保持表面恭顺但内心视为官僚障碍）",
      "importance": 0.85
    }
  ]
}`;

      const response = await adapter.request({
        model: agentModel,
        reasoningEffort: agentReasoning,
        system: systemPrompt,
        user: `${globalContextSummary}\n\n【用户指令】\n${instruction}`,
        responseFormat: 'json',
        temperature: 0.1,
      });

      const parsed = parseJson(response.text) as {
        summary?: string;
        modifiedCharacters?: Array<Record<string, unknown>>;
        newRelationships?: Array<Record<string, unknown>>;
      };
      const summary = String(parsed?.summary ?? '已完成人物关系与档案梳理。');
      const appliedCount = this.#repository.updateCharacterRelations(projectId, {
        modifiedCharacters: parsed?.modifiedCharacters as any,
        newRelationships: parsed?.newRelationships as any,
      });

      const elapsed = Date.now() - startedAt;
      this.#emitLog('success', 'system', `👥 人物关系 Agent 执行完成：${summary} (耗时: ${(elapsed / 1000).toFixed(1)}s · 更新 ${appliedCount} 处)`);
      return { summary, appliedCount, updates: [...(parsed?.modifiedCharacters ?? []), ...(parsed?.newRelationships ?? [])] };
    }

    if (domain === 'memory') {
      this.#emitLog('api', 'system', `🧠 AI 记忆管理 Agent (${agentModel} · 思考: ${agentReasoning}) 正在分析指令：“${instruction}”...`);
      const systemPrompt = `你是一个轻小说/文学作品长程记忆与世界线事实的专属 AI 助理。
你拥有全书所有术语、记忆事实、章节大纲的全景数据视界。
你的任务是根据用户指令，精炼核心主线、重估事实重要度（0.0~1.0）、锁定关键事实、归并重复事件或裁定假说。

【输出格式】
只输出一个合法的 JSON 对象，格式如下：
{
  "summary": "向用户说明你精炼与调整了哪些记忆事实",
  "modifiedFacts": [
    {
      "factId": "事实的 factId（必须存在于当前事实库中）",
      "statement": "精炼后的中文事实陈述（可选）",
      "importance": 0.9,
      "status": "confirmed|locked|archived",
      "memoryClass": "canon|character|relationship|event|state|episode-detail"
    }
  ],
  "archivedFactIds": ["要归档/排除的冗余 factId"],
  "newConsolidatedFacts": [
    {
      "subjectKey": "主语（可选）",
      "objectKey": "宾语（可选）",
      "factKind": "event|setting|character|relationship",
      "statement": "新精炼生成的全局长程事实",
      "importance": 0.95,
      "chapterStart": 1
    }
  ]
}`;

      const response = await adapter.request({
        model: agentModel,
        reasoningEffort: agentReasoning,
        system: systemPrompt,
        user: `${globalContextSummary}\n\n【用户指令】\n${instruction}`,
        responseFormat: 'json',
        temperature: 0.1,
      });

      const parsed = parseJson(response.text) as {
        summary?: string;
        modifiedFacts?: Array<Record<string, unknown>>;
        archivedFactIds?: string[];
        newConsolidatedFacts?: Array<Record<string, unknown>>;
      };
      const summary = String(parsed?.summary ?? '已完成记忆事实重构与精炼。');
      const appliedCount = this.#repository.updateMemoryFacts(projectId, {
        modifiedFacts: parsed?.modifiedFacts as any,
        archivedFactIds: parsed?.archivedFactIds as any,
        newConsolidatedFacts: parsed?.newConsolidatedFacts as any,
      });

      const elapsed = Date.now() - startedAt;
      this.#emitLog('success', 'system', `🧠 记忆管理 Agent 执行完成：${summary} (耗时: ${(elapsed / 1000).toFixed(1)}s · 更新 ${appliedCount} 处事实)`);
      return { summary, appliedCount, updates: [...(parsed?.modifiedFacts ?? []), ...(parsed?.newConsolidatedFacts ?? [])] };
    }

    if (domain === 'workshop') {
      const chapterId = options?.activeChapterId;
      const chapter = globalCtx.chapters.find((c) => c.chapter_id === chapterId);
      const segments = chapterId
        ? (this.#repository.workbench(projectId, chapterId, 0, 80).segments)
        : [];

      this.#emitLog('api', 'system', `✍️ AI 翻译润色 Agent (${agentModel} · 思考: ${agentReasoning}) 正在分析指令：“${instruction}” (章节: 第 ${chapter?.ordinal ?? 1} 章 · 段落数: ${segments.length})...`);

      const systemPrompt = `你是一个出版级轻小说/文学作品翻译润色专属 AI 助理。
你拥有全景术语表、核心人物关系与世界线记忆。
你的任务是根据用户指令，对给出的段落进行批量重润色、消除翻译腔、对齐专名与标点规范、重构自然流畅的出版级译文。

【硬性忠实与文学规范】
1. 绝对忠实原文语义，严禁擅自增删情节；
2. 自然省略生硬多余的第三人称代词（“他/她”），被动语态文学化意合重构；
3. 严格遵循日文原著标点（『』独白/标题/着重、「」对话、——破折号），严禁使用英文半角双引号。

【输出格式】
只输出一个合法的 JSON 对象，格式如下：
{
  "summary": "向用户说明你进行了哪些润色与纠偏",
  "polishedSegments": [
    {
      "segmentId": "段落的 segmentId",
      "text": "重润色后的完美中文成稿",
      "explanation": "修改要点说明（如：去除代词、对齐专名）"
    }
  ]
}`;

      const response = await adapter.request({
        model: agentModel,
        reasoningEffort: agentReasoning,
        system: systemPrompt,
        user: `${globalContextSummary}\n\n【待润色段落（第 ${chapter?.ordinal ?? 1} 章，共 ${segments.length} 段）】\n${JSON.stringify(segments.map((s) => ({ id: s.segmentId, ordinal: s.segmentOrdinal, jp: s.sourceText, currentCn: s.selectedTranslation || s.originalTranslation })), null, 2)}\n\n【用户润色指令】\n${instruction}`,
        responseFormat: 'json',
        temperature: 0.2,
      });

      const parsed = parseJson(response.text) as {
        summary?: string;
        polishedSegments?: Array<{ segmentId: string; text: string; explanation?: string }>;
      };
      const summary = String(parsed?.summary ?? '已完成段落批量润色。');
      const polished = Array.isArray(parsed?.polishedSegments) ? parsed.polishedSegments : [];

      let appliedCount = 0;
      for (const item of polished) {
        if (item.segmentId && item.text?.trim()) {
          try {
            this.saveManual(item.segmentId, item.text.trim());
            appliedCount += 1;
          } catch {
            // continue
          }
        }
      }

      const elapsed = Date.now() - startedAt;
      this.#emitLog('success', 'system', `✍️ 翻译润色 Agent 执行完成：${summary} (耗时: ${(elapsed / 1000).toFixed(1)}s · 润色成稿 ${appliedCount} 段)`);
      return { summary, appliedCount, details: polished.map((p) => `段落 #${p.segmentId.slice(0, 8)}: ${p.explanation ?? '已润色'}`), updates: polished };
    }

    if (domain === 'review') {
      const openReviews = globalCtx.reviews;
      this.#emitLog('api', 'system', `🛡️ AI 审校仲裁 Agent (${agentModel} · 思考: ${agentReasoning}) 正在分析指令：“${instruction}” (待裁定复核项: ${openReviews.length} 条)...`);

      const systemPrompt = `你是一个轻小说/文学作品翻译质量复核与争议仲裁专属 AI 助理。
你拥有全景专名表、人物关系与长程事实。
你的任务是根据用户指令和全书设定，对复核队列中的冲突、警告与文学多解进行批量裁定，生成符合忠实规则的成稿并接受，或驳回重做。

【输出格式】
只输出一个合法的 JSON 对象，格式如下：
{
  "summary": "向用户说明你裁定了哪些复核项",
  "resolutions": [
    {
      "reviewId": "复核项的 reviewId",
      "action": "accept|reject",
      "proposedText": "最终裁定接受的中文译文（action 为 accept 时必填）",
      "rationale": "裁定理由"
    }
  ]
}`;

      const response = await adapter.request({
        model: agentModel,
        reasoningEffort: agentReasoning,
        system: systemPrompt,
        user: `${globalContextSummary}\n\n【待裁定复核项列表（共 ${openReviews.length} 项）】\n${JSON.stringify(openReviews.map((r) => ({ id: r.reviewId, category: r.category, severity: r.severity, title: r.title, explanation: r.explanation, source: r.sourceText, current: r.currentTranslation, proposed: r.proposedText })), null, 2)}\n\n【用户仲裁指令】\n${instruction}`,
        responseFormat: 'json',
        temperature: 0.1,
      });

      const parsed = parseJson(response.text) as {
        summary?: string;
        resolutions?: Array<{ reviewId: string; action: 'accept' | 'reject'; proposedText?: string; rationale?: string }>;
      };
      const summary = String(parsed?.summary ?? '已完成复核项批量仲裁。');
      const resolutions = Array.isArray(parsed?.resolutions) ? parsed.resolutions : [];

      let appliedCount = 0;
      for (const res of resolutions) {
        if (res.reviewId) {
          try {
            this.resolveReview(res.reviewId, res.action, res.proposedText);
            appliedCount += 1;
          } catch {
            // continue
          }
        }
      }

      const elapsed = Date.now() - startedAt;
      this.#emitLog('success', 'system', `🛡️ 审校仲裁 Agent 执行完成：${summary} (耗时: ${(elapsed / 1000).toFixed(1)}s · 裁定 ${appliedCount} 项)`);
      return { summary, appliedCount, details: resolutions.map((r) => `[${r.action}] ${r.rationale ?? '已裁定'}`), updates: resolutions };
    }

    throw new Error(`未知的 Agent 板块类型: ${domain}`);
  }

  start(input: StartWorkflowInput) {
    const snapshot = this.#providerSettings.snapshot();
    const profile = this.#providerSettings.getProfile(snapshot.activeProfileId);
    const key = this.#providerSettings.getApiKey(snapshot.activeProfileId);
    if (!profile || !key) throw new Error('请先在“设置 → 模型与接口”保存并启用可用服务。');
    const task = this.#repository.createTask(input, profile.profileId);
    void this.#run(task.taskId);
    return task;
  }

  pause(taskId: string) {
    const task = this.#repository.getTask(taskId);
    if (!task || !['pending', 'running'].includes(task.status)) throw new Error('这个任务当前不能暂停。');
    this.#stopIntent.set(taskId, 'paused');
    this.#repository.setTaskStatus(taskId, 'pausing');
    this.#emitLog('info', task.taskType === 'pre-read' ? 'pre-read' : task.taskType === 'review' ? 'review' : 'translate',
      '已收到暂停请求；正在中止当前模型调用，并停在最近完成的安全断点。');
    this.#abort(taskId);
    return this.#repository.getTask(taskId)!;
  }

  cancel(taskId: string) {
    const task = this.#repository.getTask(taskId);
    if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) throw new Error('这个任务已经结束。');
    this.#stopIntent.set(taskId, 'cancelled');
    this.#abort(taskId);
    return this.#repository.setTaskStatus(taskId, 'cancelled', '用户取消了任务。');
  }

  resume(taskId: string) {
    const task = this.#repository.getTask(taskId);
    if (!task || !['paused', 'interrupted'].includes(task.status)) throw new Error('这个任务当前不能继续。');
    const profile = task.providerProfileId ? this.#providerSettings.getProfile(task.providerProfileId) : null;
    const key = task.providerProfileId ? this.#providerSettings.getApiKey(task.providerProfileId) : null;
    if (!profile || !key) throw new Error('原任务使用的模型服务或密钥已不可用。');
    this.#stopIntent.delete(taskId);
    const next = this.#repository.setTaskStatus(taskId, 'pending');
    void this.#run(taskId);
    return next;
  }

  retryFailed(taskId: string) {
    const task = this.#repository.getTask(taskId);
    if (!task) throw new Error('这个任务不存在。');
    const profile = task.providerProfileId ? this.#providerSettings.getProfile(task.providerProfileId) : null;
    const key = task.providerProfileId ? this.#providerSettings.getApiKey(task.providerProfileId) : null;
    if (!profile || !key) throw new Error('原任务使用的模型服务或密钥已不可用。');
    this.#stopIntent.delete(taskId);
    const next = this.#repository.retryFailedTaskItems(taskId);
    void this.#run(taskId);
    return next;
  }

  #abort(taskId: string) { this.#controllers.get(taskId)?.forEach((controller) => controller.abort()); }

  #profileForTask(task: WorkflowTaskSummary) {
    const profile = task.providerProfileId ? this.#providerSettings.getProfile(task.providerProfileId) : null;
    const key = task.providerProfileId ? this.#providerSettings.getApiKey(task.providerProfileId) : null;
    if (!profile || !key) throw new Error('任务绑定的模型服务或密钥不可用。');
    return { profile, key };
  }

  async #request(
    taskId: string,
    adapter: ProviderAdapter,
    input: Parameters<ProviderAdapter['request']>[0],
    trace?: RequestTrace,
  ) {
    if (this.#stopIntent.has(taskId)) throw new ProviderRequestError('cancelled', '任务正在暂停或取消，已阻止启动新的模型请求。');
    const controller = new AbortController();
    const controllers = this.#controllers.get(taskId) ?? new Set<AbortController>();
    controllers.add(controller); this.#controllers.set(taskId, controllers);
    const requestId = randomUUID().slice(0, 8);
    const descriptor = adapter.describeRequest(input);
    const reasoning = descriptor.reasoningEffort === 'none' ? '关闭' : descriptor.reasoningEffort;
    const jsonHandling = descriptor.jsonHandling === 'native'
      ? '原生 JSON 约束'
      : descriptor.jsonHandling === 'prompt-only'
        ? '严格提示＋本地 JSON 校验'
        : '文本';
    const details = [
      `请求 ${requestId}`,
      `服务 ${descriptor.providerName}`,
      `模型 ${descriptor.model}`,
      `协议 ${descriptor.protocol}`,
      `思考请求 ${reasoning}`,
      `输出上限 ${descriptor.maxOutputTokens} Token`,
      `格式 ${jsonHandling}`,
      `超时 ${descriptor.timeoutSeconds} 秒`,
      `临时故障最多重试 ${descriptor.maxRetries} 次`,
      trace?.sourceChars === undefined ? '' : `本次原文 ${trace.sourceChars} 字`,
    ].filter(Boolean).join(' · ');
    const startedAt = Date.now();
    if (trace) {
      this.#emitLog('api', trace.stage, `[请求 ${requestId}] ${trace.label}已发送，等待服务返回完整响应。`, {
        details,
        model: descriptor.model,
      });
    }
    const heartbeat = trace ? setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      this.#emitLog('api', trace.stage, `[请求 ${requestId}] ${trace.label}仍在等待（${formatDuration(elapsedMs)}）；正在等待网关排队、模型生成或完整响应传输，软件没有卡死。`, {
        details,
        model: descriptor.model,
        elapsedMs,
      });
    }, REQUEST_HEARTBEAT_MS) : null;
    const externalProgress = input.onProgress;
    try {
      const response = await adapter.request({
        ...input,
        signal: controller.signal,
        onProgress: (event) => {
          externalProgress?.(event);
          if (!trace) return;
          this.#emitLog('warn', trace.stage, `[请求 ${requestId}] ${event.message}`, {
            details,
            model: descriptor.model,
            elapsedMs: Date.now() - startedAt,
          });
        },
      });
      if (this.#stopIntent.has(taskId)) throw new ProviderRequestError('cancelled', '任务正在暂停或取消，当前响应未越过安全断点。');
      return response;
    } catch (error) {
      if (trace && error instanceof ProviderRequestError && error.code !== 'cancelled') {
        const meta = error.responseMeta;
        this.#emitLog(error.code === 'truncated-response' ? 'warn' : 'error', trace.stage, `[请求 ${requestId}] ${trace.label}未成功：${error.message}`, {
          details: `${details} · 错误代码 ${error.code}${meta?.finishReason ? ` · 结束原因 ${meta.finishReason}` : ''}`,
          model: descriptor.model,
          inputTokens: meta?.inputTokens,
          outputTokens: meta?.outputTokens,
          elapsedMs: Date.now() - startedAt,
        });
      }
      throw error;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      controllers.delete(controller);
      if (!controllers.size) this.#controllers.delete(taskId);
    }
  }

  async #run(taskId: string) {
    if (this.#running.has(taskId)) return;
    this.#running.add(taskId);
    try {
      const task = this.#repository.getTask(taskId);
      if (!task) return;
      const { profile, key } = this.#profileForTask(task);
      if (task.taskType === 'pre-read') await this.#runPreRead(task, profile, key);
      else if (task.taskType === 'translate') await this.#runTranslations(task, profile, key, false);
      else if (task.taskType === 'review') await this.#runTranslations(task, profile, key, true);
    } catch (error) {
      if (this.#closing) return;
      const intent = this.#stopIntent.get(taskId);
      if (intent) this.#repository.setTaskStatus(taskId, intent, intent === 'paused' ? null : '用户取消了任务。');
      else this.#repository.setTaskStatus(taskId, 'failed', error instanceof Error ? error.message : '任务执行失败。');
    } finally {
      const intent = this.#stopIntent.get(taskId);
      if (!this.#closing && intent === 'paused') this.#repository.setTaskStatus(taskId, 'paused');
      this.#running.delete(taskId); this.#controllers.delete(taskId); this.#stopIntent.delete(taskId);
    }
  }

  async #runPreRead(task: WorkflowTaskSummary, profile: ProviderProfile, key: string) {
    const taskStartedAt = Date.now();
    const extraction = this.#adapter({ ...profile, maxRetries: profile.maxRetries }, key);
    const reviewer = this.#adapter({ ...profile, model: profile.reviewModel }, key);
    const resetChapters = this.#repository.upgradePreReadTaskPrompt(task.taskId);
    if (resetChapters > 0) {
      this.#emitLog('warn', 'pre-read', `预读认知规范已升级，为避免沿用缺少人物实体的旧结果，正在自动重新核对 ${resetChapters} 个已处理章节；原任务和总 Token 记录保留。`);
    }
    this.#emitLog('info', 'pre-read', `全书预读任务已启动，共 ${task.totalItems} 个章节`);

    let processedChapters = 0;
    let learnedPreReadLimit = MAX_PREREAD_CHARS;
    while (!this.#stopIntent.has(task.taskId)) {
      const items = this.#repository.claimItems(task.taskId, 1);
      if (!items.length) break;
      const item = items[0];
      const chapterStartedAt = Date.now();
      try {
        const material = this.#repository.readChapterMaterial(task.projectId, item.chapterId);
        const chapterOrdinal = this.#repository.chapterOrdinal(task.projectId, item.chapterId);
        const priorContext = this.#repository.preReadContext(task.projectId, chapterOrdinal, material);
        const pieces = splitMaterial(material);
        const checkpoint = restorePreReadCheckpoint(this.#repository.preReadCheckpoint(item.taskItemId), chapterOrdinal, pieces.length);
        learnedPreReadLimit = Math.min(learnedPreReadLimit, checkpoint?.adaptiveCharLimit ?? MAX_PREREAD_CHARS);
        let aggregate: ReturnType<typeof normalizePreRead> = checkpoint?.aggregate ?? {
          chapterSummary: '', entities: [], glossary: [], facts: [], events: [], frames: [],
          styleDecisions: [], ambiguities: [],
        };
        let inputTokens = checkpoint?.inputTokens ?? 0;
        let outputTokens = checkpoint?.outputTokens ?? 0;
        let revisedPiece = checkpoint?.revisedPiece ?? false;
        const startPieceIndex = checkpoint?.nextPieceIndex ?? 0;
        let activePieceIndex = startPieceIndex;
        const saveCheckpoint = (nextPieceIndex: number) => this.#repository.savePreReadCheckpoint(item.taskItemId, {
          version: 1,
          pieceCount: pieces.length,
          nextPieceIndex,
          aggregate,
          inputTokens,
          outputTokens,
          revisedPiece,
          adaptiveCharLimit: learnedPreReadLimit,
        } satisfies PreReadCheckpoint);

        this.#emitLog('info', 'pre-read', `正在分析第 ${chapterOrdinal} 章（共 ${pieces.length} 个分片，${material.length} 字）...`);
        if (startPieceIndex > 0) {
          this.#emitLog('success', 'pre-read', `第 ${chapterOrdinal} 章已恢复分片断点，将从 ${startPieceIndex + 1}/${pieces.length} 继续。`);
        }

        const processPieceWithAdaptiveHalving = async (pieceText: string, pieceLabel: string, earlierContext: string): Promise<ReturnType<typeof normalizePreRead>> => {
          const splitAndProcess = async (reason: 'learned-limit' | 'truncated'): Promise<ReturnType<typeof normalizePreRead> | null> => {
            const half = Math.floor(pieceText.length / 2);
            let splitIdx = pieceText.lastIndexOf('\n', half);
            if (splitIdx < half * 0.4) splitIdx = half;
            const subA = pieceText.slice(0, splitIdx).trim();
            const subB = pieceText.slice(splitIdx).trim();
            if (subA.length <= 100 || subB.length <= 100) return null;
            if (reason === 'truncated') {
              learnedPreReadLimit = Math.max(
                MIN_ADAPTIVE_PREREAD_CHARS,
                Math.min(learnedPreReadLimit, Math.max(subA.length, subB.length)),
              );
              saveCheckpoint(activePieceIndex);
              this.#emitLog('warn', 'pre-read', `[第${chapterOrdinal}章] 分片 ${pieceLabel} 已按 ${pieceText.length} → ${subA.length}＋${subB.length} 字拆分；后续超过 ${learnedPreReadLimit} 字的分片会预先拆开，不再先浪费一次超长请求。`);
            } else {
              saveCheckpoint(activePieceIndex);
              this.#emitLog('info', 'pre-read', `[第${chapterOrdinal}章] 分片 ${pieceLabel} 超过已学习的安全长度 ${learnedPreReadLimit} 字，正在预拆为 ${subA.length}＋${subB.length} 字。`);
            }
            const resA = await processPieceWithAdaptiveHalving(subA, `${pieceLabel}.a`, earlierContext);
            const subEarlierContext = JSON.stringify({
              summary: [earlierContext, resA.chapterSummary].filter(Boolean).join('\n'),
              entities: resA.entities.slice(-40),
              glossary: resA.glossary.slice(-60),
              facts: resA.facts.slice(-60),
              events: resA.events.slice(-60), frames: resA.frames.slice(-20),
            });
            const resB = await processPieceWithAdaptiveHalving(subB, `${pieceLabel}.b`, subEarlierContext);
            return mergePreReadPieces(resA, resB);
          };

          if (pieceText.length > learnedPreReadLimit) {
            const preSplit = await splitAndProcess('learned-limit');
            if (preSplit) return preSplit;
          }
          const pieceStarted = Date.now();
          try {
            const response = await this.#request(task.taskId, extraction, {
              model: profile.preReadModel,
              system: systemWithCustomInstructions(preReadSystemPrompt, profile),
              responseFormat: 'json',
              temperature: 0,
              user: `作品章节序号：${chapterOrdinal}\n本章分片：${pieceLabel}\n以下是待分析原文；既有CN仅用于判断旧译名，不是事实来源。\n\n【读到本章前已经建立的连续剧情认知】\n${priorContext}\n\n【本章更早分片已经建立的认知】\n${earlierContext}\n\n【本分片原文】\n${pieceText}`,
            }, {
              stage: 'pre-read',
              label: `[第${chapterOrdinal}章] 提取分片 ${pieceLabel}（${pieceText.length} 字）`,
              sourceChars: pieceText.length,
            });
            const elapsedMs = Date.now() - pieceStarted;
            inputTokens += tokenValue(response.inputTokens);
            outputTokens += tokenValue(response.outputTokens);
            this.#emitLog('api', 'pre-read', `[第${chapterOrdinal}章] 分片 ${pieceLabel} 提取完成 (耗时 ${(elapsedMs / 1000).toFixed(1)}s · 输入 ${response.inputTokens ?? 0} / 输出 ${response.outputTokens ?? 0} tok)`, {
              model: profile.preReadModel, inputTokens: response.inputTokens, outputTokens: response.outputTokens, elapsedMs,
            });
            return normalizePreRead(parseJson(response.text), chapterOrdinal);
          } catch (err) {
            const isTruncated = err instanceof ProviderRequestError && err.code === 'truncated-response';
            if (isTruncated && canSplitTruncatedPreReadPiece(pieceText.length)) {
              inputTokens += tokenValue(err.responseMeta?.inputTokens ?? null);
              outputTokens += tokenValue(err.responseMeta?.outputTokens ?? null);
              this.#emitLog('warn', 'pre-read', `[第${chapterOrdinal}章] 分片 ${pieceLabel} 的服务响应明确以长度上限结束；这是输出被截断，不是网关报错。软件不会原样盲重试，立即进入自适应拆分。`, {
                model: profile.preReadModel,
                inputTokens: err.responseMeta?.inputTokens,
                outputTokens: err.responseMeta?.outputTokens,
                elapsedMs: Date.now() - pieceStarted,
              });
              const recovered = await splitAndProcess('truncated');
              if (recovered) return recovered;
            }
            throw err;
          }
        };

        const pieceSummaries: string[] = [];
        for (let index = startPieceIndex; index < pieces.length; index += 1) {
          activePieceIndex = index;
          const earlierPieceContext = index === 0 ? '（本章第一分片）' : JSON.stringify({
            previousPieceSummary: pieceSummaries[pieceSummaries.length - 1] || '',
            entities: aggregate.entities.slice(-40),
            glossary: aggregate.glossary.slice(-50),
          });
          const parsed = await processPieceWithAdaptiveHalving(pieces[index], `${index + 1}/${pieces.length}`, earlierPieceContext);

          let selectedPiece = parsed;
          // Review piece with reviewer
          try {
            const reviewStarted = Date.now();
            const reviewResponse = await this.#request(task.taskId, reviewer, {
              model: profile.reviewModel, system: systemWithCustomInstructions(preReadReviewSystemPrompt, profile), responseFormat: 'json', temperature: 0,
              user: `章节序号：${chapterOrdinal}\n分片：${index + 1}/${pieces.length}\n候选认知：\n${JSON.stringify(parsed)}\n\n用于逐项核对证据的原文分片：\n${pieces[index]}`,
            }, {
              stage: 'pre-read',
              label: `[第${chapterOrdinal}章] 独立复核分片 ${index + 1}/${pieces.length}`,
              sourceChars: pieces[index].length,
            });
            const reviewElapsed = Date.now() - reviewStarted;
            inputTokens += tokenValue(reviewResponse.inputTokens); outputTokens += tokenValue(reviewResponse.outputTokens);
            const reviewRoot = asRecord(parseJson(reviewResponse.text));
            const verdict = stringValue(reviewRoot?.verdict);
            selectedPiece = verdict === 'revise' && reviewRoot?.corrected ? normalizePreRead(reviewRoot.corrected, chapterOrdinal) : parsed;
            revisedPiece ||= verdict === 'revise';
            this.#emitLog('api', 'pre-read', `[第${chapterOrdinal}章] 分片 ${index + 1}/${pieces.length} 复核完成 (耗时 ${(reviewElapsed / 1000).toFixed(1)}s)`, {
              model: profile.reviewModel, inputTokens: reviewResponse.inputTokens, outputTokens: reviewResponse.outputTokens, elapsedMs: reviewElapsed,
            });
          } catch (reviewError) {
            if (this.#stopIntent.has(task.taskId)
              || reviewError instanceof ProviderRequestError && reviewError.code === 'cancelled') throw reviewError;
            this.#emitLog('warn', 'pre-read', `[第${chapterOrdinal}章] 分片 ${index + 1}/${pieces.length} 的独立复核未完成，将保留初次提取结果并在日志中保留原因：${reviewError instanceof Error ? reviewError.message : '未知错误'}`);
          }

          const pieceSummary = stringValue(selectedPiece.chapterSummary).trim();
          if (pieceSummary && !pieceSummaries.includes(pieceSummary)) {
            pieceSummaries.push(pieceSummary);
          }
          aggregate.chapterSummary = condensePieceSummaries(pieceSummaries);
          aggregate.entities.push(...selectedPiece.entities); aggregate.glossary.push(...selectedPiece.glossary);
          aggregate.facts.push(...selectedPiece.facts); aggregate.events.push(...selectedPiece.events);
          aggregate.frames.push(...selectedPiece.frames); aggregate.styleDecisions.push(...selectedPiece.styleDecisions);
          aggregate.ambiguities.push(...selectedPiece.ambiguities);
          saveCheckpoint(index + 1);
        }

        // Clean and finalize whole chapter summary
        aggregate.chapterSummary = condensePieceSummaries(pieceSummaries);

        // A reference introduced early in a chapter may only receive its canonical entity or
        // terminology entry in a later piece. Audit once after all pieces have been read so the
        // chapter can resolve itself before requesting any repair.
        const knownReferenceKeys = this.#repository.preReadResolvableKeys(task.projectId);
        const auditChapter = () => auditPreReadEntityCoverage({ ...aggregate, knownReferenceKeys });
        const beforeCleanup = auditChapter();
        if (beforeCleanup.genericKeys.length) {
          aggregate = clearGenericPreReadReferences(aggregate);
          saveCheckpoint(pieces.length);
          this.#emitLog('info', 'pre-read', `[第${chapterOrdinal}章] 整章汇总后已清空 ${beforeCleanup.genericKeys.length} 个非持久泛称引用；它们只保留在事实叙述中，不会写入术语表：${beforeCleanup.genericKeys.join('、')}`);
        }

        let coverage = auditChapter();
        if (coverage.issues.length) {
          this.#emitLog('warn', 'pre-read', `[第${chapterOrdinal}章] 全部 ${pieces.length} 个分片读完后检出 ${coverage.issues.length} 个实体/专名引用缺口，正在进行一次整章统一：${coverage.unresolvedKeys.join('、')}`);
          const repairStarted = Date.now();
          const repairResponse = await this.#request(task.taskId, reviewer, {
            model: profile.reviewModel,
            system: systemWithCustomInstructions(preReadEntityRepairSystemPrompt, profile),
            responseFormat: 'json',
            temperature: 0,
            user: `章节序号：${chapterOrdinal}\n本章共 ${pieces.length} 个分片，现已全部读取和独立复核。\n软件整章实体覆盖检查：\n${coverage.issues.join('\n')}\n\n只允许处理这些未解析 Key：\n${JSON.stringify(coverage.unresolvedKeys)}\n\n整章候选认知（仅供定位引用与复用既有人物/术语）：\n${JSON.stringify(aggregate)}\n\n用于补建证据且不得超出的整章日文原文：\n${material}`,
          }, {
            stage: 'pre-read',
            label: `[第${chapterOrdinal}章] 整章实体/专名统一`,
            sourceChars: material.length,
          });
          const repairElapsed = Date.now() - repairStarted;
          inputTokens += tokenValue(repairResponse.inputTokens); outputTokens += tokenValue(repairResponse.outputTokens);
          const patchRoot = asRecord(parseJson(repairResponse.text));
          if (patchRoot) {
            const additions = normalizePreRead({
              chapterSummary: '',
              entities: patchRoot.addedEntities,
              glossary: patchRoot.addedGlossary,
              facts: [], events: [], frames: [], styleDecisions: [], ambiguities: [],
            }, chapterOrdinal);
            const allowedRewrites = new Set(coverage.unresolvedKeys);
            const keyRewrites = asArray(patchRoot.keyRewrites).map(asRecord)
              .filter((row): row is Record<string, unknown> => Boolean(row))
              .map((row) => ({ from: stringValue(row.from), to: stringValue(row.to) }))
              .filter((row) => row.from && allowedRewrites.has(row.from));
            aggregate = applyPreReadCoveragePatch(aggregate, {
              addedEntities: additions.entities,
              addedGlossary: additions.glossary,
              keyRewrites,
            });
            aggregate = clearGenericPreReadReferences(aggregate);
            revisedPiece = true;
            coverage = auditChapter();
            saveCheckpoint(pieces.length);
            this.#emitLog('api', 'pre-read', `[第${chapterOrdinal}章] 整章实体/专名统一完成 (耗时 ${(repairElapsed / 1000).toFixed(1)}s · 新增人物 ${additions.entities.length} · 新增术语 ${additions.glossary.length} · 引用改写 ${keyRewrites.length} · 剩余缺口 ${coverage.issues.length})`, {
              model: profile.reviewModel, inputTokens: repairResponse.inputTokens,
              outputTokens: repairResponse.outputTokens, elapsedMs: repairElapsed,
            });
          }
        }
        if (coverage.issues.length) {
          this.#emitLog('warn', 'pre-read', `[第${chapterOrdinal}章] 存在 ${coverage.issues.length} 个未完全绑定的引用键（${coverage.unresolvedKeys.slice(0, 5).join('、')}），已自动静默降级为普通叙述入库，保证全书进度顺利推进。`);
          aggregate = applyPreReadCoveragePatch(aggregate, {
            addedEntities: [], addedGlossary: [],
            keyRewrites: coverage.unresolvedKeys.map((from) => ({ from, to: '' })),
          });
          aggregate = clearGenericPreReadReferences(aggregate);
        }

        const chapterElapsed = Date.now() - chapterStartedAt;
        processedChapters += 1;
        this.#repository.savePreReadResult(task.projectId, item.chapterId, chapterOrdinal, aggregate);
        this.#repository.finishItem(item.taskItemId, 'completed', null, { inputTokens, outputTokens, warning: revisedPiece });
        this.#emitLog('success', 'pre-read', `第 ${chapterOrdinal} 章预读完成（章节耗时: ${formatDuration(chapterElapsed)} · 人物/术语 ${terminologyEntryCount(aggregate)} 条〔人物实体 ${aggregate.entities.length}〕 · 状态事实 ${aggregate.facts.length} 条 · 定向事件 ${aggregate.events.length} 条 · 场景框架 ${aggregate.frames.length} 条 · 文风决策 ${aggregate.styleDecisions.length} 条 · 歧义 ${aggregate.ambiguities.length} 条）`);
      } catch (error) {
        if (this.#stopIntent.has(task.taskId) || error instanceof ProviderRequestError && error.code === 'cancelled') throw error;
        const msg = error instanceof Error ? error.message : '章节预读失败。';
        const recovery = decidePreReadRecovery(error);
        const checkpoint = summarizePreReadCheckpoint(this.#repository.preReadCheckpoint(item.taskItemId));
        const retained = checkpoint
          ? `断点已保留 ${checkpoint.completedPieces}/${checkpoint.pieceCount} 个分片、人物实体 ${checkpoint.entityCount}、术语 ${checkpoint.glossaryCount}、事实 ${checkpoint.factCount}、事件 ${checkpoint.eventCount} 条`
          : '本章尚无可恢复的已完成分片';
        if (recovery.recoverable && item.attempts < recovery.maxAttempts) {
          this.#repository.requeueItemFromCheckpoint(item.taskItemId, msg);
          this.#emitLog('warn', 'pre-read', `第 ${item.itemOrdinal} 章遇到可恢复错误，将自动从断点执行第 ${item.attempts + 1}/${recovery.maxAttempts} 次章节尝试：${msg}（${retained}）`);
          continue;
        }
        this.#emitLog('error', 'pre-read', `第 ${item.itemOrdinal} 章处理失败：${msg}（${retained}）。为避免半章知识污染长期记忆，暂未提交本章正式术语/事件；可在任务区点击“从断点重试失败章节”。`);
        this.#repository.finishItem(item.taskItemId, 'failed', msg);
      }
    }
    const totalElapsed = Date.now() - taskStartedAt;
    if (!this.#stopIntent.has(task.taskId) && this.#repository.getTask(task.taskId)?.status === 'completed') {
      const finalized = this.#repository.finalizePreRead(task.projectId);
      this.#emitLog('success', 'pre-read', `卷级长期记忆档案已生成（章节摘要 ${finalized.dossier.chapterSummaryCount} 条 · 稳定记忆 ${finalized.dossier.durableMemoryCount} 条）。`);
    }
    this.#emitLog('info', 'pre-read', `全书预读流程已完成 (共处理 ${processedChapters} 章 · 总耗时: ${formatDuration(totalElapsed)})`);
  }

  async #runTranslations(task: WorkflowTaskSummary, profile: ProviderProfile, key: string, reviewOnly: boolean) {
    const taskStartedAt = Date.now();
    // 人类式连续阅读模式要求同一作品按阅读顺序吸收已确认译文与状态，禁止后段抢跑。
    const workerCount = 1;
    await Promise.all(Array.from({ length: workerCount }, async () => {
      const translator = this.#adapter(profile, key);
      const reviewer = this.#adapter({ ...profile, model: profile.reviewModel }, key);
      while (!this.#stopIntent.has(task.taskId)) {
        const items = this.#repository.claimItems(task.taskId, Math.max(1, profile.batchSize));
        if (!items.length) break;
        await this.#processBatchResilient(task, profile, items, translator, reviewer, reviewOnly);
      }
    }));
    const totalElapsed = Date.now() - taskStartedAt;
    this.#emitLog('success', reviewOnly ? 'review' : 'translate', `🎉 ${reviewOnly ? '独立复核' : '翻译润色'}流程已结束 (总耗时: ${formatDuration(totalElapsed)})`);
  }

  async #processBatchResilient(task: WorkflowTaskSummary, profile: ProviderProfile, items: readonly ClaimedTaskItem[], translator: ProviderAdapter, reviewer: ProviderAdapter, reviewOnly: boolean): Promise<void> {
    if (items.length > 1) {
      const segments = items.map((item) => item.segment).filter((segment): segment is TranslationSegmentRecord => Boolean(segment));
      const firstBoundary = this.#repository.narrativeBoundarySegments(task.projectId, segments)[0];
      if (firstBoundary !== undefined) {
        const splitIndex = items.findIndex((item) => (item.segment?.segmentOrdinal ?? Number.MAX_SAFE_INTEGER) >= firstBoundary);
        if (splitIndex > 0) {
          await this.#processBatchResilient(task, profile, items.slice(0, splitIndex), translator, reviewer, reviewOnly);
          await this.#processBatchResilient(task, profile, items.slice(splitIndex), translator, reviewer, reviewOnly);
          return;
        }
      }
    }
    try {
      await this.#processBatch(task, profile, items, translator, reviewer, reviewOnly);
    } catch (error) {
      if (this.#stopIntent.has(task.taskId) || error instanceof ProviderRequestError && error.code === 'cancelled') throw error;
      if (items.length > 1) {
        const middle = Math.floor(items.length / 2);
        await this.#processBatchResilient(task, profile, items.slice(0, middle), translator, reviewer, reviewOnly);
        await this.#processBatchResilient(task, profile, items.slice(middle), translator, reviewer, reviewOnly);
        return;
      }
      const item = items[0]; const segment = item.segment;
      if (segment) {
        this.#repository.setSegmentStatus(segment.segmentId, 'failed');
        const category = error instanceof ProviderRequestError && ['permission', 'authentication'].includes(error.code) ? 'provider-refusal' : 'semantic';
        this.#repository.createReviewItem(segment, category, 'blocking', '模型处理失败', error instanceof Error ? error.message : '模型处理失败。', { attempts: item.attempts });
      }
      this.#repository.finishItem(item.taskItemId, 'failed', error instanceof Error ? error.message : '模型处理失败。');
    }
  }

  async #processBatch(task: WorkflowTaskSummary, profile: ProviderProfile, items: readonly ClaimedTaskItem[], translator: ProviderAdapter, reviewer: ProviderAdapter, reviewOnly: boolean) {
    const segments = items.map((item) => item.segment).filter((segment): segment is TranslationSegmentRecord => Boolean(segment));
    if (segments.length !== items.length) throw new Error('任务段落记录不完整。');
    const context = this.#repository.contextForSegments(task.projectId, segments);
    const candidates = new Map<string, string>();
    let inputTokens = 0; let outputTokens = 0;
    let sourceResponse = null as Awaited<ReturnType<ProviderAdapter['request']>> | null;
    let sourceElapsed = 0;
    const roleStarted = Date.now();
    const roleResponse = await this.#request(task.taskId, reviewer, {
      model: profile.reviewModel, system: systemWithCustomInstructions(semanticRoleSystemPrompt, profile),
      responseFormat: 'json', temperature: 0,
      user: `【本批次精确阅读位置】\n${context.contextPosition}\n\n【当前场景/叙事层/世界线】\n${context.narrativeFrames}\n\n【前后近邻】\n${context.neighbors}\n\n【当前世界状态】\n${context.worldState}\n\n【当前段内状态/关系变化证据】\n${context.segmentTransitions}\n\n【字符级原文切片】\n${context.exactSlices}\n\n【规则句法/授受/引语边界证据】\n${context.syntaxEvidence}\n\n【必须保留或复核的多解】\n${context.ambiguities}\n\n【既有定向事件，仅用于消歧】\n${context.directionLedger}\n\n【待分析段落】\n${translationInput(segments)}`,
    }, {
      stage: 'translate',
      label: `建立 A→B 语义角色账本（${segments.length} 个段落）`,
      sourceChars: segments.reduce((sum, segment) => sum + segment.sourceText.length, 0),
    });
    inputTokens += tokenValue(roleResponse.inputTokens); outputTokens += tokenValue(roleResponse.outputTokens);
    const rawSemanticRoles = semanticRoleMap(roleResponse.text, segments);
    const semanticRoles = adjudicateSemanticRoles(rawSemanticRoles,
      new Map(segments.map((segment) => [segment.segmentId, segment.sourceText])),
      new Map(context.rawSyntaxEvidence.map((evidence) => [evidence.segmentId, evidence])));
    for (const segment of segments) {
      const conflicts = semanticRoles.find((item) => item.id === segment.segmentId)?.propositions
        .filter((proposition) => proposition.syntaxAgreement === 'conflicts') ?? [];
      if (conflicts.length) this.#repository.createReviewItem(segment, 'semantic', 'blocking',
        '模型语义角色与规则句法证据冲突', '被动、使役或授受词形与模型给出的动作方向不一致；系统已降低置信度，必须由独立复核重新裁定。',
        { conflicts, syntaxEvidence: context.rawSyntaxEvidence.find((item) => item.segmentId === segment.segmentId) });
    }
    this.#emitLog('success', 'translate', `A→B 语义角色账本已建立（${semanticRoles.reduce((sum, item) => sum + item.propositions.length, 0)} 个命题 · ${((Date.now() - roleStarted) / 1000).toFixed(1)}s）`, {
      model: profile.reviewModel, inputTokens: roleResponse.inputTokens, outputTokens: roleResponse.outputTokens, elapsedMs: Date.now() - roleStarted,
    });

    if (reviewOnly) {
      for (const segment of segments) {
        const selected = this.#repository.selectedTranslation(segment.segmentId);
        if (!selected) throw new Error('复核任务缺少当前译文版本。');
        candidates.set(segment.segmentId, selected);
      }
    } else {
      const hasExisting = segments.some((segment) => Boolean(segment.originalTranslation && segment.originalTranslation.trim()));
      const promptToUse = hasExisting ? polishingSystemPrompt : translationSystemPrompt;
      const started = Date.now();
      sourceResponse = await this.#request(task.taskId, translator, {
        model: profile.model, system: systemWithCustomInstructions(promptToUse, profile), responseFormat: 'json',
        user: `【本批次精确阅读位置】\n${context.contextPosition}\n\n【当前场景/叙事层/世界线】\n${context.narrativeFrames}\n\n【近邻原文与既有译文】\n${context.neighbors}\n\n【命中实体与多重别名】\n${context.entities}\n\n【当前时间点、且此刻允许读者知道的世界状态】\n${context.worldState}\n\n【当前段内状态/关系变化证据——严格按字符位置应用】\n${context.segmentTransitions}\n\n【字符级原文切片 exactSlices】\n${context.exactSlices}\n\n【当前角色各自知道/相信/怀疑/否认】\n${context.characterKnowledge}\n\n【当前读者已知事实】\n${context.readerFacts}\n${context.readerKnowledge}\n\n【已巩固的分层长期记忆】\n${context.consolidatedMemories}\n\n【译者消歧用的后文/隐藏事实：严禁提前写入译文】\n${context.translatorFacts}\n${context.translatorKnowledge}\n${context.futureConsolidatedMemories}\n\n【用户明确关联的更早卷系列记忆】\n${context.seriesContext}\n\n【有证据的文风与翻译决策】\n${context.styleMemories}\n\n【当前多解/双关保护策略】\n${context.ambiguities}\n\n【规则句法/授受/引语边界证据】\n${context.syntaxEvidence}\n\n【历史定向事件】\n${context.directionLedger}\n\n【当前段落语义角色硬约束 currentSemanticRoles】\n${JSON.stringify(semanticRoles)}\n\n【未决冲突：不得自行猜测】\n${context.unresolved}\n\n【当前命中的术语与 sense】\n${context.glossary}\n\n【待处理段落 JSON】\n${translationInput(segments)}`,
      }, {
        stage: 'translate',
        label: `${hasExisting ? '润色' : '精译'}批次（${segments.length} 个段落）`,
        sourceChars: segments.reduce((sum, segment) => sum + segment.sourceText.length, 0),
      });
      sourceElapsed = Date.now() - started;
      inputTokens += tokenValue(sourceResponse.inputTokens); outputTokens += tokenValue(sourceResponse.outputTokens);
      this.#emitLog('api', 'translate', `批次生成完成 (输入 ${sourceResponse.inputTokens ?? 0} / 输出 ${sourceResponse.outputTokens ?? 0} tokens · ${(sourceElapsed / 1000).toFixed(1)}s)`, {
        model: profile.model, inputTokens: sourceResponse.inputTokens, outputTokens: sourceResponse.outputTokens, elapsedMs: sourceElapsed,
      });
      const initial = translationMap(sourceResponse.text, segments.map((segment) => segment.segmentId));
      initial.forEach((text, id) => candidates.set(id, text));

      for (const segment of segments) {
        let candidate = candidates.get(segment.segmentId)!;
        let issues = validateTranslationCandidate(segment.sourceText, candidate);
        this.#repository.saveTranslationVersion(segment, candidate, 'initial', profile.profileId, profile.model, context.manifest, sourceResponse, sourceElapsed, issues.length ? null : 'reviewing', semanticRoles);
        for (let attempt = 0; issues.length && attempt < 2; attempt += 1) {
          const repairStarted = Date.now();
          this.#emitLog('warn', 'translate', `段落 #${segment.segmentOrdinal} 触发自修复：${issues.map((i) => i.message).join('；')}`);
          const repair = await this.#request(task.taskId, translator, {
            model: profile.model, system: systemWithCustomInstructions(promptToUse, profile), responseFormat: 'json', temperature: 0,
            user: `上次候选未通过硬性忠实检查。只修复指出的问题，不得改写其他内容。\n失败原因：${issues.map((issue) => issue.message).join('；')}\n上下文：${context.neighbors}\n场景与叙事层：${context.narrativeFrames}\n当前世界状态：${context.worldState}\n字符切片与段内变化：${context.exactSlices}\n${context.segmentTransitions}\n规则句法证据：${context.syntaxEvidence}\n歧义策略：${context.ambiguities}\n文风决策：${context.styleMemories}\n当前语义角色：${JSON.stringify(semanticRoles.filter((item) => item.id === segment.segmentId))}\n待修段落：${translationInput([segment])}`,
          }, {
            stage: 'translate',
            label: `自修复段落 #${segment.segmentOrdinal}（第 ${attempt + 1}/2 次）`,
            sourceChars: segment.sourceText.length,
          });
          inputTokens += tokenValue(repair.inputTokens); outputTokens += tokenValue(repair.outputTokens);
          candidate = translationMap(repair.text, [segment.segmentId]).get(segment.segmentId)!;
          issues = validateTranslationCandidate(segment.sourceText, candidate);
          this.#repository.saveTranslationVersion(segment, candidate, 'self-repair', profile.profileId, profile.model, context.manifest, repair, Date.now() - repairStarted, issues.length ? null : 'reviewing', semanticRoles);
        }
        if (issues.length) {
          this.#repository.setSegmentStatus(segment.segmentId, 'needs-human');
          this.#repository.createReviewItem(segment, 'hard-rule', 'must-human', '忠实规则反复未通过', issues.map((issue) => issue.message).join('；'), { source: segment.sourceText, candidate }, candidate);
          candidates.delete(segment.segmentId);
        } else candidates.set(segment.segmentId, candidate);
      }
    }

    const reviewSegments = segments.filter((segment) => candidates.has(segment.segmentId));
    let decisions = new Map<string, ReviewDecision>();
    let reviewResponse = null as Awaited<ReturnType<ProviderAdapter['request']>> | null;
    let reviewElapsed = 0;
    if (reviewSegments.length) {
      const reviewStarted = Date.now();
      reviewResponse = await this.#request(task.taskId, reviewer, {
        model: profile.reviewModel, system: systemWithCustomInstructions(reviewSystemPrompt, profile), responseFormat: 'json', temperature: 0,
        user: `【精确阅读位置】\n${context.contextPosition}\n\n【当前场景/叙事层/世界线】\n${context.narrativeFrames}\n\n【近邻】\n${context.neighbors}\n\n【实体与别名】\n${context.entities}\n\n【当前世界状态】\n${context.worldState}\n\n【字符级切片与段内变化】\n${context.exactSlices}\n${context.segmentTransitions}\n\n【角色知识边界】\n${context.characterKnowledge}\n\n【当前读者已知及已巩固记忆】\n${context.readerFacts}\n${context.readerKnowledge}\n${context.consolidatedMemories}\n\n【仅供消歧、禁止剧透】\n${context.translatorFacts}\n${context.translatorKnowledge}\n${context.futureConsolidatedMemories}\n\n【更早卷系列记忆】\n${context.seriesContext}\n\n【文风决策、多解策略、规则句法】\n${context.styleMemories}\n${context.ambiguities}\n${context.syntaxEvidence}\n\n【历史定向事件】\n${context.directionLedger}\n\n【必须独立复算的 currentSemanticRoles】\n${JSON.stringify(semanticRoles)}\n\n【未决冲突】\n${context.unresolved}\n\n【术语】\n${context.glossary}\n\n【待复核】\n${JSON.stringify(reviewSegments.map((segment) => ({ id: segment.segmentId, jp: segment.sourceText, existingCn: segment.originalTranslation, candidate: candidates.get(segment.segmentId) })), null, 2)}`,
      }, {
        stage: 'review',
        label: `独立复核批次（${reviewSegments.length} 个候选段落）`,
        sourceChars: reviewSegments.reduce((sum, segment) => sum + segment.sourceText.length, 0),
      });
      reviewElapsed = Date.now() - reviewStarted;
      inputTokens += tokenValue(reviewResponse.inputTokens); outputTokens += tokenValue(reviewResponse.outputTokens);
      this.#emitLog('api', 'review', `独立复核完成 (输入 ${reviewResponse.inputTokens ?? 0} / 输出 ${reviewResponse.outputTokens ?? 0} tokens · ${(reviewElapsed / 1000).toFixed(1)}s)`, {
        model: profile.reviewModel, inputTokens: reviewResponse.inputTokens, outputTokens: reviewResponse.outputTokens, elapsedMs: reviewElapsed,
      });
      decisions = reviewMap(reviewResponse.text, reviewSegments.map((segment) => segment.segmentId));
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]; const segment = item.segment!; const candidate = candidates.get(segment.segmentId);
      if (!candidate) {
        this.#repository.finishItem(item.taskItemId, 'completed', null, { inputTokens: index === 0 ? inputTokens : 0, outputTokens: index === 0 ? outputTokens : 0, warning: true });
        continue;
      }
      const decision = decisions.get(segment.segmentId);
      if (!decision || !reviewResponse) throw new Error('独立复核结果缺失。');
      let warning = false;
      if (decision.verdict === 'pass' && decision.confidence >= 0.82) {
        this.#repository.setSegmentStatus(segment.segmentId, 'approved');
        this.#repository.closeSegmentReviews(segment.segmentId, 'auto-resolved', '新候选已经通过确定性检查与独立复核。');
      } else if (decision.verdict === 'revise' && decision.revisedTranslation) {
        const issues = validateTranslationCandidate(segment.sourceText, decision.revisedTranslation);
        if (issues.length) {
          warning = true;
          this.#repository.setSegmentStatus(segment.segmentId, 'needs-human');
          this.#repository.createReviewItem(segment, 'hard-rule', 'must-human', '复核候选违反硬规则', issues.map((issue) => issue.message).join('；'), { decision }, decision.revisedTranslation);
        } else {
          this.#repository.saveTranslationVersion(segment, decision.revisedTranslation, 'independent-review', profile.profileId, profile.reviewModel, context.manifest, reviewResponse, reviewElapsed, 'approved', semanticRoles);
          this.#repository.closeSegmentReviews(segment.segmentId, 'auto-resolved', '独立复核修订稿已经重新通过全部硬规则。');
        }
      } else {
        warning = true;
        this.#repository.setSegmentStatus(segment.segmentId, 'needs-human');
        this.#repository.createReviewItem(segment, decision.issues.some((issue) => /双关|谐音|误读/u.test(issue)) ? 'literary-choice' : 'semantic', 'must-human', '需要人工裁定', decision.issues.join('；') || '独立复核无法可靠裁定。', { confidence: decision.confidence, source: segment.sourceText, candidate }, decision.revisedTranslation || candidate);
      }
      this.#repository.finishItem(item.taskItemId, 'completed', null, { inputTokens: index === 0 ? inputTokens : 0, outputTokens: index === 0 ? outputTokens : 0, warning });
    }
  }
}
