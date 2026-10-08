# Layer 1 制作の着手・引き継ぎ

更新日: 2026-10-08。作業ブランチ: `codex/layer1-replica`。開始時のmain: `d2d377e`。取り込み済みmain: `4048897`。
専用ワークツリー: `/workspace/DTP-codex-layer1`。連絡は `docs/agent-coordination.md` と `docs/coordination/codex.md` に残す。

## 今回の担当

`books/replica/*/backgrounds/` の生成画像・生成記録・生成指示のstatus、画像配置に必要なページとBOOK固有部品の最小修正、出力と比較レビューを担当する。
`company-data/`、`system/`、`shared/` は変更しない。規則・スキーマ・検証の変更が必要ならPRに論点を書く。
共有ファイルは、Layer 1 完了時に指定された行だけを別の小さいコミットで更新する。

## 開始時の生成指示

| BOOK | 素材数 | 人物あり | 任意 |
| --- | ---: | ---: | ---: |
| a-brochure | 1 | 0 | 1 |
| a-course | 7 | 5 | 0 |
| b-course | 5 | 4 | 1 |
| b-data | 7 | 7 | 0 |
| b-flyer | 19 | 6 | 2 |
| b-living | 5 | 3 | 0 |
| b-web-it | 8 | 8 | 0 |
| c-course | 3 | 3 | 0 |
| c-flyer | 9 | 4 | 0 |
| 合計 | 64 | 40 | 4 |

開始時は全9 BOOKで `status: pending`。現在はa-brochure 1点・a-course 7点・b-course 5点・b-web-it 8点・b-data 7点、計28/64点を生成・配置し、5 BOOKのstatusをgeneratedにした。残り36点・4 BOOKはpending。
全64点の入力切り出しを作成済み。HTTPプレビューによる表示と追加比較を5 BOOKで確認し、各review.mdに制限を記録した。正式renderは未完了。
各素材は `layer1-orders.yaml` のprompt・mask・placementに従う。全件が揃う前にstatusをgeneratedへ変えない。

## 人物と学校向けデザインの扱い

人間が使用可とした40件はPhase 5の構成検証用。参考の実在人物には似せず、生成モデルへ渡す前に顔をぼかし、構図だけを参照する。
この許可は、自校の在校生像、教育内容、設備、学校向けデザインコンセプトが確定したことを意味しない。
学校名のAIから先端制作・デジタルアート・日本人の若者だけという想定を作らない。
自校版の制作は、原本資料の理解 → 対象読者・目的 → 編集企画・台割 → デザインコンセプト → ラフ → 必要な素材・原稿 → 組版・校正の順に行う。
以前作った汎用素材と学生生活の試作は別作業として保全した。このLayer 1 PRには混ぜない。

## Claudeとの分担・PR #10

PR #10はマージ済みでmain `4048897` を取り込んだ。company-dataへの独自の変更は行わない。
`a-admissions`、`b-living`、`b-flyer` の再出力は未完了。公式URLによるQRの差分は正常な更新としてレビューする。
写真IDのみの `class-card`、`lecturer-card`、`memo-card`、`dept-header`、`wrap-text` はBOOK固有部品に存在する。src引数の追加は担当範囲内で行える。
参考と枠の位置の差は、引き継ぎ記載とplacementを照合し、必要なページだけを最小修正する。

## 検証と外部の阻害要因

- 生成画像配置後のtypecheckとvalidateは成功（エラー0）。checkは237件成功・11件失敗・4件skip。失敗11件は指定Chromiumが未取得のため。doctorはOK 8・NG 3。正式renderは2 BOOKとも同じ理由で失敗。
- 5 BOOKはシステムChromium 151のHTTPプレビューでフォント・画像・配置を確認。compareはプレビューPNGを入力して実行し、正式render後の比較の代わりに数えない。
- 指定版Chromium build 1194は未取得。既に通信拒否を確認している。システムChromiumでの確認をdoctor・check・正式renderの完了とは扱わない。
- GitHub APIへの接続はプロキシがHTTP 403で拒否するため、ドラフトPRの作成は未完了。既存のGit認証で読み取りは成功している。
- 通信設定の下書きに、Chromium配布先と `api.github.com` を追加済み。下書き保存だけでは現在の接続は変わらない。設定の保存・公開後に再確認する。

## 次にやること

1. この進捗記録を先にpushし、GitHub APIが利用可能になったら同ブランチのドラフトPRを作る。
2. 残り4 BOOK・36点の入力マスク、生成・配置・プレビュー確認を進める。
3. 指定ブラウザの取得後、doctor → check → 変更BOOKのrender → 目視・compareを実施する。
4. 全生成・比較が完了してから、該当status、AGENTSの指定行とREADMEの指定段落を更新する。
5. マージ前にmainを取り込み、同じ必須検証を完了する。現在はマージできる完成状態ではない。
