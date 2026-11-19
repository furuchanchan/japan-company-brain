# 利用している部品とライセンス

このリポジトリに入っているコード（`brain`・`kit/`・`tools/`・`docker/`・`sample/`）は MIT License です（[LICENSE](LICENSE)）。

`./brain up` を実行すると、次の部品をそれぞれの配布元から取り込んで Docker のイメージを組み立てます。
このリポジトリには、これらの部品のコードは入っていません。部品のコードは変えていません。

| 部品 | 役目 | バージョン | ライセンス | 配布元 |
|---|---|---|---|---|
| gbrain | エンジン（記憶・検索・権限・窓口） | v0.60.736.0（コミット 4d1628af） | MIT License。Copyright (c) 2026 Garry Tan | https://github.com/garrytan/gbrain |
| Bun | エンジンと道具を動かす実行環境 | 1.4.4 | MIT License。静的に含む JavaScriptCore は LGPL-2 | https://github.com/oven-sh/bun |
| PostgreSQL | DB | 17 | PostgreSQL License | https://www.postgresql.org/ |
| pgvector | 意味の検索の部品 | イメージ `pgvector/pgvector:pg17` に入っているバージョン | PostgreSQL License | https://github.com/pgvector/pgvector |
| pg_bigm | 日本語の索引の部品 | v1.2-20250903 | PostgreSQL License | https://github.com/pgbigm/pg_bigm |
| markitdown | Word・PDF・Excel・PowerPoint を Markdown に変える部品 | 0.1.7 | MIT License。Copyright (c) Microsoft Corporation | https://github.com/microsoft/markitdown |
| Python | markitdown を動かす実行環境 | イメージ `oven/bun:1.4.4`（Debian 13）の python3 | Python Software Foundation License | https://www.python.org/ |

## gbrain が取り込む部品

gbrain は組み立ての時に自分の部品（npm のパッケージ）を取り込みます。v0.60.736.0 の直下の268個を数えた結果です（2026-11-19）。

| ライセンス | 数 |
|---|---|
| MIT | 139 |
| Apache-2.0 | 112 |
| ISC | 8 |
| BSD-3-Clause・BSD-2-Clause | 4 |
| そのほか（0BSD・Unlicense・Python-2.0・AFL-2.1 OR BSD-3-Clause） | 4 |
| LGPL-3.0 | 1（libheif-js 1.19.8。画像を読む部品） |

GPL と AGPL の部品は0個でした。入れ子の部品（部品が取り込む部品）は数えていません。

## markitdown が取り込む部品

markitdown は組み立ての時に自分の部品（Python のパッケージ）を取り込みます。入れた後の36個を数えた結果です（2026-11-19。markitdown 自身を含み、pip を除く）。

| ライセンス | 数 |
|---|---|
| MIT（MIT-0・MIT-CMU を含む） | 14（markitdown・pdfminer.six・pdfplumber・python-pptx・openpyxl・onnxruntime・Pillow など） |
| BSD（2-Clause・3-Clause） | 13（pandas・NumPy・lxml・mammoth・pypdfium2 など。NumPy と pypdfium2 は、中に含む部品のライセンスを併記） |
| Apache-2.0（BSD との選択を含む） | 6（magika・requests・flatbuffers・tzdata・cryptography・packaging） |
| Python Software Foundation License | 2（defusedxml・typing_extensions） |
| MPL-2.0 | 1（certifi。証明書の一覧。変換では使いません） |

GPL と AGPL の部品は0個でした。変換は手元で動き、外のサービスを呼びません（ネットワークを切った入れ物で確かめました）。

## 組み立てたイメージを配る時

このリポジトリを自分で組み立てて使うだけなら、上の表示で足ります。
組み立てたイメージを第三者に配る時は、入っている部品それぞれのライセンスの条件に従ってください。
LGPL の部品（Bun が含む JavaScriptCore、libheif-js）は、差し替えられる形で配ることとライセンスの文を付けることが条件です。

## 名前について

このリポジトリは gbrain の作者・運営元とは関係のない第三者が作っています。gbrain の名前とロゴはそれぞれの権利者のものです。
