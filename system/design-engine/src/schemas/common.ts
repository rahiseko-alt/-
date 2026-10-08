// スキーマ共通部品
import { z } from 'zod';
import { StudioError } from '../errors.ts';

/** zod の日本語エラーメッセージ（グローバル設定は変更せず parse ごとに渡す） */
const jaLocale = z.locales.ja();

export const PAGE_ID_RE = /^page_\d{3}$/;
/** BOOK ID: books/ からの相対パス。英数字・ハイフン・アンダースコアのセグメントを / で連結 */
export const BOOK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/;
export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const TODO_RE = /TODO/;

/**
 * リポジトリルート相対パスとして安全か。
 * 先頭スラッシュ・バックスラッシュ・スキーム（http: 等）・ドライブレター・".." セグメントを拒否する。
 */
export function isSafeRelPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(p)) return false;
  return !p.split('/').some((seg) => seg === '..');
}

/** CSS に埋め込んでも構文を壊さない値か */
export function isSafeCssValue(v: string): boolean {
  return !/[;{}<>]/.test(v) && !v.includes('/*');
}

export const RelPath = z
  .string()
  .min(1)
  .refine(isSafeRelPath, {
    message: 'リポジトリルート相対パス（先頭スラッシュなし・"/" 区切り・".." 禁止）で指定してください',
  });

export const CssPath = RelPath.refine((p) => p.endsWith('.css'), { message: '.css ファイルを指定してください' });

export const PageId = z.string().regex(PAGE_ID_RE, { message: 'ページIDは page_NNN（3桁の数字）形式で指定してください' });

export const BookId = z.string().regex(BOOK_ID_RE, {
  message: 'BOOK ID は books/ からの相対パス（英数字・-・_ を / で連結）で指定してください',
});

/** 数値またはテキスト（"TODO: ..." プレースホルダを許容する数値項目用） */
export const NumOrText = z.union([z.number(), z.string()]);

export const NonEmpty = z.string().min(1);

/** null/未指定を空配列として扱う配列 */
export function listOf<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => (v == null ? [] : v), z.array(item));
}

/** キー必須・null は空配列として扱う配列 */
export function requiredListOf<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => (v === null ? [] : v), z.array(item));
}

/** 配列要素の id 重複を検出する superRefine 用関数 */
export function uniqueBy<T>(key: (item: T) => unknown, label = 'id') {
  return (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Map<unknown, number>();
    items.forEach((item, i) => {
      const k = key(item);
      if (seen.has(k)) {
        ctx.addIssue({
          code: 'custom',
          path: [i],
          message: `${label} "${String(k)}" が重複しています（${seen.get(k)} 番目と重複）`,
        });
      } else {
        seen.set(k, i);
      }
    });
  };
}

/** zod の検証エラーを "ファイル: パス: メッセージ" 形式の文字列配列に変換する */
export function formatIssues(error: z.ZodError, label: string): string[] {
  return error.issues.map((issue) => {
    const p = issue.path.length > 0 ? issue.path.map(String).join('.') : '(ルート)';
    return `${label}: ${p}: ${issue.message}`;
  });
}

export type SafeParseResult<T> = { success: true; data: T } | { success: false; issues: string[] };

/** 日本語メッセージで検証し、失敗時は整形済み issues を返す */
export function safeParseData<S extends z.ZodType>(schema: S, data: unknown, label: string): SafeParseResult<z.output<S>> {
  const r = schema.safeParse(data, { error: jaLocale.localeError });
  if (r.success) return { success: true, data: r.data };
  return { success: false, issues: formatIssues(r.error, label) };
}

/** 日本語メッセージで検証し、失敗時は StudioError を投げる */
export function parseData<S extends z.ZodType>(schema: S, data: unknown, label: string): z.output<S> {
  const r = safeParseData(schema, data, label);
  if (!r.success) throw new StudioError(`${label} の形式が正しくありません`, r.issues);
  return r.data;
}

/** オブジェクトスキーマに定義されていないキーを列挙する（警告用） */
export function unknownKeys(shape: Record<string, unknown>, value: unknown): string[] {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter((k) => !Object.prototype.hasOwnProperty.call(shape, k));
}
