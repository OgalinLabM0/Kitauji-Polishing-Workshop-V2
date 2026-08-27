import { describe, expect, it } from 'vitest';
import {
  checkGlossaryImportAgainstExisting,
  detectGlossaryImportFormat,
  parseGlossaryImport,
  removeExistingGlossaryDuplicates,
} from './glossaryImport';

describe('glossary import', () => {
  it('parses one mapping per line and ignores comments', () => {
    const result = parseGlossaryImport('# 人名\n関 => 关\n祈 -> 祈\n');
    expect(result.format).toBe('pair-lines');
    expect(result.records).toEqual([
      expect.objectContaining({ sourceTerm: '関', canonicalChinese: '关', category: 'other', sourceLine: 2 }),
      expect.objectContaining({ sourceTerm: '祈', canonicalChinese: '祈', category: 'other', sourceLine: 3 }),
    ]);
    expect(result.problems).toEqual([]);
  });

  it('parses TSV headers, category aliases and notes', () => {
    const result = parseGlossaryImport('日文\t中文\t类别\t备注\n久美子\t久美子\t人物\t主人公', 'tsv');
    expect(result.records[0]).toMatchObject({
      sourceTerm: '久美子', canonicalChinese: '久美子', category: 'character', note: '主人公', sourceLine: 2,
    });
  });

  it('parses quoted CSV fields including commas and escaped quotes', () => {
    const result = parseGlossaryImport('source,target,category,note\n関,关,character,"称呼有“正式,亲近”两类"', 'csv');
    expect(result.records[0]).toMatchObject({ category: 'character', note: '称呼有“正式,亲近”两类' });
    expect(result.problems).toEqual([]);
  });

  it('accepts a compact JSON mapping object', () => {
    const result = parseGlossaryImport('{"関":"关","祈":"祈"}');
    expect(result.format).toBe('json');
    expect(result.records.map((record) => [record.sourceTerm, record.canonicalChinese])).toEqual([['関', '关'], ['祈', '祈']]);
  });

  it('accepts array aliases and Version2 entries', () => {
    const aliases = parseGlossaryImport('[{"src":"祁帆","dst":"祁帆","info":"姓名谐音"}]');
    const version2 = parseGlossaryImport(JSON.stringify({
      version: 2,
      entries: [{ sourceTerm: '北宇治高校', canonicalChinese: '北宇治高中', category: 'organization', pronunciation: 'きたうじこうこう' }],
    }));
    expect(aliases.records[0]).toMatchObject({ sourceTerm: '祁帆', canonicalChinese: '祁帆', note: '姓名谐音' });
    expect(version2.records[0]).toMatchObject({ category: 'organization', pronunciation: 'きたうじこうこう' });
  });

  it('reports the exact line for malformed and incomplete rows', () => {
    const result = parseGlossaryImport('関 => 关\n这行不完整\n祈 =>');
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNRECOGNIZED_ROW', line: 2 }),
      expect.objectContaining({ code: 'MISSING_TARGET', line: 3 }),
    ]));
  });

  it('merges exact duplicates and blocks conflicting translations', () => {
    const result = parseGlossaryImport('関 => 关\n関 => 关\n関 => 关同学');
    expect(result.records).toHaveLength(1);
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warning', code: 'DUPLICATE_ROW', line: 2 }),
      expect.objectContaining({ level: 'error', code: 'CONFLICTING_TARGET', line: 3 }),
    ]));
  });

  it('checks existing glossary conflicts and filters only exact repeats', () => {
    const records = parseGlossaryImport('関 => 关\n祈 => 小祈\n麗奈 => 丽奈').records;
    const existing = [
      { sourceTerm: '関', canonicalChinese: '关' },
      { sourceTerm: '祈', canonicalChinese: '祈' },
    ];
    expect(checkGlossaryImportAgainstExisting(records, existing)).toEqual([
      expect.objectContaining({ level: 'warning', code: 'ALREADY_EXISTS' }),
      expect.objectContaining({ level: 'error', code: 'CONFLICTING_TARGET' }),
    ]);
    expect(removeExistingGlossaryDuplicates(records, existing).map((record) => record.sourceTerm)).toEqual(['祈', '麗奈']);
  });

  it('detects supported formats without relying on filename extensions', () => {
    expect(detectGlossaryImportFormat('関\t关')).toBe('tsv');
    expect(detectGlossaryImportFormat('source,target\n関,关')).toBe('csv');
    expect(detectGlossaryImportFormat('[{"src":"関","dst":"关"}]')).toBe('json');
  });
});
