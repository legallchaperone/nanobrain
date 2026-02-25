FROM node:20-slim

RUN npm install -g opencode-ai@latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Runtime dependencies required by the memory MCP server.
RUN npm install --omit=dev @modelcontextprotocol/sdk better-sqlite3 zod

COPY dist/ /workspace/dist/
COPY container/opencode.json /workspace/opencode.json
COPY container/SYSTEM_PROMPT.md /workspace/SYSTEM_PROMPT.md

CMD ["opencode"]
