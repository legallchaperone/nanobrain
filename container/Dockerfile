FROM node:20-slim

RUN npm install -g opencode-ai@latest

ARG APT_MIRROR=deb.debian.org

RUN sed -i "s|http://deb.debian.org/debian|http://${APT_MIRROR}/debian|g; s|http://security.debian.org/debian-security|http://${APT_MIRROR}/debian-security|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=20 update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Runtime dependencies required by the memory MCP server.
RUN npm install --omit=dev @modelcontextprotocol/sdk better-sqlite3 zod

COPY dist/ /workspace/dist/
COPY container/opencode.json /workspace/opencode.json
COPY container/SYSTEM_PROMPT.md /workspace/SYSTEM_PROMPT.md

CMD ["opencode"]
