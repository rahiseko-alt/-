// render: BOOK のページを PNG / PDF に出力する（Playwright Chromium）
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import type { Browser, Page } from 'playwright';
import {
  bookFileName,
  composeBook,
  composePage,
  loadBook,
  pageGeometry,
  pngDeviceScaleFactor,
  renderPixelSize,
  renderViewport,
  type PageGeometry,
} from '../../design-engine/src/index.ts';
import { CHROMIUM_PATH_ENV, chromiumOverrideNote, launchBrowser, openComposed } from './browser.ts';
import { startStudioServer, type StudioServer } from './studio-server.ts';
import {
  CliError,
  UsageError,
  consoleIo,
  elapsed,
  parseChoice,
  parseCli,
  parsePositiveNumber,
  resolveRoot,
  runCommand,
  show,
  splitList,
  userPath,
  type Command,
  type Io,
} from './cli.ts';
import { collectPrintQa, formatPrintQa } from './print-qa.ts';
import { htmlBodyText, todoSnippets } from './text.ts';

export const RENDER_USAGE = `使い方: npm run render -- --book <id> [オプション]
  --book <id>             対象 BOOK（必須。例: brochure, flyers/open-campus）
  --page <id>             対象ページ（複数指定・カンマ区切り可。省略時は全ページ）
  --format png|pdf|both   出力形式（既定: both）
  --dpi <N>               PNG の解像度（既定: book.yaml の output.png_dpi。それより低い確認用の PNG は --out が必要）
  --guides                ガイド（仕上がり線・塗り足し・安全領域・マージン・段組）を重ねる（確認用。--out が必要）
  --release               入稿・公開用。描画結果に "TODO" が残っている、6.5pt 未満（白抜きは 7pt 未満）や安全領域の外の文字がある、
                          ガイドが有効、または STUDIO_CHROMIUM_PATH で指定版以外の Chromium を使っていると失敗する（通常の出力では警告）
  --out <dir>             出力先（既定: books/<id>/output。その下に png/ と pdf/ を作る）。
                          確認用（--guides、または png_dpi 未満の --dpi の PNG）は --out で一時ディレクトリを指定する
                          （省略すると既定の出力先に書かずに失敗する。意図して output/ に置くなら --out books/<id>/output と明示）
  --root <dir>            スタジオのルート（既定: リポジトリルート）
例:
  npm run render -- --book brochure
  npm run render -- --book brochure --page page_001 --format png --dpi 150 --guides --out /tmp/brochure-check
  npm run render -- --book brochure --release`;

export const RENDER_FORMATS = ['png', 'pdf', 'both'] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

/** PNG の解像度の上限 */
export const MAX_DPI = 1200;

/**
 * PNG 1 枚の画素数の上限。
 * Chromium のスクリーンショットは約 1.3 億画素を超えると下側が描かれないまま（白のまま）返るため、余裕を見て 1 億画素で止める。
 * 例: A4（塗り足し 3mm）は 1000dpi で約 1.01 億画素、A3 は 700dpi で約 9,800 万画素
 */
export const MAX_PNG_PIXELS = 100_000_000;

export interface RenderOptions {
  /** スタジオのルート（絶対パス） */
  root: string;
  bookId: string;
  /** 省略時は book.yaml の pages すべて */
  pageIds?: string[];
  format: RenderFormat;
  /** 省略時は book.yaml の output.png_dpi */
  dpi?: number;
  guides?: boolean;
  release?: boolean;
  /** 出力先（絶対パス。省略時は books/<id>/output。確認用の出力（guides、または png_dpi 未満の PNG）では省略するとエラー） */
  outDir?: string;
}

export interface RenderedPng {
  pageId: string;
  file: string;
  width: number;
  height: number;
}

export interface RenderResult {
  dpi: number;
  geometry: PageGeometry;
  pageIds: string[];
  outDir: string;
  png: RenderedPng[];
  pdf: { file: string; pages: number } | null;
  warnings: string[];
}

/** PDF のファイル名（全ページなら <BOOK>.pdf、一部なら <BOOK>-<page>-<page>.pdf） */
export function pdfFileName(bookId: string, pageIds: string[], allPages: string[]): string {
  const base = bookFileName(bookId);
  const isAll = pageIds.length === allPages.length && pageIds.every((p, i) => p === allPages[i]);
  return isAll ? `${base}.pdf` : `${base}-${pageIds.join('-')}.pdf`;
}

/** BOOK のページを描画して PNG / PDF を書き出す */
export async function renderBook(opts: RenderOptions, io: Io = consoleIo): Promise<RenderResult> {
  const root = opts.root;
  const book = loadBook(root, opts.bookId);
  const allPages = book.config.pages;
  if (allPages.length === 0) throw new CliError(`${book.configPath} の pages が空です`, 'npm run new:page -- --book <id> でページを追加してください');

  const requested = opts.pageIds && opts.pageIds.length > 0 ? opts.pageIds : allPages;
  const unknown = requested.filter((p) => !allPages.includes(p));
  if (unknown.length > 0) {
    throw new CliError(`${book.configPath} の pages にないページです: ${unknown.join(', ')}`, `指定できるページ: ${allPages.join(', ')}`);
  }
  // 並び順は book.yaml に従う
  const pageIds = allPages.filter((p) => requested.includes(p));

  if (opts.release && opts.guides) {
    throw new CliError('--release と --guides は同時に指定できません（入稿・公開用の出力にガイドは入れません）');
  }

  const geometry = pageGeometry(book.config.format);
  const dpi = opts.dpi ?? book.config.output.png_dpi;
  if (dpi > MAX_DPI) throw new CliError(`dpi は ${MAX_DPI} 以下で指定してください（${dpi}）`);
  const wantPng = opts.format === 'png' || opts.format === 'both';
  if (wantPng) {
    const px = renderPixelSize(geometry, dpi);
    if (px.width * px.height > MAX_PNG_PIXELS) {
      let maxDpi = Math.floor(dpi * Math.sqrt(MAX_PNG_PIXELS / (px.width * px.height)));
      while (maxDpi > 1 && renderPixelSize(geometry, maxDpi).width * renderPixelSize(geometry, maxDpi).height > MAX_PNG_PIXELS) maxDpi--;
      throw new CliError(
        `PNG が大きすぎます（${geometry.boxWidthMm}×${geometry.boxHeightMm}mm・${dpi}dpi = ${px.width}×${px.height}px、約 ${((px.width * px.height) / 1e8).toFixed(2)} 億画素）。` +
          `1 枚 ${MAX_PNG_PIXELS / 1e8} 億画素までです（Chromium のスクリーンショットは約 1.3 億画素を超えると下側が欠けるため）`,
        `--dpi ${maxDpi} 以下にしてください（印刷用は通常 350dpi）`,
      );
    }
  }
  const defaultOutDir = path.join(book.dir, 'output');
  if (opts.outDir == null) assertNotCheckOutput(root, opts.bookId, defaultOutDir, { guides: opts.guides ?? false, wantPng, dpi, pngDpi: book.config.output.png_dpi });
  const outDir = opts.outDir ?? defaultOutDir;
  const wantPdf = opts.format === 'pdf' || opts.format === 'both';
  const warnings: string[] = [];
  const addWarnings = (list: string[]) => {
    for (const w of list) if (!warnings.includes(w)) warnings.push(w);
  };

  // Chromium には file:// ではなく、render の間だけ起動する HTTP サーバー経由で読ませる
  const server = await startStudioServer(root);
  try {
    return await renderWithServer(server, opts, io, { root, allPages, pageIds, geometry, dpi, outDir, wantPng, wantPdf, warnings, addWarnings });
  } finally {
    await server.close();
  }
}

/**
 * 確認用の出力（ガイド付き、または book.yaml の png_dpi 未満の PNG）を、--out なしで既定の出力先（books/<id>/output。
 * Git LFS でコミットする正式な出力の置き場所）に書き出させない（system/rules/output.md §4）。
 * 意図して output/ に置くときは --out で明示すれば通る（呼び出し側は outDir を渡したときはこれを呼ばない）
 */
function assertNotCheckOutput(
  root: string,
  bookId: string,
  defaultOutDir: string,
  o: { guides: boolean; wantPng: boolean; dpi: number; pngDpi: number },
): void {
  const lowDpi = o.wantPng && o.dpi < o.pngDpi;
  if (!o.guides && !lowDpi) return;
  const reasons = [...(o.guides ? ['ガイド付き'] : []), ...(lowDpi ? [`PNG が ${o.dpi}dpi で book.yaml の output.png_dpi ${o.pngDpi} 未満`] : [])];
  const tmp = `--out /tmp/${bookFileName(bookId)}-check`;
  const output = show(root, defaultOutDir);
  throw new CliError(
    `確認用の出力（${reasons.join('、')}）は既定の出力先 ${output}/ に書き出しません（output/ はコミットする正式な出力の置き場所。system/rules/output.md §4）`,
    o.guides
      ? `${tmp} を付けて一時ディレクトリに出してください（ガイド付きの出力は output/ に置かない）`
      : `${tmp} を付けて一時ディレクトリに出すか、--dpi を外して png_dpi（${o.pngDpi}dpi）で出力してください。` +
          `意図して ${o.pngDpi}dpi 未満の PNG を output/ に置く場合は --out ${output} と明示してください`,
  );
}

interface RenderPlan {
  root: string;
  allPages: string[];
  pageIds: string[];
  geometry: PageGeometry;
  dpi: number;
  outDir: string;
  wantPng: boolean;
  wantPdf: boolean;
  warnings: string[];
  addWarnings: (w: string[]) => void;
}

async function renderWithServer(server: StudioServer, opts: RenderOptions, io: Io, plan: RenderPlan): Promise<RenderResult> {
  const { root, allPages, pageIds, geometry, dpi, outDir, wantPng, wantPdf, warnings, addWarnings } = plan;
  const baseUrl = server.baseUrl;
  // 1. 合成（テンプレートエラーはここで止まる）
  const pages = pageIds.map((pageId) => {
    const r = composePage({ root, bookId: opts.bookId, pageId, mode: 'render', guides: opts.guides ?? false, baseUrl });
    addWarnings(r.warnings);
    return { pageId, html: r.html };
  });
  const bookDoc = wantPdf ? composeBook({ root, bookId: opts.bookId, pageIds, mode: 'render', guides: opts.guides ?? false, baseUrl }) : null;
  if (bookDoc) addWarnings(bookDoc.warnings);

  // 2. --release: 何も書き出す前に TODO を確認する
  if (opts.release) {
    const issues: string[] = [];
    for (const p of pages) {
      const snippets = todoSnippets(htmlBodyText(p.html), 3);
      if (snippets.length > 0) issues.push(`${p.pageId}: 本文に "TODO" が残っています（${snippets.map((s) => `「${s}」`).join('、')}）`);
    }
    for (const w of warnings) if (w.includes('TODO') && !w.includes('本文に "TODO"')) issues.push(w);
    if (issues.length > 0) {
      throw new CliError(
        `--release: "TODO" が残っているため出力しません\n${issues.map((i) => `  - ${i}`).join('\n')}`,
        'company-data の TODO を記入し、ページの仮テキストを置き換えてください（一覧: npm run validate -- --strict）',
      );
    }
  }

  const result: RenderResult = { dpi, geometry, pageIds, outDir, png: [], pdf: null, warnings };
  const browser = await launchBrowser();
  try {
    checkBrowser(browser, opts.release ?? false, addWarnings);
    if (wantPng) {
      fs.mkdirSync(path.join(outDir, 'png'), { recursive: true });
      for (const p of pages) {
        const png = await renderPng(browser, server, p.pageId, p.html, geometry, dpi, path.join(outDir, 'png', `${p.pageId}.png`), opts.release ?? false, addWarnings);
        result.png.push(png);
        io.log(`  PNG  ${show(root, png.file)}（${png.width}×${png.height}px）`);
      }
    }
    if (wantPdf && bookDoc) {
      fs.mkdirSync(path.join(outDir, 'pdf'), { recursive: true });
      const file = path.join(outDir, 'pdf', pdfFileName(opts.bookId, pageIds, allPages));
      await renderPdf(browser, server, bookDoc.html, geometry, file, opts.release ?? false, addWarnings, !wantPng);
      result.pdf = { file, pages: pageIds.length };
      io.log(`  PDF  ${show(root, file)}（${pageIds.length} ページ）`);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return result;
}

/** 指定版ではない Chromium: 通常は警告、--release では出力が環境によって変わるためエラー */
function checkBrowser(browser: Browser, release: boolean, addWarnings: (w: string[]) => void): void {
  const note = chromiumOverrideNote(browser);
  if (!note) return;
  if (release) {
    throw new CliError(`--release: ${note}`, `${CHROMIUM_PATH_ENV} を外し、Playwright 指定版の Chromium で出力してください（npx playwright install chromium）`);
  }
  addWarnings([note]);
}

/** 一時ファイルに書いてから置き換える（失敗時に壊れた出力を残さない） */
async function writeAtomic(file: string, write: (tmp: string) => unknown): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await write(tmp);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function assertNoTodo(release: boolean, label: string, text: string): void {
  if (!release) return;
  const snippets = todoSnippets(text, 3);
  if (snippets.length > 0) {
    throw new CliError(`--release: ${label} の描画結果に "TODO" が残っています（${snippets.map((s) => `「${s}」`).join('、')}）`);
  }
}

/** 描画時に参考資料（references/）が読み込まれていたら失敗にする（合成時の検査の取りこぼし対策） */
function assertNoReferenceRequests(label: string, urls: string[]): void {
  if (urls.length === 0) return;
  throw new CliError(
    `${label}: 参考資料（references/）のファイルがページの描画に読み込まれました: ${[...new Set(urls)].join(', ')}`,
    '参考ページ画像はそのままページに貼れません（比較・目視・画像生成の参照入力に使います）（system/rules/references.md §4）',
  );
}

/** システムフォントでの代替描画: 通常は警告、--release では環境によって字形が変わるためエラー */
function checkFontFallbacks(release: boolean, fallbacks: string[], addWarnings: (w: string[]) => void): void {
  if (fallbacks.length === 0) return;
  const hint = 'ギリシャ文字・ローマ数字（Ⅰ〜Ⅹ）・≒ などは Noto Sans JP / Noto Serif JP にありません。別の表記にしてください（例: Ⅱ期 → 2期・II期、β版 → ベータ版、≒ → 約）。system/rules/typography-ja.md';
  if (release) {
    throw new CliError(`--release: 環境によって字形が変わる文字があります\n${fallbacks.map((f) => `  - ${f}`).join('\n')}`, hint);
  }
  addWarnings(fallbacks.map((f) => `${f}。${hint}`));
}

/** 文字の最小サイズ・安全領域: 通常は警告、--release では入稿できないためエラー */
async function checkPrintQa(page: Page, geometry: PageGeometry, release: boolean, addWarnings: (w: string[]) => void): Promise<void> {
  const issues = formatPrintQa(await collectPrintQa(page, geometry.safeMm), geometry);
  if (issues.length === 0) return;
  if (release) {
    throw new CliError(
      `--release: 印刷に向かない文字があります\n${issues.map((i) => `  - ${i}`).join('\n')}`,
      '文字を大きくする・字数を減らす・位置を内側へ移す。読ませない装飾文字だけは data-print-qa="ignore" を付けて対象外にできる',
    );
  }
  addWarnings(issues);
}

/** Playwright のタイムアウトを日本語のエラーにする */
async function withTimeoutMessage<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new CliError(`${label}: 描画が時間内に終わりませんでした（${firstLineOf(err)}）`, '--dpi を下げるか、ページ内の画像を小さくしてください');
    }
    throw err;
  }
}

function firstLineOf(err: Error): string {
  return err.message.split('\n')[0] ?? '';
}

async function renderPng(
  browser: Browser,
  server: StudioServer,
  pageId: string,
  html: string,
  geometry: PageGeometry,
  dpi: number,
  file: string,
  release: boolean,
  addWarnings: (w: string[]) => void,
): Promise<RenderedPng> {
  const vp = renderViewport(geometry, dpi);
  const target = renderPixelSize(geometry, dpi);
  // ビューポートは少し大きめにして、スクリーンショットを目標の画素数ちょうどに切り出す。
  // 倍率は dpi / 96 を基本に、Chromium が CSS px の整数に丸めて描くページボックスが目標の画素数を覆うよう微調整する
  const deviceScaleFactor = pngDeviceScaleFactor(geometry, dpi);
  const context = await browser.newContext({
    viewport: { width: vp.width + 2, height: vp.height + 2 },
    deviceScaleFactor,
  });
  try {
    const doc = await openComposed(server, context, html, pageId, { checkFonts: true });
    try {
      addWarnings(doc.problems);
      assertNoReferenceRequests(pageId, doc.referenceRequests);
      checkFontFallbacks(release, doc.fontFallbacks, addWarnings);
      assertNoTodo(release, pageId, doc.text);
      await checkPrintQa(doc.page, geometry, release, addWarnings);
      // 大きな画像ほど時間がかかる（1 億画素で 30 秒程度）ので、画素数に応じてタイムアウトを延ばす
      const timeout = 60_000 + Math.ceil((target.width * target.height) / 1000);
      const shot = await withTimeoutMessage(pageId, () => doc.page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', timeout }));
      const meta = await sharp(shot).metadata();
      let img = sharp(shot);
      if ((meta.width ?? 0) >= target.width && (meta.height ?? 0) >= target.height) {
        img = img.extract({ left: 0, top: 0, width: target.width, height: target.height });
      } else {
        img = img.resize(target.width, target.height, { fit: 'fill' });
        addWarnings([`${pageId}: スクリーンショットが目標の画素数より小さいため拡大しました（${meta.width}×${meta.height} → ${target.width}×${target.height}）`]);
      }
      await writeAtomic(file, (tmp) => img.withDensity(dpi).png().toFile(tmp));
      return { pageId, file, width: target.width, height: target.height };
    } finally {
      await doc.close();
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function renderPdf(
  browser: Browser,
  server: StudioServer,
  html: string,
  geometry: PageGeometry,
  file: string,
  release: boolean,
  addWarnings: (w: string[]) => void,
  checkFonts: boolean,
): Promise<void> {
  const vp = renderViewport(geometry, 96);
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  try {
    // PNG も書き出すときは PNG 側で調べ済み
    const doc = await openComposed(server, context, html, 'PDF', { checkFonts });
    try {
      addWarnings(doc.problems);
      assertNoReferenceRequests('PDF', doc.referenceRequests);
      checkFontFallbacks(release, doc.fontFallbacks, addWarnings);
      assertNoTodo(release, 'PDF', doc.text);
      if (checkFonts) await checkPrintQa(doc.page, geometry, release, addWarnings);
      const pdf = await doc.page.pdf({
        width: `${geometry.boxWidthMm}mm`,
        height: `${geometry.boxHeightMm}mm`,
        printBackground: true,
        preferCSSPageSize: true,
      });
      await writeAtomic(file, (tmp) => fs.writeFileSync(tmp, pdf));
    } finally {
      await doc.close();
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

export const renderCommand: Command = (argv, io = consoleIo) =>
  runCommand(io, RENDER_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          book: { type: 'string' },
          page: { type: 'string', multiple: true },
          format: { type: 'string', default: 'both' },
          dpi: { type: 'string' },
          guides: { type: 'boolean', default: false },
          release: { type: 'boolean', default: false },
          out: { type: 'string' },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
      }),
    );
    if (values.help) {
      io.log(RENDER_USAGE);
      return 0;
    }
    if (!values.book) throw new UsageError('--book を指定してください');
    const format = parseChoice('--format', values.format ?? 'both', RENDER_FORMATS);
    const dpi = parsePositiveNumber('--dpi', values.dpi, { max: MAX_DPI });
    const root = resolveRoot(values.root);
    const start = Date.now();

    io.log(`render: BOOK ${values.book}（ルート: ${root}）`);
    const r = await renderBook(
      {
        root,
        bookId: values.book,
        pageIds: splitList(values.page),
        format,
        dpi,
        guides: values.guides,
        release: values.release,
        outDir: values.out ? userPath(values.out) : undefined,
      },
      io,
    );
    const g = r.geometry;
    const files = r.png.length + (r.pdf ? 1 : 0);
    io.log('');
    io.log(
      `判型: ${g.size === 'custom' ? 'custom' : `${g.size} ${g.orientation}`} 仕上がり ${g.trimWidthMm}×${g.trimHeightMm}mm + 塗り足し ${g.bleedMm}mm = ${g.boxWidthMm}×${g.boxHeightMm}mm`,
    );
    if (r.png.length > 0) io.log(`PNG: ${r.png.length} ページ・${r.dpi}dpi・${r.png[0]?.width}×${r.png[0]?.height}px → ${show(root, path.join(r.outDir, 'png'))}/`);
    if (r.pdf) io.log(`PDF: ${r.pdf.pages} ページ → ${show(root, r.pdf.file)}`);
    if (r.warnings.length > 0) {
      io.log(`\n警告（${r.warnings.length} 件）:`);
      for (const w of r.warnings) io.log(`  - ${w}`);
    }
    io.log(`\n完了: ${files} ファイルを書き出しました（${elapsed(start)}）${values.guides ? ' ※ガイド付き' : ''}${values.release ? ' ※release' : ''}`);
    return 0;
  });
