// 描画結果の印刷チェック: 文字の最小サイズ（system/rules/typography-ja.md）と安全領域（system/rules/page-layers.md）
import type { Page } from 'playwright';
import type { PageGeometry } from '../../design-engine/src/index.ts';

/** 読ませる文字の最小サイズ（pt） */
export const MIN_TEXT_PT = 6.5;
/** 白抜き文字の最小サイズ（pt）と、ウェイト 500 以上を求める大きさの上限（pt） */
export const MIN_INVERSE_TEXT_PT = 7;
export const MIN_INVERSE_TEXT_WEIGHT = 500;
export const INVERSE_WEIGHT_BELOW_PT = 12;
/** 読ませない文字（裁ち落とす装飾文字など）に付けると、この検査の対象外になる */
export const PRINT_QA_IGNORE_ATTR = 'data-print-qa';

/** 1 か所分の検出結果（座標は仕上がり線の左上を原点とする mm） */
export interface PrintQaFinding {
  page: string;
  kind: 'small' | 'inverse' | 'safe';
  text: string;
  xMm: number;
  yMm: number;
  /** small / inverse: 実効の文字サイズ（pt）。safe: はみ出し量（mm） */
  value: number;
  weight?: number;
}

/** ブラウザ内で文字を走査する。描画済みの全ページ（.page）が対象 */
export async function collectPrintQa(page: Page, safeMm: number): Promise<PrintQaFinding[]> {
  // tsx（esbuild）が関数名を保つために差し込む __name() をブラウザ側でも使えるようにする
  await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
  return page.evaluate(
    ({ safeMm, ignoreAttr }) => {
      const PX_PER_MM = 96 / 25.4;
      const TOL_MM = 0.1;
      const findings: Array<{ page: string; kind: 'small' | 'inverse' | 'safe'; text: string; xMm: number; yMm: number; value: number; weight?: number }> = [];

      /** 要素の縦方向の拡大率（祖先の CSS transform を掛け合わせる。回転は打ち消し合う） */
      const verticalScale = (el: Element): number => {
        if (el instanceof SVGGraphicsElement) {
          const m = el.getScreenCTM();
          return m ? Math.hypot(m.c, m.d) : 1;
        }
        let scale = 1;
        for (let a: Element | null = el; a; a = a.parentElement) {
          const t = getComputedStyle(a).transform;
          if (t && t !== 'none') {
            const m = new DOMMatrixReadOnly(t);
            scale *= Math.hypot(m.c, m.d);
          }
        }
        return scale;
      };
      const isInverse = (color: string): boolean => {
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color);
        return !!m && Math.min(Number(m[1]), Number(m[2]), Number(m[3])) >= 230;
      };
      const isHidden = (el: Element): boolean => {
        for (let a: Element | null = el; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
        }
        return false;
      };

      for (const pageEl of Array.from(document.querySelectorAll('.page'))) {
        const trim = pageEl.querySelector('.trim');
        if (!trim) continue;
        const label = pageEl.getAttribute('data-page') ?? '';
        const tr = trim.getBoundingClientRect();
        const safe = safeMm * PX_PER_MM;
        const tol = TOL_MM * PX_PER_MM;
        const inner = { l: tr.left + safe, t: tr.top + safe, r: tr.right - safe, b: tr.bottom - safe };
        const walker = document.createTreeWalker(trim, NodeFilter.SHOW_TEXT);
        const seen = new Set<Element>();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const el = node.parentElement;
          if (!el || el.closest(`[${ignoreAttr}="ignore"], .photo-frame__placeholder, script, style`) || isHidden(el)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          let rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
          // SVG の <text> は Range から矩形が取れないことがあるので要素の矩形を使う
          if (rects.length === 0 && el instanceof SVGGraphicsElement) rects = [el.getBoundingClientRect()].filter((r) => r.width > 0 && r.height > 0);
          if (rects.length === 0) continue;
          const first = rects[0]!;
          const pos = { xMm: (first.left - tr.left) / PX_PER_MM, yMm: (first.top - tr.top) / PX_PER_MM };
          const snippet = text.length > 14 ? `${text.slice(0, 14)}…` : text;

          const cs = getComputedStyle(el);
          const emPx = parseFloat(cs.fontSize) * verticalScale(el);
          if (!seen.has(el)) {
            seen.add(el);
            const pt = emPx * 0.75;
            const weight = Number(cs.fontWeight) || 400;
            if (isInverse(cs.color)) {
              if (pt < 7 - 0.05 || (pt < 12 - 0.05 && weight < 500)) findings.push({ page: label, kind: 'inverse', text: snippet, ...pos, value: pt, weight });
            } else if (pt < 6.5 - 0.05) {
              findings.push({ page: label, kind: 'small', text: snippet, ...pos, value: pt });
            }
          }

          // 行の矩形は字面より上下（縦組みは左右）に広いので、文字の送り方向と直角の向きは 1em の枠で判定する
          const vertical = cs.writingMode.startsWith('vertical') || cs.writingMode.startsWith('sideways');
          let over = 0;
          for (const r of rects) {
            let { left, right, top, bottom } = r;
            if (vertical) {
              const mid = (left + right) / 2;
              left = mid - emPx / 2;
              right = mid + emPx / 2;
            } else {
              const mid = (top + bottom) / 2;
              top = mid - emPx / 2;
              bottom = mid + emPx / 2;
            }
            over = Math.max(over, inner.l - left, inner.t - top, right - inner.r, bottom - inner.b);
          }
          if (over > tol) findings.push({ page: label, kind: 'safe', text: snippet, ...pos, value: over / PX_PER_MM });
        }
      }
      return findings;
    },
    { safeMm, ignoreAttr: PRINT_QA_IGNORE_ATTR },
  );
}

const KIND_MESSAGE: Record<PrintQaFinding['kind'], string> = {
  small: `${MIN_TEXT_PT}pt 未満の文字`,
  inverse: `白抜き文字が ${MIN_INVERSE_TEXT_PT}pt 未満、または ${INVERSE_WEIGHT_BELOW_PT}pt 未満でウェイト ${MIN_INVERSE_TEXT_WEIGHT} 未満`,
  safe: '安全領域の外の文字',
};

/** 検出結果をページ・種類ごとの 1 行にまとめる（例は先頭 3 か所） */
export function formatPrintQa(findings: PrintQaFinding[], geometry: Pick<PageGeometry, 'safeMm'>): string[] {
  const groups = new Map<string, PrintQaFinding[]>();
  for (const f of findings) {
    const key = `${f.page}\u0000${f.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const lines: string[] = [];
  for (const list of groups.values()) {
    const { page, kind } = list[0]!;
    const examples = list.slice(0, 3).map((f) => {
      const at = `x ${f.xMm.toFixed(1)}・y ${f.yMm.toFixed(1)}mm`;
      if (kind === 'safe') return `「${f.text}」${at}・${f.value.toFixed(1)}mm はみ出し`;
      if (kind === 'inverse') return `「${f.text}」${at}・${f.value.toFixed(1)}pt・${f.weight}`;
      return `「${f.text}」${at}・${f.value.toFixed(1)}pt`;
    });
    const more = list.length > 3 ? ` ほか ${list.length - 3} か所` : '';
    const rule =
      kind === 'safe'
        ? `仕上がり線から ${geometry.safeMm}mm の内側に置く（system/rules/page-layers.md）`
        : 'system/rules/typography-ja.md「最小サイズ」';
    lines.push(`${page}: ${KIND_MESSAGE[kind]}が ${list.length} か所（${examples.join('、')}${more}）。${rule}`);
  }
  return lines;
}
