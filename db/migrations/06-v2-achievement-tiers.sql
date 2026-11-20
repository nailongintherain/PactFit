-- PactFit V2 achievement catalog v2: 84 achievements and five woven-border tiers.
-- Additive and rerunnable. Apply only after 05 in an isolated V2 project.
BEGIN;

ALTER TABLE public.v2_achievement_catalog
 ADD COLUMN IF NOT EXISTS rank text NOT NULL DEFAULT 'starter'
 CHECK(rank IN('starter','advanced','rare','epic','legendary'));

UPDATE public.v2_achievement_catalog c SET
 title=v.title,rank=v.rank,sort_order=v.sort_order
FROM (VALUES
 ('first_checkin','初次打卡','starter',101),
 ('hello_home','新人报到','starter',102),
 ('week_one_on_road','一周熟客','starter',103),
 ('month_one_on_road','相伴一月','advanced',104),
 ('first_team','搭子初遇','starter',105),
 ('first_captain','首次组队','advanced',106),
 ('two_active_teams','双队同行','advanced',107),
 ('comeback_7','七日回归','advanced',108),
 ('comeback_14','两周回归','rare',109),
 ('comeback_30','一月回归','epic',110),

 ('checkin_3','打卡三回','starter',201),
 ('checkin_10','打卡十回','advanced',202),
 ('checkin_30','打卡三十','advanced',203),
 ('checkin_100','百次打卡','epic',205),
 ('streak_3','连续三天','starter',208),
 ('streak_7','连续七天','advanced',209),
 ('streak_14','连续两周','rare',210),
 ('streak_30','连续一月','epic',211),
 ('note_5','五篇随记','starter',212),
 ('no_weight_5','无秤五回','starter',213),

 ('weight_1','初次上秤','starter',301),
 ('weight_10','十次上秤','advanced',302),
 ('weight_30','三十次上秤','advanced',303),
 ('weight_down_1','首次下降','starter',306),
 ('weight_down_5','五次下降','rare',307),
 ('weight_up_1','首次上浮','advanced',308),
 ('weight_up_3','三次上浮','advanced',309),
 ('weight_same_3','三次持平','advanced',310),
 ('weight_swing_2','两次转折','advanced',311),
 ('goal_25','目标 25%','rare',312),

 ('goal_set','首个目标','starter',401),
 ('goal_50','目标半程','rare',402),
 ('goal_100','目标达成','epic',403),
 ('task_1','清单开张','starter',404),
 ('task_10','十项完成','advanced',405),
 ('task_50','五十项完成','rare',406),
 ('task_days_3','行动三日','starter',409),
 ('task_days_7','行动七日','advanced',410),
 ('task_days_30','行动一月','rare',411),
 ('team_tasks_50','团队五十项','rare',414),

 ('buddy_pair','两人成行','starter',501),
 ('buddy_overlap_1','首次同日','starter',502),
 ('buddy_overlap_3','同日三回','advanced',503),
 ('buddy_overlap_7','同日七回','rare',504),
 ('team_together','首次全勤','advanced',505),
 ('full_team_3','全勤三回','rare',506),
 ('full_team_7','全勤七回','epic',507),
 ('like_1','初次点赞','starter',508),
 ('like_10','点赞十回','advanced',509),
 ('remind_3','鼓励三回','advanced',510),

 ('night_checkin','午夜在线','starter',601),
 ('early_checkin','晨光抢先','starter',602),
 ('weekend_5','周末五回','advanced',603),
 ('monday_5','周一五回','advanced',604),
 ('mood_4','心情全册','advanced',605),
 ('notes_10','十篇随记','advanced',606),
 ('no_weight_10','无秤十回','advanced',607),
 ('team_members_6','六人满座','rare',608),
 ('likes_20','点赞二十','rare',609),
 ('multi_space_day','三线同日','rare',610)
) AS v(code,title,rank,sort_order)
WHERE c.code=v.code;

INSERT INTO public.v2_achievement_catalog
 (code,category,category_title,ownership,tone,reveal,title,description,trigger_text,icon,metric,threshold,sort_order,rank)
VALUES
 ('companion_90','start_return','启程与回归','personal','positive','public','相伴三月','三个月，已经走出一段自己的路。','账号建立满 90 天','journey','account_days',90,111,'rare'),
 ('companion_180','start_return','启程与回归','personal','positive','public','相伴半年','半年里，慢慢来仍然算前进。','账号建立满 180 天','journey','account_days',180,112,'epic'),
 ('companion_365','start_return','启程与回归','personal','positive','public','相伴一年','一年之后，仍然记得最初的约定。','账号建立满 365 天','journey','account_days',365,113,'legendary'),
 ('return_3','start_return','启程与回归','personal','positive','hidden','回归三回','每一次回来，都让旅程重新接上。','累计 3 次在连续 7 天未记录后再次打卡','surprise','return_events',3,114,'rare'),

 ('checkin_50','record_streak','记录与坚持','personal','positive','public','打卡五十','五十个真实日子，已经很有分量。','累计完成 50 天个人打卡','record','personal_checkins',50,204,'rare'),
 ('checkin_200','record_streak','记录与坚持','personal','positive','public','打卡两百','两百次愿意回来，已经成为长期陪伴。','累计完成 200 天个人打卡','record','personal_checkins',200,206,'epic'),
 ('checkin_300','record_streak','记录与坚持','personal','positive','public','打卡三百','三百个日子，写成了自己的长期故事。','累计完成 300 天个人打卡','record','personal_checkins',300,207,'legendary'),
 ('active_weeks_12','record_streak','记录与坚持','personal','positive','public','活跃十二周','不必每天连续，十二周里都曾认真出现。','在 12 个不同自然周完成过个人打卡','record','active_weeks',12,214,'rare'),

 ('weight_50','weight_journey','体重旅程','personal','positive','public','五十次上秤','五十次观察，让趋势比单点更可靠。','累计保存 50 条体重记录','weight','weight_records',50,304,'rare'),
 ('weight_100','weight_journey','体重旅程','personal','positive','public','百次上秤','一百次诚实记录，慢慢看见自己的节奏。','累计保存 100 条体重记录','weight','weight_records',100,305,'epic'),
 ('weight_months_3','weight_journey','体重旅程','personal','positive','public','记录三月','三个月都有记录，比天天盯着数字更从容。','在 3 个不同月份保存过体重','weight','weight_months',3,313,'rare'),
 ('weight_months_6','weight_journey','体重旅程','personal','positive','public','记录半年','半年观察，让变化有了更长的时间线。','在 6 个不同月份保存过体重','weight','weight_months',6,314,'epic'),

 ('task_100','goals_promises','目标与约定','personal','positive','public','百项完成','一百件小事，都已经交给行动。','累计完成 100 个清单项','goal','tasks_done',100,407,'rare'),
 ('task_300','goals_promises','目标与约定','personal','positive','public','三百项完成','三百次做到，让日常有了扎实的形状。','累计完成 300 个清单项','goal','tasks_done',300,408,'epic'),
 ('task_days_50','goals_promises','目标与约定','personal','positive','public','行动五十日','五十个有行动的日子，不要求连续。','累计 50 天完成至少一个清单项','goal','task_days',50,412,'epic'),
 ('task_days_100','goals_promises','目标与约定','personal','positive','public','行动一百日','一百个有行动的日子，已经成为长期习惯。','累计 100 天完成至少一个清单项','goal','task_days',100,413,'legendary'),

 ('buddy_overlap_30','buddy_collaboration','搭子协作','team','positive','public','同日三十','三十次同日出现，陪伴变得具体。','当前团队累计 30 天至少两位成员同日打卡','buddy','buddy_overlap_days',30,511,'epic'),
 ('buddy_overlap_100','buddy_collaboration','搭子协作','team','positive','public','同日百回','一百次在同一天出现，是很长的同行。','当前团队累计 100 天至少两位成员同日打卡','buddy','buddy_overlap_days',100,512,'legendary'),
 ('buddy_weeks_10','buddy_collaboration','搭子协作','team','positive','public','同行十周','十个不同星期里，都曾有人一起出现。','当前团队在 10 个不同自然周发生过成员同日打卡','buddy','buddy_overlap_weeks',10,513,'rare'),
 ('buddy_months_3','buddy_collaboration','搭子协作','team','positive','public','团队三月','三个月里，团队都有共同打卡的日子。','当前团队在 3 个不同月份发生过成员同日打卡','buddy','buddy_overlap_months',3,514,'epic'),

 ('seasons_4','surprises','意外与彩蛋','personal','positive','hidden','四季都在','春夏秋冬，都留下过你的脚印。','在春、夏、秋、冬四个季节都完成过个人打卡','surprise','checkin_seasons',4,611,'epic'),
 ('months_12','surprises','意外与彩蛋','personal','positive','hidden','月月见面','十二个月，每个月都曾见面。','连续 12 个自然月都有个人打卡','surprise','consecutive_months',12,612,'legendary'),
 ('years_2','surprises','意外与彩蛋','personal','positive','hidden','跨年同行','日历翻页之后，我们还在继续。','在两个不同自然年份完成过个人打卡','surprise','checkin_years',2,613,'rare'),
 ('notes_100','surprises','意外与彩蛋','personal','positive','hidden','百篇随记','一百段只属于自己的小注脚。','累计写下 100 天私人备注','surprise','notes_count',100,614,'legendary')
ON CONFLICT(code) DO UPDATE SET
 category=excluded.category,category_title=excluded.category_title,ownership=excluded.ownership,
 tone=excluded.tone,reveal=excluded.reveal,title=excluded.title,description=excluded.description,
 trigger_text=excluded.trigger_text,icon=excluded.icon,metric=excluded.metric,
 threshold=excluded.threshold,sort_order=excluded.sort_order,rank=excluded.rank,enabled=true;

-- Catalog names are product labels, not immutable user content. Keep existing V2 preview
-- honors, activity and badge notifications aligned with the approved short names.
UPDATE public.v2_notifications n SET title='解锁成就：'||c.title
FROM public.v2_awards a JOIN public.v2_achievement_catalog c ON c.code=a.code
WHERE n.kind='badge' AND n.user_id=a.user_id AND n.space_id IS NOT DISTINCT FROM a.space_id
 AND n.title='解锁成就：'||a.title;
UPDATE public.v2_events e SET title=c.title
FROM public.v2_awards a JOIN public.v2_achievement_catalog c ON c.code=a.code
WHERE e.source='award:'||a.id::text;
UPDATE public.v2_awards a SET title=c.title
FROM public.v2_achievement_catalog c WHERE c.code=a.code;
UPDATE public.v2_team_awards a SET title=c.title
FROM public.v2_achievement_catalog c WHERE c.code=a.code;

CREATE OR REPLACE FUNCTION v2_private.achievement_extra_metrics(p_user uuid,p_space uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE private_space uuid; m jsonb:='{}'; v integer:=0; years integer:=0; month_count integer:=0;
BEGIN
 SELECT id INTO private_space FROM public.v2_spaces WHERE owner_id=p_user AND kind='private';

 SELECT count(*) INTO v FROM (
  SELECT day-lag(day) OVER(ORDER BY day) gap
  FROM public.v2_checkins WHERE user_id=p_user AND space_id=private_space
 ) gaps WHERE gap>=8;
 m:=m||jsonb_build_object('return_events',v);

 SELECT count(DISTINCT date_trunc('week',day::timestamp)) INTO v
 FROM public.v2_checkins WHERE user_id=p_user AND space_id=private_space;
 m:=m||jsonb_build_object('active_weeks',v);

 SELECT count(DISTINCT date_trunc('month',day::timestamp)) INTO v
 FROM public.v2_daily WHERE user_id=p_user AND weight IS NOT NULL;
 m:=m||jsonb_build_object('weight_months',v);

 SELECT count(DISTINCT CASE
   WHEN extract(month FROM day) IN(3,4,5) THEN 1
   WHEN extract(month FROM day) IN(6,7,8) THEN 2
   WHEN extract(month FROM day) IN(9,10,11) THEN 3 ELSE 4 END),
  count(DISTINCT extract(year FROM day))
 INTO v,years
 FROM public.v2_checkins c
 WHERE c.user_id=p_user AND c.space_id=(SELECT id FROM public.v2_spaces WHERE owner_id=p_user AND kind='private');
 m:=m||jsonb_build_object('checkin_seasons',v,'checkin_years',years);

 SELECT coalesce(max(n),0) INTO v FROM (
  SELECT count(*)::integer n FROM (
   SELECT month_key,month_index-(row_number() OVER(ORDER BY month_key))::integer grp FROM (
    SELECT DISTINCT date_trunc('month',day::timestamp)::date month_key,
     (extract(year FROM day)::integer*12+extract(month FROM day)::integer) month_index
    FROM public.v2_checkins c
    WHERE c.user_id=p_user AND c.space_id=(SELECT id FROM public.v2_spaces WHERE owner_id=p_user AND kind='private')
   ) months
  ) grouped GROUP BY grp
 ) streaks;
 m:=m||jsonb_build_object('consecutive_months',v);

 IF p_space IS NOT NULL AND v2_private.member(p_space,p_user)
  AND EXISTS(SELECT FROM public.v2_spaces WHERE id=p_space AND kind='team' AND archived_at IS NULL) THEN
  WITH overlap_days AS (
   SELECT DISTINCT mine.day FROM public.v2_checkins mine
   WHERE mine.space_id=p_space AND mine.user_id=p_user
    AND EXISTS(SELECT FROM public.v2_checkins other
     JOIN public.v2_members active ON active.space_id=other.space_id AND active.user_id=other.user_id AND active.left_at IS NULL
     WHERE other.space_id=p_space AND other.day=mine.day AND other.user_id<>p_user)
  )
  SELECT count(DISTINCT date_trunc('week',day::timestamp)),count(DISTINCT date_trunc('month',day::timestamp))
  INTO v,month_count FROM overlap_days;
  m:=m||jsonb_build_object('buddy_overlap_weeks',v,'buddy_overlap_months',month_count);
 ELSE
  m:=m||jsonb_build_object('buddy_overlap_weeks',0,'buddy_overlap_months',0);
 END IF;
 RETURN m;
END $$;

CREATE OR REPLACE FUNCTION v2_private.evaluate_achievements(p_user uuid,p_space uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.v2_achievement_catalog; metrics jsonb; value integer; member_row record;
BEGIN
 metrics:=v2_private.achievement_metrics(p_user,p_space)||v2_private.achievement_extra_metrics(p_user,p_space);
 FOR a IN SELECT * FROM public.v2_achievement_catalog WHERE enabled ORDER BY sort_order LOOP
  value:=coalesce((metrics->>a.metric)::integer,0);
  IF value<a.threshold THEN CONTINUE; END IF;
  IF a.ownership='team' THEN
   IF p_space IS NULL OR NOT v2_private.member(p_space,p_user)
    OR NOT EXISTS(SELECT FROM public.v2_spaces WHERE id=p_space AND kind='team' AND archived_at IS NULL) THEN CONTINUE; END IF;
   INSERT INTO public.v2_team_awards(space_id,code,title) VALUES(p_space,a.code,a.title) ON CONFLICT DO NOTHING;
   FOR member_row IN SELECT user_id FROM public.v2_members WHERE space_id=p_space AND left_at IS NULL LOOP
    IF NOT EXISTS(SELECT FROM public.v2_awards WHERE user_id=member_row.user_id AND code=a.code AND space_id=p_space) THEN
     PERFORM v2_private.award(member_row.user_id,a.code,a.title,'catalog:'||a.code||':'||p_space,p_space);
    END IF;
   END LOOP;
  ELSIF NOT EXISTS(SELECT FROM public.v2_awards WHERE user_id=p_user AND code=a.code AND space_id IS NULL) THEN
   PERFORM v2_private.award(p_user,a.code,a.title,'catalog:'||a.code);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.v2_achievement_wall(p_space uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); metrics jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
 IF NOT EXISTS(SELECT FROM public.v2_people WHERE user_id=u) THEN RAISE EXCEPTION 'bootstrap_required'; END IF;
 IF p_space IS NOT NULL AND NOT v2_private.member(p_space,u) THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(2048002);
 PERFORM v2_private.evaluate_achievements(u,p_space);
 metrics:=v2_private.achievement_metrics(u,p_space)||v2_private.achievement_extra_metrics(u,p_space);
 RETURN jsonb_build_object(
  'total',(SELECT count(*) FROM public.v2_achievement_catalog WHERE enabled),
  'earned',(SELECT count(DISTINCT code) FROM public.v2_awards WHERE user_id=u AND code IN(SELECT code FROM public.v2_achievement_catalog WHERE enabled)),
  'items',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'code',c.code,'category',c.category,'category_title',c.category_title,'ownership',c.ownership,'tone',c.tone,'reveal',c.reveal,
    'rank',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL THEN 'hidden' ELSE c.rank END,
    'title',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL THEN '神秘成就' ELSE c.title END,
    'description',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL THEN '在意想不到的时刻出现。' ELSE c.description END,
    'trigger',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL THEN '触发条件暂不公开' ELSE c.trigger_text END,
    'icon',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL THEN 'mystery' ELSE c.icon END,
    'threshold',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL THEN NULL ELSE c.threshold END,
    'progress',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL OR (c.ownership='team' AND NOT EXISTS(SELECT FROM public.v2_spaces s WHERE s.id=p_space AND s.kind='team' AND s.archived_at IS NULL)) THEN NULL ELSE least(c.threshold,coalesce((metrics->>c.metric)::integer,0)) END,
    'earned',earned.created_at IS NOT NULL,'earned_at',earned.created_at,
    'available',c.ownership='personal' OR EXISTS(SELECT FROM public.v2_spaces s WHERE s.id=p_space AND s.kind='team' AND s.archived_at IS NULL)
   ) ORDER BY c.sort_order),'[]')
   FROM public.v2_achievement_catalog c
   LEFT JOIN LATERAL(
    SELECT a.created_at FROM public.v2_awards a WHERE a.user_id=u AND a.code=c.code
     AND ((c.ownership='personal' AND a.space_id IS NULL) OR (c.ownership='team' AND a.space_id=p_space))
    ORDER BY a.created_at DESC LIMIT 1
   ) earned ON true WHERE c.enabled)
 );
END $$;

REVOKE ALL ON FUNCTION v2_private.achievement_extra_metrics(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION v2_private.evaluate_achievements(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.v2_achievement_wall(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_achievement_wall(uuid) TO authenticated;

INSERT INTO public.v2_migrations(version) VALUES('06-v2-achievement-tiers') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
