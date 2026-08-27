import JSZip from 'jszip';

export const createEpubFixture = async (options: { readonly compressedMimeType?: boolean; readonly unsafePath?: boolean } = {}) => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: options.compressedMimeType ? 'DEFLATE' : 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file('OPS/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">fixture</dc:identifier>
        <dc:title>検証用の本</dc:title><dc:language>ja</dc:language><dc:creator>作者</dc:creator>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
        <item id="style" href="style.css" media-type="text/css"/>
        <item id="script" href="reader.js" media-type="text/javascript"/>
        <item id="image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
      </manifest>
      <spine page-progression-direction="rtl"><itemref idref="chapter"/></spine>
    </package>`);
  zip.file('OPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#start">序章</a></li></ol></nav></body>
    </html>`);
  zip.file('OPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
      <head><title>Chapter</title><link rel="stylesheet" href="style.css"/><script src="reader.js"></script></head>
      <body><h1 id="start">序章</h1><p>这是中文。</p><p lang="ja">これは日本語です。</p><p>弱い<ruby>身体<rt>からだ</rt></ruby>。</p></body>
    </html>`);
  zip.file('OPS/style.css', 'body { writing-mode: vertical-rl; }');
  zip.file('OPS/reader.js', 'void 0;');
  zip.file('OPS/cover.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  if (options.unsafePath) zip.file('../outside.xhtml', '<html/>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
};
