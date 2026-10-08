// YAML データの読み込み（company-data / books / references）
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { StudioError, errorMessage } from './errors.ts';
import { bookRelDir, listBookIds, listReferenceDirs, pageRelDir, relFromRoot, resolveInRoot } from './paths.ts';
import {
  AnalysisSchema,
  BOOK_KNOWN_KEYS,
  BookConfigSchema,
  BookReferencesSchema,
  ColorsFileSchema,
  FACT_SCHEMAS,
  FORMAT_KNOWN_KEYS,
  FontsFileSchema,
  FreeFormSchema,
  LogosFileSchema,
  PAGE_KNOWN_KEYS,
  PageConfigSchema,
  PhotosFileSchema,
  ReferenceSourceSchema,
  SIZE_PRESETS_MM,
  safeParseData,
  type Analysis,
  type BookConfig,
  type BookReferences,
  type BrandColors,
  type BrandFonts,
  type ContactsFile,
  type CoursesFile,
  type Logo,
  type PageConfig,
  type Photo,
  type ReferenceSource,
  type ResultsFile,
  type School,
  type TeachersFile,
} from './schemas/index.ts';

// ---------------------------------------------------------------------------
// YAML 共通

/** YAML ファイルを読む（構文エラーはファイル名付きの StudioError） */
export function readYamlFile(absPath: string, label: string = absPath): unknown {
  let text: string;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new StudioError(`${label}: ファイルを読み込めません（${errorMessage(err)}）`, [], { cause: err });
  }
  try {
    return parseYaml(text, { prettyErrors: true });
  } catch (err) {
    throw new StudioError(`${label}: YAML 構文エラー`, [errorMessage(err)], { cause: err });
  }
}

/** YAML を読んでスキーマ検証する。失敗時は StudioError（issues に詳細） */
export function loadYamlWithSchema<S extends z.ZodType>(absPath: string, schema: S, label: string): z.output<S> {
  const raw = readYamlFile(absPath, label);
  const r = safeParseData(schema, raw, label);
  if (!r.success) throw new StudioError(`${label} の形式が正しくありません`, r.issues);
  return r.data;
}

function listYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.yaml'))
    .map((d) => d.name)
    .sort();
}

// ---------------------------------------------------------------------------
// company-data

export interface Facts {
  school?: School;
  courses?: CoursesFile;
  teachers?: TeachersFile;
  results?: ResultsFile;
  contacts?: ContactsFile;
  [basename: string]: unknown;
}

export interface Brand {
  /** --color-* になる色（primary, secondary, accent, text, muted, background, surface） */
  colors: BrandColors;
  /** provisional（暫定）| final */
  color_status: 'provisional' | 'final' | null;
  /** --font-* になる font-family（heading, body, serif, number） */
  fonts: BrandFonts;
  /** logo.yaml の logos（並び順どおり） */
  logos: Logo[];
  /** id -> logo */
  logo: Record<string, Logo>;
}

export interface CompanyData {
  /** facts/<basename>.yaml -> facts.<basename>（ファイル内容そのまま） */
  facts: Facts;
  brand: Brand;
  /** photos.yaml の id -> photo */
  photos: Record<string, Photo>;
  /** photos.yaml の photos（並び順どおり） */
  photoList: Photo[];
  /** copy/<basename>.yaml -> copy.<basename> */
  copy: Record<string, unknown>;
  /** 読み込んだファイル（ルート相対） */
  files: string[];
}

/**
 * company-data/ を読み込み検証する。問題はすべて集めて 1 つの StudioError（issues）で投げる。
 * colors.yaml は必須。fonts.yaml / logo.yaml / photos.yaml は省略時に既定値。
 */
export function loadCompanyData(root: string): CompanyData {
  const absRoot = path.resolve(root);
  const base = path.join(absRoot, 'company-data');
  const issues: string[] = [];
  const files: string[] = [];

  if (!fs.existsSync(base)) {
    throw new StudioError(`company-data/ が見つかりません（ルート: ${absRoot}）`);
  }

  function load<S extends z.ZodType>(rel: string, schema: S, required: boolean): z.output<S> | undefined {
    const abs = path.join(absRoot, rel);
    if (!fs.existsSync(abs)) {
      if (required) issues.push(`${rel}: ファイルがありません`);
      return undefined;
    }
    files.push(rel);
    try {
      const raw = readYamlFile(abs, rel);
      const r = safeParseData(schema, raw, rel);
      if (!r.success) {
        issues.push(...r.issues);
        return undefined;
      }
      return r.data;
    } catch (err) {
      issues.push(err instanceof StudioError && err.issues.length > 0 ? `${err.message.split('\n')[0]}: ${err.issues.join(' / ')}` : errorMessage(err));
      return undefined;
    }
  }

  // facts/*.yaml
  const facts: Facts = {};
  for (const name of listYamlFiles(path.join(base, 'facts'))) {
    const key = name.slice(0, -'.yaml'.length);
    const schema = (FACT_SCHEMAS as Record<string, z.ZodType>)[key] ?? FreeFormSchema;
    const data = load(`company-data/facts/${name}`, schema, false);
    if (data !== undefined) facts[key] = data;
  }

  // copy/*.yaml
  const copy: Record<string, unknown> = {};
  for (const name of listYamlFiles(path.join(base, 'copy'))) {
    const data = load(`company-data/copy/${name}`, FreeFormSchema, false);
    if (data !== undefined) copy[name.slice(0, -'.yaml'.length)] = data;
  }

  // brand
  const colorsFile = load('company-data/brand/colors/colors.yaml', ColorsFileSchema, true);
  const fontsFile = load('company-data/brand/fonts/fonts.yaml', FontsFileSchema, false) ?? FontsFileSchema.parse({});
  const logosFile = load('company-data/brand/logo/logo.yaml', LogosFileSchema, false) ?? { logos: [] };
  const photosFile = load('company-data/photos/photos.yaml', PhotosFileSchema, false) ?? { photos: [] };

  if (issues.length > 0 || !colorsFile) {
    throw new StudioError('company-data の読み込みに失敗しました', issues);
  }

  const brand: Brand = {
    colors: colorsFile.colors,
    color_status: colorsFile.status ?? null,
    fonts: fontsFile.families,
    logos: logosFile.logos,
    logo: Object.fromEntries(logosFile.logos.map((l) => [l.id, l])),
  };

  return {
    facts,
    brand,
    photos: Object.fromEntries(photosFile.photos.map((p) => [p.id, p])),
    photoList: photosFile.photos,
    copy,
    files,
  };
}

// ---------------------------------------------------------------------------
// books

export interface LoadedBook {
  id: string;
  /** 絶対パス */
  dir: string;
  /** ルート相対（books/<id>） */
  relDir: string;
  /** ルート相対（books/<id>/config/book.yaml） */
  configPath: string;
  config: BookConfig;
  warnings: string[];
}

/** books/<bookId>/config/book.yaml を読み込み検証する（id とディレクトリの一致も確認） */
export function loadBook(root: string, bookId: string): LoadedBook {
  const relDir = bookRelDir(bookId);
  const dir = resolveInRoot(root, relDir);
  const configPath = `${relDir}/config/book.yaml`;
  const abs = resolveInRoot(root, configPath);
  if (!fs.existsSync(abs)) {
    throw new StudioError(`BOOK "${bookId}" が見つかりません（${configPath} がありません）`);
  }
  const raw = readYamlFile(abs, configPath);
  const r = safeParseData(BookConfigSchema, raw, configPath);
  if (!r.success) throw new StudioError(`${configPath} の形式が正しくありません`, r.issues);
  const config = r.data;
  if (config.id !== bookId) {
    throw new StudioError(`${configPath}: id "${config.id}" がディレクトリ名 "${bookId}" と一致しません`);
  }

  const warnings: string[] = [];
  const rawObj = raw as Record<string, unknown>;
  for (const k of Object.keys(rawObj)) {
    if (!BOOK_KNOWN_KEYS.includes(k)) warnings.push(`${configPath}: 未知のキー "${k}"`);
  }
  const rawFormat = rawObj.format;
  if (rawFormat && typeof rawFormat === 'object') {
    for (const k of Object.keys(rawFormat)) {
      if (!FORMAT_KNOWN_KEYS.includes(k)) warnings.push(`${configPath}: format に未知のキー "${k}"`);
    }
  }
  const f = config.format;
  if (f.size !== 'custom' && (f.width_mm != null || f.height_mm != null)) {
    const preset = SIZE_PRESETS_MM[f.size];
    const [w, h] = f.orientation === 'landscape' ? [preset.height, preset.width] : [preset.width, preset.height];
    if ((f.width_mm != null && f.width_mm !== w) || (f.height_mm != null && f.height_mm !== h)) {
      warnings.push(`${configPath}: width_mm/height_mm は size: custom のときだけ有効です（${f.size} ${f.orientation} = ${w}×${h}mm を使用）`);
    }
  }
  return { id: bookId, dir, relDir, configPath, config, warnings };
}

/** BOOK ID の一覧（ネスト対応・ソート済み） */
export function listBooks(root: string): string[] {
  return listBookIds(root);
}

export interface LoadedPage {
  id: string;
  bookId: string;
  /** 絶対パス */
  dir: string;
  /** ルート相対（books/<id>/pages/<pageId>） */
  relDir: string;
  config: PageConfig;
  /** page.html の内容（Handlebars テンプレート） */
  template: string;
  /** ルート相対 */
  templatePath: string;
  /** page.css の内容（なければ null） */
  css: string | null;
  /** ルート相対（なければ null） */
  cssPath: string | null;
  warnings: string[];
}

/** books/<bookId>/pages/<pageId>/ の page.yaml・page.html・page.css を読み込む */
export function loadPage(root: string, bookId: string, pageId: string): LoadedPage {
  const relDir = pageRelDir(bookId, pageId);
  const dir = resolveInRoot(root, relDir);
  if (!fs.existsSync(dir)) {
    throw new StudioError(`ページ "${pageId}" が見つかりません（${relDir}/ がありません）`);
  }
  const yamlPath = `${relDir}/page.yaml`;
  const templatePath = `${relDir}/page.html`;
  const cssRel = `${relDir}/page.css`;
  const yamlAbs = resolveInRoot(root, yamlPath);
  const htmlAbs = resolveInRoot(root, templatePath);
  const cssAbs = resolveInRoot(root, cssRel);
  const missing = [yamlAbs, htmlAbs].filter((p) => !fs.existsSync(p)).map((p) => relFromRoot(root, p));
  if (missing.length > 0) {
    throw new StudioError(`ページ "${bookId}/${pageId}" に必須ファイルがありません`, missing.map((m) => `${m} がありません`));
  }
  const raw = readYamlFile(yamlAbs, yamlPath);
  const r = safeParseData(PageConfigSchema, raw, yamlPath);
  if (!r.success) throw new StudioError(`${yamlPath} の形式が正しくありません`, r.issues);
  const config = r.data;
  if (config.id !== pageId) {
    throw new StudioError(`${yamlPath}: id "${config.id}" がディレクトリ名 "${pageId}" と一致しません`);
  }
  const warnings: string[] = [];
  for (const k of Object.keys(raw as object)) {
    if (!PAGE_KNOWN_KEYS.includes(k)) warnings.push(`${yamlPath}: 未知のキー "${k}"`);
  }
  const hasCss = fs.existsSync(cssAbs);
  return {
    id: pageId,
    bookId,
    dir,
    relDir,
    config,
    template: fs.readFileSync(htmlAbs, 'utf8'),
    templatePath,
    css: hasCss ? fs.readFileSync(cssAbs, 'utf8') : null,
    cssPath: hasCss ? cssRel : null,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// references

/** books/<bookId>/references.yaml（なければ null） */
export function loadReferences(root: string, bookId: string): BookReferences | null {
  const rel = `${bookRelDir(bookId)}/references.yaml`;
  const abs = resolveInRoot(root, rel);
  if (!fs.existsSync(abs)) return null;
  return loadYamlWithSchema(abs, BookReferencesSchema, rel);
}

/** references/<source>/<kind>/source.yaml。refDir は "references/HAL/brochure" 形式 */
export function loadReferenceSource(root: string, refDir: string): ReferenceSource {
  const rel = `${refDir.replace(/\/+$/, '')}/source.yaml`;
  return loadYamlWithSchema(resolveInRoot(root, rel), ReferenceSourceSchema, rel);
}

/** source.yaml を持つ参考資料ディレクトリの一覧（"references/<source>/<kind>"） */
export function listReferenceSources(root: string): string[] {
  return listReferenceDirs(root);
}

/** 解析結果 YAML（analysis/book.yaml, analysis/page_NNN.yaml） */
export function loadAnalysis(root: string, relPath: string): Analysis {
  return loadYamlWithSchema(resolveInRoot(root, relPath), AnalysisSchema, relPath);
}

// ---------------------------------------------------------------------------
// 文字列走査ユーティリティ（validate / render --release 用）

export interface StringHit {
  /** facts.school.name のようなドット区切りパス */
  path: string;
  value: string;
}

/** オブジェクト中のすべての文字列をパス付きで列挙する */
export function walkStrings(value: unknown, prefix = ''): StringHit[] {
  const out: StringHit[] = [];
  const visit = (v: unknown, p: string) => {
    if (typeof v === 'string') out.push({ path: p, value: v });
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, p ? `${p}.${i}` : String(i)));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k);
  };
  visit(value, prefix);
  return out;
}

/** "TODO" を含む文字列の一覧 */
export function collectTodos(value: unknown, prefix = ''): StringHit[] {
  return walkStrings(value, prefix).filter((h) => h.value.includes('TODO'));
}
