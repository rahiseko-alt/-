// Playwright（Chromium）で合成済み HTML を開き、フォント・画像の読み込みを待つ
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Request } from 'playwright';
import { isReferencePath } from '../../design-engine/src/index.ts';
import { CliError, firstLine } from './cli.ts';
import type { StudioServer } from './studio-server.ts';

const require = createRequire(import.meta.url);

/** Playwright 指定版の代わりに使う Chromium の実行ファイルを指定する環境変数 */
export const CHROMIUM_PATH_ENV = 'STUDIO_CHROMIUM_PATH';

function realPath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

/**
 * Playwright 指定版の実行ファイル（既定の headless 起動が使う headless shell）。
 * 同じビルドのフル版（chromium.executablePath()）は描画がわずかに違うことがあるので指定版に含めない。
 * headless shell の場所は Playwright の内部 API でしか分からないので、取れなければ null（どれも指定版とみなさない）
 */
function defaultChromiumPath(): string | null {
  try {
    const { registry } = require('playwright-core/lib/server') as {
      registry: { findExecutable(name: string): { executablePath(sdk: string): string | undefined } | undefined };
    };
    const shell = registry.findExecutable('chromium-headless-shell')?.executablePath('javascript');
    return shell ? realPath(shell) : null;
  } catch {
    return null;
  }
}

export interface ChromiumOverride {
  /** 環境変数で指定された実行ファイル */
  path: string;
  /** Playwright 指定版（既定で起動する headless shell。シンボリックリンクも含む）か */
  bundled: boolean;
}

/**
 * 環境変数で指定された Chromium（指定がなければ null）。指定があれば必ずそれで起動する。
 * 指定版を取得できない環境の代替。版が違うと字形・行送りがわずかに変わることがある
 */
export function chromiumOverride(): ChromiumOverride | null {
  const value = process.env[CHROMIUM_PATH_ENV]?.trim();
  if (!value) return null;
  return { path: value, bundled: realPath(value) === defaultChromiumPath() };
}

/** Chromium を起動する（失敗時は対処つきのエラー） */
export async function launchBrowser(): Promise<Browser> {
  const executablePath = chromiumOverride()?.path;
  if (executablePath && !fs.existsSync(executablePath)) {
    throw new CliError(`${CHROMIUM_PATH_ENV} の Chromium が見つかりません: ${executablePath}`, `${CHROMIUM_PATH_ENV} を正しい実行ファイルにするか、外してください`);
  }
  try {
    return await chromium.launch(executablePath ? { executablePath } : {});
  } catch (err) {
    throw new CliError(
      `Chromium を起動できません（${executablePath ? `${CHROMIUM_PATH_ENV}=${executablePath}、` : ''}${firstLine(err)}）`,
      'npm run doctor で環境を確認してください。ブラウザが未インストールなら npx playwright install chromium' +
        `（取得できない環境では、手元の Chromium を ${CHROMIUM_PATH_ENV} に指定できます）`,
    );
  }
}

/** 指定版ではない Chromium で描画しているときの説明（指定版なら null） */
export function chromiumOverrideNote(browser: Browser): string | null {
  const override = chromiumOverride();
  if (!override || override.bundled) return null;
  return `Playwright 指定版ではない Chromium（${CHROMIUM_PATH_ENV}=${override.path}、${browser.version()}）で描画しています。字形・行送りが指定版とわずかに違うことがあります`;
}

export interface OpenedDocument {
  page: Page;
  /** 読み込みに失敗したリソースなどの警告 */
  problems: string[];
  /** 本文の表示テキスト（innerText） */
  text: string;
  /** 読み込まれた参考資料（<root>/references/ 配下）のルート相対パス。描画に使ってはいけない */
  referenceRequests: string[];
  /** Noto（@fontsource）にない文字がシステムフォントで代替描画された箇所（checkFonts のときだけ） */
  fontFallbacks: string[];
  close(): Promise<void>;
}

export interface OpenOptions {
  /** システムフォントによる代替描画を調べる（CDP。ページ数・要素数に比例して時間がかかる） */
  checkFonts?: boolean;
}

interface AssetStatus {
  broken: string[];
  jaFontsLoaded: number;
  text: string;
}

/**
 * render モードの HTML（compose の baseUrl に server.baseUrl を渡したもの）を HTTP 配信で開き、
 * フォントと画像の読み込み完了まで待つ。
 */
export async function openComposed(
  server: StudioServer,
  context: BrowserContext,
  html: string,
  label: string,
  opts: OpenOptions = {},
): Promise<OpenedDocument> {
  const doc = server.addDocument(html);
  const page = await context.newPage();
  const problems: string[] = [];
  const referenceRequests: string[] = [];
  // 合成時の検査（design-engine の reference-guard）をすり抜けた参照も、実際の読み込みで捕まえる。
  // URL はエンコードされたまま届く（references%2F... など）ので、デコードしたルート相対パスで判定する
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(server.baseUrl)) return;
    const rel = server.displayPath(url.replace(/[?#].*$/, ''));
    if (isReferencePath(rel)) referenceRequests.push(rel);
  });
  // HTTP では存在しないファイルも「失敗」にならず 404 の応答になるので、応答の状態で調べる。
  // CSS・フォントは 404 のあと読み込みが中止（requestfailed）にもなるので、二重に報告しない
  const httpFailed = new WeakSet<Request>();
  page.on('response', (res) => {
    if (res.status() < 400) return;
    httpFailed.add(res.request());
    problems.push(`${label}: 読み込みに失敗しました: ${server.displayPath(res.url())}（HTTP ${res.status()}）`);
  });
  page.on('requestfailed', (req) => {
    if (httpFailed.has(req)) return;
    problems.push(`${label}: 読み込みに失敗しました: ${server.displayPath(req.url())}（${req.failure()?.errorText ?? '不明'}）`);
  });
  page.on('pageerror', (err) => problems.push(`${label}: ページ内でエラー: ${firstLine(err)}`));
  try {
    await page.goto(doc.url, { waitUntil: 'load', timeout: 60_000 });
    const status: AssetStatus = await page.evaluate(async () => {
      await document.fonts.ready;
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              }),
        ),
      );
      await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
      // 画像の読み込みで再レイアウトされ、追加の字形サブセットが要求されることがあるので再度待つ
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      let jaFontsLoaded = 0;
      document.fonts.forEach((f) => {
        if (/Noto (Sans|Serif) JP/.test(f.family) && f.status === 'loaded') jaFontsLoaded++;
      });
      return {
        broken: imgs.filter((img) => img.naturalWidth === 0).map((img) => img.getAttribute('src') ?? ''),
        jaFontsLoaded,
        text: document.body.innerText,
      };
    });
    for (const src of status.broken) problems.push(`${label}: 画像を表示できません: ${src}`);
    if (status.jaFontsLoaded === 0 && /[぀-ヿ一-鿿]/.test(status.text)) {
      problems.push(`${label}: 日本語フォント（Noto Sans JP / Noto Serif JP）が読み込まれていません（npm run doctor で確認）`);
    }
    const fontFallbacks = opts.checkFonts ? await findFontFallbacks(page, label) : [];
    return {
      page,
      problems,
      text: status.text,
      referenceRequests,
      fontFallbacks,
      async close() {
        await page.close().catch(() => undefined);
        doc.dispose();
      },
    };
  } catch (err) {
    await page.close().catch(() => undefined);
    doc.dispose();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// システムフォントによる代替描画の検出

/** "U+0-ff, U+3000-303f, U+4e??" 形式の unicode-range を [開始, 終了] の配列にする */
export function parseUnicodeRange(range: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of range.split(',')) {
    const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!m) continue;
    const a = m[1] ?? '';
    if (a.includes('?')) {
      out.push([parseInt(a.replace(/\?/g, '0'), 16), parseInt(a.replace(/\?/g, 'f'), 16)]);
    } else {
      const start = parseInt(a, 16);
      out.push([start, m[2] ? parseInt(m[2], 16) : start]);
    }
  }
  return out;
}

/**
 * Noto Sans JP / Noto Serif JP（@fontsource）に含まれない文字は、Chromium が環境のシステムフォント
 * （WenQuanYi・Liberation・Noto CJK など）で代わりに描くため、環境ごとに字形が変わる（ギリシャ文字・ローマ数字 Ⅰ〜Ⅹ・≒ など）。
 * CDP の CSS.getPlatformFontsForNode で実際に使われたフォントを調べ、Web フォント以外が使われた要素を報告する。
 */
async function findFontFallbacks(page: Page, label: string): Promise<string[]> {
  let cdp: CDPSession;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {
    return []; // CDP が使えないブラウザでは調べない
  }
  const out: string[] = [];
  try {
    // Noto（@fontsource）の unicode-range（代替された文字を特定するため）
    const ranges = (
      await page.evaluate(() => {
        const list: string[] = [];
        document.fonts.forEach((f) => {
          if (/Noto (Sans|Serif) JP/.test(f.family)) list.push(f.unicodeRange);
        });
        return list;
      })
    ).flatMap(parseUnicodeRange);
    const covered = (cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);

    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds: pageNodes } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.page' });
    for (const pageNode of pageNodes) {
      const { attributes } = await cdp.send('DOM.getAttributes', { nodeId: pageNode });
      const i = attributes.indexOf('data-page');
      const pageId = i >= 0 ? (attributes[i + 1] ?? label) : label;
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: pageNode, selector: '*' });
      for (const nodeId of nodeIds) {
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        const system = fonts.filter((f) => !f.isCustomFont && f.glyphCount > 0).map((f) => f.familyName);
        if (system.length === 0) continue;
        const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1 });
        const text = (node.children ?? [])
          .filter((c) => c.nodeType === 3)
          .map((c) => c.nodeValue)
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        // 直下に文字のない要素（子孫のフォントがまとめて返る）は、子孫の要素の側で報告する
        if (!text) continue;
        const chars = [...new Set(Array.from(text).filter((ch) => /\S/.test(ch) && !covered(ch.codePointAt(0) ?? 0)))];
        const snippet = text.length > 30 ? `${text.slice(0, 30)}…` : text;
        const what = chars.length > 0 ? `文字 ${chars.map((c) => `「${c}」`).join('')}` : '文字';
        out.push(`${pageId}: ${what}が Noto Sans JP / Noto Serif JP になく、システムフォント（${[...new Set(system)].join(', ')}）で描画されています（「${snippet}」）`);
      }
    }
  } catch {
    // 調べられなかった場合は何も報告しない（描画そのものは続ける）
  } finally {
    await cdp.detach().catch(() => undefined);
  }
  return [...new Set(out)];
}
