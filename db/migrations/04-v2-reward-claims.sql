-- V2-only anti-farming refinement. Additive; never removes earned gems/honors.
BEGIN;
CREATE TABLE IF NOT EXISTS v2_private.reward_claims(
 user_id uuid NOT NULL REFERENCES public.v2_people(user_id), rule text NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,rule)
);
ALTER TABLE v2_private.reward_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE v2_private.reward_claims FROM PUBLIC,anon,authenticated;
-- Existing achievements count as claimed; preserve their historical ledger rows unchanged.
INSERT INTO v2_private.reward_claims(user_id,rule)
 SELECT DISTINCT user_id,code FROM public.v2_awards ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION v2_private.award(p_user uuid,p_code text,p_title text,p_source text,p_space uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_name text; v_claim uuid;
BEGIN
 IF p_space IS NOT NULL THEN SELECT name INTO v_name FROM public.v2_spaces WHERE id=p_space; END IF;
 INSERT INTO public.v2_awards(user_id,code,title,source,space_id,team_name) VALUES(p_user,p_code,p_title,p_source,p_space,v_name) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN RETURN; END IF;
 -- Honors may be earned in multiple teams, but a badge rule pays gems once per account.
 INSERT INTO v2_private.reward_claims(user_id,rule) VALUES(p_user,p_code) ON CONFLICT DO NOTHING RETURNING user_id INTO v_claim;
 IF v_claim IS NOT NULL THEN PERFORM v2_private.reward(p_user,p_code,'award-code:'||p_code); END IF;
 PERFORM v2_private.notify(p_user,'badge','解锁成就：'||p_title,'',p_space);
 INSERT INTO public.v2_events(actor_id,space_id,kind,title,source) VALUES(p_user,p_space,CASE WHEN p_space IS NULL THEN 'personal_award' ELSE 'team_award' END,p_title,'award:'||v_id);
END $$;
REVOKE ALL ON FUNCTION v2_private.award(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
UPDATE public.v2_reward_rules SET label='Preview 首次团队全员打卡测试奖励（个人仅一次）' WHERE code='team_together';
INSERT INTO public.v2_migrations(version) VALUES('04-v2-reward-claims') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
