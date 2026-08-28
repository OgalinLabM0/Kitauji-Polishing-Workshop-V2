import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { ProjectChapterSummary, ProjectSnapshot } from '../../core/projects/models';
import type { WorkbenchSegment } from '../../core/workflow/models';
import { readerSegmentPresentation, type ReaderMode } from './readerContentPolicy';

export type { ReaderMode } from './readerContentPolicy';
export type ReaderLayout = 'scroll' | 'paginated';
export type ReaderTheme = 'ivory' | 'white' | 'sepia' | 'dark' | 'oled';
export type ReaderFontFamily = 'serif' | 'sans' | 'kaiti';

export interface ReaderPreferences {
  readonly mode: ReaderMode;
  readonly layout: ReaderLayout;
  readonly theme: ReaderTheme;
  readonly fontFamily: ReaderFontFamily;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly paragraphSpacing: number;
  readonly indent: boolean;
  readonly width: number;
}

export interface IllustrationItem {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly dataUrl: string;
  readonly chapterOrdinal?: number;
}

const THEME_STYLES: Record<ReaderTheme, { bg: string; text: string; sub: string; line: string; cardBg: string }> = {
  ivory: {
    bg: '#faf7f2',
    text: '#2c2523',
    sub: '#7c726a',
    line: '#e8e2d8',
    cardBg: '#f3efe6',
  },
  white: {
    bg: '#ffffff',
    text: '#1f2421',
    sub: '#6b7280',
    line: '#e5e7eb',
    cardBg: '#f9fafb',
  },
  sepia: {
    bg: '#f4ece1',
    text: '#3b2f2f',
    sub: '#857367',
    line: '#ded3c5',
    cardBg: '#ebdccb',
  },
  dark: {
    bg: '#1c1917',
    text: '#e7d8c5',
    sub: '#a89a8c',
    line: '#332c27',
    cardBg: '#26221f',
  },
  oled: {
    bg: '#000000',
    text: '#d4d4d8',
    sub: '#71717a',
    line: '#27272a',
    cardBg: '#121212',
  },
};

const FONT_FAMILIES: Record<ReaderFontFamily, string> = {
  serif: '"Noto Serif SC", "Source Han Serif SC", "Yu Mincho", "Songti SC", serif',
  sans: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  kaiti: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", serif',
};

const resolveRelativePath = (base: string, relative: string): string => {
  const stack = base.split('/');
  stack.pop();
  for (const part of relative.split('/')) {
    if (part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
};

const guessMimeType = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
};

export function useCalibreReader(
  project: ProjectSnapshot | null,
  chapter: ProjectChapterSummary | null,
  segments: readonly WorkbenchSegment[],
  preferences: ReaderPreferences,
) {
  const [zip, setZip] = useState<JSZip | null>(null);
  const [loading, setLoading] = useState(false);
  const [chapterHtml, setChapterHtml] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<readonly IllustrationItem[]>([]);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 1. Load Zip Archive on project change
  useEffect(() => {
    if (!project || project.project.sourceFormat !== 'epub') {
      setZip(null);
      setGallery([]);
      return;
    }

    let isMounted = true;
    const desktopApi = window.kitaujiDesktop?.projects;

    if (desktopApi?.readSourceFile) {
      void desktopApi.readSourceFile(project.project.projectId).then(async (base64) => {
        if (!base64 || !isMounted) return;
        try {
          const loadedZip = await JSZip.loadAsync(base64, { base64: true });
          if (!isMounted) return;
          setZip(loadedZip);

          // Extract all illustrations for the Gallery
          const imageEntries: IllustrationItem[] = [];
          const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

          for (const [filename, file] of Object.entries(loadedZip.files)) {
            if (file.dir) continue;
            const lower = filename.toLowerCase();
            if (imageExtensions.some((ext) => lower.endsWith(ext))) {
              try {
                const b64 = await file.async('base64');
                const mime = guessMimeType(filename);
                const dataUrl = `data:${mime};base64,${b64}`;
                const title = filename.split('/').pop() || '插画';
                imageEntries.push({
                  id: filename,
                  title,
                  href: filename,
                  dataUrl,
                });
              } catch (e) {
                console.warn('Failed to parse image from zip:', filename, e);
              }
            }
          }

          if (isMounted) setGallery(imageEntries);
        } catch (e) {
          console.error('Failed to load EPUB zip:', e);
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [project?.project.projectId, project?.project.sourceFormat]);

  // 2. Render Chapter HTML with DOM injection & Calibre typography
  useEffect(() => {
    if (!project || !chapter) {
      setChapterHtml('');
      return;
    }

    let isMounted = true;
    setLoading(true);

    const render = async () => {
      setRenderError(null);
      const desktopApi = window.kitaujiDesktop?.projects;
      const theme = THEME_STYLES[preferences.theme] || THEME_STYLES.ivory;
      const fontFamily = FONT_FAMILIES[preferences.fontFamily] || FONT_FAMILIES.serif;

      // Handle TXT format or EPUB fallback
      if (project.project.sourceFormat !== 'epub' || !zip || !chapter.href) {
        // Build rich HTML from text segments
        const segHtml = segments
          .map((seg) => {
            const presentation = readerSegmentPresentation(seg, preferences.mode);
            const polishText = presentation.primaryText;
            const isDialogue = /^[「『“【（＂"']/.test(polishText.trim());
            const indentStyle = preferences.indent && !isDialogue ? 'text-indent: 2em;' : 'text-indent: 0;';

            if (preferences.mode === 'bilingual') {
              return `
                <div class="bilingual-card" style="margin-bottom: ${preferences.paragraphSpacing}em; background: ${theme.cardBg}; border: 1px solid ${theme.line}; border-radius: 8px; padding: 14px 18px;">
                  <p class="target-p${presentation.missingTranslation ? ' missing-translation' : ''}" style="margin: 0 0 6px; font-size: ${preferences.fontSize}px; line-height: ${preferences.lineHeight}; ${indentStyle} color: ${presentation.missingTranslation ? theme.sub : theme.text}; font-weight: 500;">${escapeHtml(polishText)}</p>
                  <p class="source-p" style="margin: 0; font-size: ${Math.round(preferences.fontSize * 0.85)}px; line-height: ${preferences.lineHeight}; color: ${theme.sub}; font-style: normal;" lang="ja">${escapeHtml(seg.sourceText)}</p>
                </div>
              `;
            }

            if (preferences.mode === 'source') {
              return `<p style="margin-bottom: ${preferences.paragraphSpacing}em; font-size: ${preferences.fontSize}px; line-height: ${preferences.lineHeight}; ${indentStyle} color: ${theme.text};" lang="ja">${escapeHtml(seg.sourceText)}</p>`;
            }

            if (preferences.mode === 'original') {
              return `<p style="margin-bottom: ${preferences.paragraphSpacing}em; font-size: ${preferences.fontSize}px; line-height: ${preferences.lineHeight}; ${indentStyle} color: ${presentation.missingTranslation ? theme.sub : theme.text};">${escapeHtml(polishText)}</p>`;
            }

            // Default 'final'
            return `<p style="margin-bottom: ${preferences.paragraphSpacing}em; font-size: ${preferences.fontSize}px; line-height: ${preferences.lineHeight}; ${indentStyle} color: ${presentation.missingTranslation ? theme.sub : theme.text};">${escapeHtml(polishText)}</p>`;
          })
          .join('');

        const constructedHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8" />
              <style>
                body {
                  margin: 0 auto;
                  padding: 40px 24px 80px;
                  max-width: ${preferences.width}px;
                  background: ${theme.bg};
                  color: ${theme.text};
                  font-family: ${fontFamily};
                  letter-spacing: ${preferences.letterSpacing}px;
                  box-sizing: border-box;
                }
              </style>
            </head>
            <body>
              <header style="border-bottom: 1px solid ${theme.line}; padding-bottom: 20px; margin-bottom: 30px; text-align: center;">
                <span style="font-size: 12px; font-weight: 700; color: #c6a668; text-transform: uppercase; letter-spacing: 0.15em;">CHAPTER ${chapter.ordinal}</span>
                <h1 style="margin: 8px 0 0; font-size: ${Math.round(preferences.fontSize * 1.5)}px; font-weight: 700;">${escapeHtml(chapter.title)}</h1>
              </header>
              <main>${segHtml}</main>
            </body>
          </html>
        `;

        if (isMounted) {
          setChapterHtml(constructedHtml);
          setLoading(false);
        }
        return;
      }

      // EPUB HTML Processing with JSZip
      try {
        const rawHtmlContent = await zip.file(chapter.href)?.async('string');
        if (!rawHtmlContent || !isMounted) {
          setLoading(false);
          return;
        }

        const parser = new DOMParser();
        let doc = parser.parseFromString(rawHtmlContent, 'application/xhtml+xml');
        if (doc.getElementsByTagName('parsererror').length > 0) {
          doc = parser.parseFromString(rawHtmlContent, 'text/html');
        }

        // Imported book markup is content, not trusted application code.
        Array.from(doc.querySelectorAll('script, iframe, frame, object, embed')).forEach((node) => node.remove());
        Array.from(doc.querySelectorAll('base, meta[http-equiv="refresh"]')).forEach((node) => node.remove());
        Array.from(doc.querySelectorAll('*')).forEach((element) => {
          Array.from(element.attributes).forEach((attribute) => {
            if (/^on/iu.test(attribute.name)) element.removeAttribute(attribute.name);
          });
        });
        Array.from(doc.querySelectorAll('a[href], a[xlink\\:href]')).forEach((anchor) => {
          for (const attributeName of ['href', 'xlink:href']) {
            const value = anchor.getAttribute(attributeName)?.trim();
            if (value && !value.startsWith('#')) anchor.removeAttribute(attributeName);
          }
        });
        Array.from(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).forEach((node) => node.remove());
        const contentSecurityPolicy = doc.createElement('meta');
        contentSecurityPolicy.setAttribute('http-equiv', 'Content-Security-Policy');
        contentSecurityPolicy.setAttribute('content', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'");
        doc.head.prepend(contentSecurityPolicy);

        // Fetch blocks to map DOM paths
        if (desktopApi?.readChapter) {
          const content = await desktopApi.readChapter(
            project.project.projectId,
            chapter.chapterId,
            0,
            10000,
          );

          if (content && isMounted) {
            const segMap = new Map(segments.map((s) => [s.sourceBlockId, s]));
            const targetBlockIds = new Set(segments.flatMap((segment) => segment.targetBlockId ? [segment.targetBlockId] : []));

            // Hide existing Chinese partner blocks first. The selected mode below either
            // composes an explicit bilingual pair or displays exactly one requested text.
            for (const block of content.blocks) {
              if (!targetBlockIds.has(block.blockId) || !block.domPath) continue;
              try {
                const targetNode = doc.evaluate(
                  block.domPath,
                  doc,
                  null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,
                  null,
                ).singleNodeValue as HTMLElement | null;
                targetNode?.setAttribute('hidden', 'hidden');
              } catch {
                // Continue rendering other blocks when one imported XPath is malformed.
              }
            }

            for (const block of content.blocks) {
              const seg = segMap.get(block.blockId);
              if (!seg || !block.domPath) continue;

              try {
                const node = doc.evaluate(
                  block.domPath,
                  doc,
                  null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,
                  null,
                ).singleNodeValue as HTMLElement | null;

                if (node) {
                  const presentation = readerSegmentPresentation(seg, preferences.mode);
                  const polish = presentation.primaryText;
                  const source = seg.sourceText;
                  const isDialogue = /^[「『“【（＂"']/.test(polish.trim());
                  const indentStyle = preferences.indent && !isDialogue ? 'text-indent: 2em;' : 'text-indent: 0;';

                  if (preferences.mode === 'bilingual') {
                    const card = doc.createElement('div');
                    card.className = 'calibre-bilingual-block';
                    card.setAttribute(
                      'style',
                      `margin-bottom: ${preferences.paragraphSpacing}em; background: ${theme.cardBg}; border: 1px solid ${theme.line}; border-radius: 8px; padding: 12px 16px;`,
                    );
                    card.innerHTML = `
                      <p class="target-text${presentation.missingTranslation ? ' missing-translation' : ''}" style="margin: 0 0 5px; font-size: ${preferences.fontSize}px; line-height: ${preferences.lineHeight}; ${indentStyle} color: ${presentation.missingTranslation ? theme.sub : theme.text}; font-weight: 500;">${escapeHtml(polish)}</p>
                      <p class="source-text" style="margin: 0; font-size: ${Math.round(preferences.fontSize * 0.85)}px; line-height: ${preferences.lineHeight}; color: ${theme.sub};" lang="ja">${escapeHtml(source)}</p>
                    `;
                    node.parentNode?.replaceChild(card, node);
                  } else if (preferences.mode === 'source') {
                    node.style.color = theme.text;
                    node.style.lineHeight = String(preferences.lineHeight);
                    node.style.fontSize = `${preferences.fontSize}px`;
                    node.style.marginBottom = `${preferences.paragraphSpacing}em`;
                    if (preferences.indent && !isDialogue) node.style.textIndent = '2em';
                  } else if (preferences.mode === 'original') {
                    node.textContent = polish;
                    node.style.color = presentation.missingTranslation ? theme.sub : theme.text;
                    node.style.lineHeight = String(preferences.lineHeight);
                    node.style.fontSize = `${preferences.fontSize}px`;
                    node.style.marginBottom = `${preferences.paragraphSpacing}em`;
                  } else {
                    // Final polished mode
                    node.textContent = polish;
                    node.style.color = presentation.missingTranslation ? theme.sub : theme.text;
                    node.style.lineHeight = String(preferences.lineHeight);
                    node.style.fontSize = `${preferences.fontSize}px`;
                    node.style.marginBottom = `${preferences.paragraphSpacing}em`;
                    if (preferences.indent && !isDialogue) node.style.textIndent = '2em';
                  }
                }
              } catch (err) {
                console.warn('XPath eval error for domPath:', block.domPath, err);
              }
            }
          }
        }

        // 3. Resolve and Embed all images into Base64
        const imgElements = Array.from(doc.querySelectorAll('img, image, svg image'));
        for (const el of imgElements) {
          const attr = el.tagName.toLowerCase() === 'image' ? 'xlink:href' : 'src';
          const src = el.getAttribute(attr);
          if (src && !src.startsWith('data:')) {
            const absPath = resolveRelativePath(chapter.href, src);
            const file = zip.file(absPath);
            if (file) {
              try {
                const b64 = await file.async('base64');
                const mime = guessMimeType(absPath);
                const dataUri = `data:${mime};base64,${b64}`;
                el.setAttribute(attr, dataUri);
                // Add click-to-zoom class
                el.setAttribute('class', (el.getAttribute('class') || '') + ' calibre-zoomable-image');
                el.setAttribute('title', '点击全屏查看原图');
              } catch (e) {
                console.warn('Failed to embed image:', absPath, e);
              }
            }
          }
        }

        // 4. Inject Calibre Reader Global Styles
        const styleTag = doc.createElement('style');
        styleTag.textContent = `
          body {
            margin: 0 auto !important;
            padding: 40px 24px 80px !important;
            max-width: ${preferences.width}px !important;
            background: ${theme.bg} !important;
            color: ${theme.text} !important;
            font-family: ${fontFamily} !important;
            letter-spacing: ${preferences.letterSpacing}px !important;
            box-sizing: border-box !important;
            min-height: 100vh !important;
          }
          p, div {
            color: inherit;
          }
          img, svg, svg image {
            max-width: 100% !important;
            height: auto !important;
            display: block !important;
            margin: 24px auto !important;
            border-radius: 6px !important;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12) !important;
            cursor: zoom-in !important;
            transition: transform 0.2s ease !important;
          }
          img:hover, svg image:hover {
            transform: scale(1.01) !important;
          }
          ruby rt {
            font-size: 0.55em !important;
            color: ${theme.sub} !important;
          }
          /* Custom scrollbar */
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(198, 166, 104, 0.25); border-radius: 10px; }
        `;
        doc.head.appendChild(styleTag);

        // Add script for image click lightbox postMessage
        const scriptTag = doc.createElement('script');
        scriptTag.textContent = `
          document.addEventListener('click', function(e) {
            var target = e.target;
            if (target && (target.tagName === 'IMG' || target.tagName === 'image')) {
              var src = target.getAttribute('src') || target.getAttribute('xlink:href');
              if (src) {
                window.parent.postMessage({ type: 'CALIBRE_IMAGE_CLICK', src: src }, '*');
              }
            }
          });
        `;
        doc.body.appendChild(scriptTag);

        if (isMounted) {
          setChapterHtml(new XMLSerializer().serializeToString(doc));
          setLoading(false);
        }
      } catch (e) {
        console.error('Failed to parse and render chapter:', e);
        if (isMounted) {
          setRenderError(e instanceof Error ? e.message : '章节排版渲染失败。');
          setLoading(false);
        }
      }
    };

    void render();

    return () => {
      isMounted = false;
    };
  }, [
    zip,
    project?.project.projectId,
    project?.project.sourceFormat,
    chapter?.chapterId,
    chapter?.href,
    chapter?.title,
    chapter?.ordinal,
    segments,
    preferences,
  ]);

  // Handle Lightbox postMessage from iframe
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data && e.data.type === 'CALIBRE_IMAGE_CLICK' && typeof e.data.src === 'string') {
        if (e.data.src.startsWith('data:image/')) setLightboxImage(e.data.src);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return {
    chapterHtml,
    renderError,
    loading,
    gallery,
    lightboxImage,
    setLightboxImage,
    iframeRef,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
