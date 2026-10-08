# テスト用ミニスタジオ（fixture）

`--root system/fixtures/studio` で各スクリプト・テストが使う、架空の小さなスタジオです。
実在の学校とは無関係の架空データ（サンプル学園）だけで構成し、未記入のプレースホルダは含みません。

- `company-data/` 架空校「サンプル学園」の正本データ（facts / brand / photos / copy）
- `shared/components/` 共通パーシャル（`stat-card`, `cards/course-card`）
- `shared/layouts/fixture.css` BOOK の `styles` で読み込む共通 CSS
- `books/smoke/` A4・塗り足し 3mm・2 ページの BOOK
  - `page_001` 表紙: SVG 背景（Layer 1）+ QR + facts
  - `page_002` データ: `{{#each}}` で学科一覧 + パーシャル + `num` ヘルパー
- `references/Sample/brochure/` 参考資料の例（`source.yaml` に `forbidden_terms` を 1 語設定。ページ画像は SVG で代用）

画像はすべて SVG（バイナリ禁止）。レンダリング結果（`output/`, `reviews/`）は git 管理外です。
