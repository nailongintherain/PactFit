-- PactFit V2 Preview: additive, rerunnable, no legacy/auth data changes.
-- Apply ONLY to an isolated V2 database/project. Never auto-applied by V1 scripts.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS v2_private;
REVOKE ALL ON SCHEMA v2_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS public.v2_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.v2_people(
 user_id uuid PRIMARY KEY, public_id text NOT NULL UNIQUE DEFAULT ('PF-'||upper(encode(extensions.gen_random_bytes(5),'hex'))),
 nickname text NOT NULL DEFAULT '新的搭子', avatar text NOT NULL DEFAULT 'leaf', timezone text NOT NULL DEFAULT 'UTC',
 share_activity boolean NOT NULL DEFAULT false, preferences jsonb NOT NULL DEFAULT '{"encouragement":true,"achievements":true}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.v2_name_changes(user_id uuid NOT NULL REFERENCES public.v2_people(user_id), changed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.v2_goals(user_id uuid PRIMARY KEY REFERENCES public.v2_people(user_id), start_weight numeric(5,1) NOT NULL CHECK(start_weight BETWEEN 20 AND 400), target_weight numeric(5,1) NOT NULL CHECK(target_weight BETWEEN 20 AND 400 AND target_weight<start_weight));
CREATE TABLE IF NOT EXISTS public.v2_spaces(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN('private','team')), name text NOT NULL,
 description text NOT NULL DEFAULT '', avatar text NOT NULL DEFAULT 'leaf', owner_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 captain_id uuid NOT NULL REFERENCES public.v2_people(user_id), code text UNIQUE,
 members_can_copy boolean NOT NULL DEFAULT false, extra_seats integer NOT NULL DEFAULT 0 CHECK(extra_seats>=0),
 created_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 CHECK((kind='private' AND code IS NULL) OR kind='team')
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_one_private_space ON public.v2_spaces(owner_id) WHERE kind='private';
CREATE TABLE IF NOT EXISTS public.v2_members(
 space_id uuid NOT NULL REFERENCES public.v2_spaces(id), user_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, PRIMARY KEY(space_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.v2_sharing(
 space_id uuid NOT NULL, user_id uuid NOT NULL, share_weight boolean NOT NULL DEFAULT false,
 share_goal boolean NOT NULL DEFAULT false, share_aggregate boolean NOT NULL DEFAULT false,
 PRIMARY KEY(space_id,user_id), FOREIGN KEY(space_id,user_id) REFERENCES public.v2_members(space_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.v2_daily(
 user_id uuid NOT NULL REFERENCES public.v2_people(user_id), day date NOT NULL, weight numeric(5,1) CHECK(weight BETWEEN 20 AND 400),
 mood text CHECK(mood IN('很开心','还不错','有点累','需要鼓励')), note text NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,day)
);
CREATE TABLE IF NOT EXISTS public.v2_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.v2_spaces(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 80), created_by uuid NOT NULL REFERENCES public.v2_people(user_id),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.v2_checkins(
 space_id uuid NOT NULL, user_id uuid NOT NULL, day date NOT NULL, done_tasks jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(done_tasks)='array'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(space_id,user_id,day),
 FOREIGN KEY(space_id,user_id) REFERENCES public.v2_members(space_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.v2_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES public.v2_spaces(id),
 target_id uuid NOT NULL REFERENCES public.v2_people(user_id), sender_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 kind text NOT NULL CHECK(kind IN('application','invitation')), status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','rejected','expired','cancelled')),
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '7 days'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_one_pending_request ON public.v2_requests(space_id,target_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS public.v2_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 kind text NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '', important boolean NOT NULL DEFAULT false,
 space_id uuid, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.v2_awards(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 code text NOT NULL, title text NOT NULL, space_id uuid, team_name text, source text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,source)
);
CREATE TABLE IF NOT EXISTS public.v2_team_awards(
 space_id uuid NOT NULL REFERENCES public.v2_spaces(id), code text NOT NULL, title text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(space_id,code)
);
CREATE TABLE IF NOT EXISTS public.v2_reward_rules(
 code text PRIMARY KEY, label text NOT NULL, gems integer NOT NULL CHECK(gems>=0), enabled boolean NOT NULL DEFAULT true,
 preview_only boolean NOT NULL DEFAULT true
);
INSERT INTO public.v2_reward_rules(code,label,gems) VALUES
 ('daily_checkin','Preview 每日打卡测试奖励',1),('first_checkin','Preview 首次打卡测试奖励',1),
 ('streak_7','Preview 连续七天测试奖励',3),('team_together','Preview 团队首次全员打卡测试奖励',1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.v2_gem_ledger(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 amount integer NOT NULL CHECK(amount<>0), reason text NOT NULL, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source)
);
CREATE TABLE IF NOT EXISTS public.v2_catalog(
 code text PRIMARY KEY, title text NOT NULL, kind text NOT NULL CHECK(kind IN('space_slot','team_seat','decoration')),
 description text NOT NULL DEFAULT '', price integer CHECK(price>0), max_quantity integer CHECK(max_quantity>0),
 enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO public.v2_catalog(code,title,kind,description) VALUES
 ('space_slot','更多公共空间名额','space_slot','永久增加个人公共空间额度；价格与上限待确认'),
 ('team_seat','团队成员席位','team_seat','仅为选定团队扩容；解散后失效；价格与上限待确认'),
 ('frame_garden','花园头像框','decoration','官方外观装饰；价格待确认') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.v2_purchases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 product text NOT NULL REFERENCES public.v2_catalog(code), space_id uuid, quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0),
 request_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key)
);
CREATE TABLE IF NOT EXISTS public.v2_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.v2_people(user_id),
 space_id uuid, kind text NOT NULL CHECK(kind IN('personal_award','team_award')), title text NOT NULL,
 source text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.v2_likes(user_id uuid NOT NULL REFERENCES public.v2_people(user_id), event_id uuid NOT NULL REFERENCES public.v2_events(id), PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS public.v2_reminders(space_id uuid NOT NULL, sender_id uuid NOT NULL, target_id uuid NOT NULL, day date NOT NULL, PRIMARY KEY(space_id,sender_id,target_id,day));

CREATE OR REPLACE FUNCTION v2_private.today(p_user uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT timezone(p.timezone,now())::date FROM public.v2_people p WHERE p.user_id=p_user
$$;
CREATE OR REPLACE FUNCTION v2_private.member(p_space uuid,p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.v2_members m JOIN public.v2_spaces s ON s.id=m.space_id WHERE m.space_id=p_space AND m.user_id=p_user AND m.left_at IS NULL AND s.archived_at IS NULL)
$$;
-- Approximate common graphemes, including composed accents, emoji modifiers, flags and ZWJ emoji.
CREATE OR REPLACE FUNCTION v2_private.visible_length(p_text text) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE c text; n integer:=0; cp integer; joined boolean:=false; regional integer:=0;
BEGIN
 FOR c IN SELECT regexp_split_to_table(normalize(p_text,NFC),'') LOOP
  cp:=ascii(c);
  IF cp=8205 THEN joined:=true; CONTINUE; END IF;
  IF cp BETWEEN 768 AND 879 OR cp BETWEEN 65024 AND 65039 OR cp BETWEEN 127995 AND 127999 OR cp BETWEEN 6832 AND 6911 THEN CONTINUE; END IF;
  IF joined THEN joined:=false; CONTINUE; END IF;
  IF cp BETWEEN 127462 AND 127487 THEN regional:=regional+1; IF regional%2=0 THEN CONTINUE; END IF; ELSE regional:=0; END IF;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
CREATE OR REPLACE FUNCTION v2_private.notify(p_user uuid,p_kind text,p_title text,p_body text DEFAULT '',p_space uuid DEFAULT NULL,p_important boolean DEFAULT false) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.v2_notifications(user_id,kind,title,body,space_id,important) VALUES(p_user,p_kind,p_title,p_body,p_space,p_important)
$$;
CREATE OR REPLACE FUNCTION v2_private.reward(p_user uuid,p_rule text,p_source text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_amount integer; v_id bigint;
BEGIN
 SELECT gems INTO v_amount FROM public.v2_reward_rules WHERE code=p_rule AND enabled;
 IF coalesce(v_amount,0)<=0 THEN RETURN; END IF;
 INSERT INTO public.v2_gem_ledger(user_id,amount,reason,source) VALUES(p_user,v_amount,p_rule,p_source) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN PERFORM v2_private.notify(p_user,'gems','宝石到账','Preview 测试奖励 +'||v_amount||' 宝石'); END IF;
END $$;
CREATE OR REPLACE FUNCTION v2_private.award(p_user uuid,p_code text,p_title text,p_source text,p_space uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_name text;
BEGIN
 IF p_space IS NOT NULL THEN SELECT name INTO v_name FROM public.v2_spaces WHERE id=p_space; END IF;
 INSERT INTO public.v2_awards(user_id,code,title,source,space_id,team_name) VALUES(p_user,p_code,p_title,p_source,p_space,v_name) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN RETURN; END IF;
 PERFORM v2_private.reward(p_user,p_code,'award:'||p_source);
 PERFORM v2_private.notify(p_user,'badge','解锁成就：'||p_title,'',p_space);
 INSERT INTO public.v2_events(actor_id,space_id,kind,title,source) VALUES(p_user,p_space,CASE WHEN p_space IS NULL THEN 'personal_award' ELSE 'team_award' END,p_title,'award:'||v_id);
END $$;
CREATE OR REPLACE FUNCTION v2_private.space_limit(p_user uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT 5+coalesce(sum(quantity),0)::integer FROM public.v2_purchases WHERE user_id=p_user AND product IN(SELECT code FROM public.v2_catalog WHERE kind='space_slot')
$$;
CREATE OR REPLACE FUNCTION v2_private.admit(p_space uuid,p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.v2_spaces;
BEGIN
 SELECT * INTO s FROM public.v2_spaces WHERE id=p_space AND archived_at IS NULL AND kind='team' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'space_unavailable'; END IF;
 IF v2_private.member(p_space,p_user) THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.v2_members m JOIN public.v2_spaces sp ON sp.id=m.space_id WHERE m.user_id=p_user AND m.left_at IS NULL AND sp.kind='team' AND sp.archived_at IS NULL)>=v2_private.space_limit(p_user) THEN RAISE EXCEPTION 'space_limit'; END IF;
 IF (SELECT count(*) FROM public.v2_members WHERE space_id=p_space AND left_at IS NULL)>=6+s.extra_seats THEN RAISE EXCEPTION 'member_limit'; END IF;
 INSERT INTO public.v2_members(space_id,user_id) VALUES(p_space,p_user) ON CONFLICT(space_id,user_id) DO UPDATE SET left_at=NULL,joined_at=now();
 INSERT INTO public.v2_sharing(space_id,user_id) VALUES(p_space,p_user) ON CONFLICT(space_id,user_id) DO UPDATE SET share_weight=false,share_goal=false,share_aggregate=false;
END $$;
CREATE OR REPLACE FUNCTION v2_private.leave_space(p_space uuid,p_user uuid,p_removed boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.v2_spaces; next_user uuid;
BEGIN
 SELECT * INTO s FROM public.v2_spaces WHERE id=p_space AND archived_at IS NULL AND kind='team' FOR UPDATE;
 IF NOT FOUND OR NOT v2_private.member(p_space,p_user) THEN RAISE EXCEPTION 'not_a_member'; END IF;
 UPDATE public.v2_members SET left_at=now() WHERE space_id=p_space AND user_id=p_user;
 UPDATE public.v2_sharing SET share_weight=false,share_goal=false,share_aggregate=false WHERE space_id=p_space AND user_id=p_user;
 IF s.captain_id=p_user THEN
  SELECT user_id INTO next_user FROM public.v2_members WHERE space_id=p_space AND left_at IS NULL ORDER BY joined_at,user_id LIMIT 1;
  IF next_user IS NULL THEN
   UPDATE public.v2_spaces SET archived_at=now() WHERE id=p_space;
   UPDATE public.v2_requests SET status='cancelled' WHERE space_id=p_space AND status='pending';
  ELSE
   UPDATE public.v2_spaces SET captain_id=next_user WHERE id=p_space;
   PERFORM v2_private.notify(next_user,'captain','你已成为队长',s.name,p_space,true);
  END IF;
 END IF;
 PERFORM v2_private.notify(p_user,CASE WHEN p_removed THEN 'removed' ELSE 'left' END,CASE WHEN p_removed THEN '你已被移出团队' ELSE '已退出团队' END,s.name,p_space,true);
END $$;
CREATE OR REPLACE FUNCTION v2_private.event_visible(p_event uuid,p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.v2_events e JOIN public.v2_people p ON p.user_id=e.actor_id WHERE e.id=p_event AND
  ((e.kind='team_award' AND v2_private.member(e.space_id,p_user)) OR
   (e.kind='personal_award' AND (e.actor_id=p_user OR (p.share_activity AND EXISTS(
    SELECT FROM public.v2_members a JOIN public.v2_members b ON a.space_id=b.space_id JOIN public.v2_spaces s ON s.id=a.space_id
    WHERE a.user_id=p_user AND b.user_id=e.actor_id AND a.left_at IS NULL AND b.left_at IS NULL AND s.kind='team' AND s.archived_at IS NULL))))))
$$;

CREATE OR REPLACE FUNCTION public.v2_command(p_action text,p_args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 u uuid:=auth.uid(); sp uuid; s public.v2_spaces; person public.v2_people; request public.v2_requests;
 target uuid; result jsonb:='{}'; v_title text; nick text; v_avatar text; zone text; d date; private_space uuid;
 balance integer; v_product public.v2_catalog; key uuid; purchase_id uuid; item uuid; n integer; streak integer:=0; cursor_day date;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
 -- Preview intentionally serializes commands: lock order is fixed, quotas/ledgers cannot race.
 PERFORM pg_advisory_xact_lock(2048002);
 IF jsonb_typeof(p_args)<>'object' THEN RAISE EXCEPTION 'invalid_input'; END IF;
 IF NOT EXISTS(SELECT FROM public.v2_people WHERE user_id=u) THEN
  zone:=coalesce(p_args->>'timezone','UTC');
  IF NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=zone) THEN zone:='UTC'; END IF;
  INSERT INTO public.v2_people(user_id,timezone) VALUES(u,zone);
  INSERT INTO public.v2_spaces(kind,name,owner_id,captain_id) VALUES('private','我的私人空间',u,u) RETURNING id INTO sp;
  INSERT INTO public.v2_members(space_id,user_id) VALUES(sp,u);
 END IF;
 SELECT * INTO person FROM public.v2_people WHERE user_id=u;
 d:=v2_private.today(u);
 SELECT id INTO private_space FROM public.v2_spaces WHERE owner_id=u AND kind='private';
 UPDATE public.v2_requests SET status='expired' WHERE status='pending' AND expires_at<=now();
 sp:=nullif(p_args->>'space_id','')::uuid;
 IF sp IS NOT NULL THEN SELECT * INTO s FROM public.v2_spaces WHERE id=sp AND archived_at IS NULL; END IF;
 IF p_action='bootstrap' THEN
  result:=jsonb_build_object('private_space',private_space);
 ELSIF p_action='profile' THEN
  nick:=normalize(btrim(coalesce(p_args->>'nickname',person.nickname)),NFC);
  v_avatar:=coalesce(p_args->>'avatar',person.avatar);
  IF v2_private.visible_length(nick) NOT BETWEEN 2 AND 16 OR length(nick)>128 OR nick ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_nickname'; END IF;
  IF v_avatar NOT IN('leaf','sun','moon','peach','ocean','flower') THEN RAISE EXCEPTION 'invalid_avatar'; END IF;
  IF nick<>person.nickname THEN
   IF (SELECT count(*) FROM public.v2_name_changes WHERE user_id=u AND changed_at>now()-interval '7 days')>=2 THEN RAISE EXCEPTION 'nickname_rate_limit'; END IF;
   INSERT INTO public.v2_name_changes(user_id) VALUES(u);
  END IF;
  UPDATE public.v2_people SET nickname=nick,avatar=v_avatar WHERE user_id=u;
 ELSIF p_action='settings' THEN
  UPDATE public.v2_people SET share_activity=coalesce((p_args->>'share_activity')::boolean,share_activity),
   preferences=jsonb_build_object('encouragement',coalesce((p_args->>'encouragement')::boolean,(preferences->>'encouragement')::boolean,true),
    'achievements',coalesce((p_args->>'achievements')::boolean,(preferences->>'achievements')::boolean,true)) WHERE user_id=u;
 ELSIF p_action='goal' THEN
  INSERT INTO public.v2_goals VALUES(u,(p_args->>'start_weight')::numeric,(p_args->>'target_weight')::numeric)
   ON CONFLICT(user_id) DO UPDATE SET start_weight=excluded.start_weight,target_weight=excluded.target_weight;
 ELSIF p_action='create_space' THEN
  v_title:=btrim(p_args->>'name');
  IF coalesce(v2_private.visible_length(v_title),0) NOT BETWEEN 2 AND 20 OR length(v_title)>160 OR length(coalesce(p_args->>'description',''))>300 THEN RAISE EXCEPTION 'invalid_space_name'; END IF;
  IF (SELECT count(*) FROM public.v2_members m JOIN public.v2_spaces x ON x.id=m.space_id WHERE m.user_id=u AND m.left_at IS NULL AND x.kind='team' AND x.archived_at IS NULL)>=v2_private.space_limit(u) THEN RAISE EXCEPTION 'space_limit'; END IF;
  v_avatar:=coalesce(p_args->>'avatar','leaf');
  IF v_avatar NOT IN('leaf','sun','moon','peach','ocean','flower') THEN RAISE EXCEPTION 'invalid_avatar'; END IF;
  INSERT INTO public.v2_spaces(kind,name,description,avatar,owner_id,captain_id,code) VALUES('team',v_title,coalesce(p_args->>'description',''),v_avatar,u,u,'PF-'||upper(encode(extensions.gen_random_bytes(6),'hex'))) RETURNING id INTO sp;
  PERFORM v2_private.admit(sp,u);
  result:=jsonb_build_object('space_id',sp);
 ELSIF p_action='apply' THEN
  SELECT * INTO s FROM public.v2_spaces WHERE code=upper(btrim(p_args->>'code')) AND kind='team' AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF v2_private.member(s.id,u) THEN RAISE EXCEPTION 'already_member'; END IF;
  IF (SELECT count(*) FROM public.v2_members m JOIN public.v2_spaces x ON x.id=m.space_id WHERE m.user_id=u AND m.left_at IS NULL AND x.kind='team' AND x.archived_at IS NULL)>=v2_private.space_limit(u) THEN RAISE EXCEPTION 'space_limit'; END IF;
  IF (SELECT count(*) FROM public.v2_requests WHERE sender_id=u AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  INSERT INTO public.v2_requests(space_id,target_id,sender_id,kind) VALUES(s.id,u,u,'application');
  PERFORM v2_private.notify(s.captain_id,'application','新的加入申请',person.nickname,s.id);
 ELSIF p_action='invite' THEN
  IF s.kind<>'team' OR s.captain_id<>u OR NOT v2_private.member(sp,u) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT user_id INTO target FROM public.v2_people WHERE public_id=upper(btrim(p_args->>'public_id'));
  IF target IS NULL THEN RAISE EXCEPTION 'person_not_found'; END IF;
  IF target=u OR v2_private.member(sp,target) THEN RAISE EXCEPTION 'already_member'; END IF;
  IF (SELECT count(*) FROM public.v2_requests WHERE sender_id=u AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  INSERT INTO public.v2_requests(space_id,target_id,sender_id,kind) VALUES(sp,target,u,'invitation');
  PERFORM v2_private.notify(target,'invitation','收到团队邀请',s.name,sp);
 ELSIF p_action='respond' THEN
  SELECT * INTO request FROM public.v2_requests WHERE id=(p_args->>'request_id')::uuid FOR UPDATE;
  IF NOT FOUND OR request.status<>'pending' OR request.expires_at<=now() THEN RAISE EXCEPTION 'request_expired'; END IF;
  SELECT * INTO s FROM public.v2_spaces WHERE id=request.space_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'space_unavailable'; END IF;
  IF (request.kind='application' AND (s.captain_id<>u OR NOT v2_private.member(s.id,u))) OR (request.kind='invitation' AND request.target_id<>u) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce((p_args->>'accept')::boolean,false) THEN
   PERFORM v2_private.admit(s.id,request.target_id);
   UPDATE public.v2_requests SET status='accepted' WHERE id=request.id;
   PERFORM v2_private.notify(request.target_id,'joined','已加入团队',s.name,s.id);
  ELSE
   UPDATE public.v2_requests SET status='rejected' WHERE id=request.id;
   PERFORM v2_private.notify(CASE WHEN request.kind='application' THEN request.target_id ELSE request.sender_id END,'request_rejected','申请或邀请已被拒绝',s.name,s.id);
  END IF;
 ELSIF p_action IN('space_profile','code_permission','reset_code','remove_member','dissolve') THEN
  IF sp IS NULL OR s.kind IS DISTINCT FROM 'team' OR s.captain_id IS DISTINCT FROM u OR NOT v2_private.member(sp,u) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_action='space_profile' THEN
   v_title:=btrim(p_args->>'name'); v_avatar:=coalesce(p_args->>'avatar',s.avatar);
   IF coalesce(v2_private.visible_length(v_title),0) NOT BETWEEN 2 AND 20 OR length(v_title)>160 OR length(coalesce(p_args->>'description',''))>300 OR v_avatar NOT IN('leaf','sun','moon','peach','ocean','flower') THEN RAISE EXCEPTION 'invalid_space_name'; END IF;
   UPDATE public.v2_spaces SET name=v_title,description=coalesce(p_args->>'description',''),avatar=v_avatar WHERE id=sp;
  ELSIF p_action='code_permission' THEN UPDATE public.v2_spaces SET members_can_copy=coalesce((p_args->>'allow')::boolean,false) WHERE id=sp;
  ELSIF p_action='reset_code' THEN UPDATE public.v2_spaces SET code='PF-'||upper(encode(extensions.gen_random_bytes(6),'hex')) WHERE id=sp;
  ELSIF p_action='remove_member' THEN
   IF (p_args->>'confirm') IS DISTINCT FROM 'REMOVE' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
   target:=(p_args->>'user_id')::uuid;
   IF target=u THEN RAISE EXCEPTION 'use_leave'; END IF;
   PERFORM v2_private.leave_space(sp,target,true);
  ELSE
   IF (p_args->>'confirm') IS DISTINCT FROM 'DISSOLVE' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
   PERFORM v2_private.notify(m.user_id,'dissolved','团队已解散',s.name,sp,true) FROM public.v2_members m WHERE m.space_id=sp AND m.left_at IS NULL;
   UPDATE public.v2_spaces SET archived_at=now() WHERE id=sp;
   UPDATE public.v2_members SET left_at=now() WHERE space_id=sp AND left_at IS NULL;
   UPDATE public.v2_requests SET status='cancelled' WHERE space_id=sp AND status='pending';
   UPDATE public.v2_sharing SET share_weight=false,share_goal=false,share_aggregate=false WHERE space_id=sp;
  END IF;
 ELSIF p_action='leave' THEN
  IF (p_args->>'confirm') IS DISTINCT FROM 'LEAVE' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  PERFORM v2_private.leave_space(sp,u);
 ELSIF p_action='sharing' THEN
  IF NOT v2_private.member(sp,u) OR s.kind IS DISTINCT FROM 'team' THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.v2_sharing VALUES(sp,u,coalesce((p_args->>'share_weight')::boolean,false),coalesce((p_args->>'share_goal')::boolean,false),coalesce((p_args->>'share_aggregate')::boolean,false))
   ON CONFLICT(space_id,user_id) DO UPDATE SET share_weight=excluded.share_weight,share_goal=excluded.share_goal,share_aggregate=excluded.share_aggregate;
 ELSIF p_action IN('add_task','remove_task') THEN
  IF NOT v2_private.member(sp,u) OR s.captain_id IS DISTINCT FROM u THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_action='add_task' THEN
   IF (SELECT count(*) FROM public.v2_tasks WHERE space_id=sp AND active)>=30 THEN RAISE EXCEPTION 'task_limit'; END IF;
   INSERT INTO public.v2_tasks(space_id,title,created_by) VALUES(sp,btrim(p_args->>'title'),u);
  ELSE UPDATE public.v2_tasks SET active=false WHERE id=(p_args->>'task_id')::uuid AND space_id=sp; END IF;
 ELSIF p_action='checkin' THEN
  IF NOT v2_private.member(sp,u) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_typeof(coalesce(p_args->'done_tasks','[]'))<>'array' OR jsonb_array_length(coalesce(p_args->'done_tasks','[]'))>30 THEN RAISE EXCEPTION 'invalid_tasks'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(p_args->'done_tasks','[]')) t(value) WHERE NOT EXISTS(SELECT FROM public.v2_tasks WHERE id=t.value::uuid AND space_id=sp AND active)) THEN RAISE EXCEPTION 'invalid_tasks'; END IF;
  IF coalesce((p_args->>'update_health')::boolean,true) THEN
   INSERT INTO public.v2_daily(user_id,day,weight,mood,note) VALUES(u,d,nullif(p_args->>'weight','')::numeric,nullif(p_args->>'mood',''),coalesce(p_args->>'note',''))
    ON CONFLICT(user_id,day) DO UPDATE SET weight=excluded.weight,mood=excluded.mood,note=excluded.note,updated_at=now();
  ELSE INSERT INTO public.v2_daily(user_id,day) VALUES(u,d) ON CONFLICT DO NOTHING; END IF;
  INSERT INTO public.v2_checkins(space_id,user_id,day,done_tasks) VALUES(sp,u,d,coalesce(p_args->'done_tasks','[]'))
   ON CONFLICT(space_id,user_id,day) DO UPDATE SET done_tasks=excluded.done_tasks;
  INSERT INTO public.v2_checkins(space_id,user_id,day) VALUES(private_space,u,d) ON CONFLICT DO NOTHING;
  PERFORM v2_private.reward(u,'daily_checkin','daily:'||d);
  PERFORM v2_private.award(u,'first_checkin','迈出第一步','first_checkin');
  cursor_day:=d;
  WHILE EXISTS(SELECT FROM public.v2_checkins WHERE space_id=private_space AND user_id=u AND day=cursor_day) LOOP streak:=streak+1; cursor_day:=cursor_day-1; EXIT WHEN streak>=7; END LOOP;
  IF streak>=7 THEN PERFORM v2_private.award(u,'streak_7','连续七天','streak_7'); END IF;
  IF s.kind='team' AND (SELECT count(*) FROM public.v2_members WHERE space_id=sp AND left_at IS NULL)>=2 AND NOT EXISTS(
    SELECT FROM public.v2_members m WHERE m.space_id=sp AND m.left_at IS NULL AND NOT EXISTS(SELECT FROM public.v2_checkins c WHERE c.space_id=sp AND c.user_id=m.user_id AND c.day=d)) THEN
   INSERT INTO public.v2_team_awards(space_id,code,title) VALUES(sp,'team_together','同频的一天') ON CONFLICT DO NOTHING;
   PERFORM v2_private.award(m.user_id,'team_together','同频的一天','team_together:'||sp,sp) FROM public.v2_members m WHERE m.space_id=sp AND m.left_at IS NULL;
  END IF;
 ELSIF p_action='remind' THEN
  target:=(p_args->>'user_id')::uuid;
  IF s.kind IS DISTINCT FROM 'team' OR target=u OR NOT v2_private.member(sp,u) OR NOT v2_private.member(sp,target) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS(SELECT FROM public.v2_checkins WHERE space_id=sp AND user_id=target AND day=d) THEN RAISE EXCEPTION 'already_checked_in'; END IF;
  IF NOT coalesce((SELECT (preferences->>'encouragement')::boolean FROM public.v2_people WHERE user_id=target),true) THEN RAISE EXCEPTION 'reminders_disabled'; END IF;
  INSERT INTO public.v2_reminders VALUES(sp,u,target,d);
  PERFORM v2_private.notify(target,'encouragement','搭子为你加油','今天也一起迈出一小步吧。',sp);
 ELSIF p_action='like' THEN
  item:=(p_args->>'event_id')::uuid;
  IF NOT v2_private.event_visible(item,u) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce((p_args->>'liked')::boolean,false) THEN INSERT INTO public.v2_likes VALUES(u,item) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.v2_likes WHERE user_id=u AND event_id=item; END IF;
 ELSIF p_action='read_notifications' THEN
  UPDATE public.v2_notifications SET read_at=now() WHERE user_id=u AND read_at IS NULL;
 ELSIF p_action='purchase' THEN
  key:=(p_args->>'request_key')::uuid;
  IF key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  SELECT id INTO purchase_id FROM public.v2_purchases WHERE user_id=u AND request_key=key;
  IF purchase_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('purchase_id',purchase_id,'duplicate',true)); END IF;
  SELECT * INTO v_product FROM public.v2_catalog WHERE code=p_args->>'product' FOR UPDATE;
  IF NOT FOUND OR NOT v_product.enabled OR v_product.price IS NULL OR v_product.max_quantity IS NULL THEN RAISE EXCEPTION 'product_not_configured'; END IF;
  IF v_product.kind='team_seat' AND (s.kind IS DISTINCT FROM 'team' OR s.captain_id IS DISTINCT FROM u OR NOT v2_private.member(sp,u)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF (SELECT coalesce(sum(quantity),0) FROM public.v2_purchases pp WHERE pp.product=v_product.code AND ((v_product.kind='team_seat' AND space_id=sp) OR (v_product.kind<>'team_seat' AND user_id=u)))>=v_product.max_quantity THEN RAISE EXCEPTION 'product_limit'; END IF;
  SELECT coalesce(sum(amount),0) INTO balance FROM public.v2_gem_ledger WHERE user_id=u;
  IF balance<v_product.price THEN RAISE EXCEPTION 'insufficient_gems'; END IF;
  INSERT INTO public.v2_purchases(user_id,product,space_id,request_key) VALUES(u,v_product.code,CASE WHEN v_product.kind='team_seat' THEN sp END,key) RETURNING id INTO purchase_id;
  INSERT INTO public.v2_gem_ledger(user_id,amount,reason,source) VALUES(u,-v_product.price,'purchase:'||v_product.code,'purchase:'||purchase_id);
  IF v_product.kind='team_seat' THEN UPDATE public.v2_spaces SET extra_seats=extra_seats+1 WHERE id=sp; END IF;
  PERFORM v2_private.notify(u,'purchase','兑换成功',v_product.title,sp);
  result:=jsonb_build_object('purchase_id',purchase_id);
 ELSIF p_action='erase_health' THEN
  IF (p_args->>'confirm') IS DISTINCT FROM 'DELETE_HEALTH' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  DELETE FROM public.v2_daily WHERE user_id=u;
  DELETE FROM public.v2_goals WHERE user_id=u;
 ELSIF p_action='erase_team_history' THEN
  IF (p_args->>'confirm') IS DISTINCT FROM 'DELETE_HISTORY' OR NOT EXISTS(SELECT FROM public.v2_members WHERE space_id=sp AND user_id=u) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS(SELECT FROM public.v2_spaces WHERE id=sp AND kind='private') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.v2_checkins WHERE user_id=u AND space_id=sp;
 ELSE RAISE EXCEPTION 'unsupported_action';
 END IF;
 RETURN jsonb_build_object('ok',true,'data',result);
EXCEPTION
 WHEN raise_exception THEN RETURN jsonb_build_object('ok',false,'code',SQLERRM);
 WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','duplicate_or_rate_limited');
 WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range OR foreign_key_violation THEN RETURN jsonb_build_object('ok',false,'code','invalid_input');
END $$;
CREATE OR REPLACE FUNCTION public.v2_snapshot(p_space uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); s public.v2_spaces; d date; people jsonb; aggregate_data jsonb; contributors integer;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
 IF NOT EXISTS(SELECT FROM public.v2_people WHERE user_id=u) THEN RAISE EXCEPTION 'bootstrap_required'; END IF;
 d:=v2_private.today(u);
 IF p_space IS NULL THEN SELECT * INTO s FROM public.v2_spaces WHERE owner_id=u AND kind='private';
 ELSE
  IF NOT v2_private.member(p_space,u) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM public.v2_spaces WHERE id=p_space AND archived_at IS NULL;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',p.user_id,'public_id',p.public_id,'nickname',p.nickname,'avatar',p.avatar,'joined_at',m.joined_at,
  'captain',s.captain_id=p.user_id,'checked_today',EXISTS(SELECT FROM public.v2_checkins c WHERE c.space_id=s.id AND c.user_id=p.user_id AND c.day=d),
  'share_weight',coalesce(sh.share_weight,false),'share_goal',coalesce(sh.share_goal,false),'share_aggregate',coalesce(sh.share_aggregate,false),
  'weight',CASE WHEN p.user_id=u OR sh.share_weight THEN last_weight.weight END,
  'goal',CASE WHEN p.user_id=u OR sh.share_goal THEN to_jsonb(g)-'user_id' END,
  'weights',CASE WHEN p.user_id=u OR sh.share_weight THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('day',h.day,'weight',h.weight) ORDER BY h.day),'[]') FROM public.v2_daily h WHERE h.user_id=p.user_id AND h.weight IS NOT NULL AND h.day>=d-90) END
 ) ORDER BY m.joined_at,p.user_id),'[]') INTO people
 FROM public.v2_members m JOIN public.v2_people p ON p.user_id=m.user_id
 LEFT JOIN public.v2_sharing sh ON sh.space_id=m.space_id AND sh.user_id=m.user_id
 LEFT JOIN public.v2_goals g ON g.user_id=m.user_id
 LEFT JOIN LATERAL(SELECT h.weight FROM public.v2_daily h WHERE h.user_id=m.user_id AND h.weight IS NOT NULL ORDER BY h.day DESC LIMIT 1) last_weight ON true
 WHERE m.space_id=s.id AND m.left_at IS NULL;
 -- Aggregation never includes a non-consenting member. Suppress small groups as an extra safeguard.
 SELECT count(*), CASE WHEN count(*)>=3 THEN jsonb_build_object(
  'participants',count(*),'target_kg',sum(g.start_weight-g.target_weight),
  'lost_kg',sum(greatest(0,g.start_weight-coalesce(w.weight,g.start_weight)))
 ) ELSE NULL END INTO contributors,aggregate_data
 FROM public.v2_members m JOIN public.v2_sharing sh ON sh.space_id=m.space_id AND sh.user_id=m.user_id
 JOIN public.v2_goals g ON g.user_id=m.user_id
 LEFT JOIN LATERAL(SELECT h.weight FROM public.v2_daily h WHERE h.user_id=m.user_id AND h.weight IS NOT NULL ORDER BY h.day DESC LIMIT 1) w ON true
 WHERE m.space_id=s.id AND m.left_at IS NULL AND sh.share_weight AND sh.share_goal AND sh.share_aggregate AND s.kind='team';
 RETURN jsonb_build_object(
  'version','2.0 Preview','today',d,'history_window_days',365,
  'me',(SELECT to_jsonb(p)-'timezone' FROM public.v2_people p WHERE p.user_id=u),
  'nickname_changes_remaining',greatest(0,2-(SELECT count(*) FROM public.v2_name_changes WHERE user_id=u AND changed_at>now()-interval '7 days')),
  'goal',(SELECT to_jsonb(g)-'user_id' FROM public.v2_goals g WHERE g.user_id=u),
  'space_limit',v2_private.space_limit(u),
  'spaces',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'kind',sp.kind,'name',sp.name,'description',sp.description,'avatar',sp.avatar,
    'captain_id',sp.captain_id,'limit',6+sp.extra_seats,
    'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'nickname',p.nickname,'avatar',p.avatar,'captain',p.user_id=sp.captain_id) ORDER BY mm.joined_at),'[]') FROM public.v2_members mm JOIN public.v2_people p ON p.user_id=mm.user_id WHERE mm.space_id=sp.id AND mm.left_at IS NULL)) ORDER BY sp.kind,sp.created_at),'[]')
    FROM public.v2_spaces sp JOIN public.v2_members m ON m.space_id=sp.id WHERE m.user_id=u AND m.left_at IS NULL AND sp.archived_at IS NULL),
  'space',jsonb_build_object('id',s.id,'kind',s.kind,'name',s.name,'description',s.description,'avatar',s.avatar,'captain_id',s.captain_id,'limit',6+s.extra_seats,
    'members_can_copy',s.members_can_copy,'code',CASE WHEN s.kind='team' AND (s.captain_id=u OR s.members_can_copy) THEN s.code END),
  'members',people,'aggregate',aggregate_data,
  'my_records',(SELECT coalesce(jsonb_agg(to_jsonb(h)-'user_id' ORDER BY h.day DESC),'[]') FROM public.v2_daily h WHERE h.user_id=u AND h.day>=d-365),
  'my_checkins',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',c.day,'done_tasks',c.done_tasks) ORDER BY c.day DESC),'[]') FROM public.v2_checkins c WHERE c.space_id=s.id AND c.user_id=u AND c.day>=d-365),
  'personal_checkins',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',c.day) ORDER BY c.day DESC),'[]') FROM public.v2_checkins c JOIN public.v2_spaces sp ON sp.id=c.space_id WHERE sp.kind='private' AND sp.owner_id=u AND c.user_id=u AND c.day>=d-365),
  'checkin_counts',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',q.day,'count',q.n,'tasks_done',q.tasks) ORDER BY q.day),'[]') FROM
    (SELECT c.day,count(*) n,sum(jsonb_array_length(c.done_tasks)) tasks FROM public.v2_checkins c WHERE c.space_id=s.id AND c.day>=d-90 GROUP BY c.day) q),
  'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at),'[]') FROM public.v2_tasks t WHERE t.space_id=s.id AND t.active),
  'sharing',(SELECT jsonb_build_object('share_weight',sh.share_weight,'share_goal',sh.share_goal,'share_aggregate',sh.share_aggregate) FROM public.v2_sharing sh WHERE sh.space_id=s.id AND sh.user_id=u),
  'requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'space_name',sp.name,'kind',r.kind,
      'status',CASE WHEN r.status='pending' AND r.expires_at<=now() THEN 'expired' ELSE r.status END,
      'target_name',p.nickname,'target_id',r.target_id,'sender_name',sender.nickname,'expires_at',r.expires_at,
      'can_respond',r.status='pending' AND r.expires_at>now() AND sp.archived_at IS NULL AND ((r.kind='invitation' AND r.target_id=u) OR(r.kind='application' AND sp.captain_id=u AND v2_private.member(sp.id,u)))) ORDER BY r.created_at DESC),'[]')
    FROM public.v2_requests r JOIN public.v2_spaces sp ON sp.id=r.space_id JOIN public.v2_people p ON p.user_id=r.target_id JOIN public.v2_people sender ON sender.user_id=r.sender_id
    WHERE r.target_id=u OR r.sender_id=u OR (sp.captain_id=u AND v2_private.member(sp.id,u))),
  'notifications',(SELECT coalesce(jsonb_agg(to_jsonb(n)-'user_id' ORDER BY n.created_at DESC),'[]') FROM
    (SELECT * FROM public.v2_notifications WHERE user_id=u AND (important OR kind NOT IN('gems','badge') OR coalesce((SELECT (preferences->>'achievements')::boolean FROM public.v2_people WHERE user_id=u),true)) ORDER BY created_at DESC LIMIT 100) n),
  'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'title',e.title,'nickname',p.nickname,'avatar',p.avatar,'created_at',e.created_at,
    'liked',EXISTS(SELECT FROM public.v2_likes l WHERE l.event_id=e.id AND l.user_id=u),
    'likes',(SELECT count(*) FROM public.v2_likes l WHERE l.event_id=e.id)) ORDER BY e.created_at DESC),'[]') FROM
    (SELECT * FROM public.v2_events ev WHERE v2_private.event_visible(ev.id,u) ORDER BY created_at DESC LIMIT 50) e JOIN public.v2_people p ON p.user_id=e.actor_id),
  'awards',(SELECT coalesce(jsonb_agg(to_jsonb(a)-'user_id' ORDER BY a.created_at DESC),'[]') FROM public.v2_awards a WHERE user_id=u),
  'team_awards',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]') FROM public.v2_team_awards a WHERE space_id=s.id),
  'gems',(SELECT coalesce(sum(amount),0) FROM public.v2_gem_ledger WHERE user_id=u),
  'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(l)-'user_id' ORDER BY l.created_at DESC,l.id DESC),'[]') FROM (SELECT * FROM public.v2_gem_ledger WHERE user_id=u ORDER BY id DESC LIMIT 100) l),
  'reward_rules',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.v2_reward_rules r WHERE enabled),
  'catalog',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.code),'[]') FROM public.v2_catalog c),
  'past_spaces',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.name,'archived',sp.archived_at IS NOT NULL)),'[]') FROM public.v2_spaces sp JOIN public.v2_members m ON m.space_id=sp.id WHERE m.user_id=u AND m.left_at IS NOT NULL)
 );
END $$;

-- No base table exposes team secrets. All writes pass through atomic, allowlisted RPCs.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'v2\_%' ESCAPE '\' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.tablename);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',r.tablename);
 END LOOP;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='v2_daily' AND policyname='v2_own_daily') THEN
  CREATE POLICY v2_own_daily ON public.v2_daily FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
 END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='v2_gem_ledger' AND policyname='v2_own_ledger') THEN
  CREATE POLICY v2_own_ledger ON public.v2_gem_ledger FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
 END IF;
END $$;
GRANT SELECT ON public.v2_daily, public.v2_gem_ledger TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_command(text,jsonb),public.v2_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_command(text,jsonb),public.v2_snapshot(uuid) TO authenticated;
REVOKE ALL ON SEQUENCE public.v2_gem_ledger_id_seq FROM PUBLIC, anon, authenticated;
INSERT INTO public.v2_migrations(version) VALUES('03-v2-preview') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
