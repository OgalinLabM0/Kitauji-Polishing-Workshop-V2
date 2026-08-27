import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import type { GlossaryRecord, MemoryFactRecord } from '../../core/workflow/models';
import '../../styles/knowledge.css';

const genderLabel: Record<string, string> = { unknown: '性别未知', male: '男性', female: '女性', nonbinary: '非二元', 'not-applicable': '不适用' };
const numberLabel: Record<string, string> = { unknown: '人数未知', singular: '单数', plural: '复数', collective: '集合', 'not-applicable': '不适用' };
const factLabel: Record<string, string> = { character: '人物状态', event: '事件', relationship: '关系变化', address: '称呼', voice: '说话风格', viewpoint: '叙述视角', setting: '场景设定', secret: '秘密', foreshadowing: '伏笔', pun: '双关 / 谐音', 'scene-summary': '场景摘要', 'chapter-summary': '章节摘要' };

export const CharacterRelations = ({ projectId }: { readonly projectId: string }) => {
  const api = window.kitaujiDesktop?.workflow;
  const [glossary, setGlossary] = useState<readonly GlossaryRecord[]>([]);
  const [facts, setFacts] = useState<readonly MemoryFactRecord[]>([]);
  const [selected, setSelected] = useState('');
  const load = useCallback(async () => { if (!api) return; const [g, f] = await Promise.all([api.glossary(projectId), api.memory(projectId)]); setGlossary(g); setFacts(f); }, [api, projectId]);
  useEffect(() => { void load(); }, [load]);
  const people = glossary.filter((item) => ['character', 'animal'].includes(item.entityKind));
  useEffect(() => { if (!people.some((item) => item.sourceTerm === selected)) setSelected(people[0]?.sourceTerm ?? ''); }, [people, selected]);
  const current = people.find((item) => item.sourceTerm === selected);
  const related = useMemo(() => facts.filter((fact) => fact.subjectKey === selected || fact.objectKey === selected), [facts, selected]);
  return <div className="knowledge-page character-page"><header><Users size={22} /><div><p className="eyebrow">人物与关系</p><h1>人物关系簿</h1><p>梳理登场角色、身份设定与人际关系演进时间线，保障长篇翻译称谓连贯统一。</p></div></header><div className="character-layout"><aside>{people.length ? people.map((item) => <button type="button" key={item.glossaryId} className={item.sourceTerm === selected ? 'active' : ''} onClick={() => setSelected(item.sourceTerm)}><strong>{item.translatedTerm}</strong><span lang="ja">{item.sourceTerm}{item.reading ? ` · ${item.reading}` : ''}</span><small>{item.gender === 'not-applicable' ? '' : genderLabel[item.gender] ?? item.gender}</small></button>) : <p className="knowledge-empty">全书预读完成后将自动呈现登场人物与关系图谱。</p>}</aside><main>{current ? <><header><h2>{current.translatedTerm}</h2><p lang="ja">{current.sourceTerm}　{current.reading}</p><span>{current.status}</span></header><dl><div><dt>身份 / 词义</dt><dd>{current.sense}</dd></div><div><dt>性别证据</dt><dd>{current.gender === 'unknown' ? '尚无明确证据' : genderLabel[current.gender] ?? current.gender}</dd></div><div><dt>人数证据</dt><dd>{numberLabel[current.grammaticalNumber] ?? current.grammaticalNumber}</dd></div></dl><section><h3>关系、称呼与人物状态时间线</h3>{related.length ? related.map((fact) => <article key={fact.factId}><span>第 {fact.chapterStart} 章{fact.readerVisibleFrom > fact.chapterStart ? ` · 读者第 ${fact.readerVisibleFrom} 章后可知` : ''}</span><strong>{factLabel[fact.factKind] ?? fact.factKind}{fact.objectKey ? ` → ${fact.objectKey}` : ''}</strong><p>{fact.statement}</p><blockquote lang="ja">{fact.evidenceExcerpt}</blockquote></article>) : <p className="knowledge-empty">暂无与该人物直接关联的事件或称呼记录。</p>}</section></> : <div className="knowledge-empty">请从左侧选择人物查看详情与剧情时间线。</div>}</main></div></div>;
};
