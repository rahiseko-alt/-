// テスト設定（npm test = vitest run）
// Playwright（Chromium）を使うテストがあるためタイムアウトは長め
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['system/**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/output/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
