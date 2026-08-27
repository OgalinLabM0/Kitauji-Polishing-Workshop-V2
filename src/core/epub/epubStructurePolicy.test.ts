import { describe, expect, it } from 'vitest';
import {
  EPUB_STRUCTURE_POLICY,
  validateEpubWriteIntent,
  type EpubWriteIntent,
} from './epubStructurePolicy';

const intent = (overrides: Partial<EpubWriteIntent> = {}): EpubWriteIntent => ({
  mode: 'slot-per-line',
  address: {
    documentPath: 'OEBPS/Text/chapter-01.xhtml',
    elementPath: 'html[1]/body[1]/p[3]/span[1]',
    blockPath: 'html[1]/body[1]/p[3]',
    slot: 'text',
    sourceDigest: 'source-hash',
  },
  currentSourceDigest: 'source-hash',
  translatedFragments: ['译文'],
  expectedFragmentCount: 1,
  expectedOpaqueTokenIds: [],
  returnedOpaqueTokenIds: [],
  opaqueTokenStructureValid: true,
  touchesProtectedSubtree: false,
  requestedAttributeMutations: [],
  ...overrides,
});

describe('EPUB structure policy', () => {
  it('把精确回写和标准打包列为不可关闭的导出条件', () => {
    expect(EPUB_STRUCTURE_POLICY.requireSourceDigestBeforeWrite).toBe(true);
    expect(EPUB_STRUCTURE_POLICY.forbidSilentBlockFlattening).toBe(true);
    expect(EPUB_STRUCTURE_POLICY.requireMimetypeFirstAndStored).toBe(true);
    expect(EPUB_STRUCTURE_POLICY.protectedSubtrees).toContain('rt');
    expect(EPUB_STRUCTURE_POLICY.protectedAttributes).toContain('href');
  });

  it('原文摘要或片段数量不匹配时阻止写回', () => {
    const findings = validateEpubWriteIntent(
      intent({
        currentSourceDigest: 'changed-source',
        translatedFragments: ['第一段', '多出来的一段'],
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'SOURCE_DIGEST_MISMATCH',
      'FRAGMENT_COUNT_MISMATCH',
    ]);
  });

  it('禁止路径穿越、受保护子树和结构属性变更', () => {
    const findings = validateEpubWriteIntent(
      intent({
        address: {
          ...intent().address,
          documentPath: '../outside.xhtml',
        },
        touchesProtectedSubtree: true,
        requestedAttributeMutations: ['href', 'class'],
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'UNSAFE_DOCUMENT_PATH',
      'PROTECTED_SUBTREE_MUTATION',
      'PROTECTED_ATTRIBUTE_MUTATION',
    ]);
  });

  it('复杂行内结构必须完整回传不透明标记且保持合法嵌套', () => {
    const findings = validateEpubWriteIntent(
      intent({
        mode: 'tokenized-block',
        expectedOpaqueTokenIds: ['ruby-1', 'noteref-2'],
        returnedOpaqueTokenIds: ['ruby-1', 'lost-and-replaced'],
        opaqueTokenStructureValid: false,
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'OPAQUE_TOKEN_SET_MISMATCH',
      'OPAQUE_TOKEN_STRUCTURE_INVALID',
    ]);
  });

  it('非法 XML 控制字符不能进入成品', () => {
    expect(
      validateEpubWriteIntent(intent({ translatedFragments: ['正常\u0000异常'] })),
    ).toContainEqual({ code: 'INVALID_XML_CODE_POINT', blocksExport: true });
  });
});
