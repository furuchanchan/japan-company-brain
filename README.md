# Japan Company Brain

**社員それぞれの AI が会社で決まったことを共有する、会社の記憶です。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Engine: gbrain](https://img.shields.io/badge/engine-gbrain-blue?style=flat-square)](https://github.com/garrytan/gbrain)
[![selftest](https://img.shields.io/github/actions/workflow/status/furuchanchan/japan-company-brain/selftest.yml?style=flat-square&label=selftest)](https://github.com/furuchanchan/japan-company-brain/actions/workflows/selftest.yml)

[5分で試す](#5分で試す) · [自分の会社で使う](#自分の会社で使う) · [読める範囲](#読める範囲) · [サーバーに置く](guide/server.md) · [Issues](https://github.com/furuchanchan/japan-company-brain/issues)

社員が Claude Code などの AI を使い始めると、決まったことは決めた人の AI の中にしか残りません。隣の人の AI は、同じことをもう1度調べます。

Japan Company Brain は、AI が仕事の中で決まったことを書き足し、ほかの人の AI が日本語の質問で探せる置き場です。読める範囲は人ごとに変わり、資料は自分のサーバーから出ません。

> **営業の佐藤さん → 自分の AI**
> 青空建設の11月の見積は値引き8パーセントで、専務が承認した。残しておいて。
>
> **営業の田中さん → 自分の AI**
> 青空建設の値引きは何パーセントに決まりましたか。
>
> **田中さんの AI** は、佐藤さんの AI が書いた決定を見つけて答えます。
> **人事の鈴木さんの AI** には、この決定は返りません。

## できること

| | |
|---|---|
| **AI が書き足す** | 打ち合わせの決定を自分の AI に書かせると、同じ部門の人の AI がすぐに探せます |
| **日本語の質問で探す** | 「値引きの承認は誰がしますか」のような文のまま探せます |
| **人ごとに読める範囲が変わる** | 役員・部門・全社・社外の4段を、会社の形を書いた1つのファイルから入れます |
| **入れた権限を表で見る** | 1人ずつの鍵で実際に呼び、だれに何が返るかを1枚の表にします |
| **自分のサーバーで動く** | 資料・DB・鍵は立てたサーバーに残ります。外のサービスへは何も送りません |
| **記録とバックアップ** | だれの鍵がいつ何をしたかを CSV に出せます。1つのファイルから復元できます |

## 読める範囲

AI は、つないだ人の鍵で読める物だけを返します。読めない資料は「無い」と同じ答えになります。

| 段 | 読める物 | 書く先 |
|---|---|---|
| 役員 | 全社と全部門。役員だけのフォルダも読める | 全社 |
| 部門 | 自分の部門と全社。ほかの部門と役員だけのフォルダは読めない | 自分の部門 |
| 社外 | 全社のうち、名指ししたフォルダだけ | 書けない |

入れた結果は `./brain check --html` で1枚の表になります。情報システムや上長に見せる時に使えます。

![読める範囲の表。資料ごとに、役員・営業・人事・社外のだれが読めるかを●で示す](assets/yomeru-hani.png)

## 5分で試す

要る物は Docker だけです。

```bash
git clone https://github.com/furuchanchan/japan-company-brain.git
cd japan-company-brain
./brain up      # 立てる。初回は組み立てに数分かかります
./brain demo    # 見本の会社（6人・文書9件）を入れて動かす
```

`./brain demo` は、見本の会社で権限の表を出し、同じ質問を3人の鍵で投げ、営業の人の AI が書き足した決定をほかの人の鍵で探します。

## 自分の会社で使う

1. `./brain up` で立てます
2. `config/company.example.json` を `config/company.json` に写し、部門とメンバーを書きます（項目の説明は [権限のひな形](kit/kengen-4dan/README.md)）
3. `docs/` の下に置き場ごとのフォルダを作り、Markdown のファイルを入れます

   ```
   docs/zensha/   全社の資料（keiei/ は役員だけ、shagai/ は社外にも出す）
   docs/eigyo/    営業の資料
   docs/jinji/    人事の資料
   ```

4. 入れて、表で見ます

   ```bash
   ./brain apply --yes    # 会社の形を入れる（--yes を外すと下見）
   ./brain sync           # 資料を取り込む
   ./brain check          # 読める範囲の表を出す
   ```

5. 1人ずつ、AI をつなぐ鍵を作ります

   ```bash
   ./brain connect sato
   ```

   つなぐコマンドが表示されます。Claude Code なら次の形です。

   ```bash
   claude mcp add company-brain -t http http://127.0.0.1:3133/mcp -H "Authorization: Bearer <鍵>"
   ```

会社のみんなで使う時の置き方は [サーバーに置く](guide/server.md)、バックアップ・記録・人の出入りは [毎日の運用](guide/operations.md) にあります。コマンドの一覧は `./brain` で出ます。

## しくみ

```
各自の AI ──→ 日本語検索の中継 ──→ エンジン（gbrain）──→ Postgres
                質問文を語に分ける    鍵を確かめ、読める範囲で返す
```

エンジンは [gbrain](https://github.com/garrytan/gbrain)（MIT License）です。コードは変えず、バージョンを指定して取り込みます。この一式は、日本の会社で使う時に要る3つを周りに足しています。

| | gbrain をそのまま | この一式 |
|---|---|---|
| 日本語の質問文で探す | 文のままでは当たらない | 文のまま当たる |
| AI が書き足したページ | 書いた本人にしか返らない | 同じ部門と役員に返る |
| 権限を入れる | コマンドを順に実行する | 1つのファイルから入れ、表で見る |

細かい説明は [日本語検索の直し](kit/nihongo-kensaku/README.md)・[権限のひな形](kit/kengen-4dan/README.md)・[確かめた範囲と、まだの所](guide/tested.md) にあります。

## コントリビュート

使ってみて困った所や足りない所を [Issue](https://github.com/furuchanchan/japan-company-brain/issues/new/choose) に書いてもらえるのが、いちばん助かります。直しを送る時は [CONTRIBUTING.md](CONTRIBUTING.md) を見てください。

## セキュリティ

弱い所を見つけた時は、公開の Issue に書かず、[SECURITY.md](SECURITY.md) の手順で知らせてください。`.env`・`keys/`・`backup/` には鍵とパスワードが入るので、リポジトリに入れないでください。

## 作っている人

[Kotaro Furuno](https://github.com/furuchanchan)（株式会社TechWorker 代表）が作っています。自社でも gbrain を毎日使っています。

gbrain の作者・運営元とは関係のない第三者が作っています。

## ライセンス

[MIT License](LICENSE) です。利用している部品のライセンスは [THIRD_PARTY.md](THIRD_PARTY.md) にあります。
