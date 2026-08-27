import type {
  DecodedTextDocument,
  ParsedChapter,
  ParsedParagraph,
  ProjectTextEncoding,
  TxtImportDocument,
} from './models.cjs';

export const MAX_TXT_SOURCE_BYTES = 64 * 1024 * 1024;

const utf8Bom = [0xef, 0xbb, 0xbf] as const;
const utf16LeBom = [0xff, 0xfe] as const;
const utf16BeBom = [0xfe, 0xff] as const;

const startsWithBytes = (bytes: Uint8Array, prefix: readonly number[]) =>
  prefix.every((value, index) => bytes[index] === value);

const decodeFatal = (bytes: Uint8Array, encoding: ProjectTextEncoding) =>
  new TextDecoder(encoding, { fatal: true }).decode(bytes);

const detectNewline = (text: string): DecodedTextDocument['newline'] => {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const withoutCrlf = text.replace(/\r\n/g, '');
  const lf = (withoutCrlf.match(/\n/g) ?? []).length;
  const cr = (withoutCrlf.match(/\r/g) ?? []).length;
  const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (crlf > 0) return 'crlf';
  return lf > 0 ? 'lf' : 'cr';
};

const validateDecodedText = (text: string) => {
  if (!text.trim()) throw new Error('文本文件没有可导入的内容。');
  if (text.includes('\u0000')) throw new Error('文件包含二进制空字符，不能作为小说文本导入。');
  const controlCharacters = [...text].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t' && character !== '\f';
  }).length;
  if (controlCharacters > Math.max(8, text.length * 0.002)) {
    throw new Error('文件包含过多控制字符，可能不是纯文本。');
  }
};

export const decodeTxtBytes = (input: Uint8Array): DecodedTextDocument => {
  if (input.byteLength === 0) throw new Error('文本文件为空。');
  if (input.byteLength > MAX_TXT_SOURCE_BYTES) throw new Error('文本文件超过 64 MiB 的当前安全上限。');

  let encoding: ProjectTextEncoding;
  let text: string;
  if (startsWithBytes(input, utf8Bom)) {
    encoding = 'utf-8';
    text = decodeFatal(input.subarray(utf8Bom.length), encoding);
  } else if (startsWithBytes(input, utf16LeBom)) {
    encoding = 'utf-16le';
    text = decodeFatal(input.subarray(utf16LeBom.length), encoding);
  } else if (startsWithBytes(input, utf16BeBom)) {
    encoding = 'utf-16be';
    text = decodeFatal(input.subarray(utf16BeBom.length), encoding);
  } else {
    try {
      encoding = 'utf-8';
      text = decodeFatal(input, encoding);
    } catch {
      try {
        encoding = 'shift_jis';
        text = decodeFatal(input, encoding);
      } catch {
        throw new Error('无法可靠识别文本编码；当前支持 UTF-8、UTF-16 和 Shift_JIS。');
      }
    }
  }

  const normalizedText = text.replace(/^\uFEFF/, '');
  validateDecodedText(normalizedText);
  return { encoding, text: normalizedText, newline: detectNewline(normalizedText) };
};

const chapterHeadingPattern = /^(?:第[〇零一二三四五六七八九十百千万0-9０-９]+[章話话部篇編幕]|序章|序幕|プロローグ|終章|终章|エピローグ|幕間|幕间|間章|间章|前書き|あとがき|後書き)(?:[\s　:：\-—].*)?$/u;
const markdownHeadingPattern = /^#{1,3}\s+\S/u;

export const isTxtChapterHeading = (line: string) => {
  const trimmed = line.trim();
  return trimmed.length > 0 && (chapterHeadingPattern.test(trimmed) || markdownHeadingPattern.test(trimmed));
};

const normalizeLines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');

const buildChapter = (
  ordinal: number,
  title: string,
  startLine: number,
  endLine: number,
  bodyLines: readonly { text: string; sourceLine: number }[],
): ParsedChapter => {
  const paragraphs: ParsedParagraph[] = bodyLines.flatMap((line) => {
    if (!line.text.trim()) return [];
    return [{ ordinal: 0, sourceLine: line.sourceLine, text: line.text }];
  }).map((paragraph, index) => ({ ...paragraph, ordinal: index + 1 }));
  const content = bodyLines.map((line) => line.text).join('\n').replace(/^\n+|\n+$/g, '');
  return {
    ordinal,
    title,
    startLine,
    endLine,
    content,
    paragraphs,
    characterCount: paragraphs.reduce((sum, paragraph) => sum + [...paragraph.text].length, 0),
  };
};

export const parseTxtChapters = (text: string): readonly ParsedChapter[] => {
  const lines = normalizeLines(text).map((line, index) => ({ text: line, sourceLine: index + 1 }));
  const headings = lines.filter((line) => isTxtChapterHeading(line.text));
  if (headings.length === 0) {
    return [buildChapter(1, '正文', 1, Math.max(1, lines.length), lines)];
  }

  const chapters: ParsedChapter[] = [];
  const firstHeadingIndex = lines.findIndex((line) => line.sourceLine === headings[0].sourceLine);
  const prefaceLines = lines.slice(0, firstHeadingIndex);
  if (prefaceLines.some((line) => line.text.trim())) {
    chapters.push(buildChapter(chapters.length + 1, '开篇', 1, headings[0].sourceLine - 1, prefaceLines));
  }

  headings.forEach((heading, headingIndex) => {
    const lineIndex = lines.findIndex((line) => line.sourceLine === heading.sourceLine);
    const nextHeadingLine = headings[headingIndex + 1]?.sourceLine;
    const endIndex = nextHeadingLine ? lines.findIndex((line) => line.sourceLine === nextHeadingLine) : lines.length;
    const bodyLines = lines.slice(lineIndex + 1, endIndex);
    chapters.push(buildChapter(
      chapters.length + 1,
      heading.text.trim().replace(/^#{1,3}\s+/, ''),
      heading.sourceLine,
      nextHeadingLine ? nextHeadingLine - 1 : Math.max(heading.sourceLine, lines.length),
      bodyLines,
    ));
  });
  return chapters;
};

export const parseTxtDocument = (bytes: Uint8Array): TxtImportDocument => {
  const decoded = decodeTxtBytes(bytes);
  const chapters = parseTxtChapters(decoded.text);
  return {
    ...decoded,
    chapters,
    paragraphCount: chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0),
    characterCount: chapters.reduce((sum, chapter) => sum + chapter.characterCount, 0),
  };
};
