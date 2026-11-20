\set QUIET on
BEGIN;
CREATE FUNCTION pg_temp.assert(p boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',true);
SELECT public.v2_command('bootstrap');
SELECT public.v2_achievement_wall() AS wall_a \gset
SELECT pg_temp.assert((:'wall_a'::jsonb->>'total')::integer=84,'eighty-four catalog entries');
SELECT pg_temp.assert((SELECT bool_and(n=14) FROM (SELECT value->>'category' category,count(*) n FROM jsonb_array_elements(:'wall_a'::jsonb->'items') GROUP BY 1) q),'fourteen entries in every category');
SELECT pg_temp.assert((SELECT value->>'title'='神秘成就' AND value->>'rank'='hidden' AND value->>'trigger'='触发条件暂不公开' FROM jsonb_array_elements(:'wall_a'::jsonb->'items') WHERE value->>'code'='night_checkin'),'locked hidden achievement redacts identity and rank');
SELECT pg_temp.assert((SELECT value->>'trigger'='累计完成 3 天个人打卡' FROM jsonb_array_elements(:'wall_a'::jsonb->'items') WHERE value->>'code'='checkin_3'),'public trigger visible');
SELECT pg_temp.assert((SELECT value->>'earned'='true' FROM jsonb_array_elements(:'wall_a'::jsonb->'items') WHERE value->>'code'='hello_home'),'account start earned from server');
SELECT pg_temp.assert((SELECT value->>'available'='false' AND value->'progress'='null'::jsonb FROM jsonb_array_elements(:'wall_a'::jsonb->'items') WHERE value->>'code'='buddy_pair'),'private space does not expose team progress');
RESET ROLE;
SELECT pg_temp.assert((SELECT jsonb_object_agg(rank,n)='{"epic": 14, "rare": 22, "starter": 18, "advanced": 24, "legendary": 6}'::jsonb FROM (SELECT rank,count(*) n FROM public.v2_achievement_catalog GROUP BY rank) q),'approved tier distribution');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.v2_achievement_catalog; RAISE EXCEPTION 'UNEXPECTED_CATALOG_ACCESS'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT (public.v2_snapshot()->'space'->>'id') AS private_a \gset
SELECT public.v2_command('checkin',jsonb_build_object('space_id',:'private_a','weight',null));
SELECT public.v2_achievement_wall() AS wall_after_checkin \gset
SELECT pg_temp.assert((SELECT value->>'earned'='true' FROM jsonb_array_elements(:'wall_after_checkin'::jsonb->'items') WHERE value->>'code'='first_checkin'),'first checkin earned');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=2,'new catalog awards add no unapproved gems');
SELECT (public.v2_command('create_space','{"name":"成就测试队"}')->'data'->>'space_id') AS team \gset
SELECT (public.v2_snapshot(:'team')->'space'->>'code') AS team_code \gset
SELECT public.v2_achievement_wall(:'team');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',true);
SELECT public.v2_command('bootstrap');
SELECT public.v2_command('apply',jsonb_build_object('code',:'team_code'));
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',true);
SELECT (public.v2_snapshot()->'requests'->0->>'id') AS join_request \gset
SELECT public.v2_command('respond',jsonb_build_object('request_id',:'join_request','accept',true));
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',true);
SELECT public.v2_achievement_wall(:'team') AS wall_team \gset
SELECT pg_temp.assert((SELECT value->>'earned'='true' FROM jsonb_array_elements(:'wall_team'::jsonb->'items') WHERE value->>'code'='buddy_pair'),'team achievement earned for all active members');
SELECT pg_temp.assert(EXISTS(SELECT FROM jsonb_array_elements(public.v2_snapshot(:'team')->'team_awards') a WHERE a->>'code'='buddy_pair'),'team honor persisted');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=0,'team catalog honor has no implicit gem reward');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000023',true);
SELECT public.v2_command('bootstrap');
CREATE FUNCTION pg_temp.assert_wall_forbidden(p_space uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN PERFORM public.v2_achievement_wall(p_space); RAISE EXCEPTION 'UNEXPECTED_TEAM_WALL_ACCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_wall_forbidden(:'team');
ROLLBACK;
SELECT 'PASS achievements: 6x14 catalog, five tiers, redaction, real progress, team ownership, no implicit rewards' AS result;
