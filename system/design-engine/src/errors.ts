// デザインエンジン共通のエラー型

/** データ・設定・パスに関するエラー。issues に個別の問題を列挙する。 */
export class StudioError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = [], options?: { cause?: unknown }) {
    super(formatMessage(message, issues), options);
    this.name = 'StudioError';
    this.issues = issues;
  }
}

function formatMessage(message: string, issues: string[]): string {
  if (issues.length === 0) return message;
  return `${message}\n${issues.map((i) => `  - ${i}`).join('\n')}`;
}

export interface TemplateErrorInfo {
  /** 問題の説明（日本語） */
  detail: string;
  book?: string;
  page?: string;
  /** テンプレートファイル（ルート相対） */
  file?: string;
  /** 見つからなかったキー（例: facts.school.fax） */
  key?: string;
  line?: number;
  column?: number;
  cause?: unknown;
}

/** Handlebars テンプレートの描画エラー。BOOK・ページ・キーを必ずメッセージに含める。 */
export class TemplateError extends StudioError {
  detail: string;
  book?: string;
  page?: string;
  file?: string;
  key?: string;
  line?: number;
  column?: number;

  constructor(info: TemplateErrorInfo) {
    super(info.detail, [], { cause: info.cause });
    this.name = 'TemplateError';
    this.detail = info.detail;
    this.book = info.book;
    this.page = info.page;
    this.file = info.file;
    this.key = info.key;
    this.line = info.line;
    this.column = info.column;
    this.message = this.compose();
  }

  /** 不足しているコンテキスト（book/page/file 等）を補ってメッセージを更新する */
  withContext(ctx: Partial<Pick<TemplateErrorInfo, 'book' | 'page' | 'file' | 'line' | 'column'>>): this {
    this.book ??= ctx.book;
    this.page ??= ctx.page;
    this.file ??= ctx.file;
    this.line ??= ctx.line;
    this.column ??= ctx.column;
    this.message = this.compose();
    return this;
  }

  private compose(): string {
    const where: string[] = [];
    if (this.book) where.push(`book=${this.book}`);
    if (this.page) where.push(`page=${this.page}`);
    let loc = this.file ?? '';
    if (this.line != null) loc += `:${this.line}${this.column != null ? `:${this.column + 1}` : ''}`;
    if (loc) where.push(`at ${loc}`);
    const head = where.length > 0 ? `[テンプレートエラー ${where.join(' ')}] ` : '[テンプレートエラー] ';
    return head + this.detail;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
