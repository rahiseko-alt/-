// validate: company-data・BOOK・参考資料の整合性チェック
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { validateCommand, validateStudio } from '../lib/validate.ts';
import { FIXTURE_ROOT, appendFile, cleanupTemp, copyFixture, readFile, run, writeFile } from './helpers.ts';

afterAll(() => cleanupTemp());

function edit(root: string, rel: string, fn: (s: string) => string): void {
  writeFile(root, rel, fn(readFile(root, rel)));
}

describe('validate', () => {
  it('fixture スタジオはエラー・警告なしで通る（fixture を書き換えない）', async () => {
    const r = await run(validateCommand, ['--root', FIXTURE_ROOT]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('結果: エラー 0 件・警告 0 件 → OK');
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(r.out).toContain(`[${n}]`);
  });

  it('book.yaml の pages にあるページがないとエラー', async () => {
    const root = copyFixture();
    edit(root, 'books/smoke/config/book.yaml', (s) => s.replace('pages: [page_001, page_002]', 'pages: [page_001, page_002, page_003]'));
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ページ "page_003" が見つかりません');
    expect(r.out).toMatch(/結果: エラー [1-9]\d* 件/);
  });

  it('BOOK ID に使えない名前のディレクトリ（日本語・空白）は飛ばさずエラー', async () => {
    const root = copyFixture();
    fs.renameSync(path.join(root, 'books/smoke'), path.join(root, 'books/学校案内'));
    edit(root, 'books/学校案内/config/book.yaml', (s) => s.replace('id: smoke', 'id: 学校案内'));
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('books/学校案内: BOOK ID に使えない名前です');
  });

  it('page.html だけ欠けている・pages にないページ・book.yaml の id 不一致', async () => {
    const root = copyFixture();
    fs.rmSync(path.join(root, 'books/smoke/pages/page_002/page.html'));
    writeFile(root, 'books/smoke/pages/page_009/page.yaml', 'id: page_009\ntitle: 迷子\ntype: other\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('books/smoke/pages/page_002/page.html がありません');
    expect(r.out).toContain('books/smoke/pages/page_009: books/smoke/config/book.yaml の pages に含まれていません');

    const root2 = copyFixture();
    edit(root2, 'books/smoke/config/book.yaml', (s) => s.replace('id: smoke', 'id: smoke2'));
    const r2 = await run(validateCommand, ['--root', root2]);
    expect(r2.code).toBe(1);
    expect(r2.out).toContain('id "smoke2" がディレクトリ名 "smoke" と一致しません');
  });

  it('禁止語（forbidden_terms）が books/・company-data/・shared/ にあるとエラー', async () => {
    const root = copyFixture();
    appendFile(root, 'books/smoke/pages/page_002/page.html', '\n<p>サンプル他校に学ぶ</p>\n');
    appendFile(root, 'company-data/copy/brochure.yaml', 'extra: "ｻﾝﾌﾟﾙ他校"\n'); // 半角カナも NFKC で検出
    appendFile(root, 'shared/components/stat-card.hbs', '\n{{!-- サンプル他校 --}}\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/books\/smoke\/pages\/page_002\/page\.html:\d+: 禁止語「サンプル他校」が含まれています（references\/Sample\/brochure\/source\.yaml/);
    expect(r.out).toContain('company-data/copy/brochure.yaml:');
    expect(r.out).toContain('shared/components/stat-card.hbs:');
  });

  it('references/<source>/... のパスとしての出現は禁止語にしない', async () => {
    const root = copyFixture();
    writeFile(
      root,
      'references/Hoge-school/brochure/source.yaml',
      'source: Hoge-school\ntitle: テスト\nkind: brochure\nusage: reference-only\nforbidden_terms: [Hoge-school]\n',
    );
    edit(root, 'books/smoke/references.yaml', (s) => s.replace('references:\n', 'references:\n  - references/Hoge-school/brochure/\n'));
    appendFile(root, 'books/smoke/references.yaml', '# 補正画像: .cache/ref-prep/Hoge-school/brochure/prep/page_001.png\n');
    const ok = await run(validateCommand, ['--root', root]);
    expect(ok.code, ok.text).toBe(0);

    appendFile(root, 'books/smoke/pages/page_001/page.html', '\n<p>Hoge-school</p>\n');
    const ng = await run(validateCommand, ['--root', root]);
    expect(ng.code).toBe(1);
    expect(ng.out).toContain('禁止語「Hoge-school」');
  });

  it('references/ のパスの直後に続く日本語の文章は照合から外さない', async () => {
    const root = copyFixture();
    appendFile(root, 'books/smoke/pages/page_002/page.html', '\n<p class="data-note">references/Sample/brochure/page_001.svgのサンプル他校の構成を参考にしました</p>\n');
    appendFile(root, 'company-data/copy/brochure.yaml', 'note: "参考はreferences/Sample/brochure/、サンプル他校のコピーを転用"\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/books\/smoke\/pages\/page_002\/page\.html:\d+: 禁止語「サンプル他校」/);
    expect(r.out).toMatch(/company-data\/copy\/brochure\.yaml:\d+: 禁止語「サンプル他校」/);
  });

  it('page.css で共通 CSS（styles）のクラス名をページの要素に使っていたら警告（共通パーシャルの上書きだけなら対象外）', async () => {
    const root = copyFixture();
    // stat-card は styles（shared/layouts/fixture.css）のクラスで、page_002 には直接書かれていない（パーシャルの上書き）
    appendFile(root, 'books/smoke/pages/page_002/page.css', '\n/* 共通部品の上書き */\n.stat-card { border-radius: 2mm; }\n');
    let r = await run(validateCommand, ['--root', root]);
    expect(r.out).not.toContain('共通 CSS');

    // data-title は page_002 に直接書かれている要素。共通 CSS と同じ名前で装飾すると警告
    appendFile(root, 'books/smoke/pages/page_002/page.css', '\n.data-title { position: absolute; top: 10mm; }\n');
    r = await run(validateCommand, ['--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('books/smoke/pages/page_002/page.css: 共通 CSS（shared/layouts/fixture.css）と同じクラス名 .data-title を、ページで書いた要素に使って装飾しています');
    expect(r.out).not.toContain('.stat-card');
  });

  it('事実の直書きは警告（{{...}} の中・コメントは対象外）', async () => {
    const root = copyFixture();
    appendFile(root, 'books/smoke/pages/page_002/page.html', '\n{{!-- サンプル学園 の説明 --}}\n<p>{{#if facts.school.name}}ok{{/if}}</p>\n<p>サンプル学園へようこそ。TEL 00-0000-0000</p>\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toMatch(/books\/smoke\/pages\/page_002\/page\.html:\d+: 事実「サンプル学園」が直接書かれています。\{\{facts\.school\.name\}\} を使ってください/);
    expect(r.out).toContain('事実「00-0000-0000」');
    const report = await validateStudio(root);
    const hard = report.sections.find((s) => s.no === 5)!;
    expect(hard.errors).toEqual([]);
    // コメント行（{{!-- --}}）は数えない: サンプル学園 の警告は 1 件だけ
    expect(hard.warnings.filter((w) => w.includes('「サンプル学園」'))).toHaveLength(1);
  });

  it('事実の直書きは全角・半角の違いがあっても検出する（NFKC）', async () => {
    const root = copyFixture();
    // IME で入力しがちな全角英数字（Ｓａｍｐｌｅ Ｇａｋｕｅｎ・００－００００－０００１）
    appendFile(root, 'books/smoke/pages/page_002/page.html', '\n<p>Ｓａｍｐｌｅ Ｇａｋｕｅｎ</p>\n<p>FAX ００－００００－０００１</p>\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('事実「Sample Gakuen」が直接書かれています。{{facts.school.name_en}} を使ってください');
    expect(r.out).toContain('事実「00-0000-0001」が直接書かれています。{{facts.school.fax}} を使ってください');
  });

  it('company-data の TODO は警告、--strict ではエラー', async () => {
    const root = copyFixture();
    edit(root, 'company-data/facts/school.yaml', (s) => s.replace('fax: 00-0000-0001', 'fax: "TODO: FAX 番号を記入"'));
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('[警告] company-data/facts/school.yaml: 未記入の "TODO" が 1 件（fax）');

    const strict = await run(validateCommand, ['--strict', '--root', root]);
    expect(strict.code).toBe(1);
    expect(strict.out).toContain('[エラー] company-data/facts/school.yaml: 未記入の "TODO" が 1 件（fax）');
  });

  it('company-data のスキーマ違反はエラー', async () => {
    const root = copyFixture();
    edit(root, 'company-data/brand/colors/colors.yaml', (s) => s.replace('primary: "#1d4e89"', 'primary: blue'));
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('company-data/brand/colors/colors.yaml: colors.primary');
  });

  it('実績の数値に出典がない・数値項目に単位つきの文字列を書くとエラー', async () => {
    const root = copyFixture();
    edit(root, 'company-data/facts/results.yaml', (s) => s.replace('    as_of: "2026-03"\n    source: 架空の集計\n  - id: graduates', '  - id: graduates'));
    edit(root, 'company-data/facts/courses.yaml', (s) => s.replace('capacity: 40', 'capacity: 40名'));
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('[エラー] company-data/facts/results.yaml: metrics.0.as_of: value を記入したら as_of（基準日・年度）も書いてください');
    expect(r.out).toContain('[エラー] company-data/facts/results.yaml: metrics.0.source: value を記入したら source（出典）も書いてください');
    expect(r.out).toContain('[エラー] company-data/facts/courses.yaml: courses.0.capacity: "40名" は数値ではありません');
  });

  it('company-data の ID の参照: 存在しない学科・写真 ID はエラー、*-todo は警告（--strict ではエラー）', async () => {
    const root = copyFixture();
    edit(root, 'company-data/facts/teachers.yaml', (s) => s.replace('course_ids: [ai-system]', 'course_ids: [ai-system, ai-sytem]\n    photo: teacher-yamada'));
    edit(root, 'company-data/facts/courses.yaml', (s) => s.replace('photo: campus', 'photo: campus-01'));
    writeFile(root, 'company-data/facts/admissions.yaml', 'departments:\n  - course_id: data-business\n  - course_id: data-busines\n  - program: 課程だけ\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('[エラー] company-data/facts/teachers.yaml: teachers.0.course_ids.1: 学科 ID "ai-sytem" が company-data/facts/courses.yaml にありません（登録済み: ai-system, data-business）');
    expect(r.out).toContain('[エラー] company-data/facts/teachers.yaml: teachers.0.photo: 写真 ID "teacher-yamada" が company-data/photos/photos.yaml にありません（登録済み: campus。写真は npm run photo:add で登録する）');
    expect(r.out).toContain('[エラー] company-data/facts/courses.yaml: courses.0.photo: 写真 ID "campus-01"');
    expect(r.out).toContain('[エラー] company-data/facts/admissions.yaml: departments.1.course_id: 学科 ID "data-busines"');
    const report = await validateStudio(root);
    const s1 = report.sections.find((s) => s.no === 1)!;
    expect(s1.errors.filter((e) => e.includes('ID "'))).toHaveLength(4); // 正しい参照（ai-system・data-business）は報告しない

    // 記入例のプレースホルダ（*-todo）は警告、--strict ではエラー。"TODO: ..." の値は TODO として数える
    const root2 = copyFixture();
    edit(root2, 'company-data/facts/teachers.yaml', (s) => s.replace('course_ids: [ai-system]', 'course_ids: [course-todo]\n    photo: "TODO: 写真 ID を記入"'));
    const ok = await run(validateCommand, ['--root', root2]);
    expect(ok.code, ok.text).toBe(0);
    expect(ok.out).toContain('[警告] company-data/facts/teachers.yaml: teachers.0.course_ids.0: 記入例のプレースホルダ "course-todo" を指しています');
    expect(ok.out).not.toContain('teachers.0.photo: 写真 ID');
    const strict = await run(validateCommand, ['--strict', '--root', root2]);
    expect(strict.code).toBe(1);
    expect(strict.out).toContain('[エラー] company-data/facts/teachers.yaml: teachers.0.course_ids.0: 記入例のプレースホルダ "course-todo"');
  });

  it('ID の参照（course_id）は事実の直書きの照合に使わない', async () => {
    const root = copyFixture();
    writeFile(root, 'company-data/facts/admissions.yaml', 'departments:\n  - course_id: data-business\n');
    appendFile(root, 'books/smoke/pages/page_002/page.html', '\n<div class="data-business"></div>\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).not.toContain('事実「data-business」');
  });

  it('company-data の全角英数字は警告（コメント・source・file は対象外）', async () => {
    const root = copyFixture();
    edit(root, 'company-data/facts/courses.yaml', (s) => s.replace('- Python基礎', '- Ｐｙｔｈｏｎ基礎\n      - ２年次の演習'));
    appendFile(root, 'company-data/copy/brochure.yaml', '# 原本の表記: 【様式１】\nform: 入学願書【様式１】\nsource: 原稿＿Ｖ４.docx\n');
    appendFile(root, 'company-data/facts/results.yaml', '# 原本: ＡＢＣ\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain(
      '[警告] company-data/facts/courses.yaml: 全角英数字が 2 か所にあります（courses.0.curriculum.0 の「Ｐｙｔｈｏｎ」、courses.0.curriculum.1 の「２」）。英数字は半角で書いてください',
    );
    expect(r.out).toContain('[警告] company-data/copy/brochure.yaml: 全角英数字が 1 か所にあります（form の「１」）');
    expect(r.out).not.toContain('company-data/facts/results.yaml: 全角英数字');
  });

  it('テンプレートの存在しないキーは試し合成でエラー（BOOK・ページ・キー名つき）', async () => {
    const root = copyFixture();
    appendFile(root, 'books/smoke/pages/page_002/page.html', '\n<p>{{facts.school.nope}}</p>\n');
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('book=smoke page=page_002');
    expect(r.out).toContain('facts.school.nope');
  });

  it('背景: 画像がない・参考資料の画像を使う はエラー、生成記録がない は警告', async () => {
    const root = copyFixture();
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
      .png()
      .toFile(path.join(root, 'books/smoke/backgrounds/page_002.png'));
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('books/smoke/backgrounds/page_002.png: 生成記録 page_002.prompt.yaml がありません');

    edit(root, 'books/smoke/pages/page_001/page.yaml', (s) => s.replace('books/smoke/backgrounds/page_001.svg', 'books/smoke/backgrounds/missing.png'));
    const missing = await run(validateCommand, ['--root', root]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('背景画像がありません: books/smoke/backgrounds/missing.png');

    edit(root, 'books/smoke/pages/page_001/page.yaml', (s) => s.replace('books/smoke/backgrounds/missing.png', 'references/Sample/brochure/page_001.svg'));
    const ref = await run(validateCommand, ['--root', root]);
    expect(ref.code).toBe(1);
    expect(ref.out).toContain('参考資料の画像を背景に使っています');
  });

  it('参考資料の画像をページの描画に使うと、書き方に関係なくエラー（img src・パーシャル・srcset・style・page.css・styles・asset）', async () => {
    const ref = 'references/Sample/brochure/page_001.svg';
    const cases: Array<[string, Array<[string, string]>]> = [
      ['<img src>', [['books/smoke/pages/page_002/page.html', `\n<img class="abs fill" src="${ref}" alt="">\n`]]],
      [
        'パーシャルの src=',
        [
          ['books/smoke/components/frame.hbs', '<figure><img src="{{src}}" alt=""></figure>'],
          ['books/smoke/pages/page_002/page.html', `\n{{> book/frame src="${ref}"}}\n`],
        ],
      ],
      ['srcset', [['books/smoke/pages/page_002/page.html', `\n<img srcset="${ref} 2x" alt="">\n`]]],
      ['style 属性', [['books/smoke/pages/page_002/page.html', `\n<div style="background:url('./${ref}')"></div>\n`]]],
      ['%エンコード', [['books/smoke/pages/page_002/page.html', '\n<img src="refer%65nces/Sample/brochure/page_001.svg" alt="">\n']]],
      ['page.css の url()', [['books/smoke/pages/page_002/page.css', `.x { background-image: url(../../../../${ref}); }\n`]]],
      ['book.yaml の styles', [['shared/layouts/fixture.css', `\n.y { background: url("../../${ref}"); }\n`]]],
      ['{{asset}}', [['books/smoke/pages/page_002/page.html', `\n<img src="{{asset "${ref}"}}" alt="">\n`]]],
    ];
    for (const [label, files] of cases) {
      const root = copyFixture();
      for (const [rel, content] of files) {
        if (fs.existsSync(path.join(root, rel))) appendFile(root, rel, content);
        else writeFile(root, rel, content);
      }
      const r = await run(validateCommand, ['--root', root]);
      expect(r.code, label).toBe(1);
      expect(r.out, label).toMatch(/参考資料（references\/）(をページの描画に使っています|はページの描画に使えません)/);
      expect(r.out, label).toContain(ref);
    }
  });

  it('参考資料: source.yaml がない・スキーマ違反・references.yaml の参照先がないとエラー', async () => {
    const root = copyFixture();
    writeFile(root, 'references/Other/flyers/page_001.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    edit(root, 'references/Sample/brochure/source.yaml', (s) => s.replace('usage: reference-only', 'usage: free'));
    edit(root, 'books/smoke/references.yaml', (s) => s.replace('visual_reference: [references/Sample/brochure/page_001.svg]', 'visual_reference: [references/Sample/brochure/page_099.png]'));
    const r = await run(validateCommand, ['--root', root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('references/Other/flyers/source.yaml がありません');
    expect(r.out).toContain('references/Sample/brochure/source.yaml: usage');
    expect(r.out).toContain('参考資料が見つかりません: references/Sample/brochure/page_099.png');
  });

  it('不明なオプションは終了コード 1', async () => {
    const r = await run(validateCommand, ['--bogus']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('不明なオプションです: --bogus');
  });
});
