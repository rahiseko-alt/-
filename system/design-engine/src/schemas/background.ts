// books/<bookId>/backgrounds/<name>.prompt.yaml（背景画像の生成記録）
import { z } from 'zod';
import { NonEmpty, NumOrText, RelPath, listOf } from './common.ts';

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
