-- psql-only synthetic smoke, rolled back; creates no auth.users rows.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT public.rpc_create_space('Synthetic A','her',70,60) AS created \gset
SELECT (:'created'::jsonb->>'code') AS space \gset
SELECT (:'created'::jsonb->>'ok')::boolean AS ok \gset
\if :ok
\else
  \quit 1
\endif
INSERT INTO public.records(owner_id,space_id,record_date,weight)
VALUES ('00000000-0000-0000-0000-000000000001',:'space',CURRENT_DATE,70);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT public.rpc_join_space(:'space','Synthetic B','him',80,70) AS joined \gset
SELECT (:'joined'::jsonb->>'ok')::boolean AS ok \gset
\if :ok
\else
  \quit 1
\endif
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles) <> 2 OR (SELECT count(*) FROM public.records) <> 1 THEN
    RAISE EXCEPTION 'Member sharing failed';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.profiles) OR EXISTS (SELECT FROM public.records) THEN
    RAISE EXCEPTION 'Third-party isolation failed';
  END IF;
  BEGIN
    INSERT INTO public.records(owner_id,space_id,record_date,weight)
    VALUES ('00000000-0000-0000-0000-000000000001','FIT-FAKE01',CURRENT_DATE,99);
    RAISE EXCEPTION 'Spoofed ownership accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
