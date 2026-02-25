#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "[nanobrain] Building TypeScript output..."
npm run build

echo "[nanobrain] Building Docker image..."
docker build -t nanobrain-agent:latest -f container/Dockerfile .

echo "[nanobrain] Done."
