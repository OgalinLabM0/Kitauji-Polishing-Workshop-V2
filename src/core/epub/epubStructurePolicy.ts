export type EpubWriteMode = 'slot-per-line' | 'tokenized-block';
export type EpubTextSlot = 'text' | 'tail' | 'tokenized-block';

export interface EpubNodeAddress {
  readonly documentPath: string;
  readonly elementPath: string;
  readonly blockPath: string;
  readonly slot: EpubTextSlot;
  readonly sourceDigest: string;
}

export interface EpubWriteIntent {
  readonly mode: EpubWriteMode;
  readonly address: EpubNodeAddress;
  readonly currentSourceDigest: string;
  readonly translatedFragments: readonly string[];
  readonly expectedFragmentCount: number;
  readonly expectedOpaqueTokenIds: readonly string[];
  readonly returnedOpaqueTokenIds: readonly string[];
  readonly opaqueTokenStructureValid: boolean;
  readonly touchesProtectedSubtree: boolean;
  readonly requestedAttributeMutations: readonly string[];
}

export type EpubWriteFindingCode =
  | 'UNSAFE_DOCUMENT_PATH'
  | 'SOURCE_DIGEST_MISMATCH'
  | 'FRAGMENT_COUNT_MISMATCH'
  | 'PROTECTED_SUBTREE_MUTATION'
  | 'PROTECTED_ATTRIBUTE_MUTATION'
  | 'OPAQUE_TOKEN_SET_MISMATCH'
  | 'OPAQUE_TOKEN_STRUCTURE_INVALID'
  | 'INVALID_XML_CODE_POINT';

export interface EpubWriteFinding {
  readonly code: EpubWriteFindingCode;
  readonly blocksExport: true;
  readonly detail?: string;
}

export interface EpubStructurePolicy {
  readonly preserveOriginalArchiveSnapshot: true;
  readonly discoverPackageThroughContainerXml: true;
  readonly preserveManifestSpineNavAndNcx: true;
  readonly preserveUnchangedResourcesByteForByte: true;
  readonly requireStableNodeAddresses: true;
  readonly requireSourceDigestBeforeWrite: true;
  readonly forbidLegacySequentialFallbackForFinalExport: true;
  readonly forbidSilentBlockFlattening: true;
  readonly requireOpaqueInlineTokenRoundTrip: true;
  readonly requireMimetypeFirstAndStored: true;
  readonly requirePostWritePackageGraphCheck: true;
  readonly protectedSubtrees: readonly string[];
  readonly protectedAttributes: readonly string[];
}

export const EPUB_STRUCTURE_POLICY: EpubStructurePolicy = Object.freeze({
  preserveOriginalArchiveSnapshot: true,
  discoverPackageThroughContainerXml: true,
  preserveManifestSpineNavAndNcx: true,
  preserveUnchangedResourcesByteForByte: true,
  requireStableNodeAddresses: true,
  requireSourceDigestBeforeWrite: true,
  forbidLegacySequentialFallbackForFinalExport: true,
  forbidSilentBlockFlattening: true,
  requireOpaqueInlineTokenRoundTrip: true,
  requireMimetypeFirstAndStored: true,
  requirePostWritePackageGraphCheck: true,
  protectedSubtrees: Object.freeze([
    'script',
    'style',
    'code',
    'pre',
    'kbd',
    'samp',
    'var',
    'noscript',
    'svg',
    'math',
    'rt',
    'rp',
  ]),
  protectedAttributes: Object.freeze([
    'id',
    'href',
    'src',
    'srcset',
    'poster',
    'epub:type',
    'role',
    'media-type',
    'properties',
  ]),
});

export function validateEpubWriteIntent(
  intent: EpubWriteIntent,
): readonly EpubWriteFinding[] {
  const findings: EpubWriteFinding[] = [];

  if (!isSafeContainerPath(intent.address.documentPath)) {
    findings.push({
      code: 'UNSAFE_DOCUMENT_PATH',
      blocksExport: true,
      detail: intent.address.documentPath,
    });
  }

  if (
    intent.address.sourceDigest === '' ||
    intent.currentSourceDigest !== intent.address.sourceDigest
  ) {
    findings.push({ code: 'SOURCE_DIGEST_MISMATCH', blocksExport: true });
  }

  if (intent.translatedFragments.length !== intent.expectedFragmentCount) {
    findings.push({ code: 'FRAGMENT_COUNT_MISMATCH', blocksExport: true });
  }

  if (intent.touchesProtectedSubtree) {
    findings.push({ code: 'PROTECTED_SUBTREE_MUTATION', blocksExport: true });
  }

  for (const attribute of intent.requestedAttributeMutations) {
    if (EPUB_STRUCTURE_POLICY.protectedAttributes.includes(attribute.toLowerCase())) {
      findings.push({
        code: 'PROTECTED_ATTRIBUTE_MUTATION',
        blocksExport: true,
        detail: attribute,
      });
    }
  }

  if (
    intent.mode === 'tokenized-block' &&
    !haveSameUniqueTokenSet(
      intent.expectedOpaqueTokenIds,
      intent.returnedOpaqueTokenIds,
    )
  ) {
    findings.push({ code: 'OPAQUE_TOKEN_SET_MISMATCH', blocksExport: true });
  }

  if (intent.mode === 'tokenized-block' && !intent.opaqueTokenStructureValid) {
    findings.push({ code: 'OPAQUE_TOKEN_STRUCTURE_INVALID', blocksExport: true });
  }

  if (intent.translatedFragments.some(hasInvalidXmlCodePoint)) {
    findings.push({ code: 'INVALID_XML_CODE_POINT', blocksExport: true });
  }

  return findings;
}

function isSafeContainerPath(path: string): boolean {
  if (
    path === '' ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /[\u0000-\u001f\u007f-\u009f"*:<>?|]/u.test(path)
  ) {
    return false;
  }
  const parts = path.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

function haveSameUniqueTokenSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) {
    return false;
  }
  return [...leftSet].every((token) => rightSet.has(token));
}

function hasInvalidXmlCodePoint(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint !== 0x9 &&
      codePoint !== 0xa &&
      codePoint !== 0xd &&
      !(codePoint >= 0x20 && codePoint <= 0xd7ff) &&
      !(codePoint >= 0xe000 && codePoint <= 0xfffd) &&
      !(codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      return true;
    }
  }
  return false;
}
