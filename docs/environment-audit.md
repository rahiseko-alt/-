# 環境の棚卸し（2026-10-10）

## 運用の前提

利用者は一人。PC 2 台は交互に使用し、Codex と Claude Code は並行作業する。GitHub を正本とし、開始・終了の手順と担当確認は AGENTS.md、作業状況は担当別の 2 冊のノートに残す。

## 確認した環境と問題

Windows の直接実行では doctor は OK 10 / WARN 1 / NG 0。一方、check は typecheck・validate が合格しても、テストが 295 合格・25 失敗・33 skipped となった。主な失敗は Git for Windows がテスト用の `os.devNull` を開けないこと、シンボリックリンク作成の権限、POSIX と Windows のパス表記差。後片付けで一時ファイルを削除できない失敗もあった。

Windows の管理者権限や開発者モードを変更せず、既存の Linux 前提の検証をそのまま動かす経路を確認する。検査の削除・skip の追加・期待値の緩和は行っていない。Windows 直接実行の完全対応を実装したわけではない。

## Docker 起動障害

Docker Desktop 4.67.0 は `dockerInference` と `docker-secrets-engine/engine.sock` の古い通信用ファイルを処理できず停止していた。[同じ症状の報告](https://github.com/docker/desktop-feedback/issues/554)を参考に、停止後に両方の親フォルダーを退避して再生成した。factory reset、VM・volume・コンテナ・WSL ディストリビューションの削除は行っていない。

退避先はホストの `%LOCALAPPDATA%/Docker/run.dtp-backup-20261010`、`run.dtp-backup-20261010-2`、`%LOCALAPPDATA%/docker-secrets-engine.dtp-backup-20261010`。Docker API の応答（Engine 29.3.1）を確認した。制作用 Docker イメージの初回取得は時間がかかり、中断した。Docker 内の制作コマンドは未検証である。

既存 Dockerfile を利用する PowerShell の入口も試作したが、実コマンドの検証が完了していないため公開用のソースには含めない。

## WSL Ubuntu の検証

Ubuntu 24.04.4 LTS に Node 22.23.3（公式配布の SHA256 を照合）、Git LFS、Poppler、日本語フォント、Playwright 1.56.1 の指定版 Chromium と必要な OS ライブラリを準備した。共通の `system/scripts/setup.sh` を実行し、doctor は OK 11 / WARN 0 / NG 0。

Windows の現在の制作ファイルを独立コピーし、検証用 Git リポジトリを初期化した。これは GitHub の作業ブランチではないので、このコピーから push しない。元の Git 履歴の編集・置換は行っていない。作業場所はこの PC の WSL 内 `/root/dtp-workspaces/environment-audit.pxSr5F`、Node の場所は `/opt/dtp-node22/bin`。Windows の変更が自動同期されるフォルダーではない。

`npm run check` は typecheck 合格、validate エラー 0・警告 28、23 ファイル・353 テストすべて合格（skip 0）。紙面出力の最終結果は Codex ノートに記録する。再検証は WSL 内で:

```bash
export PATH=/opt/dtp-node22/bin:$PATH
cd /root/dtp-workspaces/environment-audit.pxSr5F
npm run doctor
npm run check
npm run render -- --book replica/a-brochure --format both --dpi 72 --out .cache/linux-smoke
```

## 残る作業

- Docker イメージのビルドと、Windows からの制作コマンド実行を検証する。
- 本番作業は通常の GitHub clone / 作業ブランチを使う。今回の診断コピーを制作の正本にしない。
- 別 PC・リモート Codex・リモート Claude Code で共通セットアップと検証が通るか確認する。この PC の結果を他の環境の合格とみなさない。
- Windows の直接実行も正式に対応する場合は、Git のテスト環境・シェルの引用・パス正規化・リンク権限を個別に設計して検証する。
