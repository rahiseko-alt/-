# 参考資料（references）のルール

他校・他社のパンフレット・募集要項・チラシ等は `references/` にだけ置きます（docs/concept.md §5）。
参考資料は「デザイン構造を学ぶための資料」であり、Layer 1 の画像生成では視覚リファレンスとして直接入力してもかまいません（§4）。ただし内容（固有情報）を自社の BOOK に持ち込んではいけません。

## 1. 格納のしかた

```text
references/<source>/<kind>/
├─ source.yaml          出自・用途・禁止語（必須）
├─ page_001.jpg         ページ画像（3 桁連番。元資料のページ番号と一致させる）
├─ page_002.jpg
├─ ...
├─ original/            元の PDF
│  └─ <ファイル名>.pdf
├─ analysis/            解析結果（Phase 4）
└─ prep/                比較用の補正指定（Phase 5。npm run ref:prep）
   ├─ book.yaml         資料全体の解析
   └─ page_NNN.yaml     ページ単位の解析
```

- `<source>`: 発行元の識別名（例: `HAL`、`A-school`）。`<kind>`: 資料の種別（例: `brochure`、`admissions`、`flyers`）。命名は system/rules/naming.md
- 取り込みは `npm run ref:ingest` で行う（PDF からページ画像を作り、source.yaml と analysis/book.yaml の雛形を置く）
- PDF のページ画像は既定で JPEG（150dpi・品質 85）。PNG（`--format png`）は約 6 倍の容量になり、Git LFS の無料枠（容量・転送量 各 10 GiB／月）を圧迫するため、特別な理由がなければ使わない

```bash
npm run ref:ingest -- --source HAL --kind brochure --pdf ~/Downloads/hal-brochure.pdf
npm run ref:ingest -- --source A-school --kind flyers --images ~/scans/a-school-flyer --dpi 150
```

- BOOK ごとに参考資料をコピーしない。BOOK の `references.yaml` からパスで参照する
- PNG / JPG / PDF は Git LFS で管理される
- 参考資料を含むため、リポジトリは非公開で運用する【要確認: GitHub リポジトリの公開設定と、参考資料の社内利用範囲】

## 2. source.yaml

```yaml
source: HAL                     # <source> と同じ
title: "（資料の正式名称）"
kind: brochure                  # <kind> と同じ
obtained: 2026-10-01            # 入手日
original: references/HAL/brochure/original/brochure.pdf
pages: 48
usage: reference-only           # 固定値。制作参考以外に使わない
forbidden_terms:                # 自社の BOOK・company-data・shared に絶対に出てはいけない語
  - "（他校の学校名）"
  - "（他校の略称・英語名）"
  - "（固有のキャッチコピー）"
notes: "入手経路・利用上の注意"
```

テンプレート: `system/templates/reference/`。スキーマ: `system/design-engine/src/schemas/references.ts`。

### forbidden_terms（禁止語）

取り込み直後に必ず埋めます。`npm run validate` は、すべての参考資料の `forbidden_terms` が `books/`・`company-data/`・`shared/` のテキストファイルに現れるとエラーにします。

登録するもの:

- 学校名・法人名・略称・英語名・ロゴタイプの文字列
- 学科名・コース名（自社にない固有の名称）
- 固有のキャッチコピー・スローガン・見出しの言い回し
- 人物名（在校生・卒業生・教員・著名人）
- 企業名（就職先・提携先）、独自の制度名・イベント名
- URL・ドメイン・電話番号・住所の特徴的な部分

一般的な語（「学科」「就職」「オープンキャンパス」など）は登録しません（自社の BOOK で使えなくなるため）。

注意:

- 検査対象はテキストファイル全体です。`books/`・`company-data/`・`shared/` の README・コメント・`notes` にも参考資料の固有名を書かないでください
- BOOK の `references.yaml` や生成記録の `reference_inputs`（`path`）・`source_refs` は参考資料をパス（`references/<source>/...`）で参照します。`npm run validate` はこの形のパスを禁止語の照合から除外するため、`<source>` のディレクトリ名（例: `HAL`）を `forbidden_terms` に登録してもかまいません。パス以外の場所（コメント・`notes`・`reference_inputs` の `note`・本文）に書いた発行元名は検出されます

## 3. 流用してよいもの・いけないもの（Phase 8）

参考資料から**流用してはいけないもの**（docs/concept.md §9 Phase 8）:

1. 学校名
2. 実績
3. 数字
4. 人物
5. 企業名
6. ロゴ
7. 学科名
8. インタビュー
9. 写真
10. 固有コピー

**利用してよいもの**: レイアウト・情報設計・デザイン構造。具体的には、グリッド・余白・ガター・写真の比率と配置・見出し階層・罫線やカードの使い方・情報密度・ページタイプ・視線誘導・背景表現の方向性・画像のクロップの仕方・ページ間のリズム。
配色は「どの役割にどの程度の面積で色を使っているか」という関係性を学び、実際の色は自社のブランドカラー（`company-data/brand/colors/colors.yaml`）を使います。

## 4. 作業ごとの注意

### 解析（Phase 4）

- OCR やテキスト抽出だけで判断せず、ページ画像を実際に開いて目視する
- 結果は `analysis/book.yaml`・`analysis/page_NNN.yaml` に書く（キー: `grid` `margins` `gutter` `photo_ratios` `heading_hierarchy` `colors` `rules` `cards` `density` `page_type` `eye_flow` `background` `image_crop` `rhythm` `notes`）。会話にだけ残さない
- 解析結果に参考資料の文章を長く書き写さない。構造の説明に必要な場合でも、固有名詞は「（学校名）」のように伏せる

### 完コピ検証（Phase 5）

- 写真・スキャンの参考ページ（倒れた見開き・台形ゆがみ）は、`references/<source>/<kind>/prep/<name>.yaml`（回転・ページの四隅・縦横比）を書いて `npm run ref:prep` で正立・単ページ・台形補正した比較用画像を作る。`references.yaml` の `layout_reference` や `--reference` にこの指定ファイル（`.yaml`）を書けば、`compare` が自動で補正してから比較する（補正画像は `.cache/ref-prep/` に作られ、コミットしない）
- 再現するのはレイアウトと構造。**参考資料の文字をページに書き写さない。参考資料の写真・ロゴをそのまま貼らない・切り出さない**（Layer 1 の画像生成に参考ページ画像を入力するのは可。下の「画像生成」）
- 文字はダミー（同じ文字数・行数のダミーテキスト）か company-data の値で置き、サイズ・行送り・位置だけを合わせる
- 写真は参考資料から切り出さない。写真枠はプレースホルダ（`{{> photo-frame ratio="..."}}`）か、自社写真・生成画像で埋める
- 参考ページ画像は、比較（`npm run compare`）・目視・画像生成の参照入力に使ってよい。参考画像そのものをページに貼ること（`{{asset "references/..."}}`、`background.image: references/...`、`<img src="references/...">`、パーシャルの `src=`、CSS の `url()` など、書き方を問わない）は禁止。`npm run validate`（試し合成）と `npm run render` がエラーにする。背景が必要なら参考画像を入力して生成し、結果を `books/<id>/backgrounds/` に置く

### 画像生成

- 参考ページ画像を画像生成モデルへ直接入力してよい（image prompt、image reference、composition reference、style / visual reference、img2img 系の参照など）。構図・背景・質感・視覚密度を高精度に再現または参考にするため、必要に応じて参考画像そのものを視覚リファレンスとして使う
- 生成に任せるのは Layer 1 だけ。生成結果に参考資料の文字・数字・ロゴ・QR を焼き込まない（正確な文字は Layer 3 でコードが配置する）
- 入力した参考画像と方式は `.prompt.yaml` の `reference_inputs` に、入力せず見て参考にしたページは `source_refs` に記録する（system/rules/image-generation.md）

### 自社版への変換（Phase 8）

- 使う情報は `company-data/` だけ。足りない情報は TODO として company-data に追加し、人間に確認する
- 参考資料と同じ構成の言い回し（見出しの文面、コピーの言い換え）を作らない。コピーは自社の内容から書く
- 変換後に `npm run validate` で forbidden_terms がゼロであることを確認する

## 5. BOOK からの参照（references.yaml）

```yaml
references:
  - references/HAL/brochure/
  - references/A-school/brochure/
page_016:
  layout_reference: [references/HAL/brochure/page_016.png]        # レイアウト
  visual_reference: [references/A-school/brochure/page_031.png]   # 写真・ビジュアルの見せ方
  information_reference: [references/B-school/brochure/page_008.png]  # 情報の見せ方
```

- `page_016` は **BOOK 側のページ ID**、値のファイル名は **参考資料側のページ番号**
- `npm run compare` は `layout_reference` の先頭を既定の比較対象にする
- 参照先のファイルが存在しないと `npm run validate` がエラーにする

## 6. 削除・差し替え

- 参考資料を削除する場合は、その資料を参照している BOOK の `references.yaml` も同じコミットで直す
- 削除しても、その資料の `forbidden_terms` が不要になるとは限らない。他の資料の `source.yaml` に移すか、残す判断を人間に確認する
