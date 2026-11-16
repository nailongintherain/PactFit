#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --env-file .env.v2 -f v2/compose.yaml -p pactfit-v2-preview down
# Named volume retained; no --volumes, no contact with V1 project.
