// books/<bookId>/backgrounds/<name>.prompt.yaml（背景画像の生成記録）と layer1-orders.yaml（Layer 1 の生成指示）
import { z } from 'zod';
import { BookId, NonEmpty, NumOrText, PageId, RelPath, listOf } from './common.ts';

/** 参考画像を生成モデルへ入力した方式（system/rules/image-generation.md §3） */
export const REFERENCE_INPUT_USAGES = ['image_prompt', 'image_reference', 'composition', 'style', 'img2img', 'other'] as const;

/** 生成モデルへ直接入力した参考画像 1 件 */
export const ReferenceInputSchema = z.looseObject({
  path: RelPath,
  usage: z.enum(REFERENCE_INPUT_USAGES),
  strength: NumOrText.nullish(),
  note: z.string().nullish(),
});

/**
 * 生成画像に文字を入れない（ルール）。文字は Layer 3 で HTML として配置する。
 * 参考ページ画像は生成モデルへ直接入力してよく、入力したものは reference_inputs に記録する。
 */
export const BackgroundPromptSchema = z.looseObject({
  tool: NonEmpty,
  model: z.string().nullish(),
  prompt: NonEmpty,
  negative_prompt: z.string().nullish(),
  seed: NumOrText.nullish(),
  size: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]).nullish(),
  created: NumOrText.nullish(),
  author: z.string().nullish(),
  reference_inputs: listOf(ReferenceInputSchema),
  params: z.record(z.string(), z.unknown()).nullish(),
  source_refs: listOf(RelPath),
  notes: z.string().nullish(),
});
export type BackgroundPrompt = z.output<typeof BackgroundPromptSchema>;

// ---------------------------------------------------------------------------
// books/<bookId>/backgrounds/layer1-orders.yaml（Layer 1 の生成指示）

/** 生成指示の素材の種類 */
export const LAYER1_KINDS = ['photo', 'cutout', 'illustration', 'texture', 'decoration'] as const;

/** negative_prompt に必ず含める語（system/rules/image-generation.md §3） */
export const REQUIRED_NEGATIVE_TERMS = ['text', 'letters', 'typography', 'words', 'numbers', 'logo', 'watermark', 'signature', 'QR code', 'caption'] as const;

/** 生成指示の素材 ID（= 生成画像のベース名）: page_NNN-<用途> */
export const LAYER1_ITEM_ID_RE = /^page_\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const Mm = z.number({ message: 'mm の数値で指定してください' });
const PositiveMm = Mm.positive({ message: '0 より大きい mm の数値で指定してください' });

/** 生成指示 1 件（生成画像 1 枚） */
export const Layer1OrderItemSchema = z.looseObject({
  id: z.string().regex(LAYER1_ITEM_ID_RE, { message: 'id は page_NNN-<用途>（英小文字・数字・ハイフン）で指定してください' }),
  kind: z.enum(LAYER1_KINDS),
  /** 人物を含む（生成人物の使用可否は人間が確認する） */
  people: z.boolean(),
  optional: z.boolean().default(false),
  /** 配置する枠の大きさ（仕上がり基準の mm。塗り足しにかかる分を含む） */
  size_mm: z.tuple([PositiveMm, PositiveMm]),
  bleed: z.boolean().default(false),
  /** 補正後の参考ページ上で、この枠に当たる範囲 [x, y, w, h]（仕上がり線基準の mm。ページ外へはみ出してよい） */
  crop_mm: z.tuple([Mm, Mm, PositiveMm, PositiveMm]),
  placement: NonEmpty,
  reference_usage: z.enum(REFERENCE_INPUT_USAGES),
  mask: NonEmpty,
  prompt: NonEmpty,
  negative_prompt: NonEmpty.refine(
    (v) => REQUIRED_NEGATIVE_TERMS.every((t) => v.toLowerCase().includes(t.toLowerCase())),
    { message: `negative_prompt に ${REQUIRED_NEGATIVE_TERMS.join(', ')} をすべて含めてください` },
  ),
  summary: NonEmpty,
  notes: z.string().nullish(),
});
export type Layer1OrderItem = z.output<typeof Layer1OrderItemSchema>;

/** ページ 1 枚分の Layer 1 生成指示。生成ツールは人間が指定する（system/prompts/generate-background.md） */
export const Layer1OrdersSchema = z
  .looseObject({
    book: BookId,
    page: PageId,
    /** 生成モデルへ入力する参考ページ画像 */
    reference_image: RelPath,
    /** 補正指定（references/<source>/<kind>/prep/*.yaml）。crop_mm はこの補正後の画像上の位置 */
    reference_prep: RelPath.nullish(),
    status: z.enum(['pending', 'generated']).default('pending'),
    items: z.array(Layer1OrderItemSchema).min(1, { message: 'items を 1 件以上書いてください' }),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((item, i) => {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: `id "${item.id}" が重複しています` });
      seen.add(item.id);
      if (!item.id.startsWith(`${v.page}-`)) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: `id は ${v.page}- で始めてください` });
      }
    });
  });
export type Layer1Orders = z.output<typeof Layer1OrdersSchema>;
