#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "[nanobrain] Building TypeScript output..."
npm run build

APT_MIRROR="${NANOBRAIN_APT_MIRROR:-deb.debian.org}"
echo "[nanobrain] Building Docker image..."
echo "[nanobrain] Using apt mirror: ${APT_MIRROR}"
docker build --build-arg APT_MIRROR="${APT_MIRROR}" -t nanobrain-agent:latest -f container/Dockerfile .

echo "[nanobrain] Done."
