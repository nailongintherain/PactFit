-- Only the new V2 local Docker database; NEVER apply on managed Supabase.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN NOINHERIT; END IF;
END $$;
GRANT anon,authenticated,service_role TO authenticator;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT CREATE,TEMPORARY,CONNECT ON DATABASE pactfit_v2 TO supabase_auth_admin;
GRANT USAGE,CREATE ON SCHEMA public,auth TO supabase_auth_admin;
GRANT CONNECT ON DATABASE pactfit_v2 TO authenticator,anon,authenticated,service_role;
