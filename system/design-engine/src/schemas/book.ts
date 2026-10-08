// books/<bookId>/config/book.yaml のスキーマ
import { z } from 'zod';
import { BookId, CssPath, PageId, isSafeCssValue, listOf, uniqueBy } from './common.ts';

export const SIZE_NAMES = ['A3', 'A4', 'A5', 'B4', 'B5', 'custom'] as const;
export type SizeName = (typeof SIZE_NAMES)[number];
export type PresetSizeName = Exclude<SizeName, 'custom'>;

/** 仕上がりサイズ（縦向き・mm）。B 判は JIS B 列 */
export const SIZE_PRESETS_MM: Record<PresetSizeName, { width: number; height: number }> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B4: { width: 257, height: 364 },
  B5: { width: 182, height: 257 },
};

export const BOOK_KINDS = ['brochure', 'admissions', 'flyer', 'poster', 'guide', 'event', 'other'] as const;
export type BookKind = (typeof BOOK_KINDS)[number];

export const ORIENTATIONS = ['portrait', 'landscape'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const BINDINGS = ['left', 'right', 'none'] as const;
export type Binding = (typeof BINDINGS)[number];

const Mm = z.number().min(0);

export const DEFAULT_MARGINS_MM = { top: 15, bottom: 15, inside: 18, outside: 15 };

export const MarginsSchema = z.object({
  top: Mm.default(DEFAULT_MARGINS_MM.top),
  bottom: Mm.default(DEFAULT_MARGINS_MM.bottom),
  inside: Mm.default(DEFAULT_MARGINS_MM.inside),
  outside: Mm.default(DEFAULT_MARGINS_MM.outside),
});

export const BookFormatSchema = z
  .object({
    size: z.enum(SIZE_NAMES),
    orientation: z.enum(ORIENTATIONS).default('portrait'),
    width_mm: z.number().positive().optional(),
    height_mm: z.number().positive().optional(),
    bleed_mm: Mm.default(3),
    safe_mm: Mm.default(5),
    margins_mm: MarginsSchema.default({ ...DEFAULT_MARGINS_MM }),
    columns: z.number().int().min(1).max(48).default(12),
    gutter_mm: Mm.default(4),
    binding: z.enum(BINDINGS).default('left'),
  })
  .superRefine((f, ctx) => {
    if (f.size === 'custom') {
      if (f.width_mm == null) ctx.addIssue({ code: 'custom', path: ['width_mm'], message: 'size: custom のときは width_mm が必要です' });
      if (f.height_mm == null) ctx.addIssue({ code: 'custom', path: ['height_mm'], message: 'size: custom のときは height_mm が必要です' });
    }
  });
export type BookFormat = z.output<typeof BookFormatSchema>;

const CssVarName = z.string().regex(/^--[A-Za-z0-9_-]+$/, { message: 'theme のキーは CSS カスタムプロパティ名（--xxx）で指定してください' });
const CssVarValue = z
  .union([z.string(), z.number()])
  .refine((v) => isSafeCssValue(String(v)), { message: 'theme の値に ; { } < > は使えません' });

export const BookOutputSchema = z.object({
  png_dpi: z.number().int().min(36).max(2400).default(350),
  preview_dpi: z.number().int().min(36).max(2400).default(150),
});

export const BookConfigSchema = z.looseObject({
  id: BookId,
  title: z.string().min(1),
  kind: z.enum(BOOK_KINDS),
  format: BookFormatSchema,
  styles: listOf(CssPath),
  theme: z.preprocess((v) => (v == null ? {} : v), z.record(CssVarName, CssVarValue)),
  pages: listOf(PageId).superRefine(uniqueBy((p: string) => p, 'ページID')),
  output: z.preprocess((v) => (v == null ? {} : v), BookOutputSchema),
  description: z.string().nullish(),
  notes: z.string().nullish(),
});
export type BookConfig = z.output<typeof BookConfigSchema>;

/** 警告対象にしない既知キー */
export const BOOK_KNOWN_KEYS = ['id', 'title', 'kind', 'format', 'styles', 'theme', 'pages', 'output', 'description', 'notes'];
export const FORMAT_KNOWN_KEYS = [
  'size',
  'orientation',
  'width_mm',
  'height_mm',
  'bleed_mm',
  'safe_mm',
  'margins_mm',
  'columns',
  'gutter_mm',
  'binding',
];
