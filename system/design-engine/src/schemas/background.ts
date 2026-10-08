// books/<bookId>/backgrounds/<name>.prompt.yaml（背景画像の生成記録）
import { z } from 'zod';
import { NonEmpty, NumOrText, RelPath, listOf } from './common.ts';

/** 生成画像に文字を入れない（ルール）。文字は Layer 3 で HTML として配置する。 */
export const BackgroundPromptSchema = z.looseObject({
  tool: NonEmpty,
  model: z.string().nullish(),
  prompt: NonEmpty,
  negative_prompt: z.string().nullish(),
  seed: NumOrText.nullish(),
  size: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]).nullish(),
  created: NumOrText.nullish(),
  author: z.string().nullish(),
  source_refs: listOf(RelPath),
  notes: z.string().nullish(),
});
export type BackgroundPrompt = z.output<typeof BackgroundPromptSchema>;
