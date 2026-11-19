#!/bin/sh
# 初回だけ記憶を立て、エンジンの窓口（中だけ）と、日本語検索の中継（外への口）を動かす。
set -eu
export GBRAIN_HOME=/data/home
if [ ! -f /data/home/.gbrain/config.json ]; then
  echo "[brain] 初回の準備：記憶を立てます"
  mkdir -p /data/home /data/content/brain
  gbrain init --url "postgresql://brain:${BRAIN_DB_PASSWORD}@db:5432/brain?sslmode=disable" \
    --no-embedding --non-interactive --content-root /data/content/brain --search-mode conservative
  gbrain apply-migrations --yes --no-autopilot-install
  echo "[brain] 初回の準備が終わりました"
fi
gbrain serve --http --port 3131 --surface full ${BRAIN_PUBLIC_URL:+--public-url "$BRAIN_PUBLIC_URL"} &
S=$!
# 記録の書き方の決まり。会社で直した物（config/kakikata.md）があれば、そちらを配る
K=/opt/brain/kit/kakikata/kimari.md; [ -f /srv/brain/config/kakikata.md ] && K=/srv/brain/config/kakikata.md
bun /opt/brain/kit/nihongo-kensaku/chukei.ts --upstream http://127.0.0.1:3131 --listen 3133 --host 0.0.0.0 --annai "$K" &
C=$!
trap 'kill $S $C 2>/dev/null; exit 0' TERM INT
# どちらかが止まったら、入れ物ごと止めて立て直させる（片方だけ動いた状態を残さない）
while kill -0 $S 2>/dev/null && kill -0 $C 2>/dev/null; do sleep 2; done
echo "[brain] 窓口か中継が止まりました。立て直します"
kill $S $C 2>/dev/null || true
exit 1
