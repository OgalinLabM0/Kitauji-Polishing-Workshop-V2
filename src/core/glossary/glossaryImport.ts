import type { GlossaryCategory } from './models';

export type GlossaryImportFormat = 'pair-lines' | 'tsv' | 'csv' | 'json';
export type GlossaryImportMode = GlossaryImportFormat | 'auto';

export interface GlossaryImportRecord {
  readonly sourceTerm: string;
  readonly canonicalChinese: string;
  readonly category: GlossaryCategory;
  readonly note?: string;
  readonly pronunciation?: string;
  readonly sourceLine?: number;
}

export type GlossaryImportProblemCode =
  | 'EMPTY_INPUT'
  | 'UNRECOGNIZED_ROW'
  | 'MISSING_SOURCE'
  | 'MISSING_TARGET'
  | 'INVALID_CATEGORY'
  | 'INVALID_CSV'
  | 'INVALID_JSON'
  | 'INVALID_JSON_SHAPE'
  | 'DUPLICATE_ROW'
  | 'CONFLICTING_TARGET'
  | 'ALREADY_EXISTS';

export interface GlossaryImportProblem {
  readonly level: 'error' | 'warning';
  readonly code: GlossaryImportProblemCode;
  readonly message: string;
  readonly line?: number;
}

export interface GlossaryImportResult {
  readonly format: GlossaryImportFormat;
  readonly records: readonly GlossaryImportRecord[];
  readonly problems: readonly GlossaryImportProblem[];
}

export interface ExistingGlossaryMapping {
  readonly sourceTerm: string;
  readonly canonicalChinese: string;
}

interface CsvRow {
  readonly cells: readonly string[];
  readonly line: number;
}

const categoryAliases: Readonly<Record<string, GlossaryCategory>> = {
  character: 'character',
  person: 'character',
  人物: 'character',
  角色: 'character',
  人名: 'character',
  animal: 'animal',
  动物: 'animal',
  動物: 'animal',
  place: 'place',
  location: 'place',
  地点: 'place',
  地點: 'place',
  地名: 'place',
  organization: 'organization',
  organisation: 'organization',
  org: 'organization',
  组织: 'organization',
  組織: 'organization',
  event: 'event',
  活动: 'event',
  活動: 'event',
  事件: 'event',
  title: 'title',
  称号: 'title',
  稱號: 'title',
  头衔: 'title',
  item: 'item',
  object: 'item',
  物品: 'item',
  道具: 'item',
  ability: 'ability',
  能力: 'ability',
  技能: 'ability',
  species: 'species',
  种族: 'species',
  種族: 'species',
  concept: 'concept',
  概念: 'concept',
  other: 'other',
  其他: 'other',
  未分类: 'other',
  未分類: 'other',
};

const sourceHeaders = new Set(['source', 'src', 'sourceterm', 'japanese', 'ja', '日文', '原文', '原词', '原詞']);
const targetHeaders = new Set(['target', 'dst', 'canonicalchinese', 'chinese', 'zh', '中文', '译名', '譯名', '翻译', '翻譯']);
const categoryHeaders = new Set(['category', 'type', 'kind', '类别', '類別', '类型', '類型']);
const noteHeaders = new Set(['note', 'info', 'comment', '备注', '備註', '说明', '說明']);
const pronunciationHeaders = new Set(['pronunciation', 'reading', '读音', '讀音']);

const normalizeHeader = (value: string) => value.trim().replace(/[\s_-]+/g, '').toLocaleLowerCase();

export const normalizeGlossaryCategory = (value?: string): GlossaryCategory | undefined => {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized ? categoryAliases[normalized] : undefined;
};

export const detectGlossaryImportFormat = (text: string): GlossaryImportFormat => {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';

  const firstContentLine = text.split(/\r?\n/).find((line) => line.trim() && !line.trimStart().startsWith('#')) ?? '';
  if (firstContentLine.includes('\t')) return 'tsv';
  if (/=>|->|→/.test(firstContentLine)) return 'pair-lines';

  const normalizedFirstCells = firstContentLine.split(',').map(normalizeHeader);
  if (normalizedFirstCells.some((cell) => sourceHeaders.has(cell)) && normalizedFirstCells.some((cell) => targetHeaders.has(cell))) {
    return 'csv';
  }
  return firstContentLine.includes(',') ? 'csv' : 'pair-lines';
};

const makeRecord = (
  source: unknown,
  target: unknown,
  category: unknown,
  note: unknown,
  pronunciation: unknown,
  line: number | undefined,
  problems: GlossaryImportProblem[],
): GlossaryImportRecord | undefined => {
  const sourceTerm = typeof source === 'string' ? source.trim() : '';
  const canonicalChinese = typeof target === 'string' ? target.trim() : '';
  const rawCategory = typeof category === 'string' ? category.trim() : '';

  if (!sourceTerm) {
    problems.push({ level: 'error', code: 'MISSING_SOURCE', line, message: '缺少日文原词。' });
  }
  if (!canonicalChinese) {
    problems.push({ level: 'error', code: 'MISSING_TARGET', line, message: '缺少中文译名。' });
  }
  const normalizedCategory = normalizeGlossaryCategory(rawCategory);
  if (rawCategory && !normalizedCategory) {
    problems.push({ level: 'error', code: 'INVALID_CATEGORY', line, message: `无法识别类别“${rawCategory}”。` });
  }
  if (!sourceTerm || !canonicalChinese || (rawCategory && !normalizedCategory)) return undefined;

  const normalizedNote = typeof note === 'string' ? note.trim() : '';
  const normalizedPronunciation = typeof pronunciation === 'string' ? pronunciation.trim() : '';
  return {
    sourceTerm,
    canonicalChinese,
    category: normalizedCategory ?? 'other',
    ...(normalizedNote ? { note: normalizedNote } : {}),
    ...(normalizedPronunciation ? { pronunciation: normalizedPronunciation } : {}),
    ...(line === undefined ? {} : { sourceLine: line }),
  };
};

const parsePairLines = (text: string): GlossaryImportResult => {
  const records: GlossaryImportRecord[] = [];
  const problems: GlossaryImportProblem[] = [];

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = /=>|->|→/.exec(trimmed);
    if (!separator || separator.index === undefined) {
      problems.push({ level: 'error', code: 'UNRECOGNIZED_ROW', line, message: '这一行需要使用“日文 => 中文”。' });
      return;
    }
    const source = trimmed.slice(0, separator.index);
    const target = trimmed.slice(separator.index + separator[0].length);
    const record = makeRecord(source, target, undefined, undefined, undefined, line, problems);
    if (record) records.push(record);
  });

  return finalizeImport('pair-lines', records, problems);
};

const isHeaderRow = (cells: readonly string[]) => {
  const normalized = cells.map(normalizeHeader);
  return normalized.some((cell) => sourceHeaders.has(cell)) && normalized.some((cell) => targetHeaders.has(cell));
};

const headerIndexes = (cells: readonly string[]) => {
  const normalized = cells.map(normalizeHeader);
  const find = (headers: ReadonlySet<string>) => normalized.findIndex((cell) => headers.has(cell));
  return {
    source: find(sourceHeaders),
    target: find(targetHeaders),
    category: find(categoryHeaders),
    note: find(noteHeaders),
    pronunciation: find(pronunciationHeaders),
  };
};

const parseTsv = (text: string): GlossaryImportResult => {
  const rows: CsvRow[] = text.split(/\r?\n/).flatMap((rawLine, index) => {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) return [];
    return [{ cells: rawLine.split('\t'), line: index + 1 }];
  });
  const records: GlossaryImportRecord[] = [];
  const problems: GlossaryImportProblem[] = [];
  const indexes = rows[0] && isHeaderRow(rows[0].cells)
    ? headerIndexes(rows.shift()!.cells)
    : { source: 0, target: 1, category: 2, note: 3, pronunciation: 4 };

  rows.forEach((row) => {
    const record = makeRecord(
      row.cells[indexes.source],
      row.cells[indexes.target],
      indexes.category >= 0 ? row.cells[indexes.category] : undefined,
      indexes.note >= 0 ? row.cells[indexes.note] : undefined,
      indexes.pronunciation >= 0 ? row.cells[indexes.pronunciation] : undefined,
      row.line,
      problems,
    );
    if (record) records.push(record);
  });
  return finalizeImport('tsv', records, problems);
};

const readCsvRows = (text: string, problems: GlossaryImportProblem[]): CsvRow[] => {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const finishRow = () => {
    cells.push(cell);
    if (cells.some((value) => value.trim())) rows.push({ cells, line: rowStartLine });
    cells = [];
    cell = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (character === ',' && !inQuotes) {
      cells.push(cell);
      cell = '';
      continue;
    }
    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRow();
      line += 1;
      rowStartLine = line;
      continue;
    }
    if (character === '\n') line += 1;
    cell += character;
  }

  if (inQuotes) {
    problems.push({ level: 'error', code: 'INVALID_CSV', line: rowStartLine, message: 'CSV 引号没有闭合。' });
  }
  if (cell.length > 0 || cells.length > 0) finishRow();
  return rows;
};

const parseCsv = (text: string): GlossaryImportResult => {
  const records: GlossaryImportRecord[] = [];
  const problems: GlossaryImportProblem[] = [];
  const rows = readCsvRows(text, problems);
  const indexes = rows[0] && isHeaderRow(rows[0].cells)
    ? headerIndexes(rows.shift()!.cells)
    : { source: 0, target: 1, category: 2, note: 3, pronunciation: 4 };

  rows.forEach((row) => {
    const record = makeRecord(
      row.cells[indexes.source],
      row.cells[indexes.target],
      indexes.category >= 0 ? row.cells[indexes.category] : undefined,
      indexes.note >= 0 ? row.cells[indexes.note] : undefined,
      indexes.pronunciation >= 0 ? row.cells[indexes.pronunciation] : undefined,
      row.line,
      problems,
    );
    if (record) records.push(record);
  });
  return finalizeImport('csv', records, problems);
};

const objectValue = (value: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) {
    if (value[key] !== undefined) return value[key];
  }
  return undefined;
};

const parseJsonRecord = (
  value: unknown,
  itemNumber: number,
  problems: GlossaryImportProblem[],
): GlossaryImportRecord | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    problems.push({ level: 'error', code: 'INVALID_JSON_SHAPE', line: itemNumber, message: `JSON 第 ${itemNumber} 项不是词条对象。` });
    return undefined;
  }
  const object = value as Record<string, unknown>;
  return makeRecord(
    objectValue(object, ['sourceTerm', 'source', 'src', 'japanese', 'ja']),
    objectValue(object, ['canonicalChinese', 'target', 'dst', 'chinese', 'zh']),
    objectValue(object, ['category', 'type', 'kind']),
    objectValue(object, ['note', 'info', 'comment']),
    objectValue(object, ['pronunciation', 'reading']),
    itemNumber,
    problems,
  );
};

const parseJson = (text: string): GlossaryImportResult => {
  const records: GlossaryImportRecord[] = [];
  const problems: GlossaryImportProblem[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '语法错误';
    return { format: 'json', records, problems: [{ level: 'error', code: 'INVALID_JSON', message: `JSON 无法解析：${detail}` }] };
  }

  if (Array.isArray(parsed)) {
    parsed.forEach((value, index) => {
      const record = parseJsonRecord(value, index + 1, problems);
      if (record) records.push(record);
    });
    return finalizeImport('json', records, problems);
  }

  if (parsed && typeof parsed === 'object') {
    const object = parsed as Record<string, unknown>;
    if (Array.isArray(object.entries)) {
      object.entries.forEach((value, index) => {
        const record = parseJsonRecord(value, index + 1, problems);
        if (record) records.push(record);
      });
      return finalizeImport('json', records, problems);
    }

    const looksLikeSingleRecord = objectValue(object, ['sourceTerm', 'source', 'src']) !== undefined;
    if (looksLikeSingleRecord) {
      const record = parseJsonRecord(object, 1, problems);
      if (record) records.push(record);
      return finalizeImport('json', records, problems);
    }

    Object.entries(object).forEach(([source, target], index) => {
      if (typeof target !== 'string') {
        problems.push({ level: 'error', code: 'INVALID_JSON_SHAPE', line: index + 1, message: `“${source}”的译名必须是字符串。` });
        return;
      }
      const record = makeRecord(source, target, undefined, undefined, undefined, index + 1, problems);
      if (record) records.push(record);
    });
    return finalizeImport('json', records, problems);
  }

  problems.push({ level: 'error', code: 'INVALID_JSON_SHAPE', message: 'JSON 顶层必须是对象或数组。' });
  return { format: 'json', records, problems };
};

const finalizeImport = (
  format: GlossaryImportFormat,
  records: readonly GlossaryImportRecord[],
  initialProblems: readonly GlossaryImportProblem[],
): GlossaryImportResult => {
  const problems = [...initialProblems];
  const uniqueRecords: GlossaryImportRecord[] = [];
  const targetsBySource = new Map<string, string>();

  records.forEach((record) => {
    const knownTarget = targetsBySource.get(record.sourceTerm);
    if (knownTarget === record.canonicalChinese) {
      problems.push({ level: 'warning', code: 'DUPLICATE_ROW', line: record.sourceLine, message: `“${record.sourceTerm} → ${record.canonicalChinese}”重复，已合并。` });
      return;
    }
    if (knownTarget !== undefined) {
      problems.push({ level: 'error', code: 'CONFLICTING_TARGET', line: record.sourceLine, message: `“${record.sourceTerm}”同时对应“${knownTarget}”和“${record.canonicalChinese}”。` });
      return;
    }
    targetsBySource.set(record.sourceTerm, record.canonicalChinese);
    uniqueRecords.push(record);
  });

  if (uniqueRecords.length === 0 && problems.length === 0) {
    problems.push({ level: 'error', code: 'EMPTY_INPUT', message: '没有可导入的词条。' });
  }
  return { format, records: uniqueRecords, problems };
};

export const parseGlossaryImport = (text: string, mode: GlossaryImportMode = 'auto'): GlossaryImportResult => {
  const format = mode === 'auto' ? detectGlossaryImportFormat(text) : mode;
  if (!text.trim()) return { format, records: [], problems: [{ level: 'error', code: 'EMPTY_INPUT', message: '没有可导入的词条。' }] };
  if (format === 'json') return parseJson(text);
  if (format === 'csv') return parseCsv(text);
  if (format === 'tsv') return parseTsv(text);
  return parsePairLines(text);
};

export const checkGlossaryImportAgainstExisting = (
  records: readonly GlossaryImportRecord[],
  existingMappings: readonly ExistingGlossaryMapping[],
): readonly GlossaryImportProblem[] => {
  const existing = new Map(existingMappings.map((mapping) => [mapping.sourceTerm.trim(), mapping.canonicalChinese.trim()]));
  const problems: GlossaryImportProblem[] = [];
  records.forEach((record) => {
    const knownTarget = existing.get(record.sourceTerm);
    if (knownTarget === undefined) return;
    if (knownTarget === record.canonicalChinese) {
      problems.push({ level: 'warning', code: 'ALREADY_EXISTS', line: record.sourceLine, message: `“${record.sourceTerm} → ${record.canonicalChinese}”已经存在，本次会跳过。` });
      return;
    }
    problems.push({ level: 'error', code: 'CONFLICTING_TARGET', line: record.sourceLine, message: `“${record.sourceTerm}”现有译名为“${knownTarget}”，不能直接改成“${record.canonicalChinese}”。` });
  });
  return problems;
};

export const removeExistingGlossaryDuplicates = (
  records: readonly GlossaryImportRecord[],
  existingMappings: readonly ExistingGlossaryMapping[],
) => {
  const existing = new Map(existingMappings.map((mapping) => [mapping.sourceTerm.trim(), mapping.canonicalChinese.trim()]));
  return records.filter((record) => existing.get(record.sourceTerm) !== record.canonicalChinese);
};
