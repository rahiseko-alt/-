// テキスト処理（TODO 検出・Handlebars 式の除去・行番号）

/** 合成済み HTML の <body> から表示テキストを取り出す（タグ・style・script を除去） */
export function htmlBodyText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return decodeEntities(
    body
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** "TODO" の出現箇所を前後の文字つきで返す（表示用、最大 limit 件） */
export function todoSnippets(text: string, limit = 5): string[] {
  const out: string[] = [];
  const re = /TODO/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    // "TODO" から次の "TODO"・空白の連続・30 文字のいずれかまで
    let s = text.slice(m.index, m.index + 30);
    const next = s.indexOf('TODO', 4);
    if (next > 0) s = s.slice(0, next);
    const gap = s.search(/\s{2,}|\n/);
    if (gap > 0) s = s.slice(0, gap);
    s = s.replace(/\s+/g, ' ').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Handlebars のコメント・式（{{...}}）を空白に置き換える（行番号を保つため改行は残す） */
export function stripHandlebars(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return src
    .replace(/\{\{!--[\s\S]*?--\}\}/g, blank)
    .replace(/\{\{![\s\S]*?\}\}/g, blank)
    .replace(/\{\{\{[\s\S]*?\}\}\}/g, blank)
    .replace(/\{\{[\s\S]*?\}\}/g, blank);
}

/** 文字位置から 1 始まりの行番号 */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** 文字数（サロゲートペアを 1 文字と数える） */
export function charLength(s: string): number {
  return Array.from(s).length;
}
