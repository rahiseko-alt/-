// 参考資料関連のスキーマ
// - books/<bookId>/references.yaml（BOOK が使う参考資料の指定）
// - references/<source>/<kind>/source.yaml（参考資料の出自・禁止語）
// - references/<source>/<kind>/analysis/*.yaml（解析結果）
// - references/<source>/<kind>/prep/*.yaml（比較用にページ画像を正立・単ページ化する指定）
import { z } from 'zod';
import { NonEmpty, NumOrText, PAGE_ID_RE, RelPath, listOf, requiredListOf } from './common.ts';

/** ページ単位の参照指定 */
export const PageReferenceSchema = z.looseObject({
  layout_reference: listOf(RelPath),
  visual_reference: listOf(RelPath),
  information_reference: listOf(RelPath),
  notes: z.string().nullish(),
});
export type PageReference = z.output<typeof PageReferenceSchema>;

/** references.yaml: トップレベルの references 配列 + 任意個の page_NNN キー */
export type BookReferences = { references: string[] } & { [pageId: `page_${string}`]: PageReference | undefined };

const BookReferencesRawSchema = z
  .object({ references: listOf(RelPath) })
  .catchall(PageReferenceSchema)
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      if (key !== 'references' && !PAGE_ID_RE.test(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: '未知のキーです（references か page_NNN のみ指定できます）' });
      }
    }
  });

export const BookReferencesSchema = z.preprocess(
  (v) => (v == null ? {} : v),
  BookReferencesRawSchema,
) as unknown as z.ZodType<BookReferences>;

/** references.yaml に含まれるすべてのパス（references とページ単位の全参照） */
export function allReferencePaths(refs: BookReferences): string[] {
  const out = new Set<string>(refs.references);
  for (const [key, value] of Object.entries(refs)) {
    if (key === 'references' || value == null || Array.isArray(value)) continue;
    const pr = value as PageReference;
    for (const p of [...pr.layout_reference, ...pr.visual_reference, ...pr.information_reference]) out.add(p);
  }
  return [...out];
}

/** 指定ページの参照（なければ undefined） */
export function pageReference(refs: BookReferences, pageId: string): PageReference | undefined {
  if (!PAGE_ID_RE.test(pageId)) return undefined;
  return refs[pageId as `page_${string}`];
}

/** references/<source>/<kind>/source.yaml */
export const ReferenceSourceSchema = z.looseObject({
  source: NonEmpty,
  title: NonEmpty,
  kind: NonEmpty,
  obtained: NumOrText.nullish(),
  original: RelPath.nullish(),
  pages: z.number().int().min(0).nullish(),
  usage: z.literal('reference-only', { message: 'usage は "reference-only" で固定です' }),
  /** 自社 BOOK・company-data に絶対に出してはいけない語（他校名・固有コピー等） */
  forbidden_terms: requiredListOf(NonEmpty),
  notes: z.string().nullish(),
});
export type ReferenceSource = z.output<typeof ReferenceSourceSchema>;

export const ANALYSIS_KEYS = [
  'grid',
  'margins',
  'gutter',
  'photo_ratios',
  'heading_hierarchy',
  'colors',
  'rules',
  'cards',
  'density',
  'page_type',
  'eye_flow',
  'background',
  'image_crop',
  'rhythm',
  'notes',
] as const;

/** 解析結果（analysis/book.yaml, analysis/page_NNN.yaml）。値の形は自由、未知キーも許容 */
export const AnalysisSchema = z.preprocess(
  (v) => (v == null ? {} : v),
  z.looseObject(Object.fromEntries(ANALYSIS_KEYS.map((k) => [k, z.unknown().optional()])) as Record<(typeof ANALYSIS_KEYS)[number], z.ZodOptional<z.ZodUnknown>>),
);
export type Analysis = z.output<typeof AnalysisSchema>;

/** 0〜1 の比率 */
const Ratio = z.number().min(0).max(1);

/**
 * references/<source>/<kind>/prep/<name>.yaml
 * 写真・スキャンのページ画像を、比較（npm run compare）用に正立・単ページ・台形補正した画像にする指定。
 * corners は rotate を適用した後の画像における、ページの 左上・右上・右下・左下（幅・高さに対する比率）。
 */
export const ReferencePrepSchema = z.looseObject({
  image: RelPath,
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)], { message: 'rotate は 0 / 90 / 180 / 270（時計回り）です' }).default(0),
  corners: z.array(z.tuple([Ratio, Ratio])).length(4, { message: 'corners は 左上・右上・右下・左下 の 4 点です' }),
  aspect: z.number().positive({ message: 'aspect（出力の 幅 / 高さ）は正の数です' }),
  height_px: z.number().int().min(100).max(8000).default(2000),
  notes: z.string().nullish(),
});
export type ReferencePrep = z.output<typeof ReferencePrepSchema>;
