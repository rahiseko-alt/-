// book.yaml の配列（pages / styles）を書き換える。
// yaml の Document API で位置を特定し、該当箇所だけを書き換える（コメント・桁揃え・他の行はそのまま残す）。
import { isMap, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type YAMLSeq } from 'yaml';
import { CliError } from './cli.ts';

function parse(text: string, label: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new CliError(`${label}: YAML 構文エラー（${doc.errors[0]?.message.split('\n')[0] ?? ''}）`);
  }
  return doc;
}

function topPair(doc: Document, key: string, label: string): Pair<unknown, unknown> | undefined {
  if (!isMap(doc.contents)) throw new CliError(`${label}: トップレベルがマップではありません`);
  return doc.contents.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<unknown, unknown> | undefined;
}

function listValues(doc: Document, key: string): string[] {
  const v = doc.toJS()?.[key];
  return Array.isArray(v) ? v.map(String) : [];
}

function rangeOf(node: unknown): [number, number] | null {
  const r = (node as Node | null)?.range;
  if (!r) return null;
  // ブロック形式のリストは range が後続のコメント行まで含むことがあるので、最後の項目の終わりまでにする
  if (isSeq(node) && !node.flow && node.items.length > 0) {
    const last = (node.items[node.items.length - 1] as Node | null)?.range;
    if (last) return [r[0], last[1]];
  }
  return [r[0], r[1]];
}

/** 位置で書き換えられない書き方のときの代替（Document API で再出力。コメントは残るが桁揃えは崩れる） */
function viaDocument(text: string, key: string, label: string, edit: (values: string[]) => string[]): string {
  const doc = parse(text, label);
  const next = edit(listValues(doc, key));
  doc.set(key, doc.createNode(next));
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

function verify(text: string, key: string, expected: string[], label: string): string {
  const actual = listValues(parse(text, label), key);
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new CliError(`${label}: ${key} の書き換えに失敗しました（期待: [${expected.join(', ')}] / 結果: [${actual.join(', ')}]）`);
  }
  return text;
}

/** key の値をブロック形式のリストに置き換える（例: "pages: []" → "pages:\n  - page_001"） */
export function setBlockList(text: string, key: string, values: string[], label: string): string {
  const doc = parse(text, label);
  const pair = topPair(doc, key, label);
  const range = rangeOf(pair?.value);
  if (!pair || !range) return verify(viaDocument(text, key, label, () => values), key, values, label);
  // "key:" の直後から置き換える（同じ行のコメントは残す）
  const keyRange = rangeOf(pair.key);
  const colon = keyRange ? text.indexOf(':', keyRange[1]) : -1;
  let head = colon >= 0 && colon < range[0] ? colon + 1 : range[0];
  const between = text.slice(head, range[0]);
  const nl = between.indexOf('\n');
  if (nl >= 0 && between.slice(0, nl).includes('#')) head += nl;
  const before = text.slice(0, head).replace(/[ \t]+$/, '');
  const body = values.length === 0 ? ' []' : `\n${values.map((v) => `  - ${v}`).join('\n')}`;
  return verify(before + body + text.slice(range[1]), key, values, label);
}

/**
 * key のリストに value を挿入する（after の直後。after 省略時は末尾）。
 * フロー形式 [a, b] はその場で書き換え、ブロック形式は直前の項目と同じ字下げで 1 行追加する。
 */
export function insertIntoList(text: string, key: string, value: string, after: string | undefined, label: string): string {
  const doc = parse(text, label);
  const pair = topPair(doc, key, label);
  const current = listValues(doc, key);
  const idx = after ? current.indexOf(after) : current.length - 1;
  if (after && idx < 0) throw new CliError(`${label}: ${key} に "${after}" がありません`);
  const expected = [...current.slice(0, idx + 1), value, ...current.slice(idx + 1)];
  const node = pair?.value;
  if (!pair || node == null || (isScalar(node) && node.value == null)) return setBlockList(text, key, expected, label);
  if (!isSeq(node)) throw new CliError(`${label}: ${key} は配列（リスト）で書いてください`);
  const seq = node as YAMLSeq<unknown>;
  const range = rangeOf(seq);
  if (!range) return verify(viaDocument(text, key, label, () => expected), key, expected, label);

  if (seq.flow) {
    const src = text.slice(range[0], range[1]);
    if (src.includes('#') || src.includes('\n')) return verify(viaDocument(text, key, label, () => expected), key, expected, label);
    return verify(text.slice(0, range[0]) + `[${expected.join(', ')}]` + text.slice(range[1]), key, expected, label);
  }

  const anchor = seq.items[idx];
  const ar = rangeOf(anchor);
  if (!ar) return verify(viaDocument(text, key, label, () => expected), key, expected, label);
  const lineStart = text.lastIndexOf('\n', ar[0] - 1) + 1;
  const prefix = text.slice(lineStart, ar[0]);
  if (!/^[ \t]*-[ \t]+$/.test(prefix)) return verify(viaDocument(text, key, label, () => expected), key, expected, label);
  let lineEnd = text.indexOf('\n', ar[1]);
  if (lineEnd < 0) lineEnd = text.length;
  return verify(text.slice(0, lineEnd) + `\n${prefix}${value}` + text.slice(lineEnd), key, expected, label);
}

/** key のリストから条件に合う項目を取り除く（ブロック形式は行ごと削除。空になったら []） */
export function removeFromList(text: string, key: string, remove: (value: string) => boolean, label: string): string {
  const doc = parse(text, label);
  const pair = topPair(doc, key, label);
  const current = listValues(doc, key);
  // 条件は項目ごとに 1 回だけ評価する（呼び出し側が警告を積む場合に重複させない）
  const removed = new Set(current.filter((v) => remove(v)));
  const expected = current.filter((v) => !removed.has(v));
  if (expected.length === current.length) return text;
  const node = pair?.value;
  if (!isSeq(node)) return text;
  const seq = node as YAMLSeq<unknown>;
  const range = rangeOf(seq);
  if (!range) return verify(viaDocument(text, key, label, () => expected), key, expected, label);
  if (seq.flow) {
    if (text.slice(range[0], range[1]).includes('#')) return verify(viaDocument(text, key, label, () => expected), key, expected, label);
    return verify(text.slice(0, range[0]) + `[${expected.join(', ')}]` + text.slice(range[1]), key, expected, label);
  }
  let out = text;
  // 後ろの項目から行ごと削除する（位置がずれないように）
  for (let i = seq.items.length - 1; i >= 0; i--) {
    const item = seq.items[i];
    const v = isScalar(item) ? String(item.value) : null;
    const r = rangeOf(item);
    if (v == null || !r || !removed.has(v)) continue;
    const lineStart = out.lastIndexOf('\n', r[0] - 1) + 1;
    let lineEnd = out.indexOf('\n', r[1]);
    lineEnd = lineEnd < 0 ? out.length : lineEnd + 1;
    out = out.slice(0, lineStart) + out.slice(lineEnd);
  }
  // すべて消えたら "key: []" にする（値なしの key: は null になるため）
  if (expected.length === 0) return setBlockList(out, key, [], label);
  return verify(out, key, expected, label);
}
