#!/bin/sh
# 通しの確かめ。まっさらな写しを作り、立てる → 見本 → 確かめを3回 → 書き出し → バックアップ → 消す → 復元 → 確かめ、まで回す。
# 今ある環境には触れない（別の名前と別のポートで立て、終わりに消す）。使い方: sh tools/selftest.sh
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
export BRAIN_UID="$(id -u)" BRAIN_GID="$(id -g)"
export COMPOSE_PROJECT_NAME=brainselftest BRAIN_PORT="${BRAIN_TEST_PORT:-3139}"
w="$(mktemp -d)"; a="$w/a"; b="$w/b"; mkdir -p "$a" "$b"
copy() { ( cd "$here" && git ls-files -co --exclude-standard | tar cf - -T - ) | tar xf - -C "$1"; }
clean() { ( cd "$a" && docker compose down -v >/dev/null 2>&1 || true ); rm -rf "$w"; }
trap clean EXIT
ok() { echo "合格：$1"; }
ng() { echo "不合格：$1"; exit 1; }
copy "$a"; cd "$a"
./brain up >/dev/null 2>&1 || ng "立てる"
./brain demo > demo.log 2>&1 || { tail -20 demo.log; ng "見本"; }
grep -q "違う所は 0 か所" demo.log && ok "見本の会社で、読める範囲が決めた形どおり" || ng "読める範囲"
grep -q "suzuki「値引きの承認は誰がしますか」→ 0件" demo.log && grep -q "sato「値引きの承認は誰がしますか」→ 2件" demo.log && ok "質問文の検索が、人によって変わる" || ng "質問文の検索"
grep -q "sato が書いた: 青空建設 値引きの決定" demo.log && grep -A1 "^tanaka「青空建設の値引きは" demo.log | grep -q "kettei/2026-11-aozora-nebiki" && ! grep -A2 "^suzuki「青空建設の値引きは" demo.log | grep -q "kettei/" && grep -q "partner-a: 書けない" demo.log && ok "AI が書き足した決定が、同じ部門には返り、人事には返らない。社外の鍵では書けない" || ng "書き足し"
for i in 1 2 3; do ./brain check | grep -q "違う所は 0 か所" || ng "確かめの繰り返し（$i 回目）"; done; ok "確かめを3回続けて回せる"
./brain check --html >/dev/null && grep -q "<table>" yomeru-hani.html && ok "表を HTML に書き出せる" || ng "HTML の書き出し"
[ "$(./brain log 1 | wc -l)" -gt 10 ] && ok "記録を CSV に書き出せる" || ng "記録の書き出し"
./brain connect sato >/dev/null
./brain backup >/dev/null 2>&1; f="$(ls "$a"/backup/*.tar.gz)"; cp "$f" "$w/b.tar.gz"
docker compose down -v >/dev/null 2>&1
copy "$b"; cd "$b"
./brain restore "$w/b.tar.gz" > restore.log 2>&1 || { tail -20 restore.log; ng "復元"; }
./brain check | grep -q "違う所は 0 か所" && ok "復元の後も、読める範囲と AI からの書き込みが元のとおり" || ng "復元の後の確かめ"
code="$(docker compose exec -T engine bun -e "const r=await fetch('http://127.0.0.1:3133/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+(await Bun.file('/srv/brain/keys/sato.token.txt').text()).trim()},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'selftest',version:'1'}}})});console.log(r.status)")"
[ "$code" = 200 ] && ok "復元の後も、渡してあった AI の鍵が使える" || ng "復元の後の鍵（HTTP $code）"
( cd "$b" && docker compose down -v >/dev/null 2>&1 )
echo "通しの確かめは全部合格。"
