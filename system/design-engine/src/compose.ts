// ページ合成: company-data + book.yaml + page.yaml + page.html -> 1 枚の HTML 文書
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StudioError } from './errors.ts';
import { engineAssetUrl, engineStylesheets } from './engine-assets.ts';
import { formatCssVars, pageGeometry, pageSide, type PageGeometry, type PageSide } from './format.ts';
import { loadBook, loadCompanyData, loadPage, type CompanyData, type LoadedBook, type LoadedPage } from './load.ts';
import { isSafeRelPath, HEX_COLOR_RE } from './schemas/common.ts';
import { assetUrl, createTemplateEnv, type TemplateEnv } from './template.ts';
import { resolveInRoot } from './paths.ts';
import { findReferenceUrls, isReferencePath } from './reference-guard.ts';
import type { BookConfig } from './schemas/book.ts';
import type { PageConfig } from './schemas/page.ts';

export type ComposeMode = 'render' | 'preview';

export interface ComposePageOptions {
  /** スタジオのルート（--root。通常はリポジトリルート） */
  root: string;
  bookId: string;
  pageId: string;
  /** render: <base href="file://<root>/">（Playwright 用）／ preview: <base href="/">（Vite 用） */
  mode: ComposeMode;
  /** ガイド（仕上がり線・塗り足し・安全領域・マージン・段組）を重ねる */
  guides?: boolean;
}

export interface ComposeBookOptions {
  root: string;
  bookId: string;
  /** 省略時は book.yaml の pages すべて（順序は book.yaml の pages に従う） */
  pageIds?: string[];
  mode: ComposeMode;
  guides?: boolean;
}

export interface ComposeResult {
  html: string;
  warnings: string[];
}

export interface ComposeBookResult extends ComposeResult {
  /** 合成したページ（順序どおり） */
  pageIds: string[];
}

/** テンプレートに渡すデータ */
export interface TemplateContext {
  facts: CompanyData['facts'];
  brand: CompanyData['brand'];
  copy: CompanyData['copy'];
  photos: CompanyData['photos'];
  book: BookConfig;
  page: PageConfig & { number: number; side: PageSide };
}

/** TODO のままの色の代替（描画は止めず警告を出す） */
const FALLBACK_COLORS: Record<string, string> = {
  primary: '#4d4d4d',
  secondary: '#737373',
  accent: '#999999',
  text: '#1a1a1a',
  muted: '#737373',
  background: '#ffffff',
  surface: '#f2f2f2',
};

interface BookSession {
  root: string;
  mode: ComposeMode;
  guides: boolean;
  company: CompanyData;
  book: LoadedBook;
  geometry: PageGeometry;
  env: TemplateEnv;
  warnings: string[];
}

function openBook(root: string, bookId: string, mode: ComposeMode, guides: boolean): BookSession {
  if (mode !== 'render' && mode !== 'preview') throw new StudioError(`mode は "render" か "preview" です（"${String(mode)}"）`);
  const absRoot = path.resolve(root);
  const warnings: string[] = [];
  const company = loadCompanyData(absRoot);
  const book = loadBook(absRoot, bookId);
  warnings.push(...book.warnings);
  const geometry = pageGeometry(book.config.format);
  const env = createTemplateEnv({ root: absRoot, bookId, company, warnings });
  return { root: absRoot, mode, guides, company, book, geometry, env, warnings };
}

/** テンプレートの描画コンテキストを作る */
export function buildTemplateContext(company: CompanyData, book: BookConfig, page: PageConfig, number: number): TemplateContext {
  return {
    facts: company.facts,
    brand: company.brand,
    copy: company.copy,
    photos: company.photos,
    book,
    page: { ...page, number, side: pageSide(number, book.format.binding) },
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** CSS の font-family 値に整える（単独の名前ならクォートして総称ファミリーを補う） */
function fontFamilyValue(value: string, generic: 'sans-serif' | 'serif'): string {
  const v = value.trim();
  if (v.includes(',') || v.includes('"') || v.includes("'")) return v;
  if (v === 'sans-serif' || v === 'serif' || v === 'monospace') return v;
  return `"${v}", ${generic}`;
}

function cssDeclarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
}

/** :root の CSS 変数（ブランド色・フォント → 判型 → book.theme の順） */
function rootVarsCss(s: BookSession): string {
  const vars: Record<string, string> = {};
  for (const [role, value] of Object.entries(s.company.brand.colors)) {
    if (typeof value !== 'string') continue;
    if (HEX_COLOR_RE.test(value)) {
      vars[`--color-${role}`] = value;
    } else if (FALLBACK_COLORS[role]) {
      vars[`--color-${role}`] = FALLBACK_COLORS[role];
      s.warnings.push(`brand.colors.${role} が未確定（${value}）のため仮の色 ${FALLBACK_COLORS[role]} で描画しました`);
    }
  }
  const f = s.company.brand.fonts;
  vars['--font-heading'] = fontFamilyValue(f.heading, 'sans-serif');
  vars['--font-body'] = fontFamilyValue(f.body, 'sans-serif');
  vars['--font-serif'] = fontFamilyValue(f.serif, 'serif');
  vars['--font-number'] = fontFamilyValue(f.number, 'sans-serif');
  Object.assign(vars, formatCssVars(s.geometry));

  const theme: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.book.config.theme)) theme[k] = String(v);

  let css = `@page {\n  size: ${s.geometry.boxWidthMm}mm ${s.geometry.boxHeightMm}mm;\n  margin: 0;\n}\n`;
  css += `:root {\n${cssDeclarations(vars)}\n}\n`;
  if (Object.keys(theme).length > 0) css += `/* book.yaml theme */\n:root {\n${cssDeclarations(theme)}\n}\n`;
  return css;
}

/** page.css の相対 url() をルート相対に書き換え、ページ要素に @scope する */
function scopePageCss(s: BookSession, page: LoadedPage): string | null {
  if (page.css == null || page.cssPath == null) return null;
  const cssDir = path.posix.dirname(page.cssPath);
  let css = page.css.replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/g, (match, _q: string, url: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return match;
    const rel = path.posix.normalize(path.posix.join(cssDir, url));
    if (!isSafeRelPath(rel)) {
      s.warnings.push(`${page.cssPath}: url(${url}) がルート外を指しています`);
      return match;
    }
    return `url("${rel}")`;
  });
  if (/@import\b/.test(css)) {
    s.warnings.push(`${page.cssPath}: @import は使えません（共通 CSS は book.yaml の styles に指定してください）`);
    css = css.replace(/@import[^;]*;/g, '');
  }
  // <style> 要素を途中で閉じさせない
  css = css.replace(/<\/style/gi, '<\\/style');
  return `@scope (.page[data-page="${page.id}"]) {\n${css}\n}`;
}

function guidesHtml(geometry: PageGeometry): string {
  const cols = Array.from({ length: geometry.columns }, () => '<div class="guide-col"></div>').join('');
  return [
    '<div class="layer layer-guides" aria-hidden="true">',
    '<div class="guide guide-bleed"></div>',
    '<div class="guide guide-trim"></div>',
    '<div class="guide guide-safe"></div>',
    '<div class="guide guide-margins"></div>',
    `<div class="guide guide-columns">${cols}</div>`,
    '</div>',
  ].join('');
}

function backgroundHtml(s: BookSession, page: LoadedPage): string {
  const bg = page.config.background;
  if (!bg) return '';
  if (isReferencePath(bg.image)) throw referenceUseError(`${page.relDir}/page.yaml の background.image`, [bg.image]);
  const abs = resolveInRoot(s.root, bg.image);
  if (!fs.existsSync(abs)) {
    throw new StudioError(`背景画像が見つかりません: ${bg.image}（${page.relDir}/page.yaml の background.image）`);
  }
  const style = `object-fit:${bg.fit};object-position:${bg.position};opacity:${bg.opacity}`;
  return `<img class="base-image" src="${escapeHtml(assetUrl(bg.image))}" alt="" style="${escapeHtml(style)}">`;
}

/** 参考資料をページの描画に使っているときのエラー */
function referenceUseError(where: string, paths: string[]): StudioError {
  return new StudioError(
    `${where}: 参考資料（references/）をページの描画に使っています: ${paths.join(', ')}\n` +
      '参考ページ画像はそのままページに貼れません（比較・目視・画像生成の参照入力に使います）。背景は参考画像を入力して生成し books/<id>/backgrounds/ に、写真・ロゴは company-data/ に置いてください（system/rules/references.md §4）',
  );
}

function stripTags(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

interface PageSection {
  pageId: string;
  title: string;
  html: string;
  css: string | null;
}

function composeSection(s: BookSession, pageId: string): PageSection {
  const index = s.book.config.pages.indexOf(pageId);
  if (index < 0) {
    throw new StudioError(`ページ "${pageId}" は ${s.book.configPath} の pages に含まれていません`);
  }
  const page = loadPage(s.root, s.book.id, pageId);
  s.warnings.push(...page.warnings);
  const number = index + 1;
  const context = buildTemplateContext(s.company, s.book.config, page.config, number);
  const body = s.env.render(page.template, context, { file: page.templatePath, page: pageId });
  // {{asset}} 以外の書き方（<img src>・パーシャルの src=・style 属性の url() など）も含めて確認する
  const refsInBody = findReferenceUrls(body, s.root);
  if (refsInBody.length > 0) throw referenceUseError(`${page.templatePath}（book=${s.book.id} page=${pageId}）`, refsInBody);
  const css = scopePageCss(s, page);
  const refsInCss = css ? findReferenceUrls(css, s.root, { css: true }) : [];
  if (refsInCss.length > 0) throw referenceUseError(page.cssPath ?? `${page.relDir}/page.css`, refsInCss);
  if (stripTags(body).includes('TODO')) {
    s.warnings.push(`${s.book.id}/${pageId}: 本文に "TODO" が含まれています`);
  }
  const attrs = [
    `class="page"`,
    `data-book="${escapeHtml(s.book.id)}"`,
    `data-page="${pageId}"`,
    `data-side="${context.page.side}"`,
    `data-type="${escapeHtml(page.config.type)}"`,
    `data-number="${number}"`,
  ].join(' ');
  const html = [
    `<div ${attrs}>`,
    `<div class="layer layer-base">${backgroundHtml(s, page)}</div>`,
    `<div class="layer layer-main"><div class="trim">\n${body}\n</div></div>`,
    s.guides ? guidesHtml(s.geometry) : '',
    '</div>',
  ].join('\n');
  return { pageId, title: page.config.title, html, css };
}

/** <base href> の値 */
export function baseHref(root: string, mode: ComposeMode): string {
  if (mode === 'preview') return '/';
  const href = pathToFileURL(path.resolve(root)).href;
  return href.endsWith('/') ? href : `${href}/`;
}

function buildDocument(s: BookSession, title: string, sections: PageSection[]): string {
  const head: string[] = [
    '<meta charset="utf-8">',
    `<base href="${escapeHtml(baseHref(s.root, s.mode))}">`,
    `<title>${escapeHtml(title)}</title>`,
    '<meta name="generator" content="publishing-studio design-engine">',
  ];
  for (const ref of engineStylesheets()) {
    head.push(`<link rel="stylesheet" href="${escapeHtml(engineAssetUrl(ref, s.mode))}">`);
  }
  head.push(`<style id="studio-vars">\n${rootVarsCss(s)}</style>`);
  for (const style of s.book.config.styles) {
    const abs = resolveInRoot(s.root, style);
    if (!fs.existsSync(abs)) throw new StudioError(`${s.book.configPath}: styles のファイルが見つかりません: ${style}`);
    const refs = isReferencePath(style) ? [style] : findReferenceUrls(fs.readFileSync(abs, 'utf8'), s.root, { baseDir: path.posix.dirname(style), css: true });
    if (refs.length > 0) throw referenceUseError(`${s.book.configPath} の styles（${style}）`, refs);
    head.push(`<link rel="stylesheet" href="${escapeHtml(assetUrl(style))}" data-book-style>`);
  }
  for (const sec of sections) {
    if (sec.css) head.push(`<style data-page-css="${sec.pageId}">\n${sec.css}\n</style>`);
  }
  const bodyClass = ['studio', `mode-${s.mode}`, s.guides ? 'show-guides' : ''].filter(Boolean).join(' ');
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    ...head,
    '</head>',
    `<body class="${bodyClass}" data-book="${escapeHtml(s.book.id)}">`,
    ...sections.map((sec) => sec.html),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** 1 ページを HTML 文書に合成する */
export function composePage(opts: ComposePageOptions): ComposeResult {
  const s = openBook(opts.root, opts.bookId, opts.mode, opts.guides ?? false);
  const section = composeSection(s, opts.pageId);
  const html = buildDocument(s, `${s.book.config.title} - ${section.pageId} ${section.title}`, [section]);
  return { html, warnings: dedupe(s.warnings) };
}

/** BOOK の複数ページを 1 つの HTML 文書に合成する（ページごとに CSS 改ページ。PDF 用） */
export function composeBook(opts: ComposeBookOptions): ComposeBookResult {
  const s = openBook(opts.root, opts.bookId, opts.mode, opts.guides ?? false);
  const all = s.book.config.pages;
  const requested = opts.pageIds && opts.pageIds.length > 0 ? [...new Set(opts.pageIds)] : all;
  for (const id of requested) {
    if (!all.includes(id)) throw new StudioError(`ページ "${id}" は ${s.book.configPath} の pages に含まれていません`);
  }
  // 並び順は常に book.yaml の pages に従う
  const pageIds = all.filter((id) => requested.includes(id));
  if (pageIds.length === 0) throw new StudioError(`${s.book.configPath}: pages が空です`);
  const sections = pageIds.map((id) => composeSection(s, id));
  const html = buildDocument(s, s.book.config.title, sections);
  return { html, warnings: dedupe(s.warnings), pageIds: [...pageIds] };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}
