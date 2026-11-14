#!/usr/bin/env bash
# 停止 PactFit 开发服务。保留数据卷（数据不丢失）；如需彻底清除数据请显式执行
#   docker compose down -v    （会删除数据库卷，谨慎使用）
set -uo pipefail
cd "$(dirname "$0")/.."
docker compose down
echo "已停止（数据卷保留）。"
