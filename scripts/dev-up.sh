#!/usr/bin/env bash
# PactFit 独立开发环境启动（幂等）。
# 用法：./scripts/dev-up.sh            # 默认项目名 pactfit-dev
#       COMPOSE_PROJECT_NAME=pactfit-selftest ./scripts/dev-up.sh   # 隔离项目名
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"

# ---------- 1. 环境变量：缺失则自动生成随机密钥 ----------
if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f .env.example ]; then echo "错误：缺少 .env.example" >&2; exit 1; fi
  gen_hex() { openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  gen_jwt() { openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  sed -e "s/__POSTGRES_PASSWORD__/$(gen_hex)/" \
      -e "s/__AUTHENTICATOR_PASSWORD__/$(gen_hex)/" \
      -e "s/__GOTRUE_DB_PASSWORD__/$(gen_hex)/" \
      -e "s/__JWT_SECRET__/$(gen_jwt)/" \
      .env.example > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "已生成 .env（含随机密钥；提交前请确认其被 .gitignore 排除）"
fi
set -a; source "$ENV_FILE"; set +a
DB="${POSTGRES_DB:-pactfit_dev}"
GT_PORT="${GOTRUE_PORT:-9999}"
CP="docker compose"

echo "[1/5] 启动 PostgreSQL 并等待就绪..."
$CP up -d db
for i in $(seq 1 60); do
  $CP exec -T db pg_isready -U postgres -d "$DB" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "错误：PostgreSQL 未就绪" >&2; exit 1; }
  sleep 1
done

echo "[2/5] 注入角色密码（来自 .env，不写入 SQL 文件）..."
$CP exec -T db psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE authenticator PASSWORD '${AUTHENTICATOR_PASSWORD}';
ALTER ROLE supabase_auth_admin PASSWORD '${GOTRUE_DB_PASSWORD}';
SQL

echo "[3/5] 启动 GoTrue（首次启动自动迁移 auth schema）..."
$CP up -d gotrue
for i in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:${GT_PORT}/health" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "错误：GoTrue 未就绪，最近日志：" >&2; $CP logs --tail 30 gotrue >&2; exit 1; }
  sleep 1
done

echo "[4/5] 应用业务 schema（仅空库；已存在则跳过）..."
EXIST=$($CP exec -T db psql -U postgres -d "$DB" -Atc "SELECT to_regclass('public.spaces') IS NOT NULL")
if [ "$EXIST" = "t" ]; then
  echo "  业务 schema 已存在，跳过 02-business.sql"
else
  $CP exec -T db psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q < db/migrations/02-business.sql
  echo "  业务 schema 已应用（表/RLS/RPC/GRANT）"
fi

echo "[5/5] 启动 PostgREST / Mailpit / 前端..."
$CP up -d postgrest mailpit web

echo ""
bash "$(dirname "$0")/dev-check.sh"
echo ""
echo "前端：      http://127.0.0.1:${WEB_PORT:-8899}/?local=1"
echo "GoTrue：    http://127.0.0.1:${GT_PORT}/health"
echo "PostgREST： http://127.0.0.1:${POSTGREST_PORT:-3000}/"
echo "Mailpit：   http://127.0.0.1:${MAILPIT_PORT:-8025}"
