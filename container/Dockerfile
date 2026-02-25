FROM node:20-slim

RUN npm install -g opencode-ai@latest

WORKDIR /workspace

# Runtime dependencies required by the memory MCP server.
RUN npm install --omit=dev @modelcontextprotocol/sdk better-sqlite3 zod

COPY dist/ /workspace/dist/
COPY container/opencode.json /workspace/opencode.json
COPY container/SYSTEM_PROMPT.md /workspace/SYSTEM_PROMPT.md

CMD ["opencode"]
