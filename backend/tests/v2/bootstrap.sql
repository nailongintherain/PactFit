-- Disposable test fixture only. Managed Supabase supplies these objects itself.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated;
-- Sentinel emulates a pre-existing V1 object; V2 must not alter its rows or grants.
CREATE TABLE public.records(id integer PRIMARY KEY, note text NOT NULL);
INSERT INTO public.records VALUES(1,'synthetic V1 sentinel');
