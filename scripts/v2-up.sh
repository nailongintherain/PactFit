#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env.v2 ]; then
 umask 077
 node - <<'JS' > .env.v2
const crypto=require('node:crypto');
for(const key of ['POSTGRES_PASSWORD','AUTHENTICATOR_PASSWORD','GOTRUE_DB_PASSWORD','JWT_SECRET'])console.log(key+'='+crypto.randomBytes(32).toString('hex'));
JS
fi
set -a; source .env.v2; set +a
cpv2(){ docker compose --env-file .env.v2 -f v2/compose.yaml -p pactfit-v2-preview "$@"; }
cpv2 up -d db mailpit
for attempt in {1..60}; do
 if cpv2 exec -T db pg_isready -h 127.0.0.1 -U postgres -d pactfit_v2 >/dev/null 2>&1; then break; fi
 sleep 1
 if [ "$attempt" = 60 ]; then echo 'V2 database did not become ready' >&2; exit 1; fi
done
cpv2 exec -T db psql -U postgres -d pactfit_v2 -v ON_ERROR_STOP=1 < v2/roles.sql >/dev/null
# Generated passwords are hex, never accepted from browser input or printed.
cpv2 exec -T db psql -U postgres -d pactfit_v2 -v ON_ERROR_STOP=1 >/dev/null <<SQL
ALTER ROLE authenticator PASSWORD '${AUTHENTICATOR_PASSWORD}';
ALTER ROLE supabase_auth_admin PASSWORD '${GOTRUE_DB_PASSWORD}';
SQL
cpv2 up -d gotrue
for attempt in {1..60}; do
 if curl -fsS http://127.0.0.1:19999/health >/dev/null 2>&1; then break; fi
 sleep 1
 if [ "$attempt" = 60 ]; then echo 'V2 Auth did not become ready; inspect docker compose logs' >&2; exit 1; fi
done
for migration in db/migrations/0[34]-v2-*.sql; do
 version="$(basename "$migration" .sql)"
 has_journal=$(cpv2 exec -T db psql -U postgres -d pactfit_v2 -Atc "SELECT to_regclass('public.v2_migrations') IS NOT NULL")
 if [ "$has_journal" = t ]; then
  applied=$(cpv2 exec -T db psql -U postgres -d pactfit_v2 -Atc "SELECT EXISTS(SELECT FROM public.v2_migrations WHERE version='$version')")
  if [ "$applied" = t ]; then continue; fi
 fi
 cpv2 exec -T db psql -U postgres -d pactfit_v2 -v ON_ERROR_STOP=1 < "$migration" >/dev/null
done
# Static assets contain no credentials; nginx workers must be able to read a restrictive checkout.
chmod a+rx web/v2
chmod a+r web/v2/*.html web/v2/*.js web/v2/*.css
cpv2 up -d postgrest web
printf 'V2 Preview: http://127.0.0.1:18899/v2/\nMailpit (local mail only): http://127.0.0.1:18025\n'
