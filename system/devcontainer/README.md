# 開発環境（Dev Container）

publishing-studio は「どの PC・どのセッション・どのコンテナからでも同じ手順で作業を再開できる」ことを前提にしています（docs/concept.md §11）。
環境の正本はこのディレクトリの `Dockerfile` と、どの環境でも共通に使う `system/scripts/setup.sh` です。

## 構成

| ファイル | 役割 |
| --- | --- |
| `.devcontainer/devcontainer.json` | VS Code / Codespaces 用の設定。このディレクトリの `Dockerfile` をビルドする |
| `system/devcontainer/Dockerfile` | `mcr.microsoft.com/playwright:v1.56.1-noble` をベースに、日本語フォント（Noto CJK）、`ja_JP.UTF-8`、`Asia/Tokyo`、Git LFS、poppler（`pdftoppm`）を追加 |
| `system/devcontainer/Dockerfile.dockerignore` | ビルドコンテキストを空にする（Dockerfile はリポジトリのファイルを使わない） |
| `system/scripts/setup.sh` | 冪等な初期化スクリプト。全環境共通 |
| `system/scripts/doctor.ts` | 環境診断（`npm run doctor`） |

イメージの内容:

- Node.js 22（ベースイメージ同梱。`.nvmrc` と同じ系列）
- Playwright 1.56.1 用の Chromium（`/ms-playwright` に同梱済み。追加ダウンロード不要）
- `fonts-noto-cjk` / `fonts-noto-cjk-extra`（システムの日本語フォント。紙面の描画自体は `@fontsource` の Web フォントを使う）
- `git-lfs`、`poppler-utils`、`locales`（`ja_JP.UTF-8`）、`tzdata`（`TZ=Asia/Tokyo`）
- 作業ユーザーは `pwuser`（UID/GID 1000、パスワードなし `sudo` 可）

> Playwright を更新するときは、`package.json` の `playwright` と `Dockerfile` の `FROM` タグを**必ず同時に**変更してください。
> ずれると同梱 Chromium のリビジョンが合わず、レンダリングできなくなります。

## VS Code で使う

1. Docker（Docker Desktop など）と VS Code 拡張「Dev Containers」を入れる
2. リポジトリを開き、コマンドパレットから「Dev Containers: Reopen in Container」を実行
3. 初回ビルド後、`postCreateCommand` で `bash system/scripts/setup.sh` が自動実行される
   （Git LFS の有効化と取得、`npm ci`、Chromium の起動確認、`npm run doctor`）
4. `npm run dev` でプレビューを起動すると、ポート 5173 が自動で転送される

Linux ホストでは、コンテナ内の `pwuser` の UID がホストのユーザーに合わせて再マップされます（`updateRemoteUserUID`）。
ホスト側の `node_modules`（macOS 用など）が残っていても、`setup.sh` が読み込めないことを検知して `npm ci` で入れ直します。

## GitHub Codespaces で使う

リポジトリの「Code」→「Codespaces」→「Create codespace」で作成すると、同じ `devcontainer.json` が使われます。
`setup.sh` は作成時に自動実行されます。プレビューは「ポート」タブの 5173 から開きます。

## Codex cloud / Claude Code on the web

これらはこの Dev Container を使わず、各サービスが用意するコンテナで動きます。
そのため環境構築は Dockerfile ではなく **`system/scripts/setup.sh`** で行います。

- **Codex cloud**: 環境設定の「セットアップスクリプト」に次を登録します。

  ```bash
  bash system/scripts/setup.sh
  ```

- **Claude Code on the web**: `.claude/settings.json` の SessionStart フックが、リモートセッション（`CLAUDE_CODE_REMOTE=true`）のときだけ
  `setup.sh --quiet` を自動実行します。フックの失敗でセッションが止まることはありません（`|| true`）。

`setup.sh` は Dockerfile と違い OS パッケージを必ずしも入れられません。root（またはパスワードなし sudo）のときだけ、次を入れます。

- `poppler-utils`（`pdfinfo` / `pdftoppm`）: `npm run check` のテスト（PDF の検証）と `npm run ref:ingest` の PDF 取り込みに必要。
  Codex cloud の標準イメージ（codex-universal）には入っていないため、`setup.sh` が `apt-get install` する
- Chromium の起動に必要な共有ライブラリが足りない場合の `playwright install-deps`

日本語のシステムフォント（`fonts-noto-cjk`）は入れません。紙面の描画には `node_modules/@fontsource` の Noto Sans JP / Noto Serif JP を使うため、
通常の文字はシステムフォントの有無で結果が変わりません。ただし Noto Sans JP / Noto Serif JP にない文字（ギリシャ文字・ローマ数字 Ⅰ〜Ⅹ・≒ など）は
システムフォントで代わりに描かれ、環境ごとに字形が変わります。`npm run render` が警告し（`--release` では失敗）、紙面では使わないルールです（system/rules/typography-ja.md §7）。

## 指定版の Chromium を取得できない環境

Playwright 指定版の Chromium（`npx playwright install chromium`）を通信制限などで取得できない環境では、手元の Chromium の実行ファイルを環境変数 `STUDIO_CHROMIUM_PATH` に指定すると `render` / `doctor` / `setup.sh` がそれを使います。

```bash
export STUDIO_CHROMIUM_PATH=/usr/bin/chromium
npm run doctor   # 「Chromium 起動」が WARN（指定版ではない）になる
```

- 版が違うと字形・行送りがわずかに変わることがあるため、`render` は警告を出し、`--release`（入稿・公開用）は失敗します。正式な出力は指定版で行います
- `render` は Chromium に `file://` を読ませない（127.0.0.1 の HTTP 配信）ので、`file://` を禁止したブラウザでも出力できます
- テスト（`npm run test`）は指定版の Chromium を前提にしています

## setup.sh の動作

何度実行しても安全です。各手順が失敗しても警告して続行し、最後の `npm run doctor` の結果を終了コードとして返します。

1. `git lfs install --local`、未取得の LFS ファイルがあれば `git lfs pull`（失敗は警告のみ）
2. `node_modules` がない／`package-lock.json` の方が新しい／依存を読み込めないときだけ `npm ci`
3. Playwright の Chromium が起動できなければ `npx playwright install chromium`
   （`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` のときはスキップ。環境変数 `STUDIO_CHROMIUM_PATH` があればその Chromium で起動を確認）
4. `pdfinfo` / `pdftoppm` がなければ `apt-get install poppler-utils`（root かパスワードなし sudo のときだけ）
5. `npm run doctor` で環境診断

```bash
bash system/scripts/setup.sh          # 進捗を表示
bash system/scripts/setup.sh --quiet  # 問題点と診断結果だけ表示（詳細ログは .cache/setup.log）
npm run doctor                        # 診断だけ実行
```

## doctor の確認項目

| 項目 | 致命的 | 内容 |
| --- | --- | --- |
| Node.js | はい | 22 以上 |
| playwright パッケージ | はい | `package.json` で固定したバージョンと一致 |
| @fontsource フォント | はい | Noto Sans JP（400/500/700/900）・Noto Serif JP（400/700）の CSS と woff2 |
| Chromium 起動 | はい | Playwright で Chromium を起動できる（`STUDIO_CHROMIUM_PATH` を指定したときはその Chromium。指定版でなければ WARN） |
| 日本語描画 | はい | `@fontsource` の CSS を 127.0.0.1 の HTTP 配信で読み込み（render と同じく `file://` を使わない）、`document.fonts.check` と実際の描画フォントで Noto を確認 |
| sharp | はい | 画像処理ライブラリが動く |
| システム日本語フォント | いいえ | `fc-list :lang=ja` の結果（参考情報。Noto Sans JP / Serif JP にない文字の代替にだけ使われる） |
| git-lfs / LFS 実体 | いいえ | git-lfs の有無、ポインタのままのファイル数 |
| poppler（pdfinfo / pdftoppm） | はい | `npm run check` のテスト（PDF の検証）と参考資料 PDF の取り込み（`npm run ref:ingest`）に必要 |

致命的な項目が NG のときだけ終了コード 1 になります。
