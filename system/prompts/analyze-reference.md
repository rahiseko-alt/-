# 参考資料の解析（Phase 3〜4）

参考資料を取り込み、デザイン構造を分析してファイルに保存する。

## 入力

- `source`: 発行元の識別名（例: `HAL`）
- `kind`: 資料の種別（例: `brochure`）
- 元資料: PDF のパス、またはページ画像のディレクトリ（未取り込みの場合）
- 対象ページ: 全ページ / ページ番号の範囲（例: 1〜8、16）
- 目的（任意）: どの BOOK のどのページの参考にするか

## 前提ルール

- system/rules/references.md（流用禁止・forbidden_terms）
- system/rules/naming.md §5

## 手順

1. 取り込み（未取り込みの場合のみ）

   ```bash
   npm run ref:ingest -- --source <source> --kind <kind> --pdf <PDF のパス>
   # 画像の場合
   npm run ref:ingest -- --source <source> --kind <kind> --images <ディレクトリ>
   ```

   `references/<source>/<kind>/` に `page_NNN.png`・`original/`・`source.yaml`・`analysis/book.yaml` ができる。
2. `source.yaml` を埋める: `title`、`obtained`、`pages`、`notes`、そして **`forbidden_terms`**（学校名・略称・英語名・学科名・固有コピー・人物名・企業名・URL など。一般語は入れない）
3. `npm run validate` を実行し、forbidden_terms が既存の books / company-data / shared に出ていないか確認する（出ていたら報告する）
4. ページ画像を**画像として開いて**目視する（OCR・テキスト抽出だけで判断しない）。まず全ページを通して見て、ページタイプとリズムを把握する
5. 資料全体の解析を `analysis/book.yaml` に書く（グリッドの基本、色の役割、見出し体系、ページの並びとリズム）
6. 対象ページごとに `analysis/page_NNN.yaml` を書く。キーは `system/templates/reference/analysis.yaml` に従う:
   - `grid`（段数・基準線）、`margins`（上下・ノド・小口の mm 推定）、`gutter`
   - `photo_ratios`（写真の比率と面積比）、`heading_hierarchy`（見出しのレベル・相対サイズ・ウェイト）
   - `colors`（色の役割と面積比。16 進の推定値は参考として）、`rules`（罫線の太さ・用途）、`cards`
   - `density`（文字量・余白の多さ）、`page_type`、`eye_flow`（視線の順序）
   - `background`（背景表現の種類。Layer 1 で作るべきもの）、`image_crop`、`rhythm`（前後ページとの関係）
   - `notes`（再現時の注意。Layer 1/2/3 の切り分けの提案）
7. 寸法は「判型に対する比率」または「A4 換算の mm」で書き、どちらかを `notes` に明記する
8. 固有名詞や文章を解析結果に書き写さない（「（学校名）」「（キャッチコピー 2 行）」のように伏せる）

## 書き出すファイル

- `references/<source>/<kind>/source.yaml`（forbidden_terms を含む）
- `references/<source>/<kind>/analysis/book.yaml`
- `references/<source>/<kind>/analysis/page_NNN.yaml`（対象ページごと）
- 取り込んだ場合: `page_NNN.png`、`original/<ファイル>`

## チェックリスト

- [ ] すべての対象ページを画像として目視した
- [ ] `forbidden_terms` に固有の語を登録した（一般語は入れていない）
- [ ] 解析結果に参考資料の文章・固有名詞を書き写していない
- [ ] 各ページの解析に Layer 1 / 2 / 3 の切り分けの提案がある
- [ ] `npm run validate` がエラー 0
- [ ] `git lfs ls-files` に取り込んだ画像・PDF が含まれる
- [ ] コミット: `ref(<source>/<kind>): ...`、push 済み

## 完了報告

解析したページ、forbidden_terms の件数、再現に向いているページ（Phase 5 の候補）とその理由を報告する。
