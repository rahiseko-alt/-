// エントリポイント（system/scripts/*.ts）を別プロセスで起動し、使い方・終了コードを確認する
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT, appendFile, cleanupTemp, copyFixture, runScript } from './helpers.ts';

afterAll(() => cleanupTemp());

describe('CLI エントリポイント', () => {
  it.each([
    ['render.ts', 'npm run render'],
    ['compare.ts', 'npm run compare'],
    ['validate.ts', 'npm run validate'],
    ['new-book.ts', 'npm run new:book'],
    ['new-page.ts', 'npm run new:page'],
    ['ingest-reference.ts', 'npm run ref:ingest'],
  ])('%s --help は使い方を表示して終了コード 0', (script, usage) => {
    const r = runScript(script, ['--help']);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain(`使い方: ${usage}`);
  });

  it('validate: fixture は 0、エラーがあれば 1、不明なオプションは 1', () => {
    const ok = runScript('validate.ts', ['--root', FIXTURE_ROOT]);
    expect(ok.code, ok.text).toBe(0);
    expect(ok.out).toContain('結果: エラー 0 件');

    const root = copyFixture();
    appendFile(root, 'books/smoke/pages/page_001/page.html', '\n{{facts.school.missing_key}}\n');
    const ng = runScript('validate.ts', ['--root', root]);
    expect(ng.code).toBe(1);
    expect(ng.out).toContain('facts.school.missing_key');

    const bad = runScript('validate.ts', ['--nope']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('不明なオプションです: --nope');
    expect(bad.err).toContain('使い方: npm run validate');
  });

  it('render: 存在しない BOOK は日本語のエラーで終了コード 1', () => {
    const r = runScript('render.ts', ['--book', 'nothing', '--root', FIXTURE_ROOT]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('エラー: BOOK "nothing" が見つかりません');
  });
});
