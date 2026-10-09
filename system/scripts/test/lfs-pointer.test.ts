// Git LFS のポインタ（git lfs pull をしていない画像）: validate の警告と、各 CLI の分かるエラー。
// fixture のコピーにポインタ文書を一時的に置いて確かめる（fixture 自体は書き換えない）
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { compareCommand } from '../lib/compare.ts';
import { genInputsCommand } from '../lib/gen-inputs.ts';
import { isLfsPointer } from '../lib/images.ts';
import { ingestCommand } from '../lib/ingest.ts';
import { photoAddCommand } from '../lib/photo-add.ts';
import { prepCommand } from '../lib/prep.ts';
import { renderCommand } from '../lib/render.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, readFile, run, tempDir, writeFile } from './helpers.ts';

afterAll(() => cleanupTemp());

/** git lfs pull をしていない作業ツリーにあるのと同じ形のポインタ文書 */
const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${'0'.repeat(64)}\nsize 123456\n`;
const PULL = 'git lfs pull を実行してください';
const pointerMsg = (rel: string) => `${rel} は Git LFS のポインタです（実体が未取得）`;

const REF = 'references/Sample/brochure/page_002.jpg';
const PREP = 'references/Sample/brochure/prep/page_002.yaml';
const ORDERS = 'books/smoke/backgrounds/layer1-orders.yaml';

/** A4 + 塗り足し 3mm を 72dpi（612×859px）で描いたことにするレンダリング画像 */
async function rendered(file: string): Promise<string> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 612, height: 859, channels: 3, background: '#ffffff' } }).png().toFile(file);
  return file;
}

function orders(extra = ''): string {
  return `book: smoke
page: page_001
reference_image: ${REF}
${extra}status: pending
items:
  - id: page_001-top
    kind: photo
    people: false
    size_mm: [50, 40]
    crop_mm: [10, 10, 50, 40]
    placement: "page.html の photo-frame"
    reference_usage: composition
    mask: なし
    prompt: |
      A calm abstract photo.
    negative_prompt: "text, letters, typography, words, numbers, logo, watermark, signature, QR code, caption"
    summary: テスト用
`;
}

describe('isLfsPointer', () => {
  it('ポインタ文書だけを見分ける（画像・ほかのテキスト・ないファイル・ディレクトリは false）', async () => {
    const dir = tempDir();
    const file = (name: string, content: string | Buffer) => {
      fs.writeFileSync(path.join(dir, name), content);
      return path.join(dir, name);
    };
    expect(isLfsPointer(file('a.png', POINTER))).toBe(true);
    expect(isLfsPointer(file('b.png', await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer()))).toBe(false);
    expect(isLfsPointer(file('c.txt', 'version 1\n'))).toBe(false);
    expect(isLfsPointer(file('d.txt', ''))).toBe(false);
    expect(isLfsPointer(path.join(dir, 'missing.png'))).toBe(false);
    expect(isLfsPointer(dir)).toBe(false);
  });
});

describe('Git LFS のポインタ: 各 CLI はファイル名と対処を示して止まる', () => {
  it('compare: 参考画像・レンダリング画像がポインタ、または読めない画像なら、スタックトレースではなくファイル名を出す', async () => {
    const root = copyFixture();
    const png = await rendered(path.join(tempDir(), 'rendered.png'));
    writeFile(root, REF, POINTER);
    const ref = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--reference', REF, '--rendered', png, '--root', root]);
    expect(ref.code).toBe(1);
    expect(ref.err).toContain(`エラー: ${pointerMsg(REF)}`);
    expect(ref.err).toContain(`対処: ${PULL}`);
    expect(ref.err).not.toContain('予期しないエラー');

    // 既定のレンダリング画像（output/png。コミット済みの出力も LFS）がポインタ
    writeFile(root, 'books/smoke/output/png/page_001.png', POINTER);
    const out = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--root', root]);
    expect(out.code).toBe(1);
    expect(out.err).toContain(pointerMsg('books/smoke/output/png/page_001.png'));
    expect(out.err).not.toContain('予期しないエラー');

    // ポインタではないが画像として読めない
    writeFile(root, REF, 'not an image');
    const broken = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--reference', REF, '--rendered', png, '--root', root]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain(`画像を読めません: ${REF}`);
    expect(broken.err).not.toContain('予期しないエラー');
  });

  it('ref:prep と、compare に渡した補正指定: image がポインタ', async () => {
    const root = copyFixture();
    writeFile(root, REF, POINTER);
    writeFile(root, PREP, `image: ${REF}\nrotate: 0\ncorners: [[0, 0], [1, 0], [1, 1], [0, 1]]\naspect: 0.7071\nheight_px: 297\n`);
    const prep = await run(prepCommand, ['--spec', PREP, '--root', root]);
    expect(prep.code).toBe(1);
    expect(prep.err).toContain(pointerMsg(REF));
    expect(prep.err).toContain(PULL);
    expect(prep.err).not.toContain('予期しないエラー');

    const png = await rendered(path.join(tempDir(), 'rendered.png'));
    const cmp = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--reference', PREP, '--rendered', png, '--root', root]);
    expect(cmp.code).toBe(1);
    expect(cmp.err).toContain(pointerMsg(REF));
  });

  it('gen:inputs: reference_image（補正指定がなければ）・補正指定の image がポインタ', async () => {
    const root = copyFixture();
    writeFile(root, REF, POINTER);
    writeFile(root, ORDERS, orders());
    const direct = await run(genInputsCommand, ['--book', 'smoke', '--root', root]);
    expect(direct.code).toBe(1);
    expect(direct.err).toContain(pointerMsg(REF));
    expect(direct.err).toContain(PULL);
    expect(direct.err).not.toContain('予期しないエラー');

    writeFile(root, PREP, `image: ${REF}\nrotate: 0\ncorners: [[0, 0], [1, 0], [1, 1], [0, 1]]\naspect: 0.7071\nheight_px: 297\n`);
    writeFile(root, ORDERS, orders(`reference_prep: ${PREP}\n`));
    const viaPrep = await run(genInputsCommand, ['--book', 'smoke', '--root', root]);
    expect(viaPrep.code).toBe(1);
    expect(viaPrep.err).toContain(pointerMsg(REF));
  });

  it('photo:add・ref:ingest: 取り込む画像・PDF がポインタなら何も書き換えない', async () => {
    const root = copyFixture();
    const src = path.join(tempDir(), 'campus.jpg');
    fs.writeFileSync(src, POINTER);
    const before = readFile(root, 'company-data/photos/photos.yaml');
    const photo = await run(photoAddCommand, ['--file', src, '--id', 'campus-01', '--rights', '学校撮影。掲載同意あり', '--root', root]);
    expect(photo.code).toBe(1);
    expect(photo.err).toContain(pointerMsg(src));
    expect(photo.err).toContain(PULL);
    expect(readFile(root, 'company-data/photos/photos.yaml')).toBe(before);

    const pdf = path.join(tempDir(), 'brochure.pdf');
    fs.writeFileSync(pdf, POINTER);
    const fromPdf = await run(ingestCommand, ['--source', 'Other', '--kind', 'brochure', '--pdf', pdf, '--root', root]);
    expect(fromPdf.code).toBe(1);
    expect(fromPdf.err).toContain(pointerMsg(pdf));
    expect(fromPdf.err).toContain(PULL);

    const images = tempDir();
    await sharp({ create: { width: 40, height: 56, channels: 3, background: '#336699' } }).png().toFile(path.join(images, 'p1.png'));
    fs.writeFileSync(path.join(images, 'p2.jpg'), POINTER);
    const fromImages = await run(ingestCommand, ['--source', 'Other', '--kind', 'brochure', '--images', images, '--root', root]);
    expect(fromImages.code).toBe(1);
    expect(fromImages.err).toContain(pointerMsg(path.join(images, 'p2.jpg')));
    expect(fs.existsSync(path.join(root, 'references/Other'))).toBe(false);
  });
});

describe('Git LFS のポインタ: validate は警告し、render は案内を付ける', () => {
  it('validate: 背景・references.yaml の参考画像・補正指定の image・生成指示の reference_image がポインタなら警告（エラーにはしない）', async () => {
    const root = copyFixture();
    writeFile(root, 'books/smoke/backgrounds/page_001.png', POINTER);
    writeFile(root, 'books/smoke/pages/page_001/page.yaml', readFile(root, 'books/smoke/pages/page_001/page.yaml').replace('page_001.svg', 'page_001.png'));
    writeFile(root, REF, POINTER);
    writeFile(root, 'books/smoke/references.yaml', readFile(root, 'books/smoke/references.yaml').replace('layout_reference: [references/Sample/brochure/page_001.svg]', `layout_reference: [${REF}]`));
    writeFile(root, PREP, `image: ${REF}\nrotate: 0\ncorners: [[0, 0], [1, 0], [1, 1], [0, 1]]\naspect: 0.7071\nheight_px: 297\n`);
    writeFile(root, ORDERS, orders());

    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
    expect(v.out).toContain(`books/smoke/pages/page_001/page.yaml: 背景画像 ${pointerMsg('books/smoke/backgrounds/page_001.png')}。${PULL}`);
    expect(v.out).toContain(`books/smoke/references.yaml: 参考資料 ${pointerMsg(REF)}。${PULL}`);
    expect(v.out).toContain(`${PREP}: image ${pointerMsg(REF)}。${PULL}`);
    expect(v.out).toContain(`${ORDERS}: reference_image ${pointerMsg(REF)}。${PULL}`);
    expect(v.out).not.toContain('画像を読めません');
  });

  it('render: 背景がポインタなら「画像を表示できません」に LFS の案内を付ける（ほかの壊れた画像には付けない）', async () => {
    const root = copyFixture();
    writeFile(root, 'books/smoke/backgrounds/page_001.png', POINTER);
    writeFile(root, 'books/smoke/pages/page_001/page.yaml', readFile(root, 'books/smoke/pages/page_001/page.yaml').replace('page_001.svg', 'page_001.png'));
    const out = tempDir();
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--format', 'png', '--dpi', '36', '--out', out, '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain(`page_001: 画像を表示できません: ${pointerMsg('books/smoke/backgrounds/page_001.png')}。${PULL}`);

    // ポインタではない壊れた画像は、これまでどおりパスだけ
    writeFile(root, 'books/smoke/backgrounds/page_001.png', 'not an image');
    const r2 = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--format', 'png', '--dpi', '36', '--out', tempDir(), '--root', root]);
    expect(r2.code, r2.text).toBe(0);
    expect(r2.out).toContain('page_001: 画像を表示できません: books/smoke/backgrounds/page_001.png');
    expect(r2.out).not.toContain('Git LFS');
  });
});
