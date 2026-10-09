// 参考資料（references/）をページの描画に使わせないための検査
// 参考ページ画像は比較（npm run compare）・目視・画像生成の参照入力に使い、ページにそのまま貼らない（system/rules/references.md §4）。
// 書き方（{{asset}}・<img src>・パーシャルの src=・CSS の url()・srcset など）に関係なく、
// 合成した HTML / CSS の中の URL を解決して references/ を指すものを見つける。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside, toPosix } from './paths.ts';

/** BOOK の比較出力（npm run compare。参考ページの画素を含む）: books/<id>/reviews/<pageId>/compare-<日時>/ */
const COMPARE_OUTPUT_RE = /^books\/.+\/reviews\/[^/]+\/compare-[^/]*(?:\/|$)/;

/**
 * ルート相対パスが参考資料か（大文字小文字は区別しない）。references/ 配下のほか、参考ページの画素を含む派生物も含む:
 * .cache/（ref:prep の補正画像・gen:inputs の切り出しなど）と、BOOK の比較出力（books/<id>/reviews/<pageId>/compare-<日時>/）
 */
export function isReferencePath(relPath: string): boolean {
  const p = path.posix.normalize(relPath.replace(/\\/g, '/')).replace(/^\.\//, '').toLowerCase();
  return p === 'references' || p.startsWith('references/') || p === '.cache' || p.startsWith('.cache/') || COMPARE_OUTPUT_RE.test(p);
}

const ATTR_URL_RE = /(?:^|[\s"'])(?:src|href|xlink:href|poster|data|background|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const SRCSET_RE = /(?:^|[\s"'])(?:srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&sol;/gi, '/')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&');
}

function decodePercent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * ページ内の URL をルート相対パスに解決する（ルート外・外部 URL・data: などは null）。
 * baseDir: 相対 URL の基準（ルート相対。ページ HTML は "" = <base href> のルート、CSS ファイルはその置き場所）
 */
export function resolvePageUrl(url: string, root: string, baseDir = ''): string | null {
  let u = decodePercent(decodeEntities(url.trim())).replace(/\\/g, '/');
  u = u.replace(/[?#].*$/, '');
  if (!u) return null;
  let rel: string;
  if (/^file:/i.test(u)) {
    let abs: string;
    try {
      abs = fileURLToPath(u);
    } catch {
      return null;
    }
    if (!isInside(path.resolve(root), abs)) return null;
    rel = toPosix(path.relative(path.resolve(root), abs));
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) {
    return null;
  } else if (u.startsWith('/')) {
    // プレビュー（<base href="/">）ではルート直下を指す
    rel = u.slice(1);
  } else {
    rel = path.posix.join(baseDir, u);
  }
  rel = path.posix.normalize(rel);
  if (rel === '..' || rel.startsWith('../')) return null;
  return rel.replace(/^\.\//, '');
}

function collect(re: RegExp, text: string, each: (value: string) => void): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = m[1] ?? m[2] ?? m[3];
    if (v != null) each(v);
  }
}

/** HTML（属性・style 属性・<style>）または CSS の中で references/ を指す URL（ルート相対、重複なし） */
export function findReferenceUrls(text: string, root: string, opts: { baseDir?: string; css?: boolean } = {}): string[] {
  const urls: string[] = [];
  const add = (u: string) => urls.push(u);
  if (!opts.css) {
    collect(ATTR_URL_RE, text, add);
    collect(SRCSET_RE, text, (v) => {
      for (const part of decodeEntities(v).split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u) add(u);
      }
    });
  }
  collect(CSS_URL_RE, text, add);
  collect(CSS_IMPORT_RE, text, add);
  const found: string[] = [];
  for (const u of urls) {
    const rel = resolvePageUrl(u, root, opts.baseDir ?? '');
    if (rel != null && isReferencePath(rel) && !found.includes(rel)) found.push(rel);
  }
  return found;
}
