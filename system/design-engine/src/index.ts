// デザインエンジンの公開 API
// scripts（render / compare / validate 等）はここから import する。
export { StudioError, TemplateError, errorMessage, type TemplateErrorInfo } from './errors.ts';
export * from './schemas/index.ts';
export {
  ENGINE_ASSETS_DIR,
  ENGINE_DIR,
  REPO_PACKAGE_NAME,
  bookDir,
  bookFileName,
  bookRelDir,
  findRepoRoot,
  isInside,
  isValidBookId,
  isValidPageId,
  listBookIds,
  listInvalidBookDirs,
  listReferenceDirs,
  pageDir,
  pageRelDir,
  relFromRoot,
  resolveInRoot,
  resolveStudioRoot,
  toPosix,
} from './paths.ts';
export {
  collectTodos,
  listBooks,
  listReferenceSources,
  loadAnalysis,
  loadBook,
  loadCompanyData,
  loadPage,
  loadReferenceSource,
  loadReferences,
  loadYamlWithSchema,
  readYamlFile,
  walkStrings,
  type Brand,
  type CompanyData,
  type Facts,
  type LoadedBook,
  type LoadedPage,
  type StringHit,
} from './load.ts';
export {
  CSS_PX_PER_MM,
  formatCssVars,
  mmToCssPx,
  mmToPixels,
  pageGeometry,
  pageSide,
  pngDeviceScaleFactor,
  renderPixelSize,
  renderViewport,
  sideMargins,
  trimSizeMm,
  type Margins,
  type PageGeometry,
  type PageSide,
} from './format.ts';
export {
  HELPER_NAMES,
  assetUrl,
  createTemplateEnv,
  discoverPartials,
  type RenderInfo,
  type TemplateEnv,
  type TemplateEnvOptions,
} from './template.ts';
export {
  baseHref,
  buildTemplateContext,
  composeBook,
  composePage,
  escapeHtml,
  type ComposeBookOptions,
  type ComposeBookResult,
  type ComposeMode,
  type ComposePageOptions,
  type ComposeResult,
  type TemplateContext,
} from './compose.ts';
export { ENGINE_URL_PREFIX, FONT_PACKAGES, engineStylesheets, fontsourceDir, resolveEngineRequest } from './engine-assets.ts';
export { writeTempHtml, type HtmlFile } from './html-file.ts';
export { findReferenceUrls, isReferencePath, resolvePageUrl } from './reference-guard.ts';
export { parsePreviewPath, studioPlugin, type StudioPluginOptions } from './vite-plugin.ts';
