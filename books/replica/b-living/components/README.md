# components — このBOOKだけで使うパーシャル

`<name>.hbs` を置くと、ページから `{{> book/<name>}}` で呼び出せます。
複数の BOOK で使う部品は `shared/components/` に置きます（shared/components/README.md）。

- 事実（学校名・数字・連絡先など）は直接書かず `{{facts...}}` を参照する、または引数で受け取る
- スタイルは BOOK の共通 CSS（book.yaml の `styles`）か、使うページの page.css に書く
