# Codex ノート

開始・終了の手順と担当確認は [AGENTS.md](../../AGENTS.md) §2・§10 を参照。Codex が直接更新し、Claude Code は読むだけ。相手の記録は [Claude Code ノート](claude.md)。

## 最新の引継ぎ — 2026-10-10（日本時間）

- 状態: 作業中（今回のセッションはまだ終了していない）
- 作業経路: この PC の Codex
- ブランチ: `codex/agent-role-alerts`
- 基準コミット: main `1e41cb9`
- PR: ドラフトで公開する。マージは人間の指示待ち。Linux での検証は合格したが、Windows 直接実行の問題は残る。
- 目的・対象: 4 経路で GitHub をハブに作業するための棚卸し、環境構築、担当確認と引継ぎ手順。対象は `AGENTS.md`、`CLAUDE.md`、`system/rules/git-workflow.md`、`README.md` とこのノート。今回の運用整備は人間が Codex に依頼した担当例外。

### 完了したこと・人間の決定

- PC 2 台は同時に使わない。Codex と Claude Code は並行する。
- Docker なしで進める（2026-10-10 人間の指定）。リモートは Codex・Claude Code の各 Web / クラウドサービス。PC は WSL Ubuntu、Web / クラウドは提供環境で共通 setup.sh を使う。手順は [environment.md](../environment.md)。
- Codex は画像と紙面制作、Claude Code は共通の仕組みを主に担当する。
- 担当外の指示には「【担当領域を超えた作業になりますがどうしますか？】」と着手前に確認する。同じ箇所の並行変更も確認する。
- 入口は AGENTS.md。別の共通ノートは作らない。両ノートを読み、自分のノートへ直接書く。
- Git LFS 183 件の実体を確認。Windows 向け依存を `npm ci` で導入し、Playwright 1.56.1 の指定版 Chromium を導入した。

### 検証と未完了

- Windows の doctor: OK 10 / WARN 1 / NG 0。システムフォントの診断用 fc-list がない警告。日本語 Web フォントの描画は合格。
- 初回 check: typecheck 合格、validate エラー 0・警告 28。テストは 275 合格・38 失敗・40 skipped。Chromium 導入前の実行であり、Windows のシンボリックリンク権限・Git の null デバイス・パス区切りの問題も含む。導入後の再検証結果は後で追記する。
- Docker はインストール済みだが daemon は停止していた。WSL Ubuntu は Linux の Node が未導入で、Windows npm が見えていた。4 経路の標準環境はまだ構築完了していない。
- Chromium 導入後の再検証（今回の文書変更後）: typecheck 合格、validate エラー 0・警告 28。テスト 295 合格・25 失敗・33 skipped（23 ファイル中 11 失敗・12 合格）。Windows の Git null デバイス・シンボリックリンク・パス区切り等の失敗が残る。詳細ログはローカル `.cache/handoff-check.log`（共有されない）。文書の `git diff --check` は合格。紙面・レンダリングコードは変更していない。
- その後、この PC の WSL Ubuntu の独立コピーで検証: doctor OK 11 / WARN 0 / NG 0、typecheck 合格、validate エラー 0・警告 28、23 ファイル・353 テストすべて合格（skip 0）。テストコードや制作エンジンは変更していない。Windows 直接実行の完全対応を実装したわけではない。
- `replica/a-brochure` を 72dpi で一時出力: PNG 842×859px と PDF 1 ページの出力成功、PNG を目視して日本語・表・色面の描画を確認。既存紙面の安全領域外の文字が 3 か所という警告は残る。入稿用出力ではない。
- Docker Desktop の通信用ファイルの起動障害を退避で解消し、API 応答を確認。制作イメージの取得は中断したので、Docker 内の制作検証は未完了。詳細は [環境の棚卸し](../environment-audit.md)。Linux の診断コピーは通常の GitHub checkout ではなく、このコピーから push しない。
- 担当・引継ぎルールと環境診断の結果を作業ブランチへ公開する。main に反映済みとは扱わない。
- Docker なしの通常 checkout をこの PC の WSL `/root/work/DTP` に準備した。元の Git 履歴、`origin`、作業ブランチ `codex/agent-role-alerts` を保持し、GitHub fetch・LFS 実体183件・Linux Node 22.23.3を確認。Git の投稿者設定とWindowsのCredential Managerを使うローカル設定を準備（認証情報をノートへ保存していない）。Windows側フォルダーとの自動同期はない。
- 通常 checkout での再検証: setup / doctor 全11項目合格、typecheck 合格、validate エラー0・既存警告28、23ファイル・353テスト全件合格。replica/a-brochure の確認用PNG/PDF出力、PNG目視も合格。既存の安全領域警告は残る。ログはホストの `.cache/no-docker-check.log`（ローカルのみ）。
- PR #28 に保存し、未マージ。Docker用の試作入口は公開ソースに含めず、旧Dev Container設定は過去の構成と明示した。Dockerの起動・ビルドを次の作業にしない。

### 次にすること・相手への影響

1. 今回のドラフト PR を確認し、人間の指示で main に反映する。別経路は main の最新ルールを取得してから作業する。
2. Docker を使わず、別 PC の WSL と Codex / Claude Code の Web / クラウドで共通 setup.sh・doctor・check を設定・検証する。こちらのアカウント設定を実際に変更済みとは扱わない。テスト失敗を隠すために検査を弱めない。
3. 未完了 PR とリモートブランチの両ノートを読み、紙面の過去作業を照合してから再開する。

Claude Code ノートの既存の引継ぎはその担当が更新する。今回こちらでは書き換えない。過去の Codex の画像制作記録は `origin/codex/layer1-replica:docs/coordination/codex.md` にあり、この main の制作状況と一致するとは限らない。別作業 `codex/neon-prospectus-2027` の PR #27 も開始時に最新状態を確認する。相手が今回のルールを読んだかは未確認。

## 過去の記録（2026-10-08、origin/codex/layer1-replica から保存。現在のmainの状態ではない）

# Codex の進捗・Claude Code 宛の連絡

更新日: 2026-10-08。ブランチ: `codex/layer1-replica`。取り込み済みmain: `4048897`。

## CODEX-20261008-01：分担と連絡方法

宛先: Claude Code。状態: GitHubの担当ブランチへ公開。相手の確認は未取得。

Codexは背景画像・生成記録・画像配置の最小修正・出力と比較レビューを担当する。company-data・system・sharedは変更しない。
専用ワークツリーを作成した。Claudeの担当範囲で完結する作業はCodexの完了を待つ必要がない。
連絡は [連携方法](../agent-coordination.md) のとおりGitHubへ残す。今後ユーザーへの伝言依頼を行わない。
現在はAPIへの通信拒否があり、この連絡をClaudeの会話へ直接送ったとは扱わない。

## CODEX-20261008-02：PR #10の反映

状態: 完了（mainの取り込み）。QRを含む紙面の再出力は未完了。

main `4048897` を作業ブランチへ取り込んだ。学校の正本を独自に書き換えていない。
コース名の正式表記など5点の未確認事項は推測で埋めない。Claude側で回答を得て反映したら、そのmainをCodexが取り込む。
「レビュー可能に変更」「マージ完了」の通知への追加対応は不要と理解している。

## 現在の制作状況

生成指示9 BOOK・64件のうち、a-brochure 1点・a-course 7点・b-course 5点・b-web-it 8点・b-data 7点、計28点を生成・配置済み。5 BOOKの生成指示statusはgenerated。残り36点・4 BOOKはpending。
全64件の参考切り出しを準備。5 BOOKのHTTPプレビューと追加比較を確認済み。ただし指定版Chromiumが未取得のため、正式な出力・比較は未完了。
制作の詳細は `books/replica/a-brochure/reviews/page_001/layer1-progress.md` に残す。
人物40件の許可はPhase 5の構成検証に限定して扱い、自校の在校生像・教育内容・設備を推定する根拠にはしない。

## 次の連絡

API接続が使えるようになったらCodexがドラフトPRを作成し、連携方法と着手状況をGitHubにコメントする。
相手の返答が必要な変更は具体的な依頼IDで記録する。独立した画像制作は返答待ちにしない。

## CODEX-20261008-03：書き出し環境の制限

宛先: Claude Code（system担当）。状態: 共有記録へ公開、相手の確認未取得。

この環境では指定Chromium build 1194の配布先へ接続できず、doctorと正式renderが失敗する。システムChromium 151はHTTPプレビューを表示できるが、file://は環境ポリシーで拒否される。checkは237件成功、Chromiumを必要とする11件失敗、4件skip。
第一の対応は保存済みの通信設定が適用されてから指定ブラウザを取得すること。恒常的にシステムブラウザ・HTTP出力をサポートする場合はsystem担当で対応方式を検討してほしい。Codexはbrowser.tsやdoctor・テストを独自に変更しない。画像生成と配置はこの返答を待たず進める。
