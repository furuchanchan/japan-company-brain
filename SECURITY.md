# セキュリティ

## 弱い所を見つけた時

公開の Issue・Pull Request・Discussion には書かず、[非公開の報告](https://github.com/furuchanchan/japan-company-brain/security/advisories/new)（GitHub の「Security」タブの「Report a vulnerability」）から知らせてください。

## 対象

対象になる物

- このリポジトリのコード（`brain`・`kit/`・`tools/`・`docker/`）
- このコードを自分のサーバーに立てた環境で、読める範囲の外の資料が読める・書ける問題

対象にならない物

- エンジン（gbrain）そのものの問題。[gbrain のリポジトリ](https://github.com/garrytan/gbrain/security/advisories/new) へ知らせてください
- Bun・PostgreSQL などの部品の問題。それぞれの配布元へ知らせてください
- 立てた環境の設定の誤り（口を外へ開いた、鍵やバックアップを人に渡した、など）
- 負荷をかけて止める試し

## 書いてほしいこと

- どのファイル・コマンド・呼び出しで起きるか
- 使った鍵の段（役員・部門・社外）と、会社の形（`config/company.json`）の要る所
- 起こす手順
- 読めた物・書けた物

## 受け取った後

- 受け取ったら返事をします
- 確かめた問題は直し、望まれない限り、直しの中で報告した人の名前を載せます
- 報奨金はありません

## この一式が守る範囲

- 読める範囲は、エンジンが鍵ごとに決めます。この一式は会社の形からその設定を入れ、1人ずつの鍵で実際に呼んで表にします
- 開く口は `127.0.0.1:3133` の1つです。資料・DB・鍵は立てたサーバーの外へ送りません

## 使う人が守る物

- `.env`・`keys/`・`backup/` には、パスワードと鍵が入ります。リポジトリに入れず、読める人を絞ってください
- 鍵は本人だけに渡してください。漏れた時は `./brain gbrain auth revoke <id>-ai` で取り消します
- 退職や異動の時は `./brain gbrain access member disable <id>` で、その人の鍵を止めます
