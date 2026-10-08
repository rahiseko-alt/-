# components — このBOOKだけで使うパーシャル

`<name>.hbs` を置くと、ページから `{{> book/<name>}}` で呼び出せます。
複数の BOOK で使う部品は `shared/components/` に置きます（shared/components/README.md）。

- 事実（学校名・数字・連絡先など）は直接書かず `{{facts...}}` を参照する、または引数で受け取る
- スタイルは BOOK の共通 CSS（book.yaml の `styles`）か、使うページの page.css に書く

## adm-arrow

流れ図の矢印（細い軸＋黒い三角の SVG。Layer 2）。引数なし。位置と大きさは使う側の CSS（pages/page_001/page.css の `.adm-flow__arrow`: 長さ 5mm・高さ 2.2mm、セルの左の罫から左へ 2.25mm）で決め、色は `currentColor`。

```hbs
<td>{{> book/adm-arrow}}…</td>
```
