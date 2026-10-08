// photo:add: 学校の写真の取り込み（向きの補正・EXIF の除去・photos.yaml への登録）
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { appendPhotoEntry, photoAddCommand } from '../lib/photo-add.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, readFile, run, tempDir, writeFile } from './helpers.ts';

afterAll(() => cleanupTemp());

const RIGHTS = '学校撮影。写っている学生全員の掲載同意あり（2026 年度パンフレット・Web）';

/** 横 40×縦 20 の JPEG。EXIF の向き 6（90° 回転して表示）と、撮影者・位置情報を入れる */
async function exifJpeg(file: string): Promise<void> {
  const buf = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#cc0000' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 10/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

describe('photo:add', () => {
  it('向きを補正し EXIF を消して取り込み、photos.yaml の末尾に登録する（コメント・既存の行はそのまま）', async () => {
    const root = copyFixture();
    const src = path.join(tempDir(), 'IMG_0001.JPG');
    await exifJpeg(src);
    const before = readFile(root, 'company-data/photos/photos.yaml');
    writeFile(root, 'company-data/photos/photos.yaml', `# 写真（正本）\n${before}`);

    const r = await run(photoAddCommand, ['--file', src, '--id', 'campus-event-01', '--rights', RIGHTS, '--caption', '新入生の交流会', '--tags', 'event, students', '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('company-data/photos/campus-event-01.jpg（20×40px');

    const out = path.join(root, 'company-data/photos/campus-event-01.jpg');
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]); // 向き 6 を画素に反映（縦長）
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined(); // 撮影者・位置情報は残らない
    expect(fs.readFileSync(out).includes(Buffer.from('secret-owner'))).toBe(false);

    const yaml = readFile(root, 'company-data/photos/photos.yaml');
    expect(yaml.startsWith(`# 写真（正本）\n${before.trimEnd()}\n  - id: campus-event-01\n`)).toBe(true);
    expect(yaml).toContain('    file: company-data/photos/campus-event-01.jpg\n    caption: 新入生の交流会\n');
    expect(yaml).toContain(`    rights: ${RIGHTS}\n`);
    expect(yaml).toContain('    tags:\n      - event\n      - students\n');
    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
  });

  it('透過のある画像は PNG のまま、長辺を --max-px に縮める（拡大はしない）', async () => {
    const root = copyFixture();
    const dir = tempDir();
    const png = path.join(dir, 'logo-like.png');
    await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(png);
    const r = await run(photoAddCommand, ['--file', png, '--id', 'cutout-01', '--rights', RIGHTS, '--max-px', '100', '--root', root]);
    expect(r.code, r.text).toBe(0);
    const meta = await sharp(path.join(root, 'company-data/photos/cutout-01.png')).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([100, 75, true]);

    const small = path.join(dir, 'small.jpg');
    await sharp({ create: { width: 60, height: 40, channels: 3, background: '#00cc00' } }).jpeg().toFile(small);
    expect((await run(photoAddCommand, ['--file', small, '--id', 'small-01', '--rights', RIGHTS, '--max-px', '100', '--root', root])).code).toBe(0);
    expect((await sharp(path.join(root, 'company-data/photos/small-01.jpg')).metadata()).width).toBe(60);
  });

  it('権利が未確認・ID の重複や形式違い・HEIC・参考資料の画像は登録しない（何も書き換えない）', async () => {
    const root = copyFixture();
    const src = path.join(tempDir(), 'a.jpg');
    await exifJpeg(src);
    const yaml = readFile(root, 'company-data/photos/photos.yaml');
    const cases: Array<[string[], string]> = [
      [['--rights', 'TODO: 同意を確認'], '--rights に使用条件と肖像の同意の状況を書いてください'],
      [['--rights', '  '], '--rights に使用条件と肖像の同意の状況を書いてください'],
      [['--rights', RIGHTS, '--id', 'campus'], '写真 ID "campus" はすでに'],
      [['--rights', RIGHTS, '--id', 'Campus_01'], '--id は英小文字・数字・ハイフンで指定してください'],
    ];
    for (const [extra, message] of cases) {
      const args = ['--file', src, '--id', 'x-01', '--root', root, ...extra];
      const r = await run(photoAddCommand, args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err).toContain(message);
    }
    const heic = path.join(tempDir(), 'IMG_5468.heic');
    fs.writeFileSync(heic, 'not really heic');
    const h = await run(photoAddCommand, ['--file', heic, '--id', 'x-01', '--rights', RIGHTS, '--root', root]);
    expect(h.err).toContain('HEIC は読み込めません');
    expect(h.err).toContain('JPEG に書き出してから');

    const refSrc = path.join(root, 'references/Sample/brochure/photo.jpg');
    await exifJpeg(refSrc);
    const ref = await run(photoAddCommand, ['--file', refSrc, '--id', 'x-01', '--rights', RIGHTS, '--root', root]);
    expect(ref.err).toContain('参考資料の画像は自社の写真として登録できません');

    expect((await run(photoAddCommand, ['--file', src, '--root', root])).err).toContain('--file・--id・--rights は必須です');
    expect(readFile(root, 'company-data/photos/photos.yaml')).toBe(yaml);
    expect(fs.existsSync(path.join(root, 'company-data/photos/x-01.jpg'))).toBe(false);
  });
});

describe('appendPhotoEntry', () => {
  const entry = { id: 'a-01', file: 'company-data/photos/a-01.jpg', rights: 'r' };

  it('"photos: []" をブロック形式にし、後ろのコメントを残す', () => {
    const out = appendPhotoEntry('# 説明\n\nphotos: [] # 空\n# 末尾のコメント\n', entry, 't');
    expect(out).toBe('# 説明\n\nphotos: # 空\n  - id: a-01\n    file: company-data/photos/a-01.jpg\n    rights: r\n# 末尾のコメント\n');
  });

  it('photos がなければ末尾に足す。既存のブロックの後ろに足す', () => {
    expect(appendPhotoEntry('# x\n', entry, 't')).toBe('# x\nphotos:\n  - id: a-01\n    file: company-data/photos/a-01.jpg\n    rights: r\n');
    const two = appendPhotoEntry('photos:\n  - id: b\n    file: company-data/photos/b.jpg\n# 後ろ\n', entry, 't');
    expect(two).toBe('photos:\n  - id: b\n    file: company-data/photos/b.jpg\n  - id: a-01\n    file: company-data/photos/a-01.jpg\n    rights: r\n# 後ろ\n');
  });
});
