// npm run dev = vite --config system/design-engine/vite.config.ts
// ルートはリポジトリルート。テスト等で別のスタジオを見る場合は STUDIO_ROOT=<dir> を指定する。
//   例: STUDIO_ROOT=system/fixtures/studio npm run dev
import { defineConfig } from 'vite';
import { findRepoRoot, resolveStudioRoot } from './src/paths.ts';
import { studioPlugin } from './src/vite-plugin.ts';

const repoRoot = findRepoRoot();
const studioRoot = resolveStudioRoot(process.env.STUDIO_ROOT || repoRoot);

export default defineConfig({
  root: studioRoot,
  appType: 'custom',
  publicDir: false,
  clearScreen: false,
  plugins: [studioPlugin({ root: studioRoot })],
  // page.html は Handlebars テンプレートなので依存関係の事前スキャン対象にしない
  optimizeDeps: { entries: [], noDiscovery: true },
  server: {
    port: Number(process.env.PORT) || 5173,
    fs: { allow: [studioRoot, repoRoot] },
  },
});
