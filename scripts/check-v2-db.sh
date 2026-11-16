#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="pactfit-v2-test-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
ready=false
for attempt in {1..40}; do
 if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
 sleep 1
done
if [ "$ready" != true ]; then docker logs "$container"; exit 1; fi
docker exec -i "$container" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 < backend/tests/v2/bootstrap.sql >/dev/null
docker exec -i "$container" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 < db/migrations/03-v2-preview.sql >/dev/null
docker exec -i "$container" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 < db/migrations/03-v2-preview.sql >/dev/null
for test_file in backend/tests/v2/*-db.sql; do
 docker exec -i "$container" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 < "$test_file"
done
python backend/tests/v2/concurrency.py "$container"
echo 'PASS V2 database: additive migration, policies and business tests'
