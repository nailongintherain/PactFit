-- PactFit 独立运行环境：基础角色初始化。
-- 由 PostgreSQL 官方镜像在首次初始化数据卷时自动执行（docker-entrypoint-initdb.d）。
-- 密码不在此文件中（避免硬编码进 Git）；scripts/dev-up.sh 会在启动后用 .env 中的值执行 ALTER ROLE。
-- 幂等：可重复执行。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN NOINHERIT;
  END IF;
END
$$;

-- PostgREST 的 authenticator 通过 SET ROLE 切换到 anon / authenticated / service_role
GRANT anon, authenticated, service_role TO authenticator;

-- auth schema：GoTrue 的首个迁移假设它已存在（GoTrue 自身不创建）
CREATE SCHEMA IF NOT EXISTS auth;

-- GoTrue（supabase_auth_admin）需要在启动时自动迁移 auth schema（建表、auth.uid() 等）；
-- 其 migrator 表（schema_migrations）建在 public schema，故还需 public 的 USAGE + CREATE
GRANT CREATE, TEMPORARY, CONNECT ON DATABASE pactfit_dev TO supabase_auth_admin;
GRANT USAGE, CREATE ON SCHEMA public TO supabase_auth_admin;
GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin;
GRANT CONNECT ON DATABASE pactfit_dev TO authenticator, anon, authenticated, service_role;
