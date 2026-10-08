// lib の単体テスト（YAML の部分書き換え・雛形の置換・テキスト処理・引数）
import { describe, expect, it } from 'vitest';
import { insertIntoList, removeFromList, setBlockList } from '../lib/book-yaml.ts';
import { parseUnicodeRange } from '../lib/browser.ts';
import { UsageError, formatIsoLocal, formatStamp, naturalCompare, parseCli, splitList } from '../lib/cli.ts';
import { fillTemplate, leftoverPlaceholders, raw, yamlString } from '../lib/templates.ts';
import { htmlBodyText, stripHandlebars, todoSnippets } from '../lib/text.ts';
import { parseArgs } from 'node:util';

describe('book-yaml', () => {
  it('フロー形式の pages はその場で書き換える（他の行・コメントはそのまま）', () => {
    const src = '# 先頭のコメント\nid: x   # ID\npages: [page_001, page_002]   # 並び順\nnotes: ""\n';
    expect(insertIntoList(src, 'pages', 'page_003', 'page_001', 't')).toBe(src.replace('[page_001, page_002]', '[page_001, page_003, page_002]'));
    expect(insertIntoList(src, 'pages', 'page_003', undefined, 't')).toBe(src.replace('[page_001, page_002]', '[page_001, page_002, page_003]'));
  });

  it('ブロック形式は直前の項目と同じ字下げで 1 行追加する', () => {
    const src = 'pages:\n    - page_001 # 表紙\n    # 本文\n    - page_002\noutput: {}\n';
    expect(insertIntoList(src, 'pages', 'page_009', 'page_001', 't')).toBe('pages:\n    - page_001 # 表紙\n    - page_009\n    # 本文\n    - page_002\noutput: {}\n');
  });

  it('空の [] はフロー形式のまま、値なしの pages: はブロック形式のリストにする', () => {
    expect(insertIntoList('id: x\npages: []\nnotes: ""\n', 'pages', 'page_001', undefined, 't')).toBe('id: x\npages: [page_001]\nnotes: ""\n');
    expect(insertIntoList('id: x\npages:\nnotes: ""\n', 'pages', 'page_001', undefined, 't')).toBe('id: x\npages:\n  - page_001\nnotes: ""\n');
    expect(setBlockList('a: 1\npages: [] # 並び\nb: 2\n', 'pages', ['p1', 'p2'], 't')).toBe('a: 1\npages:\n  - p1\n  - p2 # 並び\nb: 2\n');
  });

  it('removeFromList はブロック形式の行を削除し、空になれば [] にする', () => {
    const src = '# c\nstyles:\n  - a.css\n  - b.css   # b\n# 次\ntheme: {}\n';
    expect(removeFromList(src, 'styles', (v) => v === 'a.css', 't')).toBe('# c\nstyles:\n  - b.css   # b\n# 次\ntheme: {}\n');
    expect(removeFromList(src, 'styles', () => true, 't')).toBe('# c\nstyles: []\n# 次\ntheme: {}\n');
    expect(removeFromList('styles: [a.css, b.css]\n', 'styles', (v) => v === 'b.css', 't')).toBe('styles: [a.css]\n');
  });

  it('removeFromList は条件を項目ごとに 1 回だけ呼ぶ（警告を積む呼び出し側で重複しない）', () => {
    const calls: string[] = [];
    const src = 'styles:\n  - a.css\n  - b.css\n  - c.css\n';
    const out = removeFromList(src, 'styles', (v) => (calls.push(v), v !== 'b.css'), 't');
    expect(out).toBe('styles:\n  - b.css\n');
    expect(calls).toEqual(['a.css', 'b.css', 'c.css']);
  });

  it('存在しない --after・配列でない pages・YAML の構文エラーはエラー', () => {
    expect(() => insertIntoList('pages: [a]\n', 'pages', 'b', 'z', 't')).toThrow('pages に "z" がありません');
    expect(() => insertIntoList('pages: abc\n', 'pages', 'b', undefined, 't')).toThrow('配列');
    expect(() => insertIntoList('pages: [a\n', 'pages', 'b', undefined, 't')).toThrow('YAML 構文エラー');
  });
});

describe('templates', () => {
  it('YAML ではダブルクォート内用にエスケープ、HTML では実体参照にし、RawValue はそのまま', () => {
    expect(fillTemplate('title: "__T__"\n', 'book.yaml', { __T__: 'A "B" \\ C' })).toBe('title: "A \\"B\\" \\\\ C"\n');
    expect(fillTemplate('<p>__T__</p>', 'page.html', { __T__: '<b>{{x}}</b> & "q"' })).toBe('<p>&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;</p>');
    expect(fillTemplate('original: __O__\npages: __P__\n', 'source.yaml', { __O__: raw('null'), __P__: raw('3') })).toBe('original: null\npages: 3\n');
    expect(fillTemplate('original: __O__\n', 'source.yaml', { __O__: yamlString('references/a b/x.pdf') })).toBe('original: "references/a b/x.pdf"\n');
    expect(fillTemplate('# __A__ __A__', 'x.md', { __A__: 'v' })).toBe('# v v');
    expect(leftoverPlaceholders('a __X__ b __Y_Z__ __X__')).toEqual(['__X__', '__Y_Z__']);
  });
});

describe('text', () => {
  it('htmlBodyText は <body> のテキストだけ（style・タグ・実体参照を処理）', () => {
    const html = '<html><head><title>TODO 見出し</title></head><body><style>.a{content:"TODO"}</style><p>A&amp;B</p><svg><text>TODO</text></svg></body></html>';
    expect(htmlBodyText(html).replace(/\s+/g, ' ').trim()).toBe('A&B');
  });

  it('todoSnippets は TODO からの短い抜粋', () => {
    expect(todoSnippets('本文 TODO: 住所を記入   TODO: 電話')).toEqual(['TODO: 住所を記入', 'TODO: 電話']);
    expect(todoSnippets('なし')).toEqual([]);
  });

  it('stripHandlebars はコメント・式を除き、行数を保つ', () => {
    const src = '{{!-- a\n b --}}x{{facts.y}}\n{{{raw}}}z';
    const out = stripHandlebars(src);
    expect(out.split('\n')).toHaveLength(3);
    expect(out.replace(/\s+/g, '')).toBe('xz');
  });
});

describe('cli', () => {
  it('parseCli は parseArgs のエラーを日本語の UsageError にする', () => {
    const parse = (args: string[]) => parseCli(() => parseArgs({ args, options: { book: { type: 'string' } }, strict: true }));
    expect(() => parse(['--nope'])).toThrow(UsageError);
    expect(() => parse(['--nope'])).toThrow('不明なオプションです: --nope');
    expect(() => parse(['--book'])).toThrow('--book の値が正しくありません');
    expect(() => parse(['extra'])).toThrow('余分な引数があります: extra');
  });

  it('splitList・naturalCompare', () => {
    expect(splitList(['page_001,page_002', 'page_001', ' page_003 '])).toEqual(['page_001', 'page_002', 'page_003']);
    expect(['p10', 'p2', 'p1'].sort(naturalCompare)).toEqual(['p1', 'p2', 'p10']);
  });

  it('formatIsoLocal は formatStamp と同じローカル時刻にオフセットを付ける', () => {
    const d = new Date(2026, 9, 7, 14, 30, 12);
    const iso = formatIsoLocal(d);
    expect(iso).toMatch(/^2026-10-07T14:30:12[+-]\d{2}:\d{2}$/);
    expect(formatStamp(d)).toBe('20261007-143012');
    expect(new Date(iso).getTime()).toBe(d.getTime());
  });
});

describe('parseUnicodeRange', () => {
  it('@font-face の unicode-range（単独・範囲・? のワイルドカード）を数値の範囲にする', () => {
    expect(parseUnicodeRange('U+0-ff, U+131, U+3000-303f, U+4e??')).toEqual([
      [0x0, 0xff],
      [0x131, 0x131],
      [0x3000, 0x303f],
      [0x4e00, 0x4eff],
    ]);
    expect(parseUnicodeRange('')).toEqual([]);
  });
});
