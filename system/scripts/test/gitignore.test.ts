// .gitignore: 秘密情報（.env・secrets/）を Git 管理から除外し、雛形 .env.example だけは残す
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** .gitignore の規則で除外されるか（ファイルの実在は問わない） */
function isIgnored(rel: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('.gitignore（秘密情報）', () => {
  it.each(['.env', '.env.local', '.env.production', 'system/scripts/.env', 'secrets/api-key.json', 'books/brochure/secrets/token.txt'])(
    '%s は除外される',
    (rel) => {
      expect(isIgnored(rel)).toBe(true);
    },
  );

  it.each(['.env.example', 'system/scripts/.env.example', 'books/brochure/config/book.yaml', 'company-data/facts/school.yaml'])(
    '%s は除外されない',
    (rel) => {
      expect(isIgnored(rel)).toBe(false);
    },
  );
});
