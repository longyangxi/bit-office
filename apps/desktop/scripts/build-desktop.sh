#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SIDECAR="$SCRIPT_DIR/../src-tauri/sidecar"

echo "=== Building Open Office Desktop ==="

# 1. Build web static export
echo "[1/3] Building web..."
cd "$ROOT/web" && pnpm build

# 2. Build gateway bundle (standalone — all deps bundled for sidecar)
echo "[2/3] Building gateway (standalone)..."
cd "$ROOT/gateway" && BUNDLE_ALL=1 pnpm build

# 3. Prepare sidecar directory
echo "[3/3] Preparing sidecar..."
rm -rf "$SIDECAR"
mkdir -p "$SIDECAR"

# Copy Node.js binary
cp "$(command -v node)" "$SIDECAR/node"

# Copy gateway bundle
cp "$ROOT/gateway/dist/index.js" "$SIDECAR/gateway.js"
cp "$ROOT/gateway/dist/index.js.map" "$SIDECAR/gateway.js.map" 2>/dev/null || true

# Copy web static files for gateway's HTTP serving
cp -r "$ROOT/web/out" "$SIDECAR/web"

echo "=== Sidecar ready: $SIDECAR ==="
ls -lh "$SIDECAR/node" "$SIDECAR/gateway.js"
