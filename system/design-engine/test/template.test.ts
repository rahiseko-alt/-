import { afterAll, describe, expect, it } from 'vitest';
import {
  TemplateError,
  assetUrl,
  buildTemplateContext,
  composePage,
  createTemplateEnv,
  loadBook,
  loadCompanyData,
  loadPage,
  type TemplateEnv,
} from '../src/index.ts';
import { FIXTURE_ROOT, cleanupTemp, copyFixture, readFile, writeFile } from './helpers.ts';

afterAll(cleanupTemp);

const company = loadCompanyData(FIXTURE_ROOT);
const book = loadBook(FIXTURE_ROOT, 'smoke');
const page = loadPage(FIXTURE_ROOT, 'smoke', 'page_001');
const context = buildTemplateContext(company, book.config, page.config, 1);

function env(warnings: string[] = []): TemplateEnv {
  return createTemplateEnv({ root: FIXTURE_ROOT, bookId: 'smoke', company, warnings });
}

function render(source: string, ctx: unknown = context, warnings: string[] = []): string {
  return env(warnings).render(source, ctx, { file: 'books/smoke/pages/page_001/page.html', page: 'page_001' });
}

function renderError(source: string, ctx: unknown = context): TemplateError {
  try {
    render(source, ctx);
  } catch (err) {
    expect(err).toBeInstanceOf(TemplateError);
    return err as TemplateError;
  }
  throw new Error('エラーになりませんでした');
}

describe('厳格モード（存在しないキーはエラー）', () => {
  it('出力 {{...}} の欠落キー: BOOK・ページ・キー・位置をメッセージに含める', () => {
    const err = renderError('<p>\n  {{facts.school.nickname}}\n</p>');
    expect(err.book).toBe('smoke');
    expect(err.page).toBe('page_001');
    expect(err.key).toBe('facts.school.nickname');
    expect(err.line).toBe(2);
    expect(err.message).toContain('book=smoke');
    expect(err.message).toContain('page=page_001');
    expect(err.message).toContain('books/smoke/pages/page_001/page.html:2:5');
    expect(err.message).toContain('"facts.school.nickname"');
  });

  it('中間のキーが無くても TypeError ではなくキー名付きエラー', () => {
    const err = renderError('{{facts.nothing.deeper.value}}');
    expect(err.key).toBe('facts.nothing.deeper.value');
  });

  it('ヘルパー引数・ハッシュ値も厳格', () => {
    expect(renderError('{{num facts.results.nope}}').key).toBe('facts.results.nope');
    expect(renderError('{{qr facts.school.url size=page.qr_size}}').key).toBe('page.qr_size');
  });

  it('ヘルパーの第 1 引数の欠落キーは「未定義のヘルパー」ではなくキーの欠落として報告する', () => {
    const cases: Array<[string, string]> = [
      ['{{qr facts.school.homepage size=22}}', 'facts.school.homepage'],
      ['<p>{{join facts.school.accesss " / "}}</p>', 'facts.school.accesss'],
      ['{{#if (eq page.kind "cover")}}y{{/if}}', 'page.kind'],
      ['{{#unless (eq facts.zzz 1)}}u{{/unless}}', 'facts.zzz'],
      ['{{eq zzz "a"}}', 'zzz'],
      ['{{#with facts.school}}{{qr homepage size=1}}{{/with}}', 'homepage'],
    ];
    for (const [src, key] of cases) {
      const err = renderError(src);
      expect(err.key, src).toBe(key);
      expect(err.message, src).not.toContain('未定義のヘルパー');
    }
    // 呼び出し名そのものが無いときは未定義のヘルパー
    for (const src of ['{{shout facts.school.name}}', '{{#shout facts.school.name}}x{{/shout}}', '{{{shout x}}}', '{{#if (shout facts.school.name)}}x{{/if}}', '{{~shout x~}}']) {
      expect(renderError(src).message, src).toContain('未定義のヘルパー "shout"');
    }
  });

  it('文字列・数値の値のプロパティを参照しても TypeError ではなくキー名・位置付きのエラー', () => {
    const e1 = renderError('{{facts.school.name.foo}}');
    expect(e1.key).toBe('facts.school.name.foo');
    expect(e1.line).toBe(1);
    const e2 = renderError('<ul>\n{{#each list}}<li>{{name}}</li>{{/each}}\n</ul>', { list: ['文字列の項目'] });
    expect(e2.key).toBe('name');
    expect(e2.line).toBe(2);
    expect(e2.message).not.toContain("Cannot use 'in' operator");
    expect(renderError('{{n.x}}', { n: 5 }).key).toBe('n.x');
  });

  it('{{#each}} の対象とブロック内の参照も厳格（ブロックパラメータ含む）', () => {
    expect(renderError('{{#each facts.courses.items}}x{{/each}}').key).toBe('facts.courses.items');
    expect(renderError('{{#each facts.courses.courses}}{{nickname}}{{/each}}').key).toBe('nickname');
    expect(renderError('{{#each facts.courses.courses as |c|}}{{c.nickname}}{{/each}}').key).toBe('c.nickname');
  });

  it('{{#if}} / {{#unless}} の第 1 引数だけは欠落を偽として扱う', () => {
    expect(render('{{#if facts.school.nickname}}A{{else}}B{{/if}}')).toBe('B');
    expect(render('{{#unless facts.nope.x}}N{{/unless}}')).toBe('N');
    expect(render('{{#each facts.courses.courses as |c|}}{{#if c.capacity}}{{c.id}};{{/if}}{{/each}}')).toBe('ai-system;data-business;');
    expect(render('{{#if (eq page.type "cover")}}表紙{{/if}}')).toBe('表紙');
  });

  it('既存キーは 0 や空文字でも出力できる', () => {
    expect(render('[{{v}}][{{s}}]', { v: 0, s: '' })).toBe('[0][]');
  });

  it('出力は HTML エスケープされる', () => {
    expect(render('{{t}}', { t: '<b>&"' })).toBe('&lt;b&gt;&amp;&quot;');
    expect(render('{{{t}}}', { t: '<b>' })).toBe('<b>');
  });

  it('未定義のパーシャル・ヘルパー・構文エラー', () => {
    expect(renderError('{{> nothing}}').message).toMatch(/パーシャル "nothing" が見つかりません/);
    expect(renderError('{{shout facts.school.name}}').message).toMatch(/未定義のヘルパー "shout"/);
    const parse = renderError('{{#each facts.courses.courses}}');
    expect(parse.message).toMatch(/構文エラー/);
    expect(parse.message).toContain('page=page_001');
  });

  it('パーシャル内のエラーはパーシャルのファイルを示す', () => {
    const err = renderError('{{> stat-card facts.school}}');
    expect(err.file).toBe('shared/components/stat-card.hbs');
    expect(err.key).toBe('id');
    expect(err.page).toBe('page_001');
  });

  it('page.html の欠落キーで composePage が失敗し、BOOK・ページ・キーを示す', () => {
    const root = copyFixture();
    const rel = 'books/smoke/pages/page_002/page.html';
    writeFile(root, rel, `${readFile(root, rel)}\n<p>{{facts.school.motto}}</p>\n`);
    expect(() => composePage({ root, bookId: 'smoke', pageId: 'page_002', mode: 'render' })).toThrow(
      /book=smoke page=page_002 at books\/smoke\/pages\/page_002\/page\.html:\d+:\d+\] キー "facts\.school\.motto"/,
    );
  });
});

describe('パーシャル登録', () => {
  it('shared/components は相対パス名、BOOK ローカルは book/<名前>', () => {
    expect(env().partials.sort()).toEqual(['book/page-number', 'cards/course-card', 'stat-card']);
  });

  it('パーシャルにコンテキストを渡せる', () => {
    const html = render('{{#each facts.results.metrics}}{{> stat-card}}{{/each}}');
    expect(html).toContain('data-metric="employment-rate"');
    expect(html).toContain('12,345');
    expect(render('{{> book/page-number}}')).toContain('data-side="right">1<');
  });
});

describe('ヘルパー', () => {
  it('asset: 存在するファイルのルート相対 URL を返す', () => {
    expect(render('{{asset "books/smoke/backgrounds/page_001.svg"}}')).toBe('books/smoke/backgrounds/page_001.svg');
    expect(render('{{asset brand.logo.main.file}}')).toBe('company-data/brand/logo/logo.svg');
  });

  it('assetUrl はセグメントごとにエンコードする（ファイル名の # ? % や CSS の url() を壊す括弧も）', () => {
    expect(assetUrl('company-data/photos/campus#2 (1)?.svg')).toBe('company-data/photos/campus%232%20%281%29%3F.svg');
    expect(assetUrl("company-data/photos/100%'s.png")).toBe('company-data/photos/100%25%27s.png');
    expect(decodeURIComponent(assetUrl('company-data/photos/校舎.png'))).toBe('company-data/photos/校舎.png');
    expect(render('{{asset v}}', { v: 'company-data/photos/campus.svg' })).toBe('company-data/photos/campus.svg');
  });

  it('asset: ファイルが無い・ルート外ならエラー（位置付き）', () => {
    const e1 = renderError('\n{{asset "books/smoke/backgrounds/none.png"}}');
    expect(e1.message).toContain('asset: ファイルが見つかりません: books/smoke/backgrounds/none.png');
    expect(e1.line).toBe(2);
    expect(renderError('{{asset "../package.json"}}').message).toContain('asset: 不正なパス');
    expect(renderError('{{asset "/etc/passwd"}}').message).toContain('asset:');
  });

  it('photo: 写真 ID から URL、未知 ID はエラー', () => {
    expect(render('{{photo "campus"}}')).toBe('company-data/photos/campus.svg');
    expect(renderError('{{photo "unknown"}}').message).toContain('写真ID "unknown"');
  });

  it('qr: インライン SVG（size は mm）', () => {
    const svg = render('{{qr facts.school.url size=20}}');
    expect(svg.startsWith('<svg class="qr"')).toBe(true);
    expect(svg).toContain('width="20mm"');
    expect(svg).toContain('viewBox=');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    const plain = render('{{qr "https://example.com/"}}');
    expect(plain).not.toContain('width=');
    expect(renderError('{{qr ""}}').message).toContain('qr:');
  });

  it('qr: 周囲の余白は既定で規格どおり 4 モジュール、4 未満は警告', () => {
    const viewBox = (svg: string) => Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
    const def = render('{{qr "https://example.com/"}}');
    expect(viewBox(def)).toBe(viewBox(render('{{qr "https://example.com/" margin=4}}')));
    expect(viewBox(def) - viewBox(render('{{qr "https://example.com/" margin=0}}'))).toBe(8);
    const ok: string[] = [];
    render('{{qr "https://example.com/"}}', context, ok);
    expect(ok).toEqual([]);
    const narrow: string[] = [];
    render('{{qr "https://example.com/" margin=2}}', context, narrow);
    expect(narrow.join('\n')).toContain('margin=2');
    expect(renderError('{{qr "x" margin="a"}}').message).toContain('margin');
  });

  it('qr: TODO を含む内容は警告', () => {
    const warnings: string[] = [];
    render('{{qr "TODO: URL"}}', context, warnings);
    expect(warnings.join('\n')).toContain('TODO');
  });

  it('num: 3 桁区切り、数値以外はそのまま', () => {
    expect(render('{{num 1234567}}')).toBe('1,234,567');
    expect(render('{{num v}}', { v: 98.5 })).toBe('98.5');
    expect(render('{{num v}}', { v: 'TODO: 数値' })).toBe('TODO: 数値');
    expect(render('{{num v}}', { v: '1,200' })).toBe('1,200');
  });

  it('nl2br: エスケープしてから改行を <br> に', () => {
    expect(render('{{nl2br v}}', { v: 'a<b>\nc\r\nd' })).toBe('a&lt;b&gt;<br>c<br>d');
  });

  it('eq / join', () => {
    expect(render('{{#if (eq a "x")}}Y{{else}}N{{/if}}', { a: 'x' })).toBe('Y');
    expect(render('{{#if (eq a 1)}}Y{{else}}N{{/if}}', { a: '1' })).toBe('N');
    expect(render('{{join list}}', { list: ['A', 'B'] })).toBe('A、B');
    expect(render('{{join list " / "}}', { list: ['A', 'B'] })).toBe('A / B');
    expect(render('{{join list ","}}', { list: ['<a>'] })).toBe('&lt;a&gt;');
    expect(renderError('{{join v}}', { v: 'x' }).message).toContain('join: 配列');
  });
});
