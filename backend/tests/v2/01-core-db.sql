\set QUIET on
BEGIN;
CREATE FUNCTION pg_temp.assert(p boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert((public.v2_command('bootstrap')->>'ok')::boolean,'bootstrap');
SELECT (public.v2_snapshot()->'space'->>'id') AS private_a, (public.v2_snapshot()->'me'->>'public_id') AS public_a \gset
SELECT public.v2_command('bootstrap');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'spaces')=1,'exactly one private space');
SELECT pg_temp.assert(:'public_a' LIKE 'PF-%' AND :'public_a'<>'00000000-0000-0000-0000-000000000001','public ID separate');
SELECT pg_temp.assert((public.v2_command('profile','{"nickname":"搭子一","avatar":"sun"}')->>'ok')::boolean,'profile edit one');
SELECT pg_temp.assert((public.v2_command('profile','{"nickname":"搭子二"}')->>'ok')::boolean,'profile edit two');
SELECT pg_temp.assert(public.v2_command('profile','{"nickname":"搭子三"}')->>'code'='nickname_rate_limit','nickname rolling limit');
SELECT pg_temp.assert((public.v2_command('profile','{"avatar":"moon"}')->>'ok')::boolean,'avatar-only does not consume name quota');
SELECT pg_temp.assert(public.v2_command('profile','{"nickname":"a"}')->>'code'='invalid_nickname','nickname validation');
SELECT pg_temp.assert((public.v2_command('goal','{"start_weight":70,"target_weight":60}')->>'ok')::boolean,'private goal');
SELECT (public.v2_command('create_space','{"name":"一起轻一点","description":"测试团队"}')->'data'->>'space_id') AS team \gset
SELECT pg_temp.assert(:'team' IS NOT NULL,'team created');
SELECT (public.v2_snapshot(:'team')->'space'->>'code') AS code \gset
SELECT set_config('test.team',:'team',true);
SELECT pg_temp.assert((public.v2_command('checkin',jsonb_build_object('space_id',:'team','weight',69.5,'mood','还不错','note','PRIVATE_NOTE_A'))->>'ok')::boolean,'health and checkin');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=2,'daily and first reward ledger');
SELECT pg_temp.assert((public.v2_command('checkin',jsonb_build_object('space_id',:'team','weight',69.5))->>'ok')::boolean,'edit checkin');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=2,'repeat checkin no reward');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT public.v2_command('bootstrap');
SELECT (public.v2_snapshot()->'me'->>'public_id') AS public_b \gset
DO $$ BEGIN
 BEGIN PERFORM public.v2_snapshot(current_setting('test.team')::uuid); RAISE EXCEPTION 'UNEXPECTED_ACCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert((public.v2_command('apply',jsonb_build_object('code',:'code'))->>'ok')::boolean,'application submitted');
SELECT pg_temp.assert(public.v2_command('apply',jsonb_build_object('code',:'code'))->>'code'='duplicate_or_rate_limited','duplicate application denied');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'spaces')=1,'pending application grants no membership');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT (public.v2_snapshot()->'requests'->0->>'id') AS request_b \gset
SELECT pg_temp.assert((public.v2_command('respond',jsonb_build_object('request_id',:'request_b','accept',true))->>'ok')::boolean,'captain approves');
SELECT pg_temp.assert(public.v2_command('respond',jsonb_build_object('request_id',:'request_b','accept',true))->>'code'='request_expired','no repeat approval');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert(public.v2_snapshot(:'team')->'space'->>'code' IS NULL,'member cannot see code');
SELECT pg_temp.assert((SELECT m->>'weight' IS NULL AND m->>'goal' IS NULL AND m->>'weights' IS NULL FROM jsonb_array_elements(public.v2_snapshot(:'team')->'members')m WHERE m->>'user_id'='00000000-0000-0000-0000-000000000001'),'default health privacy');
SELECT pg_temp.assert(position('PRIVATE_NOTE_A' IN public.v2_snapshot(:'team')::text)=0,'notes never shared');
SELECT pg_temp.assert((SELECT count(*) FROM public.v2_daily)=0,'RLS own records only');
SELECT pg_temp.assert(public.v2_command('reset_code',jsonb_build_object('space_id',:'team'))->>'code'='forbidden','member cannot reset code');
SELECT pg_temp.assert(public.v2_command('dissolve',jsonb_build_object('space_id',:'team','confirm','DISSOLVE'))->>'code'='forbidden','member cannot dissolve');
SELECT pg_temp.assert((public.v2_command('checkin',jsonb_build_object('space_id',:'team','weight',null,'mood','需要鼓励'))->>'ok')::boolean,'weight optional checkin');
SELECT pg_temp.assert(public.v2_snapshot()->'my_records'->0->>'weight' IS NULL,'no invented weight');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=3,'team award once');
SELECT pg_temp.assert(public.v2_command('add_task',jsonb_build_object('space_id',:'team','title','越权'))->>'code'='forbidden','captain-only task management');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT public.v2_command('sharing',jsonb_build_object('space_id',:'team','share_weight',true));
SELECT public.v2_command('code_permission',jsonb_build_object('space_id',:'team','allow',true));
SELECT public.v2_command('add_task',jsonb_build_object('space_id',:'team','title','散步十分钟'));
SELECT (public.v2_snapshot(:'team')->'tasks'->0->>'id') AS task \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert(public.v2_snapshot(:'team')->'space'->>'code'=:'code','member can copy when allowed');
SELECT pg_temp.assert((SELECT (m->>'weight')::numeric=69.5 AND m->>'goal' IS NULL FROM jsonb_array_elements(public.v2_snapshot(:'team')->'members')m WHERE m->>'user_id'='00000000-0000-0000-0000-000000000001'),'weight permission independent from goal');
SELECT pg_temp.assert(public.v2_snapshot(:'team')->'aggregate'='null'::jsonb,'small group aggregate suppressed');
SELECT public.v2_command('checkin',jsonb_build_object('space_id',:'team','done_tasks',jsonb_build_array(:'task')));
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=3,'no duplicate team reward after edit');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT public.v2_command('sharing',jsonb_build_object('space_id',:'team'));
SELECT public.v2_command('code_permission',jsonb_build_object('space_id',:'team','allow',false));
SELECT public.v2_command('reset_code',jsonb_build_object('space_id',:'team'));
SELECT pg_temp.assert(public.v2_snapshot(:'team')->'space'->>'code'<>:'code','code reset');
SELECT pg_temp.assert(public.v2_command('dissolve',jsonb_build_object('space_id',:'team'))->>'code'='confirmation_required','dissolve requires confirmation');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT public.v2_command('bootstrap');
SELECT (public.v2_snapshot()->'me'->>'public_id') AS public_c \gset
SELECT pg_temp.assert(public.v2_command('apply',jsonb_build_object('code',:'code'))->>'code'='invalid_code','old code invalid');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert((public.v2_command('invite',jsonb_build_object('space_id',:'team','public_id',:'public_c'))->>'ok')::boolean,'ID invite');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT (public.v2_snapshot()->'requests'->0->>'id') AS request_c \gset
SELECT pg_temp.assert((public.v2_command('respond',jsonb_build_object('request_id',:'request_c','accept',true))->>'ok')::boolean,'target accepts invitation');
SELECT pg_temp.assert(public.v2_command('checkin',jsonb_build_object('space_id',:'team','done_tasks',jsonb_build_array('00000000-0000-0000-0000-000000000099')))->>'code'='invalid_tasks','foreign tasks rejected');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert(public.v2_snapshot(:'team')->'space'->>'code' IS NULL,'code revoked on next request');
SELECT pg_temp.assert((SELECT m->>'weight' IS NULL FROM jsonb_array_elements(public.v2_snapshot(:'team')->'members')m WHERE m->>'user_id'='00000000-0000-0000-0000-000000000001'),'health revoked on next request');
SELECT pg_temp.assert((public.v2_command('remind',jsonb_build_object('space_id',:'team','user_id','00000000-0000-0000-0000-000000000003'))->>'ok')::boolean,'preset encouragement');
SELECT pg_temp.assert(public.v2_command('remind',jsonb_build_object('space_id',:'team','user_id','00000000-0000-0000-0000-000000000003'))->>'code'='duplicate_or_rate_limited','encouragement limited');
SELECT pg_temp.assert(public.v2_command('purchase','{"product":"space_slot","request_key":"10000000-0000-0000-0000-000000000001"}')->>'code'='product_not_configured','unpriced shop disabled server-side');
-- Three explicit authorizations are required even with three members.
SELECT public.v2_command('goal','{"start_weight":80,"target_weight":70}');
SELECT public.v2_command('sharing',jsonb_build_object('space_id',:'team','share_weight',true,'share_goal',true,'share_aggregate',true));
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT public.v2_command('sharing',jsonb_build_object('space_id',:'team','share_weight',true,'share_goal',true,'share_aggregate',true));
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT public.v2_command('goal','{"start_weight":90,"target_weight":80}');
SELECT public.v2_command('sharing',jsonb_build_object('space_id',:'team','share_weight',true,'share_goal',true,'share_aggregate',true));
SELECT pg_temp.assert((public.v2_snapshot(:'team')->'aggregate'->>'participants')::integer=3,'authorized aggregate');
SELECT public.v2_command('sharing',jsonb_build_object('space_id',:'team','share_weight',false,'share_goal',true,'share_aggregate',true));
SELECT pg_temp.assert(public.v2_snapshot(:'team')->'aggregate'='null'::jsonb,'aggregate revoked without weight permission');
-- Captain auto succession, archive, and personal honors preservation.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert((public.v2_command('leave',jsonb_build_object('space_id',:'team','confirm','LEAVE'))->>'ok')::boolean,'captain exits');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=3,'gems retained after leaving');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'awards')=2,'personal honors retained');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'my_records')=1,'personal health retained');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert(public.v2_snapshot(:'team')->'space'->>'captain_id'='00000000-0000-0000-0000-000000000002','earliest member inherits captain');
SELECT pg_temp.assert((public.v2_command('dissolve',jsonb_build_object('space_id',:'team','confirm','DISSOLVE'))->>'ok')::boolean,'new captain dissolves');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'spaces')=1,'archived space removed');
SELECT pg_temp.assert((public.v2_snapshot()->>'gems')::integer=3,'gems retained after dissolution');
SELECT pg_temp.assert((public.v2_command('erase_team_history',jsonb_build_object('space_id',:'team','confirm','DELETE_HISTORY'))->>'ok')::boolean,'independent history deletion');
SELECT pg_temp.assert(jsonb_array_length(public.v2_snapshot()->'personal_checkins')=1,'private checkin unaffected by deleting team history');
SELECT pg_temp.assert(public.v2_command('erase_health')->>'code'='confirmation_required','health erasure requires explicit confirmation');
DO $$ BEGIN
 BEGIN UPDATE public.v2_daily SET weight=50; RAISE EXCEPTION 'UNEXPECTED_WRITE'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM public.v2_spaces; RAISE EXCEPTION 'UNEXPECTED_SECRETS'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert(v2_private.visible_length('👩‍👩‍👧‍👦搭子')=3,'common visible Unicode characters');
SELECT pg_temp.assert((SELECT count(*) FROM public.v2_migrations)=2,'migration reapply idempotent');
ROLLBACK;
SELECT 'PASS core: membership/privacy/approvals/captain/optional-weight/rewards/history/RLS' AS result;
