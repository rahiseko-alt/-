# publishing-studio — AI支援型DTP制作システム

AIビジネス専門学校のパンフレット・募集要項・チラシ・ポスター等（BOOK）を、継続的に制作・更新するためのモノレポです。

- 他校・他社の参考資料からレイアウトやデザイン構造を分析し、
- 背景・ビジュアルは AI 画像生成、構造は HTML/CSS/SVG、文字は自社の正本データからコードで配置し、
- PNG / PDF として出力します。一度作ったデザインは資産として、文章・数字・写真の差し替えで運用します。

| 文書 | 内容 |
| --- | --- |
| [docs/concept.md](docs/concept.md) | 構想（目的・基本方針・フェーズ・原則）。原本のため編集しません |
| [docs/architecture.md](docs/architecture.md) | 仕組み（データの流れ・形式・パス規約・ページの DOM・CLI・テスト） |
| [AGENTS.md](AGENTS.md) | AI エージェント（Codex / Claude Code）共通の作業指示 |
| [system/rules/](system/rules/README.md) | 制作ルール |
| [system/prompts/](system/prompts/README.md) | 作業用プロンプト |

**現在の状態**: Phase 1・3・4は完了。既存の完コピ検証12ページは3ラウンドずつ比較・修正済みで、64素材の生成が残っています。2026-10-09のユーザー指示により、別に[A4縦・24ページのネオン学校案内制作案](books/prospectus-neon-2027/README.md)を追加。添付2枚目を表紙に、他の支給アートを背景へ分散しています。学校の基本情報・学科・2027年度募集要項は正本記入済みで、教員・実績・授業詳細等には未確定項目が残ります。制作案の状態と次の作業は[制作レビュー](books/prospectus-neon-2027/reviews/production.md)を参照してください。

## しくみの概要

```text
company-data/（自社の正本）   references/（参考資料・解析）   shared/（共通部品・CSS・素材）
            \                         |                          /
             └──────────── books/<id>/（BOOK：設定・ページ・背景）─┘
                                      │
                     system/design-engine（ページ合成・厳格テンプレート）
                                      │
                 npm run dev（プレビュー）／ npm run render（PNG・PDF）
                                      │
                    npm run compare（参考ページとの比較）→ reviews/
```

ページは 3 層で作ります。

| 層 | 作り方 | 例 |
| --- | --- | --- |
| Layer 1 BASE VISUAL | AI 画像生成・写真 | 背景、光、質感、写真 |
| Layer 2 STRUCTURE | HTML / CSS / SVG | カード、枠、罫線、色面 |
| Layer 3 CONTENT | HTML（コード） | 見出し、本文、数字、URL、QR、ページ番号 |

## クイックスタート

必要なもの: Git、Git LFS、Node.js 22（`.nvmrc`）、poppler（`poppler-utils`: `pdfinfo` / `pdftoppm`。`npm run check` のテストと PDF の取り込みに必要。`setup.sh` が root またはパスワードなし sudo のとき自動で入れる）。Dev Container を使う場合は Docker と VS Code。

### A. Dev Container（推奨）

1. リポジトリを clone して VS Code で開く
2. コマンドパレット →「Dev Containers: Reopen in Container」
3. 作成時に `bash system/scripts/setup.sh` が自動実行され、最後に環境診断（`npm run doctor`）の結果が表示される
4. `npm run dev` → ブラウザで http://localhost:5173/

GitHub Codespaces でも同じ設定で動きます。詳細: [system/devcontainer/README.md](system/devcontainer/README.md)

### B. 手元の環境・Codex cloud・Claude Code on the web

```bash
git clone <リポジトリの URL>
cd <リポジトリ>
bash system/scripts/setup.sh     # Git LFS の取得、npm ci、Chromium の確認、poppler-utils、npm run doctor（何度実行しても安全）
npm run check                    # 型チェック・検証・テスト
```

- Codex cloud: 環境設定の「セットアップスクリプト」に `bash system/scripts/setup.sh` を登録（イメージに poppler がないため `setup.sh` が `apt-get` で `poppler-utils` を入れる）
- Claude Code on the web: `.claude/settings.json` の SessionStart フックが自動実行
- Linux で Chromium の共有ライブラリが足りない場合は `npx playwright install-deps chromium`（root 権限が必要）

## よく使う作業

### 新しい BOOK を作る

```bash
npm run new:book -- brochure --kind brochure --title "学校案内" --size A4 --pages 8
npm run new:page -- --book brochure --after page_004 --type course --title "学科紹介"
npm run dev        # http://localhost:5173/preview/brochure/page_001 （?guides=1 でガイド表示）
```

BOOK の構成と page.html の書き方: [books/README.md](books/README.md)

### 参考資料を取り込む

```bash
npm run ref:ingest -- --source HAL --kind brochure --pdf ~/Downloads/hal-brochure.pdf
```

取り込み後、`references/HAL/brochure/source.yaml` の `forbidden_terms`（他校名・固有コピーなど自社の紙面に出てはいけない語）を必ず埋めます。
詳細: [references/README.md](references/README.md)、[system/prompts/analyze-reference.md](system/prompts/analyze-reference.md)

### 出力する

```bash
npm run render -- --book brochure                                   # 全ページの PNG（350dpi）と PDF
npm run render -- --book brochure --page page_001 --format png      # 1 ページだけ PNG
npm run render -- --book brochure --page page_001 --format png --dpi 150 --guides --out /tmp/check   # 確認用
npm run render -- --book brochure --release                         # 入稿・公開用（TODO が残っていると失敗）
```

出力先: `books/<id>/output/png/<pageId>.png`、`books/<id>/output/pdf/<BOOK 名>.pdf`

### 参考ページと比較する

```bash
npm run compare -- --book brochure --page page_016
```

`books/brochure/references.yaml` の `page_016.layout_reference` の先頭画像と比較し、`books/brochure/reviews/page_016/compare-<日時>/` に差分画像（diff / side-by-side / overlay）と `report.yaml` を出力します（差分画像は参考ページの画素を含むためコミットしません。`.gitignore` 済み）。
完コピ検証は最低 2 ラウンド行います（[system/rules/review.md](system/rules/review.md)）。

### 検証する

GitHub Actions の CI は使いません。commit / push の前に、作業セッション内（ローカル / Dev Container / Claude Code / Codex）で `npm run doctor` → `npm run check` → 変更した BOOK の `npm run render` → 出力 PNG の目視を行います。

```bash
npm run validate              # データ形式、BOOK の整合性、テンプレート、直書きの事実、禁止語、生成記録
npm run validate -- --strict  # TODO の残りもエラーにする（入稿・公開前）
npm run check                 # typecheck → validate → test
npm run doctor                # 環境診断
```

### 自社情報を更新する

学校の情報は `company-data/` だけを編集します（BOOK には書き写しません）。変更後は `npm run validate` と、影響する BOOK の再出力で確認します。
詳細: [company-data/README.md](company-data/README.md)

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `company-data/` | 自社情報の唯一の正本（事実・ブランド・写真・コピー） |
| `references/` | 他校・他社の参考資料と解析結果 |
| `books/` | 制作する BOOK |
| `shared/` | 共通パーシャル・共通 CSS・再利用する生成ビジュアル |
| `system/rules/` `system/prompts/` `system/templates/` | ルール・作業プロンプト・雛形 |
| `system/scripts/` `system/design-engine/` | CLI とページ合成エンジン |
| `system/devcontainer/` `.devcontainer/` | 開発環境 |
| `system/fixtures/studio/` | テスト用のミニスタジオ |

## 制限事項

- **PDF は RGB です。** Chromium の PDF 出力は CMYK ではなく、PDF/X にも準拠していません。トンボ（トリムマーク）も付きません（ページサイズは仕上がり + 塗り足し）。
  **入稿用データへの変換（CMYK 変換・PDF/X 化・トンボ付与・特色）は本システムの範囲外**です。入稿形式は印刷会社に確認し、必要な変換は印刷会社または専用の DTP ソフトで行ってください。【要確認: 印刷会社の入稿規定】
- RGB から CMYK への変換で、鮮やかな色はくすみます。ブランドカラーは CMYK での見え方を印刷会社と確認してください。【要確認】
- 書体は同梱の Noto Sans JP（400/500/700/900）と Noto Serif JP（400/700）だけです。他の書体はライセンスを確認したうえで追加作業が必要です。
- 画像生成ツールは組み込んでいません。外部ツールで生成し、画像と生成記録（`.prompt.yaml`）をリポジトリに入れます。
- `npm run compare` は画素単位の比較です。デザインの良し悪しは、出力を画像として見る目視レビューで判断します。
- 保護機構（読み取り専用化・PreToolUse フック・Git 差分チェック）は Phase 7 で導入予定で、現在は未導入です（[system/rules/protection.md](system/rules/protection.md)）。
- 参考資料を含むため、リポジトリは非公開で運用してください。【要確認】
