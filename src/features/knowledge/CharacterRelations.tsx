import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Sparkles, Users, UserCheck } from 'lucide-react';
import type { GlossaryRecord, MemoryFactRecord } from '../../core/workflow/models';
import { DomainAgentDrawer } from '../agent/DomainAgentDrawer';
import '../../styles/knowledge.css';

const genderLabel: Record<string, string> = {
  unknown: '性别未知',
  male: '男性',
  female: '女性',
  nonbinary: '非二元',
  'not-applicable': '不适用',
};

const numberLabel: Record<string, string> = {
  unknown: '人数未知',
  singular: '单数',
  plural: '复数',
  collective: '集合',
  'not-applicable': '不适用',
};

const factLabel: Record<string, string> = {
  character: '人物状态',
  event: '事件',
  relationship: '关系变化',
  address: '称呼',
  voice: '说话风格',
  viewpoint: '叙述视角',
  setting: '场景设定',
  secret: '秘密',
  foreshadowing: '伏笔',
  pun: '双关 / 谐音',
  'scene-summary': '场景摘要',
  'chapter-summary': '章节摘要',
};

interface ConsolidatedCharacter {
  readonly id: string;
  readonly canonicalSource: string;
  readonly canonicalTranslation: string;
  readonly reading: string | null;
  readonly gender: string;
  readonly grammaticalNumber: string;
  readonly sense: string;
  readonly status: string;
  readonly aliases: readonly string[];
  readonly rawItems: readonly GlossaryRecord[];
}

export const CharacterRelations = ({ projectId }: { readonly projectId: string }) => {
  const api = window.kitaujiDesktop?.workflow;
  const [glossary, setGlossary] = useState<readonly GlossaryRecord[]>([]);
  const [facts, setFacts] = useState<readonly MemoryFactRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [agentOpen, setAgentOpen] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    const [g, f] = await Promise.all([api.glossary(projectId), api.memory(projectId)]);
    setGlossary(g);
    setFacts(f);
  }, [api, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 智能聚合并归并同角色的多形态人名（如将 ターニャ、デグレチャフ 聚合在 ターニャ・デグレチャフ 之下）
  const characters = useMemo<readonly ConsolidatedCharacter[]>(() => {
    const rawPeople = glossary.filter((item) => ['character', 'animal'].includes(item.entityKind));
    if (!rawPeople.length) return [];

    const clusters: ConsolidatedCharacter[] = [];

    for (const person of rawPeople) {
      const source = person.sourceTerm.trim();
      const translation = person.translatedTerm.trim();

      // 寻找可安全归并的已有角色群组（同译名且存在子串关系，或完全一致）
      const existingIdx = clusters.findIndex((c) => {
        if (c.canonicalTranslation === translation) {
          if (c.canonicalSource.includes(source) || source.includes(c.canonicalSource)) return true;
          if (c.aliases.some((a) => a.includes(source) || source.includes(a))) return true;
        }
        return false;
      });

      if (existingIdx >= 0) {
        const existing = clusters[existingIdx];
        const isLongerOrMoreFormal = source.length > existing.canonicalSource.length;
        const canonicalSource = isLongerOrMoreFormal ? source : existing.canonicalSource;
        const reading = existing.reading || person.reading;
        const gender = (existing.gender !== 'unknown' && existing.gender !== 'not-applicable')
          ? existing.gender
          : person.gender;
        const aliases = Array.from(new Set([...existing.aliases, source, existing.canonicalSource])).filter((a) => a !== canonicalSource);

        clusters[existingIdx] = {
          id: existing.id,
          canonicalSource,
          canonicalTranslation: existing.canonicalTranslation || translation,
          reading,
          gender,
          grammaticalNumber: existing.grammaticalNumber !== 'unknown' ? existing.grammaticalNumber : person.grammaticalNumber,
          sense: existing.sense.length >= person.sense.length ? existing.sense : person.sense,
          status: existing.status === 'locked' || person.status === 'locked' ? 'locked' : existing.status,
          aliases,
          rawItems: [...existing.rawItems, person],
        };
      } else {
        clusters.push({
          id: person.glossaryId,
          canonicalSource: source,
          canonicalTranslation: translation,
          reading: person.reading,
          gender: person.gender,
          grammaticalNumber: person.grammaticalNumber,
          sense: person.sense,
          status: person.status,
          aliases: [],
          rawItems: [person],
        });
      }
    }

    // 按全名长度与出现重要度排序
    return clusters.sort((a, b) => b.canonicalSource.length - a.canonicalSource.length);
  }, [glossary]);

  useEffect(() => {
    if (!characters.some((c) => c.canonicalSource === selectedKey)) {
      setSelectedKey(characters[0]?.canonicalSource ?? '');
    }
  }, [characters, selectedKey]);

  const current = characters.find((c) => c.canonicalSource === selectedKey);

  // 跨表智能图谱匹配：打通主名、别名、中文译名与陈述全文
  const relatedFacts = useMemo(() => {
    if (!current) return [];
    const searchKeys = new Set([
      current.canonicalSource,
      current.canonicalTranslation,
      ...current.aliases,
      ...current.rawItems.map((r) => r.sourceTerm),
      ...current.rawItems.map((r) => r.translatedTerm),
    ].filter(Boolean));

    return facts.filter((fact) => {
      const sub = fact.subjectKey?.trim() ?? '';
      const obj = fact.objectKey?.trim() ?? '';
      const stmt = fact.statement ?? '';
      const excerpt = fact.evidenceExcerpt ?? '';

      if (sub && searchKeys.has(sub)) return true;
      if (obj && searchKeys.has(obj)) return true;
      for (const k of searchKeys) {
        if (sub && (sub.includes(k) || k.includes(sub))) return true;
        if (obj && (obj.includes(k) || k.includes(obj))) return true;
        if (stmt.includes(k)) return true;
        if (excerpt.includes(k)) return true;
      }
      return false;
    });
  }, [facts, current]);

  return (
    <div className="knowledge-page character-page">
      <header>
        <Users size={22} />
        <div>
          <p className="eyebrow">人物与关系</p>
          <h1>人物关系簿</h1>
          <p>梳理登场角色、身份设定与人际关系演进时间线，保障长篇翻译称谓连贯统一。</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="glossary-agent-trigger-btn"
            onClick={() => setAgentOpen(true)}
          >
            <Bot size={15} />
            <span>AI 人物关系助理</span>
          </button>
        </div>
      </header>

      <div className="character-layout">
        <aside>
          {characters.length ? (
            characters.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.canonicalSource === selectedKey ? 'active' : ''}
                onClick={() => setSelectedKey(item.canonicalSource)}
              >
                <strong>{item.canonicalTranslation}</strong>
                <span lang="ja">
                  {item.canonicalSource}
                  {item.reading ? ` · ${item.reading}` : ''}
                </span>
                <small>
                  {item.gender === 'not-applicable' ? '' : genderLabel[item.gender] ?? item.gender}
                  {item.aliases.length > 0 ? ` (含 ${item.aliases.length} 别名)` : ''}
                </small>
              </button>
            ))
          ) : (
            <p className="knowledge-empty">全书预读完成后将自动呈现登场人物与关系图谱。</p>
          )}
        </aside>

        <main>
          {current ? (
            <>
              <header>
                <h2>{current.canonicalTranslation}</h2>
                <p lang="ja">
                  {current.canonicalSource}　{current.reading ?? ''}
                </p>
                <span>{current.status}</span>
              </header>

              <dl>
                <div>
                  <dt>身份 / 设定</dt>
                  <dd>{current.sense}</dd>
                </div>
                <div>
                  <dt>性别证据</dt>
                  <dd>{genderLabel[current.gender] ?? current.gender}</dd>
                </div>
                <div>
                  <dt>人数状态</dt>
                  <dd>{numberLabel[current.grammaticalNumber] ?? current.grammaticalNumber}</dd>
                </div>
                {current.aliases.length > 0 && (
                  <div>
                    <dt>多形态别名</dt>
                    <dd>{current.aliases.join('、')}</dd>
                  </div>
                )}
              </dl>

              <section>
                <h3>
                  关系、称呼与人物状态时间线
                  <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: '8px' }}>
                    (共检索到 {relatedFacts.length} 条关联事实)
                  </span>
                </h3>
                {relatedFacts.length ? (
                  relatedFacts.map((fact) => (
                    <article key={fact.factId}>
                      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span>
                          第 {fact.chapterStart} 章
                          {fact.readerVisibleFrom > fact.chapterStart
                            ? ` · 读者第 ${fact.readerVisibleFrom} 章后可知`
                            : ''}
                        </span>
                        <strong>
                          {factLabel[fact.factKind] ?? fact.factKind}
                          {fact.objectKey ? ` → ${fact.objectKey}` : ''}
                        </strong>
                      </header>
                      <p>{fact.statement}</p>
                      {fact.evidenceExcerpt && <blockquote lang="ja">{fact.evidenceExcerpt}</blockquote>}
                    </article>
                  ))
                ) : (
                  <p className="knowledge-empty">暂无与该人物直接关联的事件或称呼记录。</p>
                )}
              </section>
            </>
          ) : (
            <div className="knowledge-empty">请从左侧选择人物查看详情与剧情时间线。</div>
          )}
        </main>
      </div>

      <DomainAgentDrawer
        projectId={projectId}
        domain="character"
        isOpen={agentOpen}
        onClose={() => setAgentOpen(false)}
        onUpdated={load}
      />
    </div>
  );
};
