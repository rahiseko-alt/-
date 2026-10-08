// system/templates/ の雛形を読み、プレースホルダ（__BOOK_ID__ など）を置き換えて書き出す
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './cli.ts';

/** system/templates（--root に関係なく、このリポジトリの雛形を使う） */
export const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates');

export function templatePath(rel: string): string {
  const abs = path.join(TEMPLATES_DIR, rel);
  if (!fs.existsSync(abs)) throw new CliError(`雛形が見つかりません: system/templates/${rel}`);
  return abs;
}

/** そのまま埋め込む値（YAML の null・数値・引用済み文字列など） */
export interface RawValue {
  raw: string;
}

export type TemplateValue = string | RawValue;
export type TemplateVars = Record<string, TemplateValue>;

export function raw(value: string): RawValue {
  return { raw: value };
}

/** YAML のダブルクォート文字列として埋め込む値（"..." を含む） */
export function yamlString(value: string): RawValue {
  return raw(JSON.stringify(value));
}

function escapeFor(fileName: string, value: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    // 雛形ではダブルクォートの内側に置く前提でエスケープする
    return JSON.stringify(value).slice(1, -1);
  }
  if (ext === '.html' || ext === '.hbs') {
    return value
      .replace(/[{}]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  return value;
}

/**
 * プレースホルダを単純な文字列置換で埋める。
 * 文字列値はファイルの種類に応じてエスケープ（YAML: ダブルクォート内、HTML: 実体参照）、RawValue はそのまま。
 */
export function fillTemplate(text: string, fileName: string, vars: TemplateVars): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    const rep = typeof value === 'string' ? escapeFor(fileName, value) : value.raw;
    out = out.split(key).join(rep);
  }
  return out;
}

/** 埋め残したプレースホルダ（__XXX__）の一覧 */
export function leftoverPlaceholders(text: string): string[] {
  return [...new Set(text.match(/__[A-Z][A-Z0-9_]*__/g) ?? [])];
}

/** ディレクトリ内のファイル（相対パス、/ 区切り、ソート済み） */
export function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs, base));
    else if (ent.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

/**
 * 雛形ディレクトリをコピーしながらプレースホルダを置き換える。既存ファイルは上書きしない。
 * 戻り値: 書き出したファイル（絶対パス）
 */
export function copyTemplateDir(srcDir: string, destDir: string, vars: TemplateVars, opts: { skip?: (rel: string) => boolean } = {}): string[] {
  const written: string[] = [];
  for (const rel of listFiles(srcDir)) {
    if (opts.skip?.(rel)) continue;
    const dest = path.join(destDir, ...rel.split('/'));
    if (fs.existsSync(dest)) throw new CliError(`既にファイルがあります: ${dest}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const text = fs.readFileSync(path.join(srcDir, ...rel.split('/')), 'utf8');
    fs.writeFileSync(dest, fillTemplate(text, rel, vars), 'utf8');
    written.push(dest);
  }
  return written;
}
