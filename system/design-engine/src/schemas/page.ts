// books/<bookId>/pages/page_NNN/page.yaml のスキーマ
import { z } from 'zod';
import { PageId, RelPath, isSafeCssValue } from './common.ts';

export const PAGE_TYPES = ['cover', 'toc', 'message', 'course', 'interview', 'data', 'access', 'back-cover', 'other'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const PAGE_STATUSES = ['draft', 'review', 'approved'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

/** Layer 1（BASE VISUAL）の背景画像指定 */
export const PageBackgroundSchema = z.object({
  image: RelPath,
  fit: z.enum(['cover', 'contain']).default('cover'),
  position: z
    .string()
    .default('center')
    .refine(isSafeCssValue, { message: 'position に ; { } < > は使えません' }),
  opacity: z.number().min(0).max(1).default(1),
});
export type PageBackground = z.output<typeof PageBackgroundSchema>;

export const PageConfigSchema = z.looseObject({
  id: PageId,
  title: z.string(),
  type: z.enum(PAGE_TYPES),
  background: PageBackgroundSchema.nullish(),
  status: z.enum(PAGE_STATUSES).nullish(),
  notes: z.string().nullish(),
});
export type PageConfig = z.output<typeof PageConfigSchema>;

export const PAGE_KNOWN_KEYS = ['id', 'title', 'type', 'background', 'status', 'notes'];
