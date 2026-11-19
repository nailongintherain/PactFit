-- PactFit V2 achievement wall: 6 behavior categories, server-authoritative progress and unlocks.
-- Additive and rerunnable. Apply only after 03 and 04 in an isolated V2 project.
BEGIN;

CREATE TABLE IF NOT EXISTS public.v2_achievement_catalog(
 code text PRIMARY KEY,
 category text NOT NULL CHECK(category IN('start_return','record_streak','weight_journey','goals_promises','buddy_collaboration','surprises')),
 category_title text NOT NULL,
 ownership text NOT NULL CHECK(ownership IN('personal','team')),
 tone text NOT NULL CHECK(tone IN('positive','reverse_playful')),
 reveal text NOT NULL CHECK(reveal IN('public','hidden')),
 title text NOT NULL,
 description text NOT NULL,
 trigger_text text NOT NULL,
 icon text NOT NULL,
 metric text NOT NULL,
 threshold integer NOT NULL CHECK(threshold>0),
 sort_order integer NOT NULL,
 enabled boolean NOT NULL DEFAULT true
);

INSERT INTO public.v2_achievement_catalog
 (code,category,category_title,ownership,tone,reveal,title,description,trigger_text,icon,metric,threshold,sort_order)
VALUES
 -- 1. 启程与回归
 ('first_checkin','start_return','启程与回归','personal','positive','public','迈出第一步','第一次出现，就已经算数。','完成第一次个人打卡','journey','personal_checkins',1,101),
 ('hello_home','start_return','启程与回归','personal','positive','public','新的起点','为自己留下一块可以慢慢来的地方。','创建 PactFit 账号','journey','account_days',1,102),
 ('week_one_on_road','start_return','启程与回归','personal','positive','public','相识一周','这段旅程已经陪你走过一周。','账号建立满 7 天','journey','account_days',7,103),
 ('month_one_on_road','start_return','启程与回归','personal','positive','public','满月同行','一个月，不急着定义结果。','账号建立满 30 天','journey','account_days',30,104),
 ('first_team','start_return','启程与回归','personal','positive','public','找到搭子','有人同行，路会多一点回应。','第一次加入团队空间','journey','team_joined',1,105),
 ('first_captain','start_return','启程与回归','personal','positive','public','发起约定','把一句“一起吧”变成了空间。','第一次创建团队空间','journey','teams_created',1,106),
 ('two_active_teams','start_return','启程与回归','personal','positive','public','两条同行路','不同的同行，也可以有各自节奏。','同时参与 2 个有效团队','journey','active_teams',2,107),
 ('comeback_7','start_return','启程与回归','personal','positive','public','欢迎回来','暂停不是放弃，回来就是继续。','连续 7 天未记录后再次个人打卡','journey','max_gap_days',8,108),
 ('comeback_14','start_return','启程与回归','personal','positive','public','久别重逢','隔了一阵，仍然认得回来的路。','连续 14 天未记录后再次个人打卡','journey','max_gap_days',15,109),
 ('comeback_30','start_return','启程与回归','personal','reverse_playful','hidden','好久不见','秤和搭子都说：回来就好。','连续 30 天未记录后再次个人打卡','surprise','max_gap_days',31,110),

 -- 2. 记录与坚持
 ('checkin_3','record_streak','记录与坚持','personal','positive','public','三个小脚印','三个真实的日子，已经连成一小段路。','累计完成 3 天个人打卡','record','personal_checkins',3,201),
 ('checkin_10','record_streak','记录与坚持','personal','positive','public','十次都有数','每一次行动都算数。','累计完成 10 天个人打卡','record','personal_checkins',10,202),
 ('checkin_30','record_streak','记录与坚持','personal','positive','public','月光存档','三十个日子，被好好留了下来。','累计完成 30 天个人打卡','record','personal_checkins',30,203),
 ('checkin_100','record_streak','记录与坚持','personal','positive','public','百次如一','不是每天完美，是一百次愿意回来。','累计完成 100 天个人打卡','record','personal_checkins',100,204),
 ('streak_3','record_streak','记录与坚持','personal','positive','public','三天成行','连续三天，节奏刚刚开始。','最长连续个人打卡达到 3 天','record','max_streak',3,205),
 ('streak_7','record_streak','记录与坚持','personal','positive','public','连续七天','一周的坚持，有了自己的形状。','最长连续个人打卡达到 7 天','record','max_streak',7,206),
 ('streak_14','record_streak','记录与坚持','personal','positive','public','两周不断线','连续两周，习惯正在变得熟悉。','最长连续个人打卡达到 14 天','record','max_streak',14,207),
 ('streak_30','record_streak','记录与坚持','personal','positive','public','一月长跑','一个月的连续记录，温柔也有力量。','最长连续个人打卡达到 30 天','record','max_streak',30,208),
 ('note_5','record_streak','记录与坚持','personal','positive','public','写给今天','不只有数字，感受也被认真保存。','累计写下 5 天私人备注','record','notes_count',5,209),
 ('no_weight_5','record_streak','记录与坚持','personal','positive','public','不称也算数','没有体重数字的日子，行动同样成立。','累计 5 次不填写体重的个人打卡','record','no_weight_checkins',5,210),

 -- 3. 体重旅程
 ('weight_1','weight_journey','体重旅程','personal','positive','public','初次见秤','刻度只是旅程的一条线索。','保存第一条体重记录','weight','weight_records',1,301),
 ('weight_10','weight_journey','体重旅程','personal','positive','public','十次刻度','十次诚实记录，比单个数字更有意义。','累计保存 10 条体重记录','weight','weight_records',10,302),
 ('weight_30','weight_journey','体重旅程','personal','positive','public','熟悉的刻度','三十次观察，慢慢看见自己的节奏。','累计保存 30 条体重记录','weight','weight_records',30,303),
 ('weight_down_1','weight_journey','体重旅程','personal','positive','public','轻轻一格','一次向目标方向的变化。','相邻体重记录首次下降','weight','weight_down_days',1,304),
 ('weight_down_5','weight_journey','体重旅程','personal','positive','public','向前五步','五次向目标方向变化，步子不必一样大。','累计出现 5 次相邻体重下降','weight','weight_down_days',5,305),
 ('weight_up_1','weight_journey','体重旅程','personal','reverse_playful','hidden','重力来串门','正常波动也有剧情，不作失败判定。','相邻体重记录首次上涨','surprise','weight_up_days',1,306),
 ('weight_up_3','weight_journey','体重旅程','personal','reverse_playful','hidden','弹簧剧情','上上下下很正常，趋势不会由一天定义。','累计出现 3 次相邻体重上涨','surprise','weight_up_days',3,307),
 ('weight_same_3','weight_journey','体重旅程','personal','reverse_playful','hidden','稳稳停靠','刻度连续几次选择了原地休息。','累计出现 3 次相邻体重相同','surprise','weight_same_days',3,308),
 ('weight_swing_2','weight_journey','体重旅程','personal','reverse_playful','hidden','山路弯弯','曲线拐弯不代表走错路。','体重变化方向累计转折 2 次','surprise','weight_swings',2,309),
 ('goal_25','weight_journey','体重旅程','personal','positive','public','四分之一程','目标旅程走过了四分之一。','按最近体重达到个人目标进度 25%','weight','goal_progress',25,310),

 -- 4. 目标与约定
 ('goal_set','goals_promises','目标与约定','personal','positive','public','给未来写信','目标是方向，不是催促。','设置第一个个人目标','goal','goal_exists',1,401),
 ('goal_50','goals_promises','目标与约定','personal','positive','public','半程灯亮','已经走到个人目标的一半。','按最近体重达到个人目标进度 50%','goal','goal_progress',50,402),
 ('goal_100','goals_promises','目标与约定','personal','positive','public','抵达约定','到达曾经写下的目标刻度。','最近体重达到或低于目标体重','goal','goal_progress',100,403),
 ('task_1','goals_promises','目标与约定','personal','positive','public','小事开张','完成一件小事，也值得被记住。','累计完成 1 个清单项','goal','tasks_done',1,404),
 ('task_10','goals_promises','目标与约定','personal','positive','public','十件小事','十件小事串成了行动的证据。','累计完成 10 个清单项','goal','tasks_done',10,405),
 ('task_50','goals_promises','目标与约定','personal','positive','public','五十次做到','把五十个小约定交给了行动。','累计完成 50 个清单项','goal','tasks_done',50,406),
 ('task_days_3','goals_promises','目标与约定','personal','positive','public','三日开练','三天都有完成过自己的清单。','累计 3 天完成至少一个清单项','goal','task_days',3,407),
 ('task_days_7','goals_promises','目标与约定','personal','positive','public','一周开练','七个有行动的日子。','累计 7 天完成至少一个清单项','goal','task_days',7,408),
 ('task_days_30','goals_promises','目标与约定','personal','positive','public','日常成形','小目标在三十个日子里反复出现。','累计 30 天完成至少一个清单项','goal','task_days',30,409),
 ('team_tasks_50','goals_promises','目标与约定','team','positive','public','约定成林','团队一起完成了五十个清单项。','当前团队累计完成 50 个清单项','goal','team_tasks_done',50,410),

 -- 5. 搭子协作
 ('buddy_pair','buddy_collaboration','搭子协作','team','positive','public','两人成行','至少两位成员，同行正式开始。','当前团队达到 2 位有效成员','buddy','team_members',2,501),
 ('buddy_overlap_1','buddy_collaboration','搭子协作','team','positive','public','今天都在','你和至少一位搭子在同一天出现。','当前团队累计 1 天同日打卡','buddy','buddy_overlap_days',1,502),
 ('buddy_overlap_3','buddy_collaboration','搭子协作','team','positive','public','三次碰头','三天在同一条路上碰见。','当前团队累计 3 天同日打卡','buddy','buddy_overlap_days',3,503),
 ('buddy_overlap_7','buddy_collaboration','搭子协作','team','positive','public','七日同路','七个日子里，你们都曾一起出现。','当前团队累计 7 天同日打卡','buddy','buddy_overlap_days',7,504),
 ('team_together','buddy_collaboration','搭子协作','team','positive','public','同频的一天','每位当前成员都在同一天完成打卡。','至少两人的团队首次全员同日打卡','buddy','full_team_days',1,505),
 ('full_team_3','buddy_collaboration','搭子协作','team','positive','public','三次同频','全员同日打卡累计三天。','当前团队累计 3 天全员同日打卡','buddy','full_team_days',3,506),
 ('full_team_7','buddy_collaboration','搭子协作','team','positive','public','一周合拍','全员同日打卡累计七天。','当前团队累计 7 天全员同日打卡','buddy','full_team_days',7,507),
 ('like_1','buddy_collaboration','搭子协作','personal','positive','public','为你亮灯','第一次为搭子的成就点赞。','为可见的搭子成就点赞 1 次','buddy','likes_given',1,508),
 ('like_10','buddy_collaboration','搭子协作','personal','positive','public','掌声十连','把十次鼓励送给同行的人。','累计为搭子成就点赞 10 次','buddy','likes_given',10,509),
 ('remind_3','buddy_collaboration','搭子协作','personal','positive','public','轻轻敲门','三次温柔提醒，不催促也不评判。','累计向搭子发送 3 次鼓励','buddy','reminders_sent',3,510),

 -- 6. 意外与彩蛋
 ('night_checkin','surprises','意外与彩蛋','personal','reverse_playful','hidden','夜猫子打卡','夜深了，记录还亮着一盏小灯。','在本地时间 23:00 后完成个人打卡','surprise','night_checkins',1,601),
 ('early_checkin','surprises','意外与彩蛋','personal','reverse_playful','hidden','晨光抢先','太阳还没完全上线，你先来了。','在本地时间 07:00 前完成个人打卡','surprise','early_checkins',1,602),
 ('weekend_5','surprises','意外与彩蛋','personal','positive','hidden','周末也在','周末不是缺席，只是换一种节奏。','累计 5 个周末完成个人打卡','surprise','weekend_checkins',5,603),
 ('monday_5','surprises','意外与彩蛋','personal','reverse_playful','hidden','周一不躲','五个周一，都被你正面遇见。','累计 5 个周一完成个人打卡','surprise','monday_checkins',5,604),
 ('mood_4','surprises','意外与彩蛋','personal','positive','hidden','心情万花筒','不同心情都可以被好好看见。','记录过全部 4 种心情','surprise','mood_variety',4,605),
 ('notes_10','surprises','意外与彩蛋','personal','positive','hidden','碎碎念档案','十段只属于自己的小注脚。','累计写下 10 天私人备注','surprise','notes_count',10,606),
 ('no_weight_10','surprises','意外与彩蛋','personal','reverse_playful','hidden','秤放假了','今天不称，也没有耽误你出现。','累计 10 次不填写体重的个人打卡','surprise','no_weight_checkins',10,607),
 ('team_members_6','surprises','意外与彩蛋','team','reverse_playful','hidden','六人不挤','小空间里，刚好坐满六位搭子。','当前团队达到默认 6 人上限','surprise','team_members',6,608),
 ('likes_20','surprises','意外与彩蛋','personal','reverse_playful','hidden','点赞发动机','掌声库存看起来相当充足。','累计为搭子成就点赞 20 次','surprise','likes_given',20,609),
 ('multi_space_day','surprises','意外与彩蛋','personal','reverse_playful','hidden','三线同日','同一天在三个空间都留下了脚印。','同一天在 3 个不同空间完成打卡','surprise','multi_space_day',3,610)
ON CONFLICT(code) DO UPDATE SET
 category=excluded.category,category_title=excluded.category_title,ownership=excluded.ownership,
 tone=excluded.tone,reveal=excluded.reveal,title=excluded.title,description=excluded.description,
 trigger_text=excluded.trigger_text,icon=excluded.icon,metric=excluded.metric,
 threshold=excluded.threshold,sort_order=excluded.sort_order,enabled=true;

CREATE OR REPLACE FUNCTION v2_private.achievement_metrics(p_user uuid,p_space uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 d date; private_space uuid; zone text; m jsonb:='{}'; v integer:=0; members integer:=0;
 goal_progress integer:=0; goal_exists integer:=0;
 weight_records integer:=0; weight_down integer:=0; weight_up integer:=0; weight_same integer:=0; weight_swings integer:=0;
BEGIN
 SELECT v2_private.today(p_user),p.timezone INTO d,zone FROM public.v2_people p WHERE p.user_id=p_user;
 SELECT id INTO private_space FROM public.v2_spaces WHERE owner_id=p_user AND kind='private';
 m:=m||jsonb_build_object('account_days',greatest(1,d-(SELECT created_at::date FROM public.v2_people WHERE user_id=p_user)+1));
 SELECT count(*) INTO v FROM public.v2_checkins WHERE user_id=p_user AND space_id=private_space;
 m:=m||jsonb_build_object('personal_checkins',v);
 SELECT coalesce(max(n),0) INTO v FROM (
  SELECT count(*)::integer n FROM (
   SELECT day,day-(row_number() OVER(ORDER BY day))::integer grp FROM public.v2_checkins WHERE user_id=p_user AND space_id=private_space
  ) q GROUP BY grp
 ) streaks;
 m:=m||jsonb_build_object('max_streak',v);
 SELECT coalesce(max(gap),0) INTO v FROM (
  SELECT day-lag(day) OVER(ORDER BY day) gap FROM public.v2_checkins WHERE user_id=p_user AND space_id=private_space
 ) gaps;
 m:=m||jsonb_build_object('max_gap_days',v);
 SELECT count(DISTINCT mbr.space_id) INTO v FROM public.v2_members mbr JOIN public.v2_spaces s ON s.id=mbr.space_id WHERE mbr.user_id=p_user AND s.kind='team';
 m:=m||jsonb_build_object('team_joined',v);
 SELECT count(*) INTO v FROM public.v2_members mbr JOIN public.v2_spaces s ON s.id=mbr.space_id WHERE mbr.user_id=p_user AND mbr.left_at IS NULL AND s.kind='team' AND s.archived_at IS NULL;
 m:=m||jsonb_build_object('active_teams',v);
 SELECT count(*) INTO v FROM public.v2_spaces WHERE owner_id=p_user AND kind='team';
 m:=m||jsonb_build_object('teams_created',v);
 SELECT count(*) FILTER(WHERE weight IS NOT NULL),count(*) FILTER(WHERE note<>''),count(DISTINCT mood) FILTER(WHERE mood IS NOT NULL)
 INTO weight_records,v,members FROM public.v2_daily WHERE user_id=p_user;
 m:=m||jsonb_build_object('weight_records',weight_records,'notes_count',v,'mood_variety',members);
 SELECT count(*) FILTER(WHERE weight<previous),count(*) FILTER(WHERE weight>previous),count(*) FILTER(WHERE weight=previous)
 INTO weight_down,weight_up,weight_same FROM (
  SELECT weight,lag(weight) OVER(ORDER BY day) previous FROM public.v2_daily WHERE user_id=p_user AND weight IS NOT NULL
 ) weights WHERE previous IS NOT NULL;
 SELECT count(*) INTO weight_swings FROM (
  SELECT direction,lag(direction) OVER(ORDER BY day) previous_direction FROM (
   SELECT day,sign(weight-lag(weight) OVER(ORDER BY day)) direction FROM public.v2_daily WHERE user_id=p_user AND weight IS NOT NULL
  ) changes WHERE direction<>0
 ) turns WHERE previous_direction IS NOT NULL AND direction<>previous_direction;
 m:=m||jsonb_build_object('weight_down_days',weight_down,'weight_up_days',weight_up,'weight_same_days',weight_same,'weight_swings',weight_swings);
 SELECT 1,least(100,greatest(0,floor((g.start_weight-w.weight)*100/nullif(g.start_weight-g.target_weight,0))))::integer
 INTO goal_exists,goal_progress FROM public.v2_goals g
 LEFT JOIN LATERAL(SELECT weight FROM public.v2_daily WHERE user_id=p_user AND weight IS NOT NULL ORDER BY day DESC LIMIT 1) w ON true
 WHERE g.user_id=p_user;
 m:=m||jsonb_build_object('goal_exists',goal_exists,'goal_progress',coalesce(goal_progress,0));
 SELECT coalesce(sum(jsonb_array_length(done_tasks)),0),count(DISTINCT day) FILTER(WHERE jsonb_array_length(done_tasks)>0)
 INTO v,members FROM public.v2_checkins WHERE user_id=p_user;
 m:=m||jsonb_build_object('tasks_done',v,'task_days',members);
 SELECT count(*) INTO v FROM public.v2_likes WHERE user_id=p_user;
 m:=m||jsonb_build_object('likes_given',v);
 SELECT count(*) INTO v FROM public.v2_reminders WHERE sender_id=p_user;
 m:=m||jsonb_build_object('reminders_sent',v);
 SELECT coalesce(max(n),0) INTO v FROM (SELECT day,count(DISTINCT space_id)::integer n FROM public.v2_checkins WHERE user_id=p_user GROUP BY day) q;
 m:=m||jsonb_build_object('multi_space_day',v);
 SELECT count(*) FILTER(WHERE local_time>=time '23:00'),count(*) FILTER(WHERE local_time<time '07:00'),
  count(*) FILTER(WHERE dow IN(0,6)),count(*) FILTER(WHERE dow=1)
 INTO v,members,weight_down,weight_up FROM (
  SELECT (c.created_at AT TIME ZONE zone)::time local_time,extract(dow FROM c.day)::integer dow
  FROM public.v2_checkins c WHERE c.user_id=p_user AND c.space_id=private_space
 ) timed;
 m:=m||jsonb_build_object('night_checkins',v,'early_checkins',members,'weekend_checkins',weight_down,'monday_checkins',weight_up);
 SELECT count(*) INTO v FROM public.v2_checkins c LEFT JOIN public.v2_daily h ON h.user_id=c.user_id AND h.day=c.day
 WHERE c.user_id=p_user AND c.space_id=private_space AND h.weight IS NULL;
 m:=m||jsonb_build_object('no_weight_checkins',v);
 IF p_space IS NOT NULL AND v2_private.member(p_space,p_user) AND EXISTS(SELECT FROM public.v2_spaces WHERE id=p_space AND kind='team' AND archived_at IS NULL) THEN
  SELECT count(*) INTO members FROM public.v2_members WHERE space_id=p_space AND left_at IS NULL;
  m:=m||jsonb_build_object('team_members',members);
  SELECT coalesce(sum(jsonb_array_length(done_tasks)),0) INTO v FROM public.v2_checkins WHERE space_id=p_space;
  m:=m||jsonb_build_object('team_tasks_done',v);
  SELECT count(*) INTO v FROM (
   SELECT mine.day FROM public.v2_checkins mine WHERE mine.space_id=p_space AND mine.user_id=p_user
   AND EXISTS(
    SELECT FROM public.v2_checkins other
    JOIN public.v2_members active ON active.space_id=other.space_id AND active.user_id=other.user_id AND active.left_at IS NULL
    WHERE other.space_id=p_space AND other.day=mine.day AND other.user_id<>p_user
   )
  ) overlap;
  m:=m||jsonb_build_object('buddy_overlap_days',v);
  SELECT count(*) INTO v FROM (
   SELECT c.day FROM public.v2_checkins c
   JOIN public.v2_members active ON active.space_id=c.space_id AND active.user_id=c.user_id AND active.left_at IS NULL
   WHERE c.space_id=p_space GROUP BY c.day HAVING count(DISTINCT c.user_id)>=members
  ) full_days;
  m:=m||jsonb_build_object('full_team_days',CASE WHEN members>=2 THEN v ELSE 0 END);
 ELSE
  m:=m||jsonb_build_object('team_members',0,'team_tasks_done',0,'buddy_overlap_days',0,'full_team_days',0);
 END IF;
 RETURN m;
END $$;

CREATE OR REPLACE FUNCTION v2_private.evaluate_achievements(p_user uuid,p_space uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.v2_achievement_catalog; metrics jsonb; value integer; member_row record;
BEGIN
 metrics:=v2_private.achievement_metrics(p_user,p_space);
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
 metrics:=v2_private.achievement_metrics(u,p_space);
 RETURN jsonb_build_object(
  'total',(SELECT count(*) FROM public.v2_achievement_catalog WHERE enabled),
  'earned',(SELECT count(DISTINCT code) FROM public.v2_awards WHERE user_id=u AND code IN(SELECT code FROM public.v2_achievement_catalog WHERE enabled)),
  'items',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'code',c.code,'category',c.category,'category_title',c.category_title,'ownership',c.ownership,'tone',c.tone,'reveal',c.reveal,
    'title',CASE WHEN c.reveal='hidden' AND earned.created_at IS NULL THEN '隐藏彩蛋' ELSE c.title END,
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

ALTER TABLE public.v2_achievement_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.v2_achievement_catalog FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION v2_private.achievement_metrics(uuid,uuid),v2_private.evaluate_achievements(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.v2_achievement_wall(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_achievement_wall(uuid) TO authenticated;

INSERT INTO public.v2_migrations(version) VALUES('05-v2-achievement-wall') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
