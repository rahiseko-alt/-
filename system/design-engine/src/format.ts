// 判型（book.yaml の format）からページ寸法（mm）を求める
import { SIZE_PRESETS_MM, type Binding, type BookFormat, type Orientation, type SizeName } from './schemas/book.ts';
import { StudioError } from './errors.ts';

export type PageSide = 'left' | 'right';

export interface Margins {
  top: number;
  bottom: number;
  inside: number;
  outside: number;
}

export interface PageGeometry {
  size: SizeName;
  orientation: Orientation;
  binding: Binding;
  /** 仕上がり幅・高さ（mm） */
  trimWidthMm: number;
  trimHeightMm: number;
  /** 塗り足し（mm, 片側） */
  bleedMm: number;
  /** 仕上がり線から内側の安全領域（mm） */
  safeMm: number;
  /** 塗り足し込みのページボックス（mm） = 仕上がり + 2 × 塗り足し */
  boxWidthMm: number;
  boxHeightMm: number;
  margins: Margins;
  columns: number;
  gutterMm: number;
  /** 版面（マージン内側）の幅・高さ（mm） */
  contentWidthMm: number;
  contentHeightMm: number;
  /** 1 段の幅（mm） */
  columnWidthMm: number;
}

/** 判型名と向きから仕上がり寸法（mm）を返す */
export function trimSizeMm(format: Pick<BookFormat, 'size' | 'orientation' | 'width_mm' | 'height_mm'>): {
  width: number;
  height: number;
} {
  if (format.size === 'custom') {
    if (format.width_mm == null || format.height_mm == null) {
      throw new StudioError('size: custom のときは width_mm と height_mm が必要です');
    }
    // custom は指定値をそのまま使う（orientation で入れ替えない）
    return { width: format.width_mm, height: format.height_mm };
  }
  const { width, height } = SIZE_PRESETS_MM[format.size];
  return format.orientation === 'landscape' ? { width: height, height: width } : { width, height };
}

/** book.yaml の format からページジオメトリを計算する */
export function pageGeometry(format: BookFormat): PageGeometry {
  const trim = trimSizeMm(format);
  const bleed = format.bleed_mm;
  const m = format.margins_mm;
  const contentWidthMm = trim.width - m.inside - m.outside;
  const contentHeightMm = trim.height - m.top - m.bottom;
  const columns = format.columns;
  const columnWidthMm = (contentWidthMm - (columns - 1) * format.gutter_mm) / columns;
  return {
    size: format.size,
    orientation: format.orientation,
    binding: format.binding,
    trimWidthMm: trim.width,
    trimHeightMm: trim.height,
    bleedMm: bleed,
    safeMm: format.safe_mm,
    boxWidthMm: round(trim.width + 2 * bleed),
    boxHeightMm: round(trim.height + 2 * bleed),
    margins: { top: m.top, bottom: m.bottom, inside: m.inside, outside: m.outside },
    columns,
    gutterMm: format.gutter_mm,
    contentWidthMm: round(contentWidthMm),
    contentHeightMm: round(contentHeightMm),
    columnWidthMm: round(columnWidthMm),
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * ページ番号（1 始まり）と綴じ方向から見開き上の左右を返す。
 * 左綴じ: 奇数ページ = 右、偶数 = 左。右綴じ: 奇数 = 左、偶数 = 右。綴じなし: 常に右（ノド = 左端）。
 * 右ページはノド（inside）が左端、左ページはノドが右端。
 */
export function pageSide(pageNumber: number, binding: Binding): PageSide {
  if (binding === 'none') return 'right';
  const odd = pageNumber % 2 === 1;
  if (binding === 'left') return odd ? 'right' : 'left';
  return odd ? 'left' : 'right';
}

/** 左右マージン（ページの side によってノド/小口を振り分け） */
export function sideMargins(geometry: PageGeometry, side: PageSide): { left: number; right: number } {
  const { inside, outside } = geometry.margins;
  return side === 'right' ? { left: inside, right: outside } : { left: outside, right: inside };
}

export const CSS_PX_PER_MM = 96 / 25.4;

/** mm -> CSS px（96dpi） */
export function mmToCssPx(mm: number): number {
  return mm * CSS_PX_PER_MM;
}

/** mm -> 指定 dpi のピクセル数（四捨五入） */
export function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/** レンダリング PNG のピクセルサイズ（塗り足し込み）: round((W + 2b) / 25.4 × dpi) */
export function renderPixelSize(geometry: PageGeometry, dpi: number): { width: number; height: number } {
  return { width: mmToPixels(geometry.boxWidthMm, dpi), height: mmToPixels(geometry.boxHeightMm, dpi) };
}

/** Playwright のビューポート（CSS px、塗り足し込みページボックス）と deviceScaleFactor */
export function renderViewport(geometry: PageGeometry, dpi: number): { width: number; height: number; deviceScaleFactor: number } {
  return {
    width: Math.ceil(mmToCssPx(geometry.boxWidthMm)),
    height: Math.ceil(mmToCssPx(geometry.boxHeightMm)),
    deviceScaleFactor: dpi / 96,
  };
}

/**
 * PNG を書き出すときの deviceScaleFactor（基本は dpi / 96）。
 * Chromium は要素の境界を CSS px の整数に丸めて描く（例: 216mm = 816.375px のページが 816px で描かれる）。
 * dpi / 96 のままだと、目標の画素数 round((W + 2b) / 25.4 × dpi) に対して右端・下端に 1〜数 px の白い隙間ができるため、
 * 丸めたページボックスが目標の画素数を必ず覆うように、ごくわずか（0.1% 未満）だけ拡大する。
 */
export function pngDeviceScaleFactor(geometry: PageGeometry, dpi: number): number {
  const target = renderPixelSize(geometry, dpi);
  // Chromium のレイアウト単位（1/64 px）に合わせてから整数に丸める
  const paintedW = Math.max(1, Math.round(Math.round(mmToCssPx(geometry.boxWidthMm) * 64) / 64));
  const paintedH = Math.max(1, Math.round(Math.round(mmToCssPx(geometry.boxHeightMm) * 64) / 64));
  return Math.max(dpi / 96, target.width / paintedW, target.height / paintedH);
}

/** 判型由来の CSS 変数（:root に出力） */
export function formatCssVars(geometry: PageGeometry): Record<string, string> {
  return {
    '--trim-w': `${geometry.trimWidthMm}mm`,
    '--trim-h': `${geometry.trimHeightMm}mm`,
    '--bleed': `${geometry.bleedMm}mm`,
    '--safe': `${geometry.safeMm}mm`,
    '--page-w': `${geometry.boxWidthMm}mm`,
    '--page-h': `${geometry.boxHeightMm}mm`,
    '--margin-top': `${geometry.margins.top}mm`,
    '--margin-bottom': `${geometry.margins.bottom}mm`,
    '--margin-inside': `${geometry.margins.inside}mm`,
    '--margin-outside': `${geometry.margins.outside}mm`,
    '--columns': String(geometry.columns),
    '--gutter': `${geometry.gutterMm}mm`,
    '--column-w': `${geometry.columnWidthMm}mm`,
  };
}
