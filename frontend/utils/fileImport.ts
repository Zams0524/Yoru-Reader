import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export interface BookChapter {
  title: string;
  content: string;
  isFromToc?: boolean;
}

export interface ParsedBook {
  title: string;
  author: string;
  cover: string;
  chapters: BookChapter[];
}

const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)',
  'linear-gradient(135deg, #c3ec52 0%, #0ba360 100%)',
  'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
];

function getRandomGradient(): string {
  return GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];
}

// Helper to recursively extract readable paragraphs from DOM tree, preserving <ruby> markup structure
export function htmlToStructuredParagraphs(doc: Document | Element): any[] {
  // Clean elements that do not contain readable text (metadata, scripts, styles)
  doc.querySelectorAll('script, style, head').forEach(el => el.remove());
  
  const paragraphs: any[][] = [];
  let currentParagraph: any[] = [];
  
  function traverse(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        if (currentParagraph.length > 0 && typeof currentParagraph[currentParagraph.length - 1] === 'string') {
          currentParagraph[currentParagraph.length - 1] += text;
        } else {
          currentParagraph.push(text);
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tagName = el.tagName.toLowerCase();
      
      if (tagName === 'img' || tagName === 'image') {
        const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
        if (src) {
          currentParagraph.push({
            type: 'image',
            src: src
          });
        }
        return; // Don't traverse inside img/image elements
      }

      if (tagName === 'ruby') {
        // Furigana: every <rt>, in order. Japanese EPUBs often put one reading per kanji
        // (<ruby>舞<rt>ぶ</rt>台<rt>たい</rt></ruby>): the word keeps the whole reading (ぶたい).
        const rubyReading = Array.from(el.querySelectorAll('rt'))
          .map((rt) => rt.textContent?.trim() || '')
          .join('');
        
        // Extract kanji base text by cloning and removing rt / rp elements
        const clone = el.cloneNode(true) as Element;
        clone.querySelectorAll('rt, rp').forEach(e => e.remove());
        const baseText = clone.textContent?.trim() || '';
        
        if (baseText) {
          currentParagraph.push({
            type: 'ruby',
            text: baseText,
            ruby: rubyReading
          });
        }
        return; // Skip traversing children of <ruby> as they are processed
      }
      
      const isBlock = [
        'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
        'li', 'br', 'blockquote', 'section', 'article', 'tr'
      ].includes(tagName);
      
      if (isBlock && currentParagraph.length > 0) {
        (currentParagraph as any).tagName = tagName;
        paragraphs.push(currentParagraph);
        currentParagraph = [];
      }
      
      for (let i = 0; i < el.childNodes.length; i++) {
        traverse(el.childNodes[i]);
      }
      
      if (isBlock && currentParagraph.length > 0) {
        paragraphs.push(currentParagraph);
        currentParagraph = [];
      }
    }
  }
  
  const bodyNode = (doc as Document).body;
  if (bodyNode) {
    traverse(bodyNode);
  } else {
    traverse(doc);
  }
  
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph);
  }
  
  return paragraphs.map(p => {
    const newP = p.map(segment => {
      if (typeof segment === 'string') {
        return segment.replace(/\s+/g, ' ');
      }
      return segment;
    }).filter(segment => {
      if (typeof segment === 'string') {
        return segment.trim().length > 0;
      }
      if (segment.type === 'image') {
        return true;
      }
      return segment.text && segment.text.trim().length > 0;
    });
    if ((p as any).tagName) {
      (newP as any).tagName = (p as any).tagName;
    }
    return newP;
  }).filter(p => p.length > 0);
}

// Helper to serialize structured paragraphs into a text format that preserves ruby blocks and images
export function serializeStructuredParagraph(p: any[]): string {
  const content = p.map(segment => {
    if (typeof segment === 'string') {
      return segment;
    }
    if (segment.type === 'image') {
      return `{img:${segment.src}}`;
    }
    return `{${segment.text}|${segment.ruby}}`;
  }).join('');

  const tagName = (p as any).tagName;
  if (tagName && ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
    return `{${tagName}:${content}}`;
  }
  return content;
}

// Helper to identify introductory metadata and front-matter sections
export function isFrontMatter(title: string, filename: string): boolean {
  const titleLower = title.toLowerCase();
  const filenameLower = filename.toLowerCase();
  
  // If filename or title matches typical first chapter formats, it is NOT front matter
  if (/ch(apter)?[-_]?0*1\b/i.test(filenameLower) || /ch(apter)?[-_]?0*1\b/i.test(titleLower)) {
    return false;
  }
  if (/第[一１1]章/i.test(titleLower) || /第[一１1]話/i.test(titleLower)) {
    return false;
  }
  
  const keywords = [
    'cover', 'portada', 'copyright', 'derechos', 'colofon', 'coloph',
    'notice', 'advertencia', 'aviso', 'advert', 'preface', 'prefacio',
    'まえがき', '目次', 'toc', 'index', 'indice', 'tabla de contenido',
    'illustration', '口絵', 'ilustracion', 'title', 'titulo', 'author', 'autor',
    'prologue', 'prologo', 'プロローグ'
  ];
  
  for (const kw of keywords) {
    if (titleLower.includes(kw) || filenameLower.includes(kw)) {
      return true;
    }
  }
  return false;
}

// 1. HTML Parser
export function parseHTML(htmlText: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const paragraphs = htmlToStructuredParagraphs(doc);
  return paragraphs.map(serializeStructuredParagraph).join('\n');
}

// 2. RTF Parser
export function parseRTF(rtfText: string): string {
  let output = "";
  const groupStack: boolean[] = [];
  let currentGroupIgnored = false;
  
  const IGNORED_GROUPS = [
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'generator', 
    'nonshppict', 'shp', 'pictures', 'private'
  ];
  
  let i = 0;
  while (i < rtfText.length) {
    const char = rtfText[i];
    
    if (char === '{') {
      groupStack.push(currentGroupIgnored);
      i++;
    } else if (char === '}') {
      if (groupStack.length > 0) {
        currentGroupIgnored = groupStack.pop()!;
      } else {
        currentGroupIgnored = false;
      }
      i++;
    } else if (char === '\\') {
      i++;
      if (i >= rtfText.length) break;
      
      // Escaped characters
      if (rtfText[i] === '\\' || rtfText[i] === '{' || rtfText[i] === '}') {
        if (!currentGroupIgnored) output += rtfText[i];
        i++;
        continue;
      }
      
      // Parse control word
      let word = "";
      while (i < rtfText.length && /[a-zA-Z]/.test(rtfText[i])) {
        word += rtfText[i];
        i++;
      }
      
      if (IGNORED_GROUPS.includes(word)) {
        currentGroupIgnored = true;
      }
      
      // Parse optional signed number argument
      let numStr = "";
      if (i < rtfText.length && (rtfText[i] === '-' || /[0-9]/.test(rtfText[i]))) {
        numStr += rtfText[i];
        i++;
        while (i < rtfText.length && /[0-9]/.test(rtfText[i])) {
          numStr += rtfText[i];
          i++;
        }
      }
      
      // Skip single trailing space
      if (i < rtfText.length && rtfText[i] === ' ') {
        i++;
      }
      
      // Process key tags
      if (word === 'par' || word === 'line' || word === 'row') {
        if (!currentGroupIgnored) output += '\n';
      } else if (word === 'tab') {
        if (!currentGroupIgnored) output += '\t';
      } else if (word === 'u') {
        const unicodeVal = parseInt(numStr, 10);
        if (!isNaN(unicodeVal)) {
          const codePoint = unicodeVal < 0 ? unicodeVal + 65536 : unicodeVal;
          if (!currentGroupIgnored) output += String.fromCharCode(codePoint);
        }
        // Skip placeholder char (often '?' or similar)
        if (i < rtfText.length) {
          i++;
        }
      }
    } else if (char === '\r' || char === '\n') {
      i++;
    } else {
      if (!currentGroupIgnored) {
        output += char;
      }
      i++;
    }
  }
  
  return output.trim();
}

// 3. Subtitles Parsers (SRT, VTT, ASS/SSA)
export function parseSRT(srtText: string): string {
  const blocks = srtText.split(/\r?\n\r?\n/);
  const lines: string[] = [];

  for (const block of blocks) {
    const blockLines = block.trim().split(/\r?\n/);
    if (blockLines.length < 3) continue; // Skip malformed or empty cues
    
    const textLines = blockLines.slice(2);
    const text = textLines.join(' ')
      .replace(/<[^>]+>/g, '') // Strip HTML formatting tags
      .trim();
      
    if (text) {
      lines.push(text);
    }
  }

  return lines.join('\n\n');
}

export function parseVTT(vttText: string): string {
  const lines: string[] = [];
  const rawBlocks = vttText.split(/\r?\n\r?\n/);
  
  for (const block of rawBlocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock || trimmedBlock.startsWith('WEBVTT') || trimmedBlock.startsWith('NOTE')) {
      continue;
    }
    
    const blockLines = trimmedBlock.split(/\r?\n/);
    
    let textStartIndex = 1;
    if (blockLines[0].includes('-->')) {
      textStartIndex = 1;
    } else if (blockLines.length > 1 && blockLines[1].includes('-->')) {
      textStartIndex = 2;
    } else {
      continue;
    }
    
    const textLines = blockLines.slice(textStartIndex);
    const text = textLines.join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
      
    if (text) {
      lines.push(text);
    }
  }

  return lines.join('\n\n');
}

export function parseASS(assText: string): string {
  const rawLines = assText.split(/\r?\n/);
  const dialogues: string[] = [];
  let inEventsSection = false;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[Events]')) {
      inEventsSection = true;
      continue;
    }
    if (trimmed.startsWith('[')) {
      inEventsSection = false;
      continue;
    }

    if (inEventsSection && trimmed.startsWith('Dialogue:')) {
      const commaIndices: number[] = [];
      let index = trimmed.indexOf(',');
      while (index !== -1 && commaIndices.length < 9) {
        commaIndices.push(index);
        index = trimmed.indexOf(',', index + 1);
      }

      if (commaIndices.length === 9) {
        const textStartIndex = commaIndices[8] + 1;
        let text = trimmed.substring(textStartIndex);
        
        text = text.replace(/\{[^}]+\}/g, '');
        text = text.replace(/\\N/gi, '\n');
        text = text.replace(/\\n/gi, '\n');
        
        const cleanText = text.trim();
        if (cleanText) {
          dialogues.push(cleanText);
        }
      }
    }
  }

  return dialogues.join('\n\n');
}

function resolveRelativePath(basePath: string, relativePath: string): string {
  const baseParts = basePath.split('/');
  baseParts.pop(); // Remove filename
  
  const relParts = relativePath.split('/');
  for (const part of relParts) {
    if (part === '.') {
      continue;
    } else if (part === '..') {
      baseParts.pop();
    } else if (part) {
      baseParts.push(part);
    }
  }
  return baseParts.join('/');
}

// 4. EPUB Parser (Zip extractor)
export async function parseEPUB(arrayBuffer: ArrayBuffer): Promise<any> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('Archivo contenedor inválido (META-INF/container.xml no encontrado)');
  }
  
  const containerXml = await containerFile.async('text');
  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfPathMatch) {
    throw new Error('No se pudo encontrar la ruta del archivo descriptivo principal (.opf)');
  }
  
  const opfPath = opfPathMatch[1];
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`Archivo descriptivo OPF no encontrado en la ruta: ${opfPath}`);
  }
  
  const opfXml = await opfFile.async('text');
  const parser = new DOMParser();
  const opfDoc = parser.parseFromString(opfXml, 'text/xml');
  
  const titleEl = opfDoc.querySelector('title') || opfDoc.querySelector('dc\\:title');
  const creatorEl = opfDoc.querySelector('creator') || opfDoc.querySelector('dc\\:creator');
  const title = titleEl ? titleEl.textContent?.trim() || 'Libro EPUB' : 'Libro EPUB';
  const author = creatorEl ? creatorEl.textContent?.trim() || 'Autor Desconocido' : 'Autor Desconocido';
  
  const manifestItems: Record<string, string> = {};
  opfDoc.querySelectorAll('manifest > item').forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifestItems[id] = href;
    }
  });
  
  const spineIds: string[] = [];
  opfDoc.querySelectorAll('spine > itemref').forEach(ref => {
    const idref = ref.getAttribute('idref');
    if (idref) {
      spineIds.push(idref);
    }
  });

  const lastSlashIndex = opfPath.lastIndexOf('/');
  const baseDir = lastSlashIndex !== -1 ? opfPath.substring(0, lastSlashIndex + 1) : '';

  const tocMap: Record<string, string> = {};
  try {
    let navHref = '';
    opfDoc.querySelectorAll('item').forEach(item => {
      const props = item.getAttribute('properties') || '';
      if (props.split(/\s+/).includes('nav')) {
        navHref = item.getAttribute('href') || '';
      }
    });
    if (!navHref) {
      opfDoc.querySelectorAll('item').forEach(item => {
        const id = (item.getAttribute('id') || '').toLowerCase();
        const href = (item.getAttribute('href') || '').toLowerCase();
        if (id === 'nav' || id === 'toc' || href.includes('nav.xhtml') || href.includes('toc.xhtml')) {
          navHref = item.getAttribute('href') || '';
        }
      });
    }

    if (navHref) {
      const resolvedNavPath = resolveRelativePath(opfPath, navHref);
      const navFile = zip.file(resolvedNavPath);
      if (navFile) {
        const navHtml = await navFile.async('text');
        const navDoc = parser.parseFromString(navHtml, 'text/html');
        navDoc.querySelectorAll('a').forEach(a => {
          const href = a.getAttribute('href');
          if (href) {
            const cleanHref = decodeURIComponent(href.split('#')[0]);
            const targetPath = resolveRelativePath(resolvedNavPath, cleanHref);
            const label = a.textContent?.trim() || '';
            if (label && !tocMap[targetPath]) {
              tocMap[targetPath] = label;
            }
          }
        });
      }
    }
  } catch (e) {
    console.warn("Failed to parse EPUB 3 Nav TOC:", e);
  }

  if (Object.keys(tocMap).length === 0) {
    try {
      const spineEl = opfDoc.querySelector('spine') || opfDoc.querySelector('opf\\:spine');
      const tocId = spineEl ? spineEl.getAttribute('toc') : null;
      let ncxHref = '';
      if (tocId) {
        const ncxItem = opfDoc.getElementById(tocId) || opfDoc.querySelector(`item[id="${tocId}"]`);
        if (ncxItem) {
          ncxHref = ncxItem.getAttribute('href') || '';
        }
      }
      if (!ncxHref) {
        opfDoc.querySelectorAll('item').forEach(item => {
          const mediaType = item.getAttribute('media-type') || '';
          if (mediaType === 'application/x-dtbncx+xml' || (item.getAttribute('href') || '').endsWith('.ncx')) {
            ncxHref = item.getAttribute('href') || '';
          }
        });
      }

      if (ncxHref) {
        const resolvedNcxPath = resolveRelativePath(opfPath, ncxHref);
        const ncxFile = zip.file(resolvedNcxPath);
        if (ncxFile) {
          const ncxXml = await ncxFile.async('text');
          const ncxDoc = parser.parseFromString(ncxXml, 'text/html');
          ncxDoc.querySelectorAll('navpoint').forEach(point => {
            const contentEl = point.querySelector('content');
            const textEl = point.querySelector('navlabel text');
            if (contentEl && textEl) {
              const href = contentEl.getAttribute('src');
              const label = textEl.textContent?.trim() || '';
              if (href && label) {
                const cleanHref = decodeURIComponent(href.split('#')[0]);
                const targetPath = resolveRelativePath(resolvedNcxPath, cleanHref);
                if (!tocMap[targetPath]) {
                  tocMap[targetPath] = label;
                }
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn("Failed to parse EPUB 2 NCX TOC:", e);
    }
  }
  
  let coverHref: string | null = null;
  const coverMeta = opfDoc.querySelector('meta[name="cover"]');
  if (coverMeta) {
    const coverId = coverMeta.getAttribute('content');
    if (coverId) {
      const coverItem = opfDoc.getElementById(coverId) || opfDoc.querySelector(`item[id="${coverId}"]`);
      if (coverItem) {
        coverHref = coverItem.getAttribute('href');
      }
    }
  }
  
  if (!coverHref) {
    const coverItem = opfDoc.querySelector('item[properties~="cover-image"]') || opfDoc.querySelector('item[properties="cover-image"]');
    if (coverItem) {
      coverHref = coverItem.getAttribute('href');
    }
  }
  
  if (!coverHref) {
    const items = opfDoc.querySelectorAll('manifest > item');
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const href = item.getAttribute('href') || '';
      const id = item.getAttribute('id') || '';
      const mediaType = item.getAttribute('media-type') || '';
      if (mediaType.startsWith('image/') && (
        href.toLowerCase().includes('cover') || 
        id.toLowerCase().includes('cover')
      )) {
        coverHref = href;
        break;
      }
    }
  }

  let coverUrl: string | null = null;
  if (coverHref) {
    const decodedCoverHref = decodeURIComponent(coverHref);
    const zipCoverPath = baseDir + decodedCoverHref;
    const coverFile = zip.file(zipCoverPath);
    if (coverFile) {
      try {
        const coverBase64 = await coverFile.async('base64');
        let mediaType = 'image/jpeg';
        const items = opfDoc.querySelectorAll('manifest > item');
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          if (item.getAttribute('href') === coverHref) {
            mediaType = item.getAttribute('media-type') || 'image/jpeg';
            break;
          }
        }
        coverUrl = `data:${mediaType};base64,${coverBase64}`;
      } catch (err) {
        console.warn("Failed to extract EPUB cover image:", err);
      }
    }
  }
  
  const chapters: BookChapter[] = [];
  
  for (let i = 0; i < spineIds.length; i++) {
    const id = spineIds[i];
    const href = manifestItems[id];
    if (!href) continue;
    
    const decodedHref = decodeURIComponent(href);
    const resolvedPath = baseDir + decodedHref;
    
    const file = zip.file(resolvedPath);
    if (!file) continue;
    
    const chapterHtml = await file.async('text');
    const doc = parser.parseFromString(chapterHtml, 'text/html');
    
    let chapterTitle = '';
    let isFromToc = false;
    const getCleanPath = (p: string) => {
      if (!p) return '';
      return p.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    };
    const cleanResolved = getCleanPath(resolvedPath);
    
    for (const k of Object.keys(tocMap)) {
      if (getCleanPath(k) === cleanResolved) {
        chapterTitle = tocMap[k];
        isFromToc = true;
        break;
      }
    }
    
    if (!chapterTitle) {
      const resolvedFilename = cleanResolved.split('/').pop();
      for (const k of Object.keys(tocMap)) {
        const kClean = getCleanPath(k);
        const kFilename = kClean.split('/').pop();
        if (resolvedFilename && resolvedFilename === kFilename) {
          chapterTitle = tocMap[k];
          isFromToc = true;
          break;
        }
      }
    }
    
    if (!chapterTitle) {
      const heading = doc.querySelector('h1, h2, h3, h4');
      if (heading) chapterTitle = heading.textContent?.trim() || '';
    }
    
    if (!chapterTitle) {
      const titleTag = doc.querySelector('title');
      if (titleTag) {
        const titleText = titleTag.textContent?.trim() || '';
        if (titleText && titleText !== title && titleText.toLowerCase() !== 'untitled' && titleText.toLowerCase() !== 'untitled document') {
          chapterTitle = titleText;
        }
      }
    }
    
    if (!chapterTitle) {
      chapterTitle = chapters.length === 0 ? 'Portada' : `Capítulo ${chapters.length + 1}`;
    }
    
    const structuredParagraphs = htmlToStructuredParagraphs(doc);
    if (structuredParagraphs.length === 0) continue;
    
    for (let pIdx = 0; pIdx < structuredParagraphs.length; pIdx++) {
      const p = structuredParagraphs[pIdx];
      for (let sIdx = 0; sIdx < p.length; sIdx++) {
        const segment = p[sIdx];
        if (segment && segment.type === 'image' && segment.src) {
          try {
            const cleanSrc = decodeURIComponent(segment.src.split('#')[0].split('?')[0]);
            const targetPath = resolveRelativePath(resolvedPath, cleanSrc);
            const imageFile = zip.file(targetPath);
            if (imageFile) {
              const ext = targetPath.split('.').pop()!.toLowerCase();
              const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
              const imgBase64 = await imageFile.async('base64');
              segment.src = `data:${mime};base64,${imgBase64}`;
            }
          } catch (imgErr) {
            console.warn("Failed to extract inline EPUB image:", segment.src, imgErr);
          }
        }
      }
    }
    
    chapters.push({
      title: chapterTitle || 'Portada',
      content: structuredParagraphs.map(serializeStructuredParagraph).join('\n'),
      isFromToc: isFromToc
    });
  }
  
  if (chapters.length === 0) {
    throw new Error('No se pudo extraer texto legible del archivo EPUB.');
  }
  
  return {
    title,
    author,
    chapters,
    cover: coverUrl
  };
}

// 5. PDF Parser
export async function parsePDF(arrayBuffer: ArrayBuffer, fallbackTitle?: string): Promise<ParsedBook> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: './cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './standard_fonts/',
    enableXfa: false
  });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  let title = fallbackTitle || 'Documento PDF';
  let author = 'Archivo PDF';

  try {
    const meta = await pdfDoc.getMetadata();
    if (meta && meta.info) {
      const info = meta.info as any;
      if (info.Title && typeof info.Title === 'string' && info.Title.trim()) {
        title = info.Title.trim();
      }
      if (info.Author && typeof info.Author === 'string' && info.Author.trim()) {
        author = info.Author.trim();
      }
    }
  } catch (e) {
    console.warn('Failed to read PDF metadata:', e);
  }

  // Generate high-resolution cover thumbnail from first page
  let cover = '';
  try {
    if (numPages > 0) {
      const firstPage = await pdfDoc.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');

      if (context) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        await firstPage.render({
          canvas,
          canvasContext: context,
          viewport: viewport
        }).promise;
        cover = canvas.toDataURL('image/jpeg', 0.90);
      }
    }
  } catch (e) {
    console.warn('Failed to extract PDF cover:', e);
  }

  if (!cover) {
    cover = getRandomGradient();
  }

  // Extract text by page using smart multi-band vertical (2段組) and horizontal layout analysis
  const pageTexts: { pageNum: number; text: string }[] = [];
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const rawItems = (textContent.items || []).filter((item: any) => item && typeof item.str === 'string' && item.str.trim().length > 0);
      
      if (rawItems.length === 0) continue;

      interface TextItemData {
        str: string;
        x: number;
        y: number;
        w: number;
        h: number;
        dir?: string;
      }

      const items: TextItemData[] = rawItems.map((item: any) => {
        const t = item.transform || [1, 0, 0, 1, 0, 0];
        return {
          str: item.str,
          x: t[4] || 0,
          y: t[5] || 0,
          w: item.width || 0,
          h: item.height || 0,
          dir: item.dir
        };
      });

      // Detect whether the text is predominantly vertical (tate-gaki 縦書き) or horizontal
      let verticalScore = 0;
      let horizontalScore = 0;

      for (let i = 0; i < items.length - 1; i++) {
        const a = items[i];
        const b = items[i + 1];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);

        if (a.dir === 'ttb' || b.dir === 'ttb') {
          verticalScore += 5;
        }
        // In vertical Japanese columns: same column has small dx (<8px) and distinct dy
        if (dx <= 8 && dy > 4 && dy < 45) {
          verticalScore += 2;
        } else if (dy <= 8 && dx > 4 && dx < 45) {
          horizontalScore += 2;
        }
      }

      const isVertical = verticalScore >= horizontalScore;
      let pageText = '';

      if (isVertical) {
        // VERTICAL JAPANESE with Multi-Band / Multi-Row (段組 - e.g. 2段組) Support
        const minY = Math.min(...items.map(i => i.y));
        const maxY = Math.max(...items.map(i => i.y));
        const totalHeight = maxY - minY;

        // Dynamically find the horizontal gutter / gap between vertical bands (2段組)
        const yValues = items.map(i => i.y).sort((a, b) => a - b);
        let maxGap = 0;
        let bestSplitY = minY + totalHeight * 0.5;

        for (let idx = 0; idx < yValues.length - 1; idx++) {
          const y1 = yValues[idx];
          const y2 = yValues[idx + 1];
          const gap = y2 - y1;
          const normalizedMid = (y1 + y2) / 2;
          if (normalizedMid > minY + totalHeight * 0.28 && normalizedMid < minY + totalHeight * 0.72) {
            if (gap > maxGap) {
              maxGap = gap;
              bestSplitY = normalizedMid;
            }
          }
        }

        const topItems = items.filter(i => i.y >= bestSplitY);
        const bottomItems = items.filter(i => i.y < bestSplitY);

        const hasMultiBand = totalHeight > 200 &&
                             topItems.length >= 5 && 
                             bottomItems.length >= 5 && 
                             (topItems.length / items.length > 0.15) && 
                             (bottomItems.length / items.length > 0.15);

        // Upper band (larger Y) is processed first, followed by lower band (smaller Y)
        const bands = hasMultiBand ? [topItems, bottomItems] : [items];
        const allBandLines: string[] = [];

        for (const bandItems of bands) {
          const columns: TextItemData[][] = [];
          const colTolerance = 12;

          // Sort items within band by X descending (Right to Left)
          const sortedByX = [...bandItems].sort((a, b) => b.x - a.x);

          for (const item of sortedByX) {
            let placed = false;
            for (const col of columns) {
              const avgX = col.reduce((sum, c) => sum + c.x, 0) / col.length;
              if (Math.abs(item.x - avgX) <= colTolerance) {
                col.push(item);
                placed = true;
                break;
              }
            }
            if (!placed) {
              columns.push([item]);
            }
          }

          // Sort columns strictly Right to Left (average X descending)
          columns.sort((a, b) => {
            const avgA = a.reduce((sum, c) => sum + c.x, 0) / a.length;
            const avgB = b.reduce((sum, c) => sum + c.x, 0) / b.length;
            return avgB - avgA;
          });

          for (const col of columns) {
            // Sort within column from Top to Bottom (Y descending)
            col.sort((a, b) => b.y - a.y);

            let colText = '';
            let lastY = col[0].y;
            for (const item of col) {
              // Large vertical break inside column
              if (Math.abs(lastY - item.y) > 55 && colText.trim()) {
                allBandLines.push(colText.trim());
                colText = '';
              }
              colText += item.str;
              lastY = item.y;
            }
            if (colText.trim()) {
              allBandLines.push(colText.trim());
            }
          }
        }

        // If page has substantial Japanese text, filter out isolated line numbers (1..99)
        const hasJapanese = allBandLines.some(l => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(l));
        const filteredLines = hasJapanese
          ? allBandLines.filter(l => !/^\d{1,4}$/.test(l.trim()))
          : allBandLines;

        pageText = (filteredLines.length > 0 ? filteredLines : allBandLines).join('\n');
      } else {
        // HORIZONTAL (Top to Bottom lines, Left to Right text)
        const lines: TextItemData[][] = [];
        const lineTolerance = 6;

        // Sort items by Y descending (Top to Bottom)
        const sortedByY = [...items].sort((a, b) => b.y - a.y);

        for (const item of sortedByY) {
          let placed = false;
          for (const line of lines) {
            const avgY = line.reduce((sum, c) => sum + c.y, 0) / line.length;
            if (Math.abs(item.y - avgY) <= lineTolerance) {
              line.push(item);
              placed = true;
              break;
            }
          }
          if (!placed) {
            lines.push([item]);
          }
        }

        // Sort lines from Top to Bottom
        lines.sort((a, b) => {
          const avgA = a.reduce((sum, c) => sum + c.y, 0) / a.length;
          const avgB = b.reduce((sum, c) => sum + c.y, 0) / b.length;
          return avgB - avgA;
        });

        const resultLines: string[] = [];
        for (const line of lines) {
          // Within each line, sort Left to Right (X ascending)
          line.sort((a, b) => a.x - b.x);

          let lineText = '';
          for (let i = 0; i < line.length; i++) {
            const cur = line[i];
            if (i > 0) {
              const prev = line[i - 1];
              const isJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(cur.str) || /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(prev.str);
              if (!isJapanese && (cur.x - (prev.x + prev.w)) > 3) {
                lineText += ' ';
              }
            }
            lineText += cur.str;
          }
          if (lineText.trim()) {
            resultLines.push(lineText.trim());
          }
        }
        pageText = resultLines.join('\n');
      }

      if (pageText.trim()) {
        pageTexts.push({ pageNum, text: pageText });
      }
    } catch (pageErr) {
      console.warn(`Error reading PDF page ${pageNum}:`, pageErr);
    }
  }

  if (pageTexts.length === 0) {
    throw new Error('El PDF no contiene texto digital legible (es posible que esté compuesto únicamente por imágenes o escaneos sin OCR).');
  }

  // Group pages into chapters: If document has chapter headings, split by headings;
  // otherwise treat each page cleanly with its exact page number in TOC
  const chapters: BookChapter[] = [];
  const chapterPattern = /^(第[一二三四五六七八九十百0-9]+[章話回幕節部]|Chapter\s+\d+|#\s+|CAP[ÍI]TULO\s+\d+|[一二三四五六七八九十]+之巻).*$/i;

  for (let i = 0; i < pageTexts.length; i++) {
    const { pageNum, text } = pageTexts[i];
    const lines = text.split('\n');
    let pageTitle = `Página ${pageNum}`;

    for (const line of lines) {
      const trimmed = line.trim();
      if (chapterPattern.test(trimmed)) {
        pageTitle = trimmed.replace(/^#\s+/, '');
        break;
      }
    }

    chapters.push({
      title: pageTitle,
      content: text,
      isFromToc: true
    });
  }

  return {
    title,
    author,
    cover,
    chapters
  };
}

// 6. General Router to Import Any Book File
export function importBookFile(file: File): Promise<ParsedBook> {
  return new Promise((resolve, reject) => {
    const filename = file.name;
    const extension = filename.split('.').pop()!.toLowerCase();
    
    if (extension === 'epub') {
      const reader = new FileReader();
      reader.onload = async (e: any) => {
        try {
          const parsed = await parseEPUB(e.target.result);
          resolve({
            ...parsed,
            cover: parsed.cover || getRandomGradient()
          });
        } catch (err: any) {
          reject(new Error(`Fallo al parsear EPUB: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Fallo al leer archivo EPUB'));
      reader.readAsArrayBuffer(file);
    } else if (extension === 'pdf') {
      const reader = new FileReader();
      reader.onload = async (e: any) => {
        try {
          const fallbackTitle = filename.replace(/\.[^/.]+$/, "");
          const parsed = await parsePDF(e.target.result, fallbackTitle);
          resolve(parsed);
        } catch (err: any) {
          reject(new Error(`Fallo al parsear PDF: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Fallo al leer archivo PDF'));
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const text = e.target.result;
        let content = "";
        let author = "Importado";
        
        try {
          switch (extension) {
            case 'html':
            case 'htm':
              content = parseHTML(text);
              author = 'Archivo HTML';
              break;
              
            case 'rtf':
              content = parseRTF(text);
              author = 'Archivo RTF';
              break;
              
            case 'srt':
              content = parseSRT(text);
              author = 'Subtítulos SRT';
              break;
              
            case 'vtt':
              content = parseVTT(text);
              author = 'Subtítulos WebVTT';
              break;
              
            case 'ass':
            case 'ssa':
              content = parseASS(text);
              author = 'Subtítulos ASS';
              break;
              
            case 'txt':
            default:
              content = text;
              author = 'Archivo de Texto';
              break;
          }
          
          // Clean legacy punctuation (backticks -> 、 and degree signs -> 。) and Aozora markup
          content = content
            .replace(/[｀`]/g, '、')
            .replace(/[゜°]/g, '。')
            .replace(/［＃[^］]+］/g, '')
            .replace(/｜([^\n《]+)《([^\n》]+)》/g, '{$1|$2}')
            .replace(/([\u4e00-\u9faf\u3400-\u4dbf々ー]+)《([^\n》]+)》/g, '{$1|$2}');
          
          if (!content.trim()) {
            reject(new Error('El archivo importado no contiene ningún texto legible.'));
            return;
          }
          
          // Split into chapters by headings if any
          const lines = content.split(/\r?\n/);
          let currentTitle = "Capítulo 1";
          const currentContent: string[] = [];
          const chapters: BookChapter[] = [];
          const chapterPattern = /^(第[一二三四五六七八九十百0-9]+[章話回幕節部]|目次|序|[一二三四五六七八九十]+之巻).*$/;
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (chapterPattern.test(trimmed) || trimmed.startsWith('# ')) {
              if (currentContent.length > 0) {
                chapters.push({
                  title: currentTitle,
                  content: currentContent.join('\n')
                });
              }
              currentTitle = trimmed.replace(/^#\s+/, '');
              currentContent.length = 0;
            } else {
              currentContent.push(line);
            }
          }
          
          if (currentContent.length > 0 || chapters.length === 0) {
            chapters.push({
              title: currentTitle,
              content: currentContent.join('\n')
            });
          }
          
          resolve({
            title: filename.replace(/\.[^/.]+$/, ""),
            author: author,
            cover: getRandomGradient(),
            chapters: chapters
          });
        } catch (err: any) {
          reject(new Error(`Fallo al procesar archivo: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Fallo al leer archivo de texto'));
      reader.readAsText(file);
    }
  });
}
