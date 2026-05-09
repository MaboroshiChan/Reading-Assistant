#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SURREAL_DATA_DIR="$PROJECT_ROOT/reading-app-server/data/surrealdb"
SURREAL_DATA_PATH="surrealkv://$SURREAL_DATA_DIR"

SURREAL_BIND="${SURREAL_BIND:-127.0.0.1:8000}"
SURREAL_USER="${SURREAL_USER:-root}"
SURREAL_PASS="${SURREAL_PASS:-root}"
SURREAL_NS="${SURREAL_NS:-Lumen}"
SURREAL_DB="${SURREAL_DB:-test}"

mkdir -p "$SURREAL_DATA_DIR"

echo "Starting SurrealDB with persistent storage"
echo "Bind: $SURREAL_BIND"
echo "Namespace: $SURREAL_NS"
echo "Database: $SURREAL_DB"
echo "Data path: $SURREAL_DATA_PATH"

exec surreal start \
  --bind "$SURREAL_BIND" \
  --user "$SURREAL_USER" \
  --pass "$SURREAL_PASS" \
  --default-namespace "$SURREAL_NS" \
  --default-database "$SURREAL_DB" \
  "$SURREAL_DATA_PATH"
