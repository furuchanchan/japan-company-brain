# Postgres 17 に、意味の検索の部品（pgvector）と、日本語の2文字の語に効く索引の部品（pg_bigm）を入れる。
# pg_bigm は GitHub の公式 pgbigm/pg_bigm の決めた版をソースから組み立てる。
FROM pgvector/pgvector:pg17
ARG PG_BIGM_TAG=v1.2-20250903
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget build-essential postgresql-server-dev-17 \
 && wget -q -O /tmp/pg_bigm.tar.gz https://github.com/pgbigm/pg_bigm/archive/refs/tags/${PG_BIGM_TAG}.tar.gz \
 && mkdir /tmp/pg_bigm && tar xzf /tmp/pg_bigm.tar.gz -C /tmp/pg_bigm --strip-components=1 \
 && make -C /tmp/pg_bigm USE_PGXS=1 PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config \
 && make -C /tmp/pg_bigm USE_PGXS=1 PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config install \
 && rm -rf /tmp/pg_bigm /tmp/pg_bigm.tar.gz \
 && apt-get purge -y build-essential postgresql-server-dev-17 wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
