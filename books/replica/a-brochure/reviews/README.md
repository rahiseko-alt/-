# reviews — レビュー記録と比較結果

- `<pageId>/review.md` … ページのレビュー記録（雛形: system/templates/review.md。ラウンドごとに追記）
- `<pageId>/compare-<YYYYMMDD-HHmmss>/` … `npm run compare` の出力（diff.png・side-by-side.png・overlay.png・report.yaml）
  - コミットするのは `report.yaml` だけ。比較画像は参考ページの画素を含むため `.gitignore` 済み（参考資料のコピーを BOOK に残さない）

手順と判定基準: system/rules/review.md
