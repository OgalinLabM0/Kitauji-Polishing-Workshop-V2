import {
  Ban,
  CheckCircle2,
  FileText,
  LockKeyhole,
  MessageSquareQuote,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { assessGlossaryReviewReadiness } from '../../core/glossary/glossaryReview';
import type {
  GlossaryGenderValue,
  GlossaryReferentKind,
  GlossaryReviewBlocker,
} from '../../core/glossary/models';
import type { GlossaryDemoItem } from './sampleGlossaryData';

export type GlossaryReviewDecision = 'pending' | 'approved' | 'revision' | 'excluded';

interface GlossaryInspectorProps {
  readonly item: GlossaryDemoItem;
  readonly selectedCandidate: string;
  readonly selectedResolution: string;
  readonly reviewDecision: GlossaryReviewDecision;
  readonly onSelectCandidate: (candidate: string) => void;
  readonly onSelectResolution: (resolution: string) => void;
  readonly onReviewDecision: (decision: GlossaryReviewDecision) => void;
}

const referentLabel: Record<GlossaryReferentKind, string> = {
  person: '人物',
  animal: '动物',
  place: '地点',
  organization: '组织',
  event: '活动',
  object: '物品',
  ability: '能力',
  species: '种族',
  concept: '概念',
  title: '称号',
  other: '其他',
};

const genderLabel: Record<GlossaryGenderValue, string> = {
  male: '男性',
  female: '女性',
  nonbinary: '非二元 / 作品自定义',
  unknown: '未知',
  'not-applicable': '不适用',
};

const annotationLabel = {
  none: '不注释',
  'first-occurrence': '首次出现',
  pending: '待定',
} as const;

const reviewDecisionLabel: Record<GlossaryReviewDecision, string> = {
  pending: '未处理',
  approved: '已确认',
  revision: '已退回',
  excluded: '已排除',
};

const blockerLabel = (blocker: GlossaryReviewBlocker) => {
  const location = blocker.evidenceId ? ` · ${blocker.evidenceId}` : '';
  const labels = {
    EMPTY_CHINESE_CANDIDATE: '未选择中文译名',
    MISSING_ENTRY_EVIDENCE: '没有代表性证据',
    EVIDENCE_OCCURRENCE_MISSING: '证据不存在或归属错误',
    MISSING_JAPANESE_CONTEXT: '缺少日文语境',
    SOURCE_FORM_NOT_VISIBLE: '原词未出现在所示日文中',
    MISSING_TRANSLATED_CONTEXT: '缺少对应中文',
    MISSING_RENDERED_CHINESE_FORM: '未记录本句实际译法',
  } as const;
  return `${labels[blocker.code]}${location}`;
};

const highlightedExcerpt = (text: string, term?: string) => {
  if (!term) return text;
  const start = text.indexOf(term);
  if (start < 0) return text;
  return <>{text.slice(0, start)}<mark>{term}</mark>{text.slice(start + term.length)}</>;
};

export const GlossaryInspector = ({
  item,
  selectedCandidate,
  selectedResolution,
  reviewDecision,
  onSelectCandidate,
  onSelectResolution,
  onReviewDecision,
}: GlossaryInspectorProps) => {
  const { entry, evidence, reviewRoute, wordplays } = item;
  const ordinaryVariants = item.variants.filter((variant) => variant.kind !== 'phonetic-wordplay');
  const annotatedVariant = item.variants.find((variant) => variant.annotation === 'first-occurrence');
  const wordplay = wordplays[0];
  const readiness = assessGlossaryReviewReadiness(entry, evidence, selectedCandidate);
  const requiresHuman = reviewRoute.kind === 'human';
  const resolutionReady = !wordplay || selectedResolution.trim().length > 0;
  const canApprove = readiness.readyForHumanDecision && resolutionReady;

  return (
    <aside className="glossary-inspector" aria-labelledby="glossary-inspector-title">
      <header className="glossary-inspector__header">
        <div>
          <span className="entry-kicker">{referentLabel[entry.referentKind]} · {entry.entryId}</span>
          <h2 id="glossary-inspector-title" lang="ja">{entry.sourceTerm}</h2>
          {entry.pronunciation && <span className="glossary-reading">{entry.pronunciation}</span>}
        </div>
        <span className={`glossary-status glossary-status--${entry.status}`}>
          {entry.status === 'locked' && <LockKeyhole size={12} />}
          {item.statusLabel}
        </span>
      </header>

      <div className={`entry-route entry-route--${reviewRoute.kind}`}>
        <strong>{reviewRoute.label}</strong>
        <span>{reviewRoute.reason}</span>
      </div>

      <section className="glossary-inspector__section">
        <div className="inspector-section-title"><h3>词条</h3></div>
        <dl className="glossary-definition-list glossary-definition-list--three">
          <div><dt>中文</dt><dd>{entry.canonicalChinese || '未定'}</dd></div>
          <div><dt>实体</dt><dd>{referentLabel[entry.referentKind]}</dd></div>
          <div><dt>性别</dt><dd>{genderLabel[entry.gender.value]}</dd></div>
          <div><dt>出现</dt><dd className="tabular-number">{entry.occurrenceCount} 次</dd></div>
          <div><dt>首见</dt><dd>{entry.firstSeenParagraphId}</dd></div>
          <div><dt>来源</dt><dd>{entry.origin === 'ai-extracted' ? '预读提取' : entry.origin === 'manual' ? '用户录入' : '导入'}</dd></div>
        </dl>
        <p className="glossary-sense">{entry.senseSummary}</p>
        {entry.gender.note && <p className="entity-note">性别记录：{entry.gender.note}</p>}
        {item.candidates.length > 1 && (
          <fieldset className="candidate-line">
            <legend>中文候选</legend>
            <div>
              {item.candidates.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={selectedCandidate === candidate ? 'selected' : ''}
                  aria-pressed={selectedCandidate === candidate}
                  onClick={() => onSelectCandidate(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {item.warning && <div className="glossary-warning"><TriangleAlert size={14} /><p>{item.warning}</p></div>}
      </section>

      {wordplay && (
        <section className="glossary-inspector__section wordplay-section">
          <div className="inspector-section-title"><h3>姓名读法</h3><span>跨章节线索</span></div>
          <div className="wordplay-pair">
            <span lang="ja">{wordplay.sourceForm}</span>
            <span aria-hidden="true">≈</span>
            <strong lang="ja">{wordplay.heardOrAlternateForm}</strong>
          </div>
          <p>{wordplay.narrativeMeaning}</p>
          <dl className="wordplay-evidence">
            <div><dt>依据</dt><dd>{wordplay.evidenceIds.length} 处</dd></div>
            <div><dt>反证</dt><dd>{wordplay.counterEvidenceIds.length > 0 ? `${wordplay.counterEvidenceIds.length} 处` : '未发现'}</dd></div>
            <div><dt>置信度</dt><dd>{wordplay.confidence === 'confirmed' ? '已确认' : '高'}</dd></div>
          </dl>
          <fieldset className="resolution-list">
            <legend>中文处理</legend>
            {wordplay.proposedChineseRenderings.map((resolution, index) => (
              <button
                key={resolution}
                type="button"
                className={selectedResolution === resolution ? 'selected' : ''}
                aria-pressed={selectedResolution === resolution}
                onClick={() => onSelectResolution(resolution)}
              >
                <span>{String.fromCharCode(65 + index)}</span>{resolution}
              </button>
            ))}
          </fieldset>
        </section>
      )}

      <section className="glossary-inspector__section glossary-context-review">
        <div className="inspector-section-title">
          <h3>原文 / 译文</h3>
          <span className="tabular-number">{readiness.pairedContextCount} / {readiness.requiredEvidenceCount}</span>
        </div>
        <div className="evidence-list">
          {evidence.length === 0 && <p className="empty-inline">尚未匹配原文，暂无日中对照。</p>}
          {evidence.map((itemEvidence) => (
            <article id={itemEvidence.occurrenceId} key={itemEvidence.occurrenceId}>
              <header className="evidence-header">
                <strong>{itemEvidence.location}</strong>
                <span className={`translation-state translation-state--${itemEvidence.translationStatus}`}>{itemEvidence.translationStatusLabel}</span>
              </header>
              <div className="evidence-meta" aria-label="语境信息">
                {itemEvidence.speakerLabel && <span>{itemEvidence.speakerLabel}</span>}
                {itemEvidence.targetLabel && <span>→ {itemEvidence.targetLabel}</span>}
                <span>{itemEvidence.sceneLabel}</span>
              </div>
              <div className="parallel-context">
                <section className="context-pane context-pane--japanese">
                  <div><span>日文</span><small lang="ja">{itemEvidence.sourceForm}</small></div>
                  <blockquote lang="ja">{highlightedExcerpt(itemEvidence.japaneseExcerpt, itemEvidence.sourceForm)}</blockquote>
                </section>
                <section className="context-pane context-pane--chinese">
                  <div><span>中文</span><small>{itemEvidence.renderedChineseForm || '未生成'}</small></div>
                  {itemEvidence.translatedChineseExcerpt
                    ? <blockquote>{highlightedExcerpt(itemEvidence.translatedChineseExcerpt, itemEvidence.renderedChineseForm)}</blockquote>
                    : <p className="missing-context">未生成</p>}
                </section>
              </div>
              <p className="evidence-use">{itemEvidence.use}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="glossary-inspector__section glossary-review-decision">
        <div className="inspector-section-title"><h3>{requiresHuman ? '待处理' : '处理记录'}</h3></div>
        {requiresHuman ? (
          <>
            <div className={`review-readiness ${canApprove ? 'ready' : 'blocked'}`}>
              <strong>{canApprove ? '材料齐全' : '材料不全'}</strong>
              <span>{canApprove ? '请选择中文处理后确认' : '补齐缺项后才能确认'}</span>
            </div>
            {readiness.blockers.length > 0 && (
              <ul className="review-blockers">
                {readiness.blockers.map((blocker, index) => <li key={`${blocker.code}-${blocker.evidenceId ?? index}`}>{blockerLabel(blocker)}</li>)}
              </ul>
            )}
            <div className="review-actions">
              <button type="button" className="review-action review-action--approve" disabled={!canApprove} onClick={() => onReviewDecision('approved')}>
                <CheckCircle2 size={14} />采用所选方案
              </button>
              <button type="button" className="review-action" onClick={() => onReviewDecision('revision')}><RotateCcw size={14} />退回补证据</button>
              <button type="button" className="review-action" onClick={() => onReviewDecision('excluded')}><Ban size={14} />不建立词条</button>
            </div>
            <p className={`review-result review-result--${reviewDecision}`} aria-live="polite">{reviewDecisionLabel[reviewDecision]}</p>
          </>
        ) : (
          <div className={`automatic-record automatic-record--${reviewRoute.kind}`}>
            <span>{reviewRoute.label}</span>
            <p>{reviewRoute.reason}</p>
            <button type="button" onClick={() => onReviewDecision('revision')}>{reviewDecision === 'revision' ? '已加入人工复核' : '加入人工复核'}</button>
          </div>
        )}
        <p className="session-note">样例数据；本页操作不保存。</p>
      </section>

      <section className="glossary-inspector__section">
        <div className="inspector-section-title"><MessageSquareQuote size={14} /><h3>称呼与别名</h3></div>
        {ordinaryVariants.length > 0 ? (
          <div className="variant-list">
            {ordinaryVariants.map((variant) => (
              <article className="variant-row" key={variant.variantId}>
                <div className="variant-pair"><span lang="ja">{variant.sourceForm}</span><span aria-hidden="true">→</span><strong>{variant.chineseForm}</strong></div>
                <div className="variant-meta"><span>{variant.kindLabel}</span><span>{variant.direction}</span><span>{annotationLabel[variant.annotation]}</span></div>
                <p>{variant.scopeSummary}</p>
                <a href={`#${variant.evidenceId}`}>证据 {variant.evidenceId}</a>
              </article>
            ))}
          </div>
        ) : <p className="empty-inline">无</p>}
      </section>

      <section className="glossary-inspector__section glossary-annotation-preview">
        <div className="inspector-section-title"><FileText size={14} /><h3>注释</h3></div>
        {wordplay?.annotationRecommended ? (
          <div className="annotation-sample annotation-sample--pending">
            <span>草稿 · 尚未决定</span>
            <p><strong>注</strong>　此处姓名读音被听成“喜欢”，后文仍会回收这一读法。</p>
          </div>
        ) : annotatedVariant ? (
          <div className="annotation-sample">
            <p>正文：……{annotatedVariant.chineseForm}<sup>[注 1]</sup>，你在听吗？</p>
            <p><strong>注 1</strong>　原文在此故意拖长称呼。</p>
          </div>
        ) : <p className="empty-inline">无</p>}
      </section>
    </aside>
  );
};
