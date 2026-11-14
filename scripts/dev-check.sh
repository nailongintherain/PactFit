#!/usr/bin/env bash
# PactFit 开发环境健康检查。全部通过退出码 0；任一失败退出码 1。
set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then echo "✗ 缺少 .env（先运行 scripts/dev-up.sh）"; exit 1; fi
set -a; source .env; set +a
DB="${POSTGRES_DB:-pactfit_dev}"
FAIL=0

check() { # name, cmd...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "✓ $name"; else echo "✗ $name"; FAIL=1; fi
}

check "PostgreSQL 容器运行且可查询" docker compose exec -T db pg_isready -U postgres -d "$DB"

CP_HEALTH=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${GOTRUE_PORT:-9999}/health" 2>/dev/null || echo 000)
if [ "$CP_HEALTH" = "200" ]; then echo "✓ GoTrue /health (200)"; else echo "✗ GoTrue /health ($CP_HEALTH)"; FAIL=1; fi

PGR=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${POSTGREST_PORT:-3000}/" 2>/dev/null || echo 000)
if [ "$PGR" = "200" ]; then echo "✓ PostgREST 根路径 (200)"; else echo "✗ PostgREST 根路径 ($PGR)"; FAIL=1; fi

MP=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${MAILPIT_PORT:-8025}/api/v1/messages" 2>/dev/null || echo 000)
if [ "$MP" = "200" ]; then echo "✓ Mailpit API (200)"; else echo "✗ Mailpit API ($MP)"; FAIL=1; fi

WEB=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT:-8899}/" 2>/dev/null || echo 000)
if [ "$WEB" = "200" ]; then echo "✓ 前端首页 (200)"; else echo "✗ 前端首页 ($WEB)"; FAIL=1; fi

ADAPTER=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT:-8899}/pactfit-local-api.js" 2>/dev/null || echo 000)
if [ "$ADAPTER" = "200" ]; then echo "✓ 本地认证适配层脚本可加载"; else echo "✗ 适配层脚本 ($ADAPTER)"; FAIL=1; fi

# 业务 schema 是否已应用
SCHEMA=$(docker compose exec -T db psql -U postgres -d "$DB" -Atc "SELECT to_regclass('public.spaces') IS NOT NULL AND to_regclass('public.todos') IS NOT NULL" 2>/dev/null || echo err)
if [ "$SCHEMA" = "t" ]; then echo "✓ 业务 schema（spaces/todos 等十表）已就位"; else echo "✗ 业务 schema 缺失（dev-up 应自动应用）"; FAIL=1; fi

# PostgREST 能探测 RPC（说明 authenticator 连接与角色就绪）
RPC=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${POSTGREST_PORT:-3000}/rpc/rpc_space_peek" \
  -H 'Content-Type: application/json' -d '{"p_code":"FIT-PROBE"}' 2>/dev/null || echo 000)
# 200（函数执行）/400/401/403（到达 PostgREST 被拒属预期）；000/404 才是故障
case "$RPC" in
  200|400|401|403) echo "✓ PostgREST RPC 路由可达 (HTTP $RPC)";;
  *) echo "✗ PostgREST RPC 路由 ($RPC)"; FAIL=1;;
esac

exit $FAIL
