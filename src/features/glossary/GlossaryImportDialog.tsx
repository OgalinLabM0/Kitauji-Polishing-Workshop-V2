import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Plus, X } from 'lucide-react';
import {
  checkGlossaryImportAgainstExisting,
  parseGlossaryImport,
  removeExistingGlossaryDuplicates,
  type ExistingGlossaryMapping,
  type GlossaryImportFormat,
  type GlossaryImportMode,
  type GlossaryImportProblem,
  type GlossaryImportRecord,
} from '../../core/glossary/glossaryImport';
import type { GlossaryCategory } from '../../core/glossary/models';
import { GLOSSARY_CATEGORY_OPTIONS, glossaryCategoryLabel } from './glossaryLabels';
import type { GlossaryImportHandling } from './importedGlossaryItems';

type ImportTab = 'single' | 'batch';

interface GlossaryImportDialogProps {
  readonly open: boolean;
  readonly existingMappings: readonly ExistingGlossaryMapping[];
  readonly initialTab?: ImportTab;
  readonly initialBatchText?: string;
  readonly onClose: () => void;
  readonly onImport: (records: readonly GlossaryImportRecord[], handling: GlossaryImportHandling) => void;
}

const batchFormatOptions: readonly { value: GlossaryImportMode; label: string }[] = [
  { value: 'auto', label: '自动识别' },
  { value: 'pair-lines', label: '每行一对' },
  { value: 'tsv', label: 'TSV' },
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
];

const formatLabel: Record<GlossaryImportFormat, string> = {
  'pair-lines': '每行一对',
  tsv: 'TSV',
  csv: 'CSV',
  json: 'JSON',
};

const formatProblemLocation = (problem: GlossaryImportProblem, format: GlossaryImportFormat) => {
  if (!problem.line) return '';
  return format === 'json' ? `第 ${problem.line} 项` : `第 ${problem.line} 行`;
};

const formatFileSize = (bytes: number) => bytes < 1024
  ? `${bytes} B`
  : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;

const previewLimit = 200;

export const GlossaryImportDialog = ({
  open,
  existingMappings,
  initialTab = 'single',
  initialBatchText = '',
  onClose,
  onImport,
}: GlossaryImportDialogProps) => {
  const [tab, setTab] = useState<ImportTab>(initialTab);
  const [handling, setHandling] = useState<GlossaryImportHandling>('verify');
  const [sourceTerm, setSourceTerm] = useState('');
  const [canonicalChinese, setCanonicalChinese] = useState('');
  const [category, setCategory] = useState<GlossaryCategory>('other');
  const [pronunciation, setPronunciation] = useState('');
  const [note, setNote] = useState('');
  const [batchText, setBatchText] = useState(initialBatchText);
  const [batchFormat, setBatchFormat] = useState<GlossaryImportMode>('auto');
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    if (initialBatchText) setBatchText(initialBatchText);
  }, [initialBatchText, initialTab, open]);

  const result = useMemo(() => {
    const parsed = tab === 'single'
      ? parseGlossaryImport(JSON.stringify([{
          sourceTerm,
          canonicalChinese,
          category,
          note,
          pronunciation,
        }]), 'json')
      : parseGlossaryImport(batchText, batchFormat);
    const existingProblems = parsed.records.length > 0
      ? checkGlossaryImportAgainstExisting(parsed.records, existingMappings)
      : [];
    return {
      ...parsed,
      problems: [...parsed.problems, ...existingProblems],
      importableRecords: removeExistingGlossaryDuplicates(parsed.records, existingMappings),
    };
  }, [batchFormat, batchText, canonicalChinese, category, existingMappings, note, pronunciation, sourceTerm, tab]);

  if (!open) return null;

  const hasErrors = result.problems.some((problem) => problem.level === 'error');
  const canImport = !hasErrors && result.importableRecords.length > 0;
  const showProblems = tab === 'batch'
    ? batchText.trim().length > 0
    : sourceTerm.trim().length > 0 || canonicalChinese.trim().length > 0;

  const readSelectedFile = async (file?: File) => {
    if (!file) return;
    try {
      setBatchText(await file.text());
      setSelectedFile({ name: file.name, size: file.size });
      const extension = file.name.split('.').pop()?.toLocaleLowerCase();
      if (extension === 'csv' || extension === 'tsv' || extension === 'json') setBatchFormat(extension);
      else setBatchFormat('auto');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const submit = () => {
    if (!canImport) return;
    onImport(result.importableRecords, handling);
  };

  return (
    <div className="glossary-import-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="glossary-import-dialog" role="dialog" aria-modal="true" aria-labelledby="glossary-import-title">
        <header className="glossary-import-head">
          <div>
            <h2 id="glossary-import-title">导入术语</h2>
            <p>日文原词与中文译名必须成对。导入不会修改原文件。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭导入窗口"><X size={16} /></button>
        </header>

        <div className="glossary-import-tabs" role="tablist" aria-label="录入方式">
          <button type="button" role="tab" aria-selected={tab === 'single'} className={tab === 'single' ? 'active' : ''} onClick={() => setTab('single')}>逐条输入</button>
          <button type="button" role="tab" aria-selected={tab === 'batch'} className={tab === 'batch' ? 'active' : ''} onClick={() => setTab('batch')}>批量导入</button>
        </div>

        <div className="glossary-import-body">
          {tab === 'single' ? (
            <div className="glossary-single-entry">
              <div className="glossary-pair-fields">
                <label>
                  <span>日文原词</span>
                  <textarea rows={3} lang="ja" value={sourceTerm} onChange={(event) => setSourceTerm(event.target.value)} placeholder="例：関" autoFocus />
                </label>
                <span className="pair-arrow" aria-hidden="true">→</span>
                <label>
                  <span>中文译名</span>
                  <textarea rows={3} value={canonicalChinese} onChange={(event) => setCanonicalChinese(event.target.value)} placeholder="例：关" />
                </label>
              </div>
              <div className="glossary-entry-details">
                <label>
                  <span>类别</span>
                  <select value={category} onChange={(event) => setCategory(event.target.value as GlossaryCategory)}>
                    {GLOSSARY_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>读音（可空）</span>
                  <input lang="ja" value={pronunciation} onChange={(event) => setPronunciation(event.target.value)} placeholder="例：せき" />
                </label>
                <label className="glossary-note-field">
                  <span>备注（可空）</span>
                  <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="含义、身份或需要核对的线索" />
                </label>
              </div>
              <p className="glossary-field-note">类别不确定时保持“未分类”。人物或动物没有原文证据时，性别保持未知。</p>
            </div>
          ) : (
            <div className="glossary-batch-entry">
              <div className="glossary-format-reference">
                <div className="glossary-format-title">
                  <strong>可用格式</strong>
                  <span>UTF-8 文本</span>
                </div>
                <dl>
                  <div><dt>每行一对</dt><dd><code>関 =&gt; 关</code></dd></div>
                  <div><dt>TSV</dt><dd><code>関[TAB]关[TAB]人物[TAB]角色姓氏</code></dd></div>
                  <div><dt>CSV</dt><dd><code>source,target,category,note,pronunciation</code></dd></div>
                  <div><dt>简单 JSON</dt><dd><code>{'{"関":"关"}'}</code></dd></div>
                  <div><dt>JSON 数组</dt><dd><code>{'[{"src":"関","dst":"关","info":"角色姓氏"}]'}</code></dd></div>
                  <div><dt>Version2</dt><dd><code>{'{"version":2,"entries":[{"sourceTerm":"関","canonicalChinese":"关"}]}'}</code></dd></div>
                  <div><dt>类别</dt><dd>人物、动物、地点、组织、活动、称号、物品、能力、种族、概念、未分类</dd></div>
                </dl>
              </div>

              <div className="glossary-batch-tools">
                <label>
                  <span>格式</span>
                  <select value={batchFormat} onChange={(event) => setBatchFormat(event.target.value as GlossaryImportMode)}>
                    {batchFormatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept=".txt,.tsv,.csv,.json,text/plain,text/tab-separated-values,text/csv,application/json"
                  onChange={(event) => void readSelectedFile(event.target.files?.[0])}
                />
                <button type="button" className="quiet-button" onClick={() => fileInputRef.current?.click()}><FileUp size={14} />选择文件</button>
              </div>
              {selectedFile && (
                <div className="glossary-selected-file">
                  <strong>{selectedFile.name}</strong>
                  <span>{formatFileSize(selectedFile.size)}</span>
                </div>
              )}
              <label className="glossary-batch-text">
                <span>内容</span>
                <textarea value={batchText} onChange={(event) => { setBatchText(event.target.value); setSelectedFile(undefined); }} placeholder={'関 => 关\n祈 => 祈'} spellCheck={false} />
              </label>
            </div>
          )}

          {showProblems && result.problems.length > 0 && (
            <section className="glossary-import-problems" aria-label="导入问题">
              <h3>检查结果</h3>
              <ul>
                {result.problems.map((problem, index) => (
                  <li key={`${problem.code}-${problem.line ?? 0}-${index}`} className={problem.level}>
                    <span>{problem.level === 'error' ? '错误' : '提示'}</span>
                    <strong>{formatProblemLocation(problem, result.format)}</strong>
                    <p>{problem.message}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.records.length > 0 && (
            <section className="glossary-import-preview">
              <header><h3>预览</h3><span>{formatLabel[result.format]} · {result.importableRecords.length} 项可加入</span></header>
              <div className="glossary-import-preview-table" role="table" aria-label="导入预览">
                <div className="glossary-import-preview-row glossary-import-preview-row--head" role="row"><span>日文</span><span>中文</span><span>类别</span><span>备注</span></div>
                {result.records.slice(0, previewLimit).map((record, index) => (
                  <div className="glossary-import-preview-row" role="row" key={`${record.sourceTerm}-${record.canonicalChinese}-${index}`}>
                    <strong lang="ja">{record.sourceTerm}</strong><strong>{record.canonicalChinese}</strong><span>{glossaryCategoryLabel(record.category)}</span><span>{record.note || '—'}</span>
                  </div>
                ))}
              </div>
              {result.records.length > previewLimit && <p className="glossary-preview-limit">只显示前 {previewLimit} 项；其余 {result.records.length - previewLimit} 项仍会导入。</p>}
            </section>
          )}
        </div>

        <footer className="glossary-import-footer">
          <fieldset>
            <legend>导入后</legend>
            <label><input type="radio" name="import-handling" checked={handling === 'verify'} onChange={() => setHandling('verify')} /><span><strong>先匹配原文后核对</strong><small>默认；扫描作品后补语境、实体和变体。</small></span></label>
            <label><input type="radio" name="import-handling" checked={handling === 'locked'} onChange={() => setHandling('locked')} /><span><strong>作为用户锁定译名</strong><small>只锁定实际命中的日中对应。</small></span></label>
          </fieldset>
          <div className="glossary-import-actions">
            <button type="button" className="quiet-button" onClick={onClose}>取消</button>
            <button type="button" className="start-button" disabled={!canImport} onClick={submit}><Plus size={14} />加入 {result.importableRecords.length} 个词条</button>
          </div>
        </footer>
      </section>
    </div>
  );
};
