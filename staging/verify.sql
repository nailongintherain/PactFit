-- Read-only deployment verification for pactfit-staging SQL Editor.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','records','todos','tags','messages','rewards','spaces','space_members'] LOOP
    IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'Missing table/RLS: %', t;
    END IF;
    IF has_table_privilege('anon','public.'||t,'SELECT') OR has_table_privilege('anon','public.'||t,'INSERT') THEN
      RAISE EXCEPTION 'Unexpected anonymous access: %', t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated','public.profiles','INSERT') OR
     has_table_privilege('authenticated','public.todos','UPDATE') OR
     has_table_privilege('authenticated','public.rewards','INSERT') OR
     has_function_privilege('anon','public.rpc_create_space(text,text,numeric,numeric)','EXECUTE') OR
     NOT has_function_privilege('authenticated','public.rpc_create_space(text,text,numeric,numeric)','EXECUTE') OR
     NOT has_column_privilege('authenticated','public.records','weight','UPDATE') THEN
    RAISE EXCEPTION 'Client privilege matrix mismatch';
  END IF;
END $$;
SELECT 'PASS: business RLS and client grants' AS result;
