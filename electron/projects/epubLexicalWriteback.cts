interface OpenElement {
  readonly name: string;
  readonly path: string;
  readonly contentStart: number;
  readonly childCounts: Map<string, number>;
}

export interface ElementContentRange {
  readonly contentStart: number;
  readonly contentEnd: number;
}

const localName = (qualifiedName: string) => qualifiedName.split(':').at(-1)?.toLocaleLowerCase('en-US') ?? '';

const scanTagEnd = (source: string, start: number) => {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  throw new Error('XHTML 标签没有闭合。');
};

const skipDeclaration = (source: string, start: number) => {
  let quote = '';
  let bracketDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') bracketDepth += 1;
    else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === '>' && bracketDepth === 0) return index + 1;
  }
  throw new Error('XHTML 声明没有闭合。');
};

const readTagName = (source: string, offset: number) => {
  const match = source.slice(offset).match(/^\s*([A-Za-z_][\w.:-]*)/u);
  return match ? { name: localName(match[1]), length: match[0].length } : null;
};

export const locateElementContentRange = (source: string, targetPath: string): ElementContentRange => {
  const stack: OpenElement[] = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) break;
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end < 0) throw new Error('XHTML 注释没有闭合。');
      index = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end < 0) throw new Error('XHTML CDATA 没有闭合。');
      index = end + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2);
      if (end < 0) throw new Error('XHTML 处理指令没有闭合。');
      index = end + 2;
      continue;
    }
    if (source.startsWith('<!', open)) {
      index = skipDeclaration(source, open + 2);
      continue;
    }
    if (source.startsWith('</', open)) {
      const tag = readTagName(source, open + 2);
      const end = scanTagEnd(source, open + 2);
      const current = stack.pop();
      if (!tag || !current || current.name !== tag.name) throw new Error('XHTML 元素嵌套与导入记录不一致。');
      if (current.path === targetPath) return { contentStart: current.contentStart, contentEnd: open };
      index = end + 1;
      continue;
    }
    const tag = readTagName(source, open + 1);
    const end = scanTagEnd(source, open + 1);
    if (!tag) throw new Error('XHTML 含无法识别的标签。');
    const parent = stack.at(-1);
    const occurrence = (parent?.childCounts.get(tag.name) ?? 0) + 1;
    parent?.childCounts.set(tag.name, occurrence);
    const elementPath = `${parent?.path ?? ''}/${tag.name}[${occurrence}]`;
    const selfClosing = /\/\s*>$/u.test(source.slice(open, end + 1));
    if (selfClosing) {
      if (elementPath === targetPath) return { contentStart: end, contentEnd: end };
    } else {
      stack.push({ name: tag.name, path: elementPath, contentStart: end + 1, childCounts: new Map() });
    }
    index = end + 1;
  }
  throw new Error(`无法在原 XHTML 中定位节点：${targetPath}`);
};

export const hasInvalidXmlCodePoint = (text: string) => {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint !== 0x9 && codePoint !== 0xa && codePoint !== 0xd &&
      !(codePoint >= 0x20 && codePoint <= 0xd7ff) &&
      !(codePoint >= 0xe000 && codePoint <= 0xfffd) &&
      !(codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) return true;
  }
  return false;
};

export const escapeXmlText = (text: string) => text
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;');
