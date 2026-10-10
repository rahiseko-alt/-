# 4 経路の共通環境（Docker なし）

2026-10-10 に人間が決定。利用者が Docker を起動・ビルドする手順は採用しない。

| 経路 | 作業環境 | 準備 |
| --- | --- | --- |
| この PC の Codex | WSL Ubuntu の Linux ファイルシステム | Linux 用 Node 22、Git / Git LFS、setup.sh |
| 別 PC の Codex | 同じ WSL Ubuntu の構成 | 同じ準備を再実行。PC 2 台は交互に使う |
| Codex Web / クラウド | サービスの提供環境 | リポジトリを接続し、環境準備で setup.sh を実行 |
| Claude Code Web / クラウド | サービスの提供環境 | リポジトリを接続。既存 SessionStart フックが setup.sh を実行 |

サービス内部のコンテナ管理は利用者が行う作業に含めない。画像生成はエージェントのツールで行い、生成結果と記録を GitHub に保存する。画像生成ツール自体を WSL に複製する必要はない。

## 共通にするもの

- ルール・引継ぎ: AGENTS.md → Codex / Claude Code の両ノート。自分のノートだけを更新。
- Node: .nvmrc の 22 系。今回の確認版は 22.23.3。Linux の `node` / `npm` を使い、Windows の `node.exe` や `npm.cmd` を WSL から呼ばない。
- npm 依存: package-lock.json のとおり `npm ci`。OS 別の node_modules を流用しない。
- 描画: package.json の Playwright 1.56.1 が使う指定版 headless shell、同梱 @fontsource の Noto Sans JP / Noto Serif JP。代替ブラウザを正式出力に使わない。
- PDF 処理: Linux の pdfinfo / pdftoppm。Git LFS の実体を取得する。
- 検証: doctor → check → 対象 BOOK の render → PNG 目視。すべての経路で同じ検査を行う。

## PC の初回準備

Ubuntu 24.04 の WSL と Linux 用 Node 22 を用意する。Node の導入方法は Linux のバージョン管理ツールなどを使い、`.nvmrc` に合わせる。この PC に導入済みの Node は `/opt/dtp-node22/bin`。

Linux ターミナルで:

```bash
node --version
command -v node
command -v npm
git lfs version
mkdir -p ~/work
git clone https://github.com/rahiseko-alt/DTP.git ~/work/DTP
cd ~/work/DTP
bash system/scripts/setup.sh
npm run check
```

private repository の clone / pull / push には、その環境で GitHub 認証が必要。Windows の認証が WSL へ自動で引き継がれると仮定しない。認証情報をノートやリポジトリに保存しない。

`setup.sh` は Node 自体をインストールしない。Git LFS がない場合は `sudo apt-get install git-lfs`、PDF 処理は `poppler-utils`、日本語のシステムフォントは `fonts-noto-cjk` を用意する。root / パスワードなし sudo の環境では setup.sh が不足する Poppler と Chromium の OS 依存を補う。

Codex が Windows 側のフォルダーを開いている場合、WSL の独立 checkout へ作業ファイルが自動同期されるわけではない。作業対象を Linux checkout に統一し、Windows 側から必要なら `\\wsl.localhost\Ubuntu\<Linux のパス>` で同じファイルを開く。コマンドは WSL の bash で実行する。並行する担当ごとに別ブランチ・別 checkout を使う。

## 日常の開始と終了

```bash
cd ~/work/DTP
git status --short --branch
git fetch origin
# 未保存変更を確認してから、既存の作業ブランチを最新にする
git pull --ff-only
bash system/scripts/setup.sh
npm run doctor
npm run check
npm run dev
```

ローカルに変更があれば上書きしない。main へ直接コミットしない。AGENTS.md の担当確認・引継ぎ手順に従い、終了時に自分のノートを更新して検証後に push する。別 PC ではそのブランチの最新を取得して再開する。

## Web / クラウドの準備

Codex はクラウド環境の準備で `bash system/scripts/setup.sh` を実行し、doctor / check を実行・確認してから保存する。Claude Code は既存の `.claude/settings.json` の SessionStart がリモート時に setup.sh を実行する。ただしフックは失敗してもセッションを止めないため、開始時に doctor の成功を必ず確認する。

パッケージ・ブラウザの取得先へ接続できなければ、エラーをノートに残して環境設定を直す。指定版の取得失敗を代替ブラウザの正式出力で隠さない。

## 検証の範囲

この PC の通常 checkout は WSL `/root/work/DTP` に準備済み。元の Git 履歴、GitHub の origin、作業ブランチと投稿者設定を保持し、fetch・LFS実体183件を確認した。WSLからの認証はこの checkout のローカル設定で Windows の Git Credential Manager を使用する。別PCへ認証設定・秘密情報をコピーしない。

この通常 checkout で doctor 全11項目・check 全353テスト（skip 0）・確認用PNG/PDF出力とPNG目視を確認済み。validate の既存警告28件、既存紙面の安全領域警告は残る。別 PC と両クラウドは、実際に検証するまで未確認として扱う。経路ごとのインストール結果・版・検証・未確認事項を各担当ノートに記録する。

過去の診断と Docker 障害の記録は [environment-audit.md](environment-audit.md)。Docker の復旧・導入は今後の完了条件から外す。
