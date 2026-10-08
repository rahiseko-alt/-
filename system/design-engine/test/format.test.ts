import { describe, expect, it } from 'vitest';
import {
  BookFormatSchema,
  SIZE_PRESETS_MM,
  formatCssVars,
  mmToCssPx,
  mmToPixels,
  pageGeometry,
  pageSide,
  parseData,
  pngDeviceScaleFactor,
  renderPixelSize,
  renderViewport,
  sideMargins,
  type BookFormat,
} from '../src/index.ts';

function geometryOf(format: Record<string, unknown>) {
  return pageGeometry(parseData(BookFormatSchema, format, 'format') as BookFormat);
}

describe('判型 → ページ寸法（mm）', () => {
  it('A4 縦・塗り足し 3mm: 仕上がり 210×297、ページボックス 216×303', () => {
    const g = geometryOf({ size: 'A4', bleed_mm: 3 });
    expect([g.trimWidthMm, g.trimHeightMm]).toEqual([210, 297]);
    expect([g.boxWidthMm, g.boxHeightMm]).toEqual([216, 303]);
    expect(g.orientation).toBe('portrait');
    // 版面幅 = 210 - 18 - 15 = 177、段幅 = (177 - 11×4) / 12
    expect(g.contentWidthMm).toBe(177);
    expect(g.contentHeightMm).toBe(267);
    expect(g.columnWidthMm).toBeCloseTo((177 - 44) / 12, 5);
  });

  it('B5 は JIS B5（182×257）', () => {
    const g = geometryOf({ size: 'B5', bleed_mm: 3 });
    expect([g.trimWidthMm, g.trimHeightMm]).toEqual([182, 257]);
    expect([g.boxWidthMm, g.boxHeightMm]).toEqual([188, 263]);
  });

  it('A4 横は幅と高さを入れ替える', () => {
    const g = geometryOf({ size: 'A4', orientation: 'landscape', bleed_mm: 3 });
    expect([g.trimWidthMm, g.trimHeightMm]).toEqual([297, 210]);
    expect([g.boxWidthMm, g.boxHeightMm]).toEqual([303, 216]);
  });

  it('B4 横（JIS B4 364×257）', () => {
    const g = geometryOf({ size: 'B4', orientation: 'landscape', bleed_mm: 0 });
    expect([g.boxWidthMm, g.boxHeightMm]).toEqual([364, 257]);
  });

  it('custom は width_mm/height_mm をそのまま使う（orientation で入れ替えない）', () => {
    const g = geometryOf({ size: 'custom', width_mm: 100, height_mm: 148, bleed_mm: 2, orientation: 'landscape' });
    expect([g.trimWidthMm, g.trimHeightMm]).toEqual([100, 148]);
    expect([g.boxWidthMm, g.boxHeightMm]).toEqual([104, 152]);
  });

  it('プリセット寸法（A3/A4/A5/B4/B5）', () => {
    expect(SIZE_PRESETS_MM).toEqual({
      A3: { width: 297, height: 420 },
      A4: { width: 210, height: 297 },
      A5: { width: 148, height: 210 },
      B4: { width: 257, height: 364 },
      B5: { width: 182, height: 257 },
    });
  });
});

describe('左右ページ', () => {
  it('左綴じ: 奇数 = 右、偶数 = 左', () => {
    expect([1, 2, 3, 4].map((n) => pageSide(n, 'left'))).toEqual(['right', 'left', 'right', 'left']);
  });
  it('右綴じ: 奇数 = 左、偶数 = 右', () => {
    expect([1, 2, 3].map((n) => pageSide(n, 'right'))).toEqual(['left', 'right', 'left']);
  });
  it('綴じなし: 常に右', () => {
    expect([1, 2].map((n) => pageSide(n, 'none'))).toEqual(['right', 'right']);
  });
  it('右ページはノドが左、左ページはノドが右', () => {
    const g = geometryOf({ size: 'A4' });
    expect(sideMargins(g, 'right')).toEqual({ left: 18, right: 15 });
    expect(sideMargins(g, 'left')).toEqual({ left: 15, right: 18 });
  });
});

describe('ピクセル換算', () => {
  it('PNG サイズ = round((W + 2b) / 25.4 × dpi)', () => {
    const g = geometryOf({ size: 'A4', bleed_mm: 3 });
    expect(renderPixelSize(g, 350)).toEqual({ width: Math.round((216 / 25.4) * 350), height: Math.round((303 / 25.4) * 350) });
    expect(renderPixelSize(g, 350)).toEqual({ width: 2976, height: 4175 });
    expect(mmToPixels(25.4, 300)).toBe(300);
  });

  it('CSS px（96dpi）とビューポート', () => {
    expect(mmToCssPx(25.4)).toBeCloseTo(96, 10);
    const v = renderViewport(geometryOf({ size: 'A4', bleed_mm: 3 }), 192);
    expect(v).toEqual({ width: Math.ceil(mmToCssPx(216)), height: Math.ceil(mmToCssPx(303)), deviceScaleFactor: 2 });
  });

  it('PNG の deviceScaleFactor: dpi / 96 以上で、CSS px の整数に丸めたページボックスが目標の画素数を覆う', () => {
    for (const fmt of [{ size: 'A4' }, { size: 'B5' }, { size: 'A3', orientation: 'landscape' }, { size: 'B4' }] as const) {
      const g = geometryOf({ ...fmt, bleed_mm: 3 });
      for (const dpi of [72, 96, 150, 350, 600]) {
        const dsf = pngDeviceScaleFactor(g, dpi);
        const target = renderPixelSize(g, dpi);
        expect(dsf).toBeGreaterThanOrEqual(dpi / 96);
        expect(dsf / (dpi / 96)).toBeLessThan(1.001); // 拡大は 0.1% 未満
        expect(Math.round(mmToCssPx(g.boxWidthMm)) * dsf).toBeGreaterThanOrEqual(target.width - 1e-6);
        expect(Math.round(mmToCssPx(g.boxHeightMm)) * dsf).toBeGreaterThanOrEqual(target.height - 1e-6);
      }
    }
    // A4 + 3mm（816.375px → 816px）の 350dpi: 2976 / 816
    expect(pngDeviceScaleFactor(geometryOf({ size: 'A4', bleed_mm: 3 }), 350)).toBeCloseTo(2976 / 816, 10);
  });

  it('formatCssVars', () => {
    const vars = formatCssVars(geometryOf({ size: 'A4', bleed_mm: 3, columns: 6, gutter_mm: 5 }));
    expect(vars).toMatchObject({
      '--trim-w': '210mm',
      '--trim-h': '297mm',
      '--bleed': '3mm',
      '--safe': '5mm',
      '--margin-top': '15mm',
      '--margin-bottom': '15mm',
      '--margin-inside': '18mm',
      '--margin-outside': '15mm',
      '--columns': '6',
      '--gutter': '5mm',
    });
  });
});
