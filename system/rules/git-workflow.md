# Git 運用

GitHub を唯一の正本とします（docs/concept.md §11）。「セッションを継続する」のではなく「GitHub を継続する」。
毎回、新しい PC・新しい Codex / Claude Code セッション・新しいコンテナから作業を始められることを前提にします。

## 1. 1 セッションの流れ

```text
GitHub 最新状態取得 → 新規コンテナ → AGENTS.md / CLAUDE.md 確認 → 対象 BOOK 確認
→ 作業 → render / test → commit → push → セッション終了
```

| 手順 | やること |
| --- | --- |
| 1. 最新状態取得 | `git fetch origin` → 作業ブランチを最新にする（`git pull --ff-only`）。新規 clone でもよい |
| 2. 環境準備 | `bash system/scripts/setup.sh`（Git LFS の取得・`npm ci`・Chromium 確認・`npm run doctor`）。Dev Container・Claude Code on the web では自動実行される |
| 3. ルール確認 | `AGENTS.md` → 作業に関係する `system/rules/*.md` → 使う `system/prompts/*.md` |
| 4. 対象確認 | `books/<id>/config/book.yaml`（`notes`）、各 `page.yaml`（`status` / `notes`）、`reviews/<pageId>/review.md` の「次にやること」 |
| 5. 作業 | ルールとプロンプトに従う。状態はファイルに書く |
| 6. 検証 | `npm run check`（型チェック・validate・テスト）、変更した BOOK の `npm run render` と目視 |
| 7. commit | 下記の規則で、作業単位ごとにコミット |
| 8. push | リモートに push。push できない場合は理由と未 push の内容を人間に伝える |
| 9. 終了 | 未完了の作業を `review.md` の「次にやること」や `notes` に書いてからコミット・push して終える |

## 2. ブランチ

- `main` に直接コミットしない。作業ごとにブランチを作り、プルリクエストでマージする
  - 例: `book/brochure-page-016`、`ref/hal-brochure`、`data/courses-update`、`system/render-fix`
- CI（`.github/workflows/ci.yml`）はプルリクエストと `main` への push で、`npm run doctor` → `npm run check` → フィクスチャのスモークレンダリングを実行する。CI が失敗しているブランチはマージしない
- エージェントがブランチを指定されている場合は、それに従う

## 3. コミット

- メッセージは日本語。先頭に種別を付ける

| 種別 | 用途 | 例 |
| --- | --- | --- |
| `feat` | 機能追加（system） | `feat: compare に overlay 出力を追加` |
| `fix` | 不具合修正 | `fix: 右綴じの左右判定を修正` |
| `book` | BOOK の制作・編集 | `book(brochure): page_016 をラウンド 2 の所見で修正` |
| `data` | company-data の変更 | `data: 学科情報を記入（出典: 2027 年度募集要項 原稿 p.4、担当者確認済み）` |
| `ref` | 参考資料の追加・解析 | `ref(HAL/brochure): 取り込みと forbidden_terms 登録` |
| `docs` | ルール・ドキュメント | `docs: 和文組版ルールに縦組みを追加` |
| `chore` | 設定・依存関係 | `chore: Playwright を更新` |

- 1 コミット = 1 つの意味のある変更。生成画像とその `.prompt.yaml`、ページとそのレビュー記録は同じコミットに入れる
- company-data を変更したコミットには出典を書く
- `status: approved` のページを変更したら理由を書く
- コミット前に `npm run check` を通す。通らない状態でコミットする場合は、理由をメッセージに書く

## 4. Git LFS（大容量ファイル）

参考資料・画像・PDF は Git LFS で管理します（docs/concept.md §12）。対象は `.gitattributes` で定義済みです。

```text
*.png *.jpg *.jpeg *.pdf *.webp *.tif *.tiff *.psd *.ai
```

- 新しい環境では `git lfs install --local` と `git lfs pull` が必要（`setup.sh` が実行する）
- コミット前に LFS で管理されているか確認する: `git lfs ls-files`（追加した画像が一覧にあること）
- 画像が「ポインタ（数行のテキスト）」のままだとレンダリング・比較が壊れる。`git lfs pull` を実行する
- `.gitattributes` にない形式のバイナリ（動画・独自形式など）を追加する前に、`.gitattributes` に LFS の設定を追加する
- フォント（`.woff` `.woff2` `.otf` `.ttf`）はバイナリ扱い。書体は `node_modules/@fontsource` から読むので、原則リポジトリに置かない
- 規模が大きくなった場合は、将来 `references/` だけを外部ストレージへ分離することを検討する（現時点では 1 モノレポ + Git LFS）

## 5. コミットしてよいもの・いけないもの

| コミットする | コミットしない |
| --- | --- |
| BOOK のソース（yaml / html / css / hbs）、背景画像と `.prompt.yaml` | `node_modules/`、`.cache/`、`.vite/`、ログ |
| 参考資料（画像・PDF・source.yaml・analysis） | 不採用の生成画像、作業用の一時ファイル |
| レビュー記録（`reviews/<pageId>/review.md`）と比較の数値（`compare-*/report.yaml`） | 比較画像（`compare-*/` の `side-by-side.png`・`overlay.png`・`diff.png`。参考ページの画素を含むため `.gitignore` 済み） |
| | ガイド付き・低解像度の確認用出力（`--out` で一時ディレクトリに出す） |
| 出力物（`output/png`、`output/pdf`） | 認証情報・API キー・個人情報を含むメモ |

`system/fixtures/**/output/` と `reviews/` はテストが毎回作るので `.gitignore` 済み。
比較画像は参考ページを縮小・合成した画像なので、BOOK の中に参考資料のコピーを残さない（docs/concept.md §5「BOOKごとに参考資料をコピーしない」）ためにコミットしません。
必要になったら、コミット済みの出力 PNG と参考ページから `npm run compare` で作り直せます。

## 6. 禁止事項

- `docs/concept.md` を編集する
- 履歴の書き換え（`git push --force`、`git rebase` で共有ブランチを書き換える）を人間の指示なしに行う
- 他人（他セッション）のブランチ・作業中のファイルを断りなく変更する
- 会話の中だけで作業を完了したことにする（commit / push まで行う）
