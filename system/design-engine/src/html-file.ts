// 合成した HTML を一時ファイルに書き出す（Playwright 用）
// 注意: Chromium は page.setContent() の about:blank 文書から file:// のフォント・画像を読めない。
// render モードの HTML は必ずファイルに書き出して page.goto(url) で開くこと。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface HtmlFile {
  /** 絶対パス */
  file: string;
  /** file:// URL（page.goto に渡す） */
  url: string;
  /** 一時ディレクトリごと削除する */
  dispose(): void;
}

/** HTML を OS の一時ディレクトリに書き出す（<base href> が絶対 URL なので場所はどこでもよい） */
export function writeTempHtml(html: string, name = 'page.html'): HtmlFile {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, html, 'utf8');
  return {
    file,
    url: pathToFileURL(file).href,
    dispose() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
