# references — 参考資料

他校・他社のパンフレット・募集要項・チラシ等を集約する場所です（docs/concept.md §5）。
BOOK ごとに参考資料をコピーせず、各 BOOK の `references.yaml` から「どの資料を使うか」だけを指定します。

**参考資料はデザイン構造を学ぶためだけに使います。学校名・実績・数字・人物・企業名・ロゴ・学科名・インタビュー・写真・固有コピーは、自社の BOOK に一切持ち込みません。**
ルール: system/rules/references.md

現在は空です（実際の参考資料は Phase 3 で投入します）。

## 構成

```text
references/
└─ <source>/                 発行元（例: HAL、A-school、B-school）
   └─ <kind>/                資料の種別（例: brochure、admissions、flyers）
      ├─ source.yaml         出自・用途・禁止語（必須）
      ├─ page_001.png        ページ画像（3 桁連番 = 元資料のページ順）
      ├─ page_002.png
      ├─ …
      ├─ original/           元の PDF
      └─ analysis/           解析結果
         ├─ book.yaml        資料全体
         └─ page_NNN.yaml    ページ単位
```

## 取り込み

```bash
# PDF から（pdftoppm で page_NNN.png を作る。--dpi 既定 150）
npm run ref:ingest -- --source HAL --kind brochure --pdf ~/Downloads/hal-brochure.pdf

# スキャン画像・ページ画像のディレクトリから（page_NNN.<拡張子> に正規化）
npm run ref:ingest -- --source A-school --kind flyers --images ~/scans/a-school-flyer --dpi 150
```

- 元の PDF は `original/` にコピーされる
- `source.yaml` と `analysis/book.yaml` がなければ、テンプレート（`system/templates/reference/`）から作られる
- 取り込み後に表示される「次の手順」に従う

## 取り込み後に必ずやること

1. `source.yaml` の `forbidden_terms` を埋める（学校名・略称・英語名・学科名・固有コピー・人物名・企業名・URL など）。`<source>` のディレクトリ名（例: `HAL`）が他校名そのものなら、それも登録する。BOOK の `references.yaml` や生成記録の `source_refs` に書く `references/<source>/...` の形のパスは照合から除外されるので、登録しても参照の書き方には影響しない（system/rules/references.md §2）
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

参考画像はページの描画には使いません（`npm run compare` での比較と、目視の参考専用）。

## 注意

- 既存のページ画像・PDF は上書きしない（解析結果と `source.yaml` の追記は可）
- Phase 7 で保護機構を導入した後は READ ONLY になる予定（system/rules/protection.md。現在は未導入）
- 参考資料を含むため、リポジトリは非公開で運用する【要確認】
