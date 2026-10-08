// Playwright（Chromium）で合成済み HTML を開き、フォント・画像の読み込みを待つ
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { writeTempHtml } from '../../design-engine/src/index.ts';
import { CliError, firstLine } from './cli.ts';

/** Chromium を起動する（失敗時は対処つきのエラー） */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (err) {
    throw new CliError(
      `Chromium を起動できません（${firstLine(err)}）`,
      'npm run doctor で環境を確認してください。ブラウザが未インストールなら npx playwright install chromium',
    );
  }
}

export interface OpenedDocument {
  page: Page;
  /** 読み込みに失敗したリソースなどの警告 */
  problems: string[];
  /** 本文の表示テキスト（innerText） */
  text: string;
  /** 読み込まれた参考資料（<root>/references/ 配下）のファイル URL。描画に使ってはいけない */
  referenceRequests: string[];
  /** Noto（@fontsource）にない文字がシステムフォントで代替描画された箇所（checkFonts のときだけ） */
  fontFallbacks: string[];
  close(): Promise<void>;
}

export interface OpenOptions {
  /** スタジオのルート。指定すると <root>/references/ の読み込みを referenceRequests に記録する */
  root?: string;
  /** システムフォントによる代替描画を調べる（CDP。ページ数・要素数に比例して時間がかかる） */
  checkFonts?: boolean;
}

/** 表示用に URL のパーセントエンコードを戻す（戻せなければそのまま） */
function displayUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

interface AssetStatus {
  broken: string[];
  jaFontsLoaded: number;
  text: string;
}

/**
 * render モードの HTML を一時ファイルに書き出して開き、フォントと画像の読み込み完了まで待つ。
 * （Chromium は setContent() の文書から file:// のフォント・画像を読めないため必ずファイル経由で開く）
 */
export async function openComposed(context: BrowserContext, html: string, label: string, opts: OpenOptions = {}): Promise<OpenedDocument> {
  const { root } = opts;
  const file = writeTempHtml(html);
  const page = await context.newPage();
  const problems: string[] = [];
  const referenceRequests: string[] = [];
  // 合成時の検査（design-engine の reference-guard）をすり抜けた参照も、実際の読み込みで捕まえる
  const refsPrefix = root ? `${pathToFileURL(path.join(path.resolve(root), 'references')).href}/`.toLowerCase() : null;
  page.on('request', (req) => {
    if (refsPrefix && req.url().toLowerCase().startsWith(refsPrefix)) referenceRequests.push(displayUrl(req.url()));
  });
  page.on('requestfailed', (req) => {
    problems.push(`${label}: 読み込みに失敗しました: ${displayUrl(req.url())}（${req.failure()?.errorText ?? '不明'}）`);
  });
  page.on('pageerror', (err) => problems.push(`${label}: ページ内でエラー: ${firstLine(err)}`));
  try {
    await page.goto(file.url, { waitUntil: 'load', timeout: 60_000 });
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
        file.dispose();
      },
    };
  } catch (err) {
    await page.close().catch(() => undefined);
    file.dispose();
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
