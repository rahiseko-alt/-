# references — 参考資料

他校・他社のパンフレット・募集要項・チラシ等を集約する場所です（docs/concept.md §5）。
BOOK ごとに参考資料をコピーせず、各 BOOK の `references.yaml` から「どの資料を使うか」だけを指定します。

**参考資料は、デザイン構造の分析と、Layer 1 画像生成の視覚リファレンス（参考ページ画像の直接入力。system/rules/image-generation.md §3）に使います。学校名・実績・数字・人物・企業名・ロゴ・学科名・インタビュー・写真・固有コピーは、自社の BOOK に一切持ち込みません。**
ルール: system/rules/references.md

Phase 3 で 3 校分（`HAL-nagoya/`・`nagoya-iryo-hisho-it/`・`kokusai-igaku-gijutsu/`）を投入済みです。各資料の内容・形式は `source.yaml` の `title`・`notes` を参照してください。

## 構成

```text
references/
└─ <source>/                 発行元（例: HAL、A-school、B-school）
   └─ <kind>/                資料の種別（例: brochure、admissions、flyers）
      ├─ source.yaml         出自・用途・禁止語（必須）
      ├─ page_001.jpg        ページ画像（3 桁連番 = 元資料のページ順）
      ├─ page_002.png
      ├─ …
      ├─ original/           元の PDF
      └─ analysis/           解析結果
         ├─ book.yaml        資料全体
         └─ page_NNN.yaml    ページ単位
```

## 取り込み

```bash
# PDF から（pdftoppm で page_NNN.jpg を作る。--dpi 既定 150。--format png で PNG。PNG は約 6 倍の容量で Git LFS の容量・転送量を圧迫する）
npm run ref:ingest -- --source HAL --kind brochure --pdf ~/Downloads/hal-brochure.pdf

# スキャン画像・ページ画像のディレクトリから（page_NNN.<拡張子> に正規化）
npm run ref:ingest -- --source A-school --kind flyers --images ~/scans/a-school-flyer --dpi 150
```

- 元の PDF は `original/` にコピーされる
- `source.yaml` と `analysis/book.yaml` がなければ、テンプレート（`system/templates/reference/`）から作られる
- 取り込み後に表示される「次の手順」に従う

## 取り込み後に必ずやること

1. `source.yaml` の `forbidden_terms` を埋める（学校名・略称・英語名・学科名・固有コピー・人物名・企業名・URL など）。`<source>` のディレクトリ名（例: `HAL`）が他校名そのものなら、それも登録する。BOOK の `references.yaml` や生成記録の `reference_inputs`（`path`）・`source_refs` に書く `references/<source>/...` の形のパスは照合から除外されるので（`notes` などの文章は照合される）、登録しても参照の書き方には影響しない（system/rules/references.md §2）
2. `npm run validate` を実行する（forbidden_terms が books / company-data / shared に出るとエラー）
3. 解析する（system/prompts/analyze-reference.md）。結果は `analysis/` に保存し、会話にだけ残さない
4. `git lfs ls-files` で画像・PDF が LFS 管理になっていることを確認してコミットする

## source.yaml

```yaml
source: HAL
title: "（資料の正式名称）"
kind: brochure
obtained: 2026-10-01
original: references/HAL/brochure/original/brochure.pdf
pages: 48
usage: reference-only
forbidden_terms:
  - "（学校名）"
  - "（固有のキャッチコピー）"
notes: "入手経路・見開きの扱いなど"
```

| キー | 必須 | 内容 |
| --- | --- | --- |
| `source` | 必須 | `<source>` と同じ |
| `title` | 必須 | 資料名 |
| `kind` | 必須 | `<kind>` と同じ |
| `obtained` | | 入手日 |
| `original` | | 元 PDF のパス（リポジトリルート相対） |
| `pages` | | ページ数 |
| `usage` | 必須 | `reference-only`（固定） |
| `forbidden_terms` | 必須 | 自社の BOOK・company-data・shared に出てはいけない語の一覧 |
| `notes` | | 補足 |

## BOOK からの参照

```yaml
# books/brochure/references.yaml
references:
  - references/HAL/brochure/
page_016:                                   # BOOK 側のページ ID
  layout_reference: [references/HAL/brochure/page_016.png]
  visual_reference: [references/A-school/brochure/page_031.png]
  information_reference: [references/B-school/brochure/page_008.png]
```

参考画像はそのままページの描画には使いません。`npm run compare` での比較、目視、画像生成の参照入力（image prompt・img2img など。system/rules/image-generation.md）に使います。

## 注意

- 既存のページ画像・PDF は上書きしない（解析結果と `source.yaml` の追記は可）
- Phase 7 で保護機構を導入した後は READ ONLY になる予定（system/rules/protection.md。現在は未導入）
- 参考資料を含むため、リポジトリは非公開で運用する【要確認】

## 解析済み資料と Phase 5 の候補（Phase 4 の結果）

全 14 資料・157 ページを解析済み（`analysis/book.yaml` と `analysis/page_NNN.yaml`）。各資料の候補の理由・優先順位は `book.yaml` の `phase5_candidates`（または `notes.phase5_candidates`）にある。

| 資料 | 第一候補 | 他の候補 |
| --- | --- | --- |
| `HAL-nagoya/brochure-1` | page_015（学科一覧表。ほぼ Layer 2/3） | page_018・016・008・002 |
| `HAL-nagoya/brochure-2` | page_001（学科の標準見開き。7 見開きで共通） | page_017・023・004 |
| `HAL-nagoya/admissions` | page_002（ラベル列＋本文、フロー） | page_004・006・007 |
| `nagoya-iryo-hisho-it/brochure-1` | page_016（写真＋情報ボックス＋授業カード） | page_010・013・022・003 |
| `nagoya-iryo-hisho-it/brochure-2` | page_001（大きな数字・地図・一覧） | page_003・007・005 |
| `nagoya-iryo-hisho-it/brochure-web-it` | page_003（職種の 2 軸図＋データカード。IT 系の見せ方として最も参考になる） | page_002・005・001 |
| `nagoya-iryo-hisho-it/admissions` | page_001（写真なしの表紙） | page_002・008 |
| `nagoya-iryo-hisho-it/guide-living` | page_002（カード構成） | page_003・001 |
| `nagoya-iryo-hisho-it/flyers` | page_002（基本的なチラシ構成） | page_003・001 |
| `kokusai-igaku-gijutsu/brochure` | page_006（学科・実習ページ。page_008 と色違い） | page_004・007・005・013 |
| `kokusai-igaku-gijutsu/admissions` | page_005（見開きの募集表） | page_001・008・013 |
| `kokusai-igaku-gijutsu/flyers` | page_002（同じモジュールの 4 段繰り返し） | page_001 |

`overview`（2 件）は資料一式の写真で、比較の対象ではない（構成と表紙の共通性の参考）。

Phase 5 の前に必要なこと（全資料共通）:

- ページ画像は印刷物の写真で、多くは**反時計回りに 90° 倒れた見開き**。比較の前に `prep/<name>.yaml`（回転・ページの四隅・縦横比）を書き、`npm run ref:prep` で正立・単ページ・台形補正する。`layout_reference` / `--reference` に指定ファイルを書けば `compare` が自動で補正する（補正画像は `.cache/ref-prep/` に作られ、コミットしない）
- 写真のゆがみ・照明むら・ノドの湾曲があるため、`mismatch_ratio` は高く出る。合否は位置・大きさの目視比較を主にする
- 撮影されていないページがある（各 `book.yaml` の `page_type` / `page_map` に記載）
- ライセンスキャラクター・他社ロゴ・実績バッジは、どの層でも再利用しない（各解析の `notes` に記載）

