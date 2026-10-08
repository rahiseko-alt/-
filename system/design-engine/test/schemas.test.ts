import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AnalysisSchema,
  BackgroundPromptSchema,
  BookConfigSchema,
  BookReferencesSchema,
  ColorsFileSchema,
  ContactsFileSchema,
  CoursesFileSchema,
  FontsFileSchema,
  LogosFileSchema,
  PageConfigSchema,
  PhotosFileSchema,
  ReferenceSourceSchema,
  ResultsFileSchema,
  SchoolSchema,
  StudioError,
  TeachersFileSchema,
  allReferencePaths,
  isSafeRelPath,
  loadCompanyData,
  pageReference,
  parseData,
  readYamlFile,
  safeParseData,
} from '../src/index.ts';
import { FIXTURE_ROOT } from './helpers.ts';

function fixtureYaml(rel: string): unknown {
  return readYamlFile(path.join(FIXTURE_ROOT, rel), rel);
}

function issuesOf(schema: z.ZodType, data: unknown): string[] {
  const r = safeParseData(schema, data, 'test.yaml');
  return r.success ? [] : r.issues;
}

const validBook = {
  id: 'brochure',
  title: '学校案内',
  kind: 'brochure',
  format: { size: 'A4' },
  pages: ['page_001'],
};

describe('fixture のデータはすべてスキーマに通る', () => {
  const cases: Array<[string, z.ZodType]> = [
    ['company-data/facts/school.yaml', SchoolSchema],
    ['company-data/facts/courses.yaml', CoursesFileSchema],
    ['company-data/facts/teachers.yaml', TeachersFileSchema],
    ['company-data/facts/results.yaml', ResultsFileSchema],
    ['company-data/facts/contacts.yaml', ContactsFileSchema],
    ['company-data/brand/colors/colors.yaml', ColorsFileSchema],
    ['company-data/brand/fonts/fonts.yaml', FontsFileSchema],
    ['company-data/brand/logo/logo.yaml', LogosFileSchema],
    ['company-data/photos/photos.yaml', PhotosFileSchema],
    ['books/smoke/config/book.yaml', BookConfigSchema],
    ['books/smoke/pages/page_001/page.yaml', PageConfigSchema],
    ['books/smoke/pages/page_002/page.yaml', PageConfigSchema],
    ['books/smoke/references.yaml', BookReferencesSchema],
    ['books/smoke/backgrounds/page_001.prompt.yaml', BackgroundPromptSchema],
    ['references/Sample/brochure/source.yaml', ReferenceSourceSchema],
    ['references/Sample/brochure/analysis/book.yaml', AnalysisSchema],
    ['references/Sample/brochure/analysis/page_001.yaml', AnalysisSchema],
  ];
  it.each(cases)('%s', (rel, schema) => {
    expect(issuesOf(schema, fixtureYaml(rel))).toEqual([]);
  });

  it('loadCompanyData が facts/brand/photos/copy を組み立てる', () => {
    const data = loadCompanyData(FIXTURE_ROOT);
    expect(data.facts.school?.name).toBe('サンプル学園');
    expect(data.facts.courses?.courses.map((c) => c.id)).toEqual(['ai-system', 'data-business']);
    expect(data.brand.colors.primary).toBe('#1d4e89');
    expect(data.brand.color_status).toBe('final');
    expect(data.brand.fonts.serif).toContain('Noto Serif JP');
    expect(data.brand.logo.main?.file).toBe('company-data/brand/logo/logo.svg');
    expect(data.photos.campus?.file).toBe('company-data/photos/campus.svg');
    expect(data.copy.brochure).toMatchObject({ catch: expect.any(String) });
    expect(data.files).toContain('company-data/facts/school.yaml');
  });

  it('references.yaml はトップレベル references とページ単位キーを持つ', () => {
    const refs = parseData(BookReferencesSchema, fixtureYaml('books/smoke/references.yaml'), 'references.yaml');
    expect(refs.references).toEqual(['references/Sample/brochure/']);
    expect(pageReference(refs, 'page_001')?.layout_reference).toEqual(['references/Sample/brochure/page_001.svg']);
    expect(pageReference(refs, 'page_002')).toBeUndefined();
    expect(allReferencePaths(refs)).toEqual(['references/Sample/brochure/', 'references/Sample/brochure/page_001.svg']);
  });
});

describe('既定値', () => {
  it('book.yaml の format 既定値（向き・塗り足し・マージン・段組・綴じ）', () => {
    const book = parseData(BookConfigSchema, validBook, 'book.yaml');
    expect(book.format).toMatchObject({
      orientation: 'portrait',
      bleed_mm: 3,
      safe_mm: 5,
      margins_mm: { top: 15, bottom: 15, inside: 18, outside: 15 },
      columns: 12,
      gutter_mm: 4,
      binding: 'left',
    });
    expect(book.styles).toEqual([]);
    expect(book.theme).toEqual({});
    expect(book.output).toEqual({ png_dpi: 350, preview_dpi: 150 });
  });

  it('fonts.yaml 省略項目は Noto Sans JP / Noto Serif JP', () => {
    const fonts = parseData(FontsFileSchema, {}, 'fonts.yaml');
    expect(fonts.families.body).toBe('"Noto Sans JP", sans-serif');
    expect(fonts.families.serif).toBe('"Noto Serif JP", serif');
  });

  it('logo/photos は空リスト・null を許容', () => {
    expect(parseData(LogosFileSchema, { logos: [] }, 'logo.yaml').logos).toEqual([]);
    expect(parseData(PhotosFileSchema, { photos: null }, 'photos.yaml').photos).toEqual([]);
  });

  it('page.yaml の background 既定値', () => {
    const page = parseData(
      PageConfigSchema,
      { id: 'page_001', title: '表紙', type: 'cover', background: { image: 'books/a/backgrounds/page_001.png' } },
      'page.yaml',
    );
    expect(page.background).toEqual({ image: 'books/a/backgrounds/page_001.png', fit: 'cover', position: 'center', opacity: 1 });
  });

  it('TODO プレースホルダ（文字列）を数値項目・色に許容する', () => {
    expect(issuesOf(CoursesFileSchema, { courses: [{ id: 'x', name: 'TODO: 学科名', years: 'TODO: 年数', description: 'TODO' }] })).toEqual([]);
    expect(issuesOf(ResultsFileSchema, { metrics: [{ id: 'm', label: 'TODO', value: 'TODO: 数値' }] })).toEqual([]);
    const colors = { primary: 'TODO: 決定待ち', secondary: '#000', accent: '#000', text: '#000', muted: '#000', background: '#fff', surface: '#fff' };
    expect(issuesOf(ColorsFileSchema, { colors, status: 'provisional' })).toEqual([]);
  });
});

describe('不正なデータを拒否する', () => {
  const bad: Array<[string, z.ZodType, unknown, string]> = [
    ['school: name なし', SchoolSchema, { tel: '00' }, 'name'],
    ['school: access が文字列', SchoolSchema, { name: 'x', access: '駅' }, 'access'],
    [
      'courses: id 重複',
      CoursesFileSchema,
      { courses: [{ id: 'a', name: 'A', years: 2, description: '' }, { id: 'a', name: 'B', years: 2, description: '' }] },
      '重複',
    ],
    ['courses: years なし', CoursesFileSchema, { courses: [{ id: 'a', name: 'A', description: '' }] }, 'courses.0.years'],
    ['results: metrics なし', ResultsFileSchema, { employers: [] }, 'metrics'],
    ['contacts: label なし', ContactsFileSchema, { contacts: [{ id: 'c' }] }, 'contacts.0.label'],
    [
      'colors: 16進でない',
      ColorsFileSchema,
      { colors: { primary: 'red', secondary: '#000', accent: '#000', text: '#000', muted: '#000', background: '#fff', surface: '#fff' } },
      'colors.primary',
    ],
    ['colors: 役割が欠けている', ColorsFileSchema, { colors: { primary: '#000' } }, 'colors.secondary'],
    ['colors: status 不正', ColorsFileSchema, { colors: {}, status: 'maybe' }, 'status'],
    ['fonts: CSS 注入', FontsFileSchema, { families: { body: 'x; } body { color: red' } }, 'families.body'],
    ['photos: file が絶対パス', PhotosFileSchema, { photos: [{ id: 'p', file: '/etc/passwd' }] }, 'photos.0.file'],
    ['photos: file が .. を含む', PhotosFileSchema, { photos: [{ id: 'p', file: '../x.png' }] }, 'photos.0.file'],
    ['book: kind 不正', BookConfigSchema, { ...validBook, kind: 'magazine' }, 'kind'],
    ['book: size 不正', BookConfigSchema, { ...validBook, format: { size: 'B6' } }, 'format.size'],
    ['book: custom なのに寸法なし', BookConfigSchema, { ...validBook, format: { size: 'custom' } }, 'format.width_mm'],
    ['book: orientation 不正', BookConfigSchema, { ...validBook, format: { size: 'A4', orientation: 'square' } }, 'format.orientation'],
    ['book: ページID形式', BookConfigSchema, { ...validBook, pages: ['page_1'] }, 'pages.0'],
    ['book: ページ重複', BookConfigSchema, { ...validBook, pages: ['page_001', 'page_001'] }, '重複'],
    ['book: theme キー', BookConfigSchema, { ...validBook, theme: { 'color-accent': '#fff' } }, 'theme'],
    ['book: theme 値', BookConfigSchema, { ...validBook, theme: { '--x': 'red; }' } }, 'theme'],
    ['book: styles がルート外', BookConfigSchema, { ...validBook, styles: ['../x.css'] }, 'styles.0'],
    ['book: styles が css でない', BookConfigSchema, { ...validBook, styles: ['shared/x.scss'] }, 'styles.0'],
    ['book: id 形式', BookConfigSchema, { ...validBook, id: '../evil' }, 'id'],
    ['book: binding 不正', BookConfigSchema, { ...validBook, format: { size: 'A4', binding: 'top' } }, 'format.binding'],
    ['page: id 形式', PageConfigSchema, { id: 'page-001', title: 'x', type: 'cover' }, 'id'],
    ['page: type 不正', PageConfigSchema, { id: 'page_001', title: 'x', type: 'poster' }, 'type'],
    ['page: opacity 範囲外', PageConfigSchema, { id: 'page_001', title: 'x', type: 'cover', background: { image: 'a.png', opacity: 2 } }, 'background.opacity'],
    ['page: status 不正', PageConfigSchema, { id: 'page_001', title: 'x', type: 'cover', status: 'done' }, 'status'],
    ['references: 未知のキー', BookReferencesSchema, { references: [], layout: [] }, 'layout'],
    ['references: 先頭スラッシュ', BookReferencesSchema, { references: ['/references/HAL/'] }, 'references.0'],
    ['references: ページ参照が配列でない', BookReferencesSchema, { page_016: { layout_reference: 'x.png' } }, 'page_016.layout_reference'],
    [
      'source: usage 不正',
      ReferenceSourceSchema,
      { source: 'HAL', title: 't', kind: 'brochure', usage: 'free', forbidden_terms: [] },
      'usage',
    ],
    ['source: forbidden_terms なし', ReferenceSourceSchema, { source: 'HAL', title: 't', kind: 'brochure', usage: 'reference-only' }, 'forbidden_terms'],
    ['prompt: prompt なし', BackgroundPromptSchema, { tool: 'x' }, 'prompt'],
    ['analysis: オブジェクトでない', AnalysisSchema, ['grid'], '(ルート)'],
  ];
  it.each(bad)('%s', (_name, schema, data, expected) => {
    const issues = issuesOf(schema, data);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain(expected);
    // ファイル名つき・日本語メッセージ
    expect(issues[0]).toMatch(/^test\.yaml: /);
  });

  it('parseData は StudioError（issues 付き）を投げる', () => {
    try {
      parseData(SchoolSchema, {}, 'company-data/facts/school.yaml');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(StudioError);
      const e = err as StudioError;
      expect(e.message).toContain('company-data/facts/school.yaml');
      expect(e.issues[0]).toContain('name');
      expect(e.issues[0]).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
  });
});

describe('isSafeRelPath', () => {
  it.each([
    ['books/brochure/backgrounds/page_001.png', true],
    ['references/HAL/brochure/', true],
    ['company-data/photos/写真.jpg', true],
    ['/abs/path.png', false],
    ['../outside.png', false],
    ['books/../../x', false],
    ['books\\x.png', false],
    ['C:/x.png', false],
    ['file:///etc/passwd', false],
    ['https://example.com/x.png', false],
    ['', false],
  ])('%s -> %s', (p, ok) => {
    expect(isSafeRelPath(p)).toBe(ok);
  });
});
