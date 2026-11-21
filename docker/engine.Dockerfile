# エンジンは engine/ に入っている。gbrain（MIT License、Copyright (c) 2026 Garry Tan）の v0.60.736.0 を fork した物。
# 本家の新しい版を取り込む時は guide/engine.md の手順で engine/ を更新し、./brain demo の確かめを通す。
FROM oven/bun:1.4.4
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# 会社に今ある資料（Word・PDF）を Markdown に変える部品（markitdown、MIT License）。手元で動き、外へは送らない。
ARG MARKITDOWN_VERSION=0.1.7
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/henkan && /opt/henkan/bin/pip install --no-cache-dir "markitdown[docx,pdf,xlsx,pptx]==${MARKITDOWN_VERSION}"
COPY engine /opt/gbrain
WORKDIR /opt/gbrain
ENV GBRAIN_NO_AUTOPILOT_INSTALL=1 GBRAIN_HOME=/data/home
RUN bun install --frozen-lockfile
RUN printf '#!/bin/sh\nexec bun run /opt/gbrain/src/cli.ts "$@"\n' > /usr/local/bin/gbrain && chmod +x /usr/local/bin/gbrain
# root でない人の権限でも書けるように、データの置き場を先に作っておく
RUN mkdir -p /data/home /data/content && chmod -R 1777 /data
COPY kit /opt/brain/kit
COPY tools /opt/brain/tools
COPY docker/start.sh /opt/brain/start.sh
CMD ["sh", "/opt/brain/start.sh"]
