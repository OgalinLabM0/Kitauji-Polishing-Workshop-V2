import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Link2, Plus, Search, Sparkles, UserCheck, Users } from 'lucide-react';
import type { GlossaryRecord, MemoryFactRecord } from '../../core/workflow/models';
import { DomainAgentDrawer, DomainAgentTriggerButton } from '../agent/DomainAgentDrawer';
import '../../styles/knowledge.css';

const genderLabel: Record<string, string> = {
  unknown: '未知',
  male: '男',
  female: '女',
  nonbinary: '非二元',
  'not-applicable': '不适用',
};

const numberLabel: Record<string, string> = {
  unknown: '单人',
  singular: '单数',
  plural: '复数/群组',
  collective: '集合体',
  'not-applicable': '不适用',
};

const factLabel: Record<string, string> = {
  character: '人物状态',
  event: '关键事件',
  relationship: '关系变化',
  address: '称呼习惯',
  voice: '口癖语态',
  viewpoint: '叙述视角',
  setting: '背景设定',
  secret: '隐秘真相',
  foreshadowing: '重要伏笔',
  pun: '双关/谐音',
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
  const [query, setQuery] = useState('');
  const [genderFilter, setGenderFilter] = useState('all');
  const [agentOpen, setAgentOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [g, f] = await Promise.all([api.glossary(projectId), api.memory(projectId)]);
      setGlossary(g);
      setFacts(f);
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 智能聚合并归并同角色的多形态人名
  const characters = useMemo<readonly ConsolidatedCharacter[]>(() => {
    const rawPeople = glossary.filter((item) => ['character', 'animal'].includes(item.entityKind));
    if (!rawPeople.length) return [];

    const clusters: ConsolidatedCharacter[] = [];

    for (const person of rawPeople) {
      const source = person.sourceTerm.trim();
      const translation = person.translatedTerm.trim();

      const existingIdx = clusters.findIndex((c) => {
        if (c.canonicalTranslation === translation) {
          if (c.canonicalSource.includes(source) || source.includes(c.canonicalSource)) return true;
          if (c.aliases.some((a) => a.includes(source) || source.includes(a))) return true;
        }
        return false;
      });

      if (existingIdx >= 0) {
        const existing = clusters[existingIdx];
        const isLonger = source.length > existing.canonicalSource.length;
        const canonicalSource = isLonger ? source : existing.canonicalSource;
        const reading = existing.reading || person.reading;
        const gender =
          existing.gender !== 'unknown' && existing.gender !== 'not-applicable'
            ? existing.gender
            : person.gender;
        const aliases = Array.from(
          new Set([...existing.aliases, source, existing.canonicalSource]),
        ).filter((a) => a !== canonicalSource);

        clusters[existingIdx] = {
          id: existing.id,
          canonicalSource,
          canonicalTranslation: existing.canonicalTranslation,
          reading,
          gender,
          grammaticalNumber: existing.grammaticalNumber,
          sense: existing.sense || person.sense,
          status: existing.status === 'locked' ? 'locked' : person.status,
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

    return clusters;
  }, [glossary]);

  useEffect(() => {
    if (!selectedKey && characters.length > 0) {
      setSelectedKey(characters[0].canonicalSource);
    }
  }, [characters, selectedKey]);

  const filteredCharacters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => {
      if (genderFilter !== 'all' && c.gender !== genderFilter) return false;
      if (!q) return true;
      return (
        c.canonicalTranslation.toLowerCase().includes(q) ||
        c.canonicalSource.toLowerCase().includes(q) ||
        (c.reading && c.reading.toLowerCase().includes(q)) ||
        c.aliases.some((a) => a.toLowerCase().includes(q)) ||
        c.sense.toLowerCase().includes(q)
      );
    });
  }, [characters, query, genderFilter]);

  const current = useMemo(
    () => characters.find((c) => c.canonicalSource === selectedKey) ?? filteredCharacters[0] ?? null,
    [characters, filteredCharacters, selectedKey],
  );

  const relatedFacts = useMemo(() => {
    if (!current) return [];
    const keys = new Set([
      current.canonicalSource,
      current.canonicalTranslation,
      ...current.aliases,
      ...current.rawItems.map((i) => i.sourceTerm),
      ...current.rawItems.map((i) => i.translatedTerm),
    ]);

    return facts.filter((fact) => {
      const sub = fact.subjectKey ?? '';
      const obj = fact.objectKey ?? '';
      const stmt = fact.statement;
      return (
        keys.has(sub) ||
        keys.has(obj) ||
        Array.from(keys).some((k) => k.length >= 2 && (stmt.includes(k) || fact.evidenceExcerpt.includes(k)))
      );
    });
  }, [facts, current]);

  const relationshipFacts = useMemo(() => {
    return relatedFacts.filter((f) => f.factKind === 'relationship' || f.objectKey);
  }, [relatedFacts]);

  const totalAliases = useMemo(
    () => characters.reduce((sum, c) => sum + c.aliases.length, 0),
    [characters],
  );

  return (
    <div className="knowledge-page character-page">
      {/* 1. Header (Benchmark matching ProjectGlossary) */}
      <header className="knowledge-header">
        <div className="knowledge-header-title">
          <div className="knowledge-header-icon">
            <Users size={22} />
          </div>
          <div>
            <p className="eyebrow">知识与设定</p>
            <h1>登场人物与关系图谱</h1>
            <p className="knowledge-meta-line">
              共归并 <strong>{characters.length}</strong> 位核心人物　/　
              <span>{totalAliases}</span> 个多形态别名　/　
              <span>{facts.length}</span> 条长程事实锚点
            </p>
          </div>
        </div>
        <div className="knowledge-header-actions">
          <DomainAgentTriggerButton label="AI 人物关系助理" onClick={() => setAgentOpen(true)} />
        </div>
      </header>

      {/* 2. Filter Bar */}
      <div className="knowledge-filter-bar">
        <div className="knowledge-filter-group">
          <span>性别筛选：</span>
          {['all', 'female', 'male', 'unknown'].map((g) => (
            <button
              key={g}
              type="button"
              className={`filter-btn ${genderFilter === g ? 'active' : ''}`}
              onClick={() => setGenderFilter(g)}
            >
              {g === 'all' ? '全部角色' : genderLabel[g] ?? g}
            </button>
          ))}
        </div>
        <div className="knowledge-search-wrap">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索人物名、别名、身份设定…"
          />
        </div>
      </div>

      {/* 3. Master-Detail Layout */}
      <div className="character-master-detail">
        {/* Left Character Master List */}
        <aside className="character-sidebar">
          <div className="character-list-head">
            <span>人物清单 ({filteredCharacters.length})</span>
            <small>点击查看详细设定与关系网</small>
          </div>
          <div className="character-list-items">
            {loading ? (
              <div className="knowledge-loading">正在提取登场人物…</div>
            ) : filteredCharacters.length ? (
              filteredCharacters.map((c) => {
                const isActive = c.canonicalSource === current?.canonicalSource;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`character-card-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedKey(c.canonicalSource)}
                  >
                    <div className="character-avatar-badge">
                      {c.canonicalTranslation.slice(0, 1) || '人'}
                    </div>
                    <div className="character-card-info">
                      <div className="character-card-top">
                        <strong className="character-cn-name">{c.canonicalTranslation}</strong>
                        <span className={`gender-chip gender-${c.gender}`}>
                          {genderLabel[c.gender] || c.gender}
                        </span>
                      </div>
                      <span className="character-ja-name" lang="ja">
                        {c.canonicalSource}
                        {c.reading ? ` (${c.reading})` : ''}
                      </span>
                      {c.aliases.length > 0 && (
                        <div className="character-alias-preview">
                          含 {c.aliases.length} 别名: {c.aliases.slice(0, 2).join('、')}
                          {c.aliases.length > 2 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="knowledge-empty">未检索到匹配的人物。</div>
            )}
          </div>
        </aside>

        {/* Right Character Detail Inspector */}
        <main className="character-inspector">
          {current ? (
            <div className="character-profile-container">
              {/* Profile Card Header */}
              <div className="profile-hero-card">
                <div className="profile-hero-left">
                  <div className="profile-hero-avatar">
                    {current.canonicalTranslation.slice(0, 2) || '角色'}
                  </div>
                  <div className="profile-hero-names">
                    <h2>{current.canonicalTranslation}</h2>
                    <p className="profile-hero-source" lang="ja">
                      {current.canonicalSource}
                      {current.reading ? ` 【${current.reading}】` : ''}
                    </p>
                  </div>
                </div>
                <div className="profile-hero-tags">
                  <span className={`status-pill status-${current.status}`}>
                    {current.status === 'locked' ? '🔒 已锁定保护' : '✓ 正常状态'}
                  </span>
                  <span className="gender-pill">
                    {genderLabel[current.gender] ?? current.gender} · {numberLabel[current.grammaticalNumber] ?? '单人'}
                  </span>
                </div>
              </div>

              {/* Grid Metadata Cards */}
              <div className="profile-meta-grid">
                <div className="profile-meta-card">
                  <span className="profile-meta-label">身份 / 世界观设定</span>
                  <p className="profile-meta-content">{current.sense || '暂未提取到具体身份设定。'}</p>
                </div>

                <div className="profile-meta-card">
                  <span className="profile-meta-label">多形态别名与简称 ({current.aliases.length})</span>
                  <div className="profile-alias-chips">
                    {current.aliases.length ? (
                      current.aliases.map((a, i) => (
                        <span key={i} className="alias-chip" lang="ja">
                          {a}
                        </span>
                      ))
                    ) : (
                      <span className="profile-meta-empty">暂无其他别名形态</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Relationship Network Section */}
              <section className="profile-section-card">
                <div className="section-card-head">
                  <Link2 size={16} />
                  <h3>人物关系网络 ({relationshipFacts.length})</h3>
                </div>
                {relationshipFacts.length ? (
                  <div className="relationship-grid">
                    {relationshipFacts.map((fact) => (
                      <div key={fact.factId} className="relationship-pill-card">
                        <div className="relationship-badge-row">
                          <span className="relation-target">
                            ➔ {fact.objectKey || '目标人物'}
                          </span>
                          <span className="relation-type">{factLabel[fact.factKind] ?? fact.factKind}</span>
                        </div>
                        <p className="relation-stmt">{fact.statement}</p>
                        {fact.evidenceExcerpt && (
                          <blockquote className="relation-evidence" lang="ja">
                            “{fact.evidenceExcerpt}”
                          </blockquote>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="profile-section-empty">全书预读中暂未检测到与其他核心角色的直接网络链接。</p>
                )}
              </section>

              {/* Timeline Events & Narrative Evidence */}
              <section className="profile-section-card">
                <div className="section-card-head">
                  <Sparkles size={16} />
                  <h3>台词证据与剧情时间线 ({relatedFacts.length})</h3>
                </div>
                {relatedFacts.length ? (
                  <div className="timeline-stream">
                    {relatedFacts.map((fact) => (
                      <article key={fact.factId} className="timeline-fact-item">
                        <div className="timeline-marker-row">
                          <span className="chapter-pill">第 {fact.chapterStart} 章</span>
                          {fact.readerVisibleFrom > fact.chapterStart && (
                            <span className="visibility-pill">
                              读者第 {fact.readerVisibleFrom} 章后可知
                            </span>
                          )}
                          <span className="fact-kind-tag">
                            {factLabel[fact.factKind] ?? fact.factKind}
                          </span>
                        </div>
                        <p className="timeline-statement">{fact.statement}</p>
                        {fact.evidenceExcerpt && (
                          <blockquote className="timeline-quote" lang="ja">
                            {fact.evidenceExcerpt}
                          </blockquote>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="profile-section-empty">暂无该角色的剧情时间线记录。</p>
                )}
              </section>
            </div>
          ) : (
            <div className="knowledge-empty-placeholder">
              <Users size={36} />
              <p>请从左侧选择人物，查看其详细档案、人物关系网络与证据时间线。</p>
            </div>
          )}
        </main>
      </div>

      {/* Domain Agent Drawer */}
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
