# エンジンは gbrain（MIT License、Copyright (c) 2026 Garry Tan）。コードは変えず、確かめた版をそのまま取り込む。
# 版を上げる時は、下の2つを替えてから ./kioku demo の確かめを通す。
FROM oven/bun:1.4.4
ARG GBRAIN_TAG=v0.60.736.0
ARG GBRAIN_COMMIT=4d1628afb4b443f808e4c48c58bf951d90e6f691
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${GBRAIN_TAG} https://github.com/garrytan/gbrain.git /opt/gbrain \
 && test "$(git -C /opt/gbrain rev-parse HEAD)" = "${GBRAIN_COMMIT}"
WORKDIR /opt/gbrain
ENV GBRAIN_NO_AUTOPILOT_INSTALL=1 GBRAIN_HOME=/data/home
RUN bun install --frozen-lockfile
RUN printf '#!/bin/sh\nexec bun run /opt/gbrain/src/cli.ts "$@"\n' > /usr/local/bin/gbrain && chmod +x /usr/local/bin/gbrain
COPY kit /opt/kioku/kit
COPY tools /opt/kioku/tools
COPY docker/start.sh /opt/kioku/start.sh
CMD ["sh", "/opt/kioku/start.sh"]
