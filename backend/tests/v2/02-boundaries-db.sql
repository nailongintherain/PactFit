\set QUIET on
BEGIN;
CREATE FUNCTION pg_temp.assert(p boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
SELECT public.v2_command('bootstrap');
SELECT (public.v2_command('create_space','{"name":"边界测试团队"}')->'data'->>'space_id') AS team \gset
SELECT set_config('test.team',:'team',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
SELECT public.v2_command('bootstrap');
SELECT (public.v2_snapshot()->'me'->>'public_id') AS public_b \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
SELECT public.v2_command('invite',jsonb_build_object('space_id',:'team','public_id',:'public_b'));
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
SELECT (public.v2_snapshot()->'requests'->0->>'id') AS req \gset
SELECT pg_temp.assert((public.v2_command('respond',jsonb_build_object('request_id',:'req','accept',false))->>'ok')::boolean,'reject invitation');
SELECT pg_temp.assert(public.v2_command('respond',jsonb_build_object('request_id',:'req','accept',true))->>'code'='request_expired','rejected invitation cannot replay');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
SELECT public.v2_command('invite',jsonb_build_object('space_id',:'team','public_id',:'public_b'));
RESET ROLE;
UPDATE public.v2_requests SET expires_at=now()-interval '1 second' WHERE target_id='00000000-0000-0000-0000-000000000011' AND status='pending';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
SELECT (r->>'id') AS expired FROM jsonb_array_elements(public.v2_snapshot()->'requests') r WHERE r->>'status'='expired' \gset
SELECT pg_temp.assert(public.v2_command('respond',jsonb_build_object('request_id',:'expired','accept',true))->>'code'='request_expired','expired invitation rejected');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'spaces')=1,'rejection/expiry grants no access');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.assert((public.v2_command('invite',jsonb_build_object('space_id',:'team','public_id',:'public_b'))->>'ok')::boolean,'new invitation after expiry');
-- A user already in five public teams cannot join a sixth through an invite.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000013',true);
SELECT public.v2_command('bootstrap');
DO $$ DECLARE i integer; r jsonb; BEGIN FOR i IN 1..5 LOOP r:=public.v2_command('create_space',jsonb_build_object('name','额度测试'||i)); IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'quota fixture failed'; END IF; END LOOP; END $$;
SELECT (public.v2_snapshot()->'me'->>'public_id') AS full_id \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
SELECT public.v2_command('invite',jsonb_build_object('space_id',:'team','public_id',:'full_id'));
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000013',true);
SELECT (public.v2_snapshot()->'requests'->0->>'id') AS full_req \gset
SELECT pg_temp.assert(public.v2_command('respond',jsonb_build_object('request_id',:'full_req','accept',true))->>'code'='space_limit','combined join/create quota');
-- Personal data deletion removes goals too, but never removes earned rewards/checkins.
SELECT (public.v2_snapshot()->'space'->>'id') AS mine \gset
SELECT public.v2_command('goal','{"start_weight":80,"target_weight":70}');
SELECT public.v2_command('checkin',jsonb_build_object('space_id',:'mine','weight',79));
SELECT pg_temp.assert((public.v2_command('erase_health','{"confirm":"DELETE_HEALTH"}')->>'ok')::boolean,'own erasure');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'my_records')=0,'health erased');
SELECT pg_temp.assert(public.v2_snapshot()->'goal'='null'::jsonb,'goal erased');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=2 AND jsonb_array_length(public.v2_snapshot()->'personal_checkins')=1,'earned rewards and checkins retained');
SELECT set_config('test.private',:'mine',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
DO $$ BEGIN
 BEGIN PERFORM public.v2_snapshot(current_setting('test.private')::uuid); RAISE EXCEPTION 'UNEXPECTED_ACCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert((SELECT note FROM public.records WHERE id=1)='synthetic V1 sentinel','V1 rows untouched');
SELECT pg_temp.assert(has_table_privilege('authenticated','public.records','INSERT'),'V1 grants untouched');
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.v2_command('bootstrap'); RAISE EXCEPTION 'ANON_RPC_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.v2_snapshot(NULL); RAISE EXCEPTION 'ANON_SNAPSHOT_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'PASS expiry/rejection, combined quotas, private isolation, health erasure, anonymous denial, legacy preservation' AS result;
