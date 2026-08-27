export const MAX_EPUB_SOURCE_BYTES = 512 * 1024 * 1024;
export const MAX_EPUB_ENTRY_COUNT = 10_000;
export const MAX_EPUB_ENTRY_BYTES = 128 * 1024 * 1024;
export const MAX_EPUB_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
export const MAX_EPUB_COMPRESSION_RATIO = 200;

const localHeaderSignature = 0x04034b50;
const centralHeaderSignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const epubMimeType = 'application/epub+zip';

export interface EpubArchiveEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: 0 | 8;
}

export interface EpubArchiveReport {
  readonly entries: readonly EpubArchiveEntry[];
  readonly totalCompressedBytes: number;
  readonly totalUncompressedBytes: number;
}

const ensureRange = (bytes: Uint8Array, offset: number, length: number, label: string) => {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`EPUB 的 ${label} 超出文件边界。`);
  }
};

const decodeEntryName = (bytes: Uint8Array, utf8: boolean) => {
  if (!utf8 && bytes.some((value) => value > 0x7f)) {
    throw new Error('EPUB 包含未声明 UTF-8 的非 ASCII 文件名，当前不能安全定位。');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('EPUB 包含无法解码的 ZIP 文件名。');
  }
};

const assertSafeEntryName = (name: string) => {
  if (
    !name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[a-z]:/iu.test(name)
  ) {
    throw new Error(`EPUB 包含不安全的文件路径：${name || '(空路径)'}`);
  }
  const parts = name.split('/');
  if (parts.some((part, index) => part === '..' || part === '.' || (part === '' && index !== parts.length - 1))) {
    throw new Error(`EPUB 包含路径穿越或异常路径：${name}`);
  }
};

const findEndOfCentralDirectory = (view: DataView) => {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== endOfCentralDirectorySignature) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new Error('EPUB 缺少有效的 ZIP 中央目录。');
};

const validateMimeTypeEntry = (bytes: Uint8Array, view: DataView) => {
  ensureRange(bytes, 0, 30, 'mimetype 本地头');
  if (view.getUint32(0, true) !== localHeaderSignature) throw new Error('EPUB 的第一个 ZIP 项不是 mimetype。');
  const flags = view.getUint16(6, true);
  const compressionMethod = view.getUint16(8, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  ensureRange(bytes, 30, nameLength + extraLength + epubMimeType.length, 'mimetype 内容');
  const name = decodeEntryName(bytes.subarray(30, 30 + nameLength), Boolean(flags & 0x0800));
  if (name !== 'mimetype') throw new Error('EPUB 的第一个 ZIP 项必须命名为 mimetype。');
  if (compressionMethod !== 0) throw new Error('EPUB 的 mimetype 必须使用 STORE，不得压缩。');
  const contentOffset = 30 + nameLength + extraLength;
  const content = new TextDecoder('ascii').decode(bytes.subarray(contentOffset, contentOffset + epubMimeType.length));
  if (content !== epubMimeType) throw new Error('EPUB 的 mimetype 内容不正确。');
};

export const inspectEpubArchive = (bytes: Uint8Array): EpubArchiveReport => {
  if (bytes.byteLength === 0) throw new Error('EPUB 文件为空。');
  if (bytes.byteLength > MAX_EPUB_SOURCE_BYTES) throw new Error('EPUB 超过 512 MiB 的当前安全上限。');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  validateMimeTypeEntry(bytes, view);
  const eocd = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('当前不支持分卷 ZIP 形式的 EPUB。');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('当前不支持 ZIP64 形式的 EPUB。');
  }
  if (entryCount === 0 || entryCount > MAX_EPUB_ENTRY_COUNT) {
    throw new Error(`EPUB 文件项数量异常：${entryCount}。`);
  }
  ensureRange(bytes, centralOffset, centralSize, '中央目录');

  const entries: EpubArchiveEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    ensureRange(bytes, offset, 46, `第 ${index + 1} 个中央目录项`);
    if (view.getUint32(offset, true) !== centralHeaderSignature) throw new Error('EPUB 的 ZIP 中央目录已损坏。');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('当前不支持含 ZIP64 文件项的 EPUB。');
    }
    if (flags & 0x0001) throw new Error('EPUB 包含加密文件项，无法安全读取。');
    if (method !== 0 && method !== 8) throw new Error(`EPUB 使用了不支持的 ZIP 压缩方法：${method}。`);
    ensureRange(bytes, offset + 46, nameLength + extraLength + commentLength, `第 ${index + 1} 个文件名`);
    const name = decodeEntryName(bytes.subarray(offset + 46, offset + 46 + nameLength), Boolean(flags & 0x0800));
    assertSafeEntryName(name);
    const foldedName = name.toLocaleLowerCase('en-US');
    if (names.has(foldedName)) throw new Error(`EPUB 包含重复文件路径：${name}`);
    names.add(foldedName);

    if (uncompressedSize > MAX_EPUB_ENTRY_BYTES) throw new Error(`EPUB 文件项过大：${name}`);
    if (uncompressedSize > 0 && compressedSize === 0) throw new Error(`EPUB 文件项压缩比例异常：${name}`);
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_EPUB_COMPRESSION_RATIO) {
      throw new Error(`EPUB 文件项压缩比例过高：${name}`);
    }
    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_EPUB_UNCOMPRESSED_BYTES) throw new Error('EPUB 解压后总大小超过 1 GiB 的当前安全上限。');
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod: method,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error('EPUB 中央目录长度与实际条目不一致。');
  if (entries[0]?.name !== 'mimetype') throw new Error('EPUB 中央目录的第一项不是 mimetype。');
  if (entries[0].compressionMethod !== 0 || entries[0].uncompressedSize !== epubMimeType.length) {
    throw new Error('EPUB 的 mimetype 必须是不压缩且无额外内容的标准值。');
  }
  if (!names.has('meta-inf/container.xml')) throw new Error('EPUB 缺少 META-INF/container.xml。');
  if (totalUncompressedBytes / Math.max(1, bytes.byteLength) > MAX_EPUB_COMPRESSION_RATIO) {
    throw new Error('EPUB 整体压缩比例过高，疑似 ZIP bomb。');
  }
  return { entries, totalCompressedBytes, totalUncompressedBytes };
};
