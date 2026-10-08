// エンジン同梱アセット（base.css・@fontsource フォント）の場所と URL
// スタジオのルート（--root）に依存せず、常にこのリポジトリの実ファイルを参照する。
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE_ASSETS_DIR, isInside } from './paths.ts';

const require = createRequire(import.meta.url);

/** 読み込むフォント（@fontsource パッケージ名 -> ウェイト） */
export const FONT_PACKAGES: Record<string, string[]> = {
  'noto-sans-jp': ['400', '500', '700', '900'],
  'noto-serif-jp': ['400', '700'],
};

/** プレビュー（Vite）でエンジンアセットを配信する URL 接頭辞 */
export const ENGINE_URL_PREFIX = '/@engine/';

const fontDirCache = new Map<string, string>();

/** @fontsource/<pkg> のディレクトリ（絶対パス） */
export function fontsourceDir(pkg: string): string {
  let dir = fontDirCache.get(pkg);
  if (!dir) {
    dir = path.dirname(require.resolve(`@fontsource/${pkg}/400.css`));
    fontDirCache.set(pkg, dir);
  }
  return dir;
}

export interface EngineAssetRef {
  /** プレビュー用 URL のパス部分（/@engine/ 以下） */
  urlPath: string;
  /** 実ファイル（絶対パス） */
  file: string;
}

/** ページ HTML が読み込むエンジンアセット（フォント CSS → base.css の順） */
export function engineStylesheets(): EngineAssetRef[] {
  const refs: EngineAssetRef[] = [];
  for (const [pkg, weights] of Object.entries(FONT_PACKAGES)) {
    for (const w of weights) {
      refs.push({ urlPath: `fonts/${pkg}/${w}.css`, file: path.join(fontsourceDir(pkg), `${w}.css`) });
    }
  }
  refs.push({ urlPath: 'assets/base.css', file: path.join(ENGINE_ASSETS_DIR, 'base.css') });
  return refs;
}

/**
 * モードに応じたエンジンアセットの URL
 * （render: file:// 絶対 URL、render で baseUrl あり: <baseUrl>@engine/...、preview: /@engine/...）
 */
export function engineAssetUrl(ref: EngineAssetRef, mode: 'render' | 'preview', baseUrl?: string): string {
  if (mode === 'preview') return ENGINE_URL_PREFIX + ref.urlPath;
  return baseUrl ? baseUrl + ENGINE_URL_PREFIX.slice(1) + ref.urlPath : pathToFileURL(ref.file).href;
}

/**
 * /@engine/... のリクエストパスを実ファイルに解決する（許可された場所の外は null）。
 * - /@engine/assets/<file>       -> system/design-engine/src/assets/<file>
 * - /@engine/fonts/<pkg>/<file>  -> node_modules/@fontsource/<pkg>/<file>
 */
export function resolveEngineRequest(urlPath: string): string | null {
  if (!urlPath.startsWith(ENGINE_URL_PREFIX)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(urlPath.slice(ENGINE_URL_PREFIX.length));
  } catch {
    return null;
  }
  if (rest.includes('\0') || rest.split('/').some((s) => s === '..' || s === '')) return null;
  let base: string;
  let sub: string;
  if (rest.startsWith('assets/')) {
    base = ENGINE_ASSETS_DIR;
    sub = rest.slice('assets/'.length);
  } else if (rest.startsWith('fonts/')) {
    const [pkg, ...tail] = rest.slice('fonts/'.length).split('/');
    if (!pkg || !(pkg in FONT_PACKAGES) || tail.length === 0) return null;
    base = fontsourceDir(pkg);
    sub = tail.join('/');
  } else {
    return null;
  }
  const abs = path.resolve(base, sub);
  if (!isInside(base, abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}
