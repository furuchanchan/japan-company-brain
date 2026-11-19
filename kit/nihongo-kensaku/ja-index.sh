#!/bin/sh
# 日本語の言葉検索を速くする索引を、DB で使える部品に合わせて1つ選んで足す。本家のコードも、本家の表の形も変えない。
# 選ぶ順は pg_bigm → PGroonga → pg_trgm（2文字の語に効くのは前の2つ。pg_trgm は3文字以上の語にだけ効く）。
#
# 使い方（psql が使える所で。DB の URL は画面に出さない）:
#   DATABASE_URL=... sh ja-index.sh            … 下見。実行する SQL を出すだけ
#   DATABASE_URL=... sh ja-index.sh --yes      … 足す
#   DATABASE_URL=... sh ja-index.sh --remove   … この手順で足した索引を外す（下見。--yes を付けると外す）
#   JA_INDEX=pg_trgm を付けると、選ぶ部品を決め打ちにする
# 索引は CONCURRENTLY で作るので、作っている間も読み書きは止まらない。
set -eu
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL を指定してください"; exit 2; }
YES=0; REMOVE=0
for a in "$@"; do case "$a" in --yes) YES=1 ;; --remove) REMOVE=1 ;; *) echo "知らない指定: $a"; exit 2 ;; esac; done
q() { psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off -Atc "$1"; }
run() { echo "  $1"; if [ "$YES" = 1 ]; then q "$1" > /dev/null; fi; }

if [ "$REMOVE" = 1 ]; then
  echo "外す（$([ "$YES" = 1 ] && echo 実行 || echo 下見)）:"
  for n in idx_ja_chunks_bigm idx_ja_chunks_pgroonga idx_ja_chunks_trgm; do run "DROP INDEX CONCURRENTLY IF EXISTS $n"; done
  exit 0
fi

HAVE=$(q "select string_agg(name, ' ') from pg_available_extensions where name in ('pg_bigm','pgroonga','pg_trgm')")
KIND=${JA_INDEX:-}
if [ -z "$KIND" ]; then for k in pg_bigm pgroonga pg_trgm; do case " $HAVE " in *" $k "*) KIND=$k; break ;; esac; done; fi
case " $HAVE " in *" $KIND "*) ;; *) echo "この DB では ${KIND:-日本語向けの索引の部品} が使えません（使える部品: ${HAVE:-なし}）"; exit 1 ;; esac
case "$KIND" in
  pg_bigm)  NAME=idx_ja_chunks_bigm;     USING="gin (chunk_text gin_bigm_ops)" ;;
  pgroonga) NAME=idx_ja_chunks_pgroonga; USING="pgroonga (chunk_text)" ;;
  pg_trgm)  NAME=idx_ja_chunks_trgm;     USING="gin (chunk_text gin_trgm_ops)" ;;
  *) echo "JA_INDEX は pg_bigm・pgroonga・pg_trgm のどれか"; exit 2 ;;
esac
echo "使える部品: $HAVE → 選んだ部品: $KIND（$([ "$YES" = 1 ] && echo 実行 || echo 下見)）"
[ "$KIND" = pg_trgm ] && echo "  注意: pg_trgm は、2文字の語（条項・承認など）には効きません"
run "CREATE EXTENSION IF NOT EXISTS $KIND"
run "CREATE INDEX CONCURRENTLY IF NOT EXISTS $NAME ON content_chunks USING $USING"
run "ANALYZE content_chunks"
if [ "$YES" = 1 ]; then
  q "select '足した索引 ' || c.relname || ' ' || pg_size_pretty(pg_relation_size(c.oid)) || (case when i.indisvalid then '' else '（作りかけ。外して作り直す）' end) from pg_class c join pg_index i on i.indexrelid = c.oid where c.relname = '$NAME'"
else
  echo "このとおり足す時は --yes を付ける。"
fi
