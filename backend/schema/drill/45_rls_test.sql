-- =============================================================================
-- 45_rls_test.sql —— RLS 独立测试（psql 层切身份版）
--
-- 设计要点（Phase 1-c-fix-3 定稿，Step 9-A 加固）：
--
--   1) **不在 PL/pgSQL 里切角色**。
--      角色切换只用 psql 层的 session 级 `set role authenticated` / `reset role`，
--      整个脚本只有这两处角色语句，不存在"异常块子事务把 SET LOCAL 撤销"的问题。
--
--   2) **记账两段式**，避免"边测边写"落进权限死角：
--        阶段 C（postgres）→ 算预期、存基线，写 drill_meta.rls_expect / rls_baseline
--        阶段 D（authenticated）→ 只做查询与探针，把结果写 drill_meta.rls_actual
--        阶段 E（postgres）→ 视图 join 出判定，任一非 PASS 就 raise → 非零退出
--
--   3) **未授权空间的选择**：
--      先取该 owner 的**全部**空间，再找 `space_id not in (我的全部空间)`。
--      找不到 → item 10 / 11 / 14 判 INCONCLUSIVE，整轮按失败处理，
--      不会因为"没测到"而 PASS。可见行数的预期同样按"我全部空间"聚合。
--
--   4) **探针不落数据（Step 9-A / 9-B 的核心加固）**：
--      - 跨空间 INSERT、同空间 INSERT、跨空间 UPDATE 三段探针**全部包在显式事务里**，
--        结尾**无条件 ROLLBACK**。不再依赖"被 RLS 拒绝所以语句自身回滚"这种间接保证：
--        即使隔离失效、写入成功，ROLLBACK 也一定撤销。
--        若 psql 中途退出/连接断开，服务端会回滚未提交事务 —— 见文末"边界"说明。
--      - 同空间写入用 `returning id` 证明**真的写进去了一行**（不只是"没报错"），
--        再随事务回滚 —— 避免"语句静默影响 0 行"被误判为成功。
--      - 状态变量的默认值一律设为"失败侧"（xs_ok/ss_ok/up_ok 预置为 true），
--        这样即使某条语句因故没执行、变量没被 :ERROR 覆盖，也不会被当成成功。
--      - 探针标记 = 'drill-rls-probe-' || 时间戳(微秒) || '-' || pid || '-' || 随机串，
--        既唯一又可追溯；三段探针共用同一个标记，便于事后定位。
--      - **不再用 DELETE 兜底**：残留只做计数断言（item 15）。出现残留说明回滚失效，
--        本步直接 FAIL，数据留给排查；用删除"抹平"反而会掩盖异常。
--      - 测试前把六表行数、全库业务指纹、messages 序列的 (last_value, is_called)
--        一并写入 drill_meta.rls_baseline，测试后比对（item 16 / 17 / 18），
--        证明 32 条真实记录既没有增删、字段没被改、序列也回到原状态。
--
--   5) **判定只看 SQLSTATE + 消息关键字**：
--      跨空间写入必须 `sqlstate = '42501'` **且** 消息含 `row-level security` 才算被 RLS 拒绝。
--      其他任何错误（包括同样 42501 但消息是 permission denied for ...）一律 FAIL，
--      不会被当成"隔离生效"。
--
--   6) **不输出任何身份或业务字段**：只打印计数、布尔、SQLSTATE 与判定，
--      不打印 owner_id、空间口令、昵称、备注、错误原文。
--
-- 前置：00_harness.sql、10_tables.sql、20_import.sql、30_postload.sql 已成功
-- 运行：psql -v ON_ERROR_STOP=1 -f 45_rls_test.sql
-- 退出码：0 = 18 项全 PASS；非零 = 存在 INCONCLUSIVE / FAIL（raise + ON_ERROR_STOP）
--
-- 回滚边界（必须知道）：
--   1. 三段探针都在显式事务内，正常路径一定走到 ROLLBACK。
--   2. 若 psql 因 SQL 错误退出、元命令报错退出、被 Ctrl-C 中断，或容器/连接断开，
--      未提交事务由服务端自动回滚 —— 这是 PostgreSQL 的连接级保证，不依赖脚本。
--   3. 服务端崩溃、容器被 kill 同理：恢复时未提交事务一律回滚，不会留下行。
--   4. 真正能留下行的只有两种情况：①有人把脚本里的 ROLLBACK 改成 COMMIT；
--      ②有人在事务外手工执行探针语句。这两种都不属于本脚本的正常执行路径。
--   5. 因此本脚本不用 DELETE 兜底：残留是"信号"，不是"垃圾"，删掉会掩盖问题。
--      真出现残留时 item 15 会判 FAIL，正确处置是重建演练库，而不是继续使用。
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\echo ''
\echo '=== 45 · RLS 测试开始（18 项） ==='

-- ===========================================================================
-- A · 依赖自检（postgres 身份；不通过直接中止）
--   先排掉"权限不足"与"RLS 拒绝"同为 42501 的混淆：
--   RLS 的 USING / WITH CHECK 以调用者身份求值，表达式里直接调 auth.uid()，
--   若 authenticated 没有 auth 的 USAGE，报的就是 42501 permission denied，
--   会被后面的判定误当成"隔离生效"。
-- ===========================================================================
do $$
declare
  v_definer boolean;
  v_priv    boolean;
begin
  select bool_and(p.prosecdef) into v_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('my_space_ids', 'space_peek');

  select has_schema_privilege('authenticated', 'auth',   'USAGE')
     and has_schema_privilege('authenticated', 'public', 'USAGE')
     and has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.my_space_ids()', 'EXECUTE')
     into v_priv;

  if not coalesce(v_definer, false) then
    raise exception 'DRILL-FAIL: my_space_ids / space_peek 不是 SECURITY DEFINER';
  end if;
  if not coalesce(v_priv, false) then
    raise exception 'DRILL-FAIL: authenticated 缺 schema USAGE 或函数 EXECUTE，'
                    '此时 42501 无法区分"RLS 拒绝"与"权限不足"';
  end if;
end $$;

select p.proname                                                  as function_name,
       p.prosecdef                                                as security_definer,
       pg_get_userbyid(p.proowner)                                as owner,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in ('my_space_ids', 'space_peek'))
   or (n.nspname = 'auth'   and p.proname = 'uid')
order by 1;

-- ===========================================================================
-- B · 记账表与基线表（只有计数与判定，无业务字段）
-- ===========================================================================
create schema if not exists drill_meta;
grant usage on schema drill_meta to authenticated;

drop view  if exists drill_meta.rls_verdict;
drop table if exists drill_meta.rls_actual;
drop table if exists drill_meta.rls_expect;
drop table if exists drill_meta.rls_baseline;

create table drill_meta.rls_expect (
  ord      int primary key,
  item     text not null,
  cmp      text not null,      -- eq / lt / rls
  expected text not null
);

create table drill_meta.rls_actual (
  ord      int primary key,
  item     text,
  actual   text,
  sqlstate text,
  errmsg   text,               -- 只在判定里判断"是否含关键字"，不外显
  actor    text
);

-- 测试前基线：六表行数 + 全库业务指纹（键名 profiles..messages / fp）
create table drill_meta.rls_baseline (
  k text primary key,
  v text not null
);

grant select, insert on drill_meta.rls_actual to authenticated;

-- 全库业务指纹：把六表每行 to_jsonb 后按 id 排序拼接再取 md5。
-- 只用于"测试前后是否被改"的等值比较，不用于判断数据对不对（那是 Step 8 的事）。
create or replace function drill_meta.biz_fingerprint()
returns text
language sql
stable
as $fn$
  select md5(coalesce(string_agg(t || '|' || coalesce(j, '<empty>'), '||' order by t), '<none>'))
  from (
              select 'profiles'::text as t,
                     (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.profiles x) as j
    union all select 'records'::text,
                     (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.records  x)
    union all select 'todos'::text,
                     (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.todos    x)
    union all select 'tags'::text,
                     (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.tags     x)
    union all select 'rewards'::text,
                     (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.rewards  x)
    union all select 'messages'::text,
                     (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.messages x)
  ) s
$fn$;

-- 函数默认 PUBLIC EXECUTE；它读全库，收紧到只有 psql 的 postgres 会话能调用
revoke all on function drill_meta.biz_fingerprint() from public;

-- ===========================================================================
-- C · 计算预期与基线（postgres 身份，不受 RLS 影响）
-- ===========================================================================
do $$
declare
  v_uid     text;
  v_own     text;      -- 仅用于"同空间写入"探针，不输出
  v_foreign text;      -- 真正不属于该用户的空间；找不到为 NULL
  v_fprof   bigint;    -- 他组空间里的一条 profile id，仅用于 UPDATE 探针
  c         int;
begin
  select owner_id, space_id into v_uid, v_own
    from public.profiles
   order by id
   limit 1;

  if v_uid is null then
    raise exception 'DRILL-FAIL: profiles 为空，无法进行 RLS 测试';
  end if;

  -- 基于 owner 的**全部**空间成员关系找一个我确实不属于的空间
  select p.space_id into v_foreign
    from public.profiles p
   where p.space_id not in (
           select space_id from public.profiles where owner_id = v_uid
         )
   order by p.space_id
   limit 1;

  -- 该他组空间里的一行（构造上必然存在：v_foreign 就是从 profiles 里选出来的）
  select p.id into v_fprof
    from public.profiles p
   where p.space_id = v_foreign
   order by p.id
   limit 1;

  -- 身份与空间通过会话 GUC 传递，不走 psql 变量拼接，也不会被打印
  --   pactfit.uid        —— harness 里 auth.uid() 桩读的就是这个（必须设，否则桩返回全零占位）
  --   pactfit.expect_uid —— 只用于第 2 项比对"桩是否返回了测试身份"
  perform set_config('pactfit.uid',         v_uid, false);
  perform set_config('pactfit.expect_uid',  v_uid, false);
  perform set_config('pactfit.own_space',     v_own, false);
  perform set_config('pactfit.foreign_space', coalesce(v_foreign, ''), false);
  perform set_config('pactfit.has_foreign',
                     case when v_foreign is null then 'false' else 'true' end, false);
  perform set_config('pactfit.foreign_profile_id', coalesce(v_fprof::text, ''), false);
  -- 探针标记：时间戳(微秒) + 后端 pid + 随机串 —— 唯一、可追溯，且能用 like 精确定位
  perform set_config(
    'pactfit.probe_marker',
    'drill-rls-probe-'
      || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
      || '-' || pg_backend_pid()
      || '-' || substr(md5(random()::text), 1, 8),
    false);

  -- -------------------------------------------------------------------------
  -- 基线：六表行数 + 业务指纹 + messages 序列原始状态（测试后 item 16/17/18 比对）
  --   序列必须存 (last_value, is_called)，不能只存 max(id)：
  --   空表的 is_called 决定"下一次 nextval 是 1 还是 2"，推算会丢信息。
  -- -------------------------------------------------------------------------
  insert into drill_meta.rls_baseline (k, v)
            select 'profiles', count(*)::text from public.profiles
  union all select 'records',  count(*)::text from public.records
  union all select 'todos',    count(*)::text from public.todos
  union all select 'tags',     count(*)::text from public.tags
  union all select 'rewards',  count(*)::text from public.rewards
  union all select 'messages', count(*)::text from public.messages
  union all select 'fp',       drill_meta.biz_fingerprint()
  union all select 'msg_seq_last',   last_value::text from public.messages_id_seq
  union all select 'msg_seq_called', is_called::text from public.messages_id_seq;

  -- 1 执行身份
  insert into drill_meta.rls_expect values (1, '执行身份', 'eq', 'authenticated');

  -- 2 auth.uid() 是否等于测试身份
  insert into drill_meta.rls_expect values (2, 'auth.uid() 等于测试身份', 'eq', 'true');

  -- 3 可见空间数（以 profiles 里能看到的 space_id 去重计）
  select count(distinct space_id) into c
    from public.profiles where owner_id = v_uid;
  insert into drill_meta.rls_expect values (3, '可见空间数（distinct space_id）', 'eq', c::text);

  -- 4 my_space_ids() 返回的空间数
  insert into drill_meta.rls_expect values (4, 'my_space_ids() 空间数', 'eq', c::text);

  -- 5–9 我**全部空间**内的可见行数
  select count(*) into c
    from public.profiles
   where space_id in (select space_id from public.profiles where owner_id = v_uid);
  insert into drill_meta.rls_expect values (5, 'profiles 可见行数（我全部空间）', 'eq', c::text);

  select count(*) into c
    from public.records
   where space_id in (select space_id from public.profiles where owner_id = v_uid);
  insert into drill_meta.rls_expect values (6, 'records 可见行数（我全部空间）', 'eq', c::text);

  select count(*) into c
    from public.todos
   where space_id in (select space_id from public.profiles where owner_id = v_uid);
  insert into drill_meta.rls_expect values (7, 'todos 可见行数（我全部空间）', 'eq', c::text);

  select count(*) into c
    from public.tags
   where space_id in (select space_id from public.profiles where owner_id = v_uid);
  insert into drill_meta.rls_expect values (8, 'tags 可见行数（我全部空间）', 'eq', c::text);

  select count(*) into c
    from public.messages
   where space_id in (select space_id from public.profiles where owner_id = v_uid);
  insert into drill_meta.rls_expect values (9, 'messages 可见行数（我全部空间）', 'eq', c::text);

  -- 10 未授权空间可见行数（USING 过滤下应完全不可见）
  insert into drill_meta.rls_expect values (10, '未授权空间可见行数', 'eq', '0');

  -- 11 跨空间写入：必须 42501 且消息含 row-level security
  insert into drill_meta.rls_expect values (11, '跨空间写入（他组空间）', 'rls', '42501 + row-level security');

  -- 12 同空间写入：应真正写入 1 行（returning id 证明），随后回滚
  insert into drill_meta.rls_expect values (12, '同空间写入（应成功并回滚）', 'eq', 'ok');

  -- 13 隔离证据：可见 profiles 必须少于全库
  select count(*) into c from public.profiles;
  insert into drill_meta.rls_expect values (13, '隔离证据：可见 profiles < 全库', 'lt', c::text);

  -- 14 跨空间 UPDATE：USING 应把目标行过滤掉 → 影响 0 行（不是报错）
  insert into drill_meta.rls_expect values (14, '跨空间 UPDATE（USING 过滤）影响行数', 'eq', '0');

  -- 15 探针残留必须为 0（三段探针全部无条件回滚）
  insert into drill_meta.rls_expect values (15, '探针行残留', 'eq', '0');

  -- 16 测试前后六表行数不变
  insert into drill_meta.rls_expect values (16, '六表行数未变（对比测试前基线）', 'eq', 'unchanged');

  -- 17 测试前后业务数据指纹不变（字段值未被改）
  insert into drill_meta.rls_expect values (17, '业务数据指纹未变（对比测试前基线）', 'eq', 'unchanged');

  -- 18 messages identity 序列回到测试前的 (last_value, is_called)
  insert into drill_meta.rls_expect values (18, 'messages 序列状态未变（对比测试前基线）', 'eq', 'unchanged');
end $$;

-- psql 层用来分支的，只有一个布尔
select current_setting('pactfit.has_foreign') as has_foreign \gset

-- 基线回显（只有计数，无业务数据；序列状态不打印，只在 item 18 里比对）
select k as baseline_item, v as value
from drill_meta.rls_baseline
where k in ('profiles','records','todos','tags','rewards','messages')
order by array_position(array['profiles','records','todos','tags','rewards','messages'], k);

-- ===========================================================================
-- D · 切到 authenticated（session 级；整段 SQL 都以该角色执行）
--     此后直到 `reset role` 之前，不存在任何其他角色切换。
-- ===========================================================================
set role authenticated;

-- 1 · 执行身份（若 SET ROLE 没生效，这里会显示 postgres → FAIL）
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (1, '执行身份', current_user, current_user);

-- 2 · auth.uid() 桩是否返回测试身份（只落 true/false，不落 uid）
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 2, 'auth.uid() 等于测试身份',
       case when auth.uid() = current_setting('pactfit.expect_uid') then 'true' else 'false' end,
       current_user;

-- 3 · 可见空间数
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 3, '可见空间数（distinct space_id）', count(distinct space_id)::text, current_user
from public.profiles;

-- 4 · my_space_ids() 返回空间数
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 4, 'my_space_ids() 空间数', count(*)::text, current_user
from public.my_space_ids();

-- 5–9 · 各表可见行数
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 5, 'profiles 可见行数（我全部空间）', count(*)::text, current_user from public.profiles;

insert into drill_meta.rls_actual (ord, item, actual, actor)
select 6, 'records 可见行数（我全部空间）', count(*)::text, current_user from public.records;

insert into drill_meta.rls_actual (ord, item, actual, actor)
select 7, 'todos 可见行数（我全部空间）', count(*)::text, current_user from public.todos;

insert into drill_meta.rls_actual (ord, item, actual, actor)
select 8, 'tags 可见行数（我全部空间）', count(*)::text, current_user from public.tags;

insert into drill_meta.rls_actual (ord, item, actual, actor)
select 9, 'messages 可见行数（我全部空间）', count(*)::text, current_user from public.messages;

-- 10 · 未授权空间可见性
\if :has_foreign
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 10, '未授权空间可见行数', count(*)::text, current_user
from public.profiles
where space_id = current_setting('pactfit.foreign_space');
\else
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (10, '未授权空间可见行数', 'INCONCLUSIVE', current_user);
\endif

-- 11 · 跨空间写入：显式事务 + 无条件 ROLLBACK
--      无论被拒绝还是（隔离失效时）写成功，事务结束都撤销，不依赖语句自身回滚
\if :has_foreign
-- 默认值取"失败侧"：即使语句因故没执行、:ERROR 没覆盖过来，也不会被当成成功
\set xs_ok true
\set xs_state ''
\set xs_msg ''
\set ON_ERROR_STOP off
begin;
insert into public.messages (owner_name, space_id, text)
values (current_setting('pactfit.probe_marker'),
        current_setting('pactfit.foreign_space'),
        'rls probe');
\set xs_ok :ERROR
\set xs_state :SQLSTATE
\set xs_msg :LAST_ERROR_MESSAGE
rollback;
\set ON_ERROR_STOP on
\if :xs_ok
-- 有报错：把 SQLSTATE 与消息原文交给判定视图，只有 42501 + row-level security 才算 PASS
insert into drill_meta.rls_actual (ord, item, actual, sqlstate, errmsg, actor)
values (11, '跨空间写入（他组空间）', '被拒绝', :'xs_state', :'xs_msg', current_user);
\else
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (11, '跨空间写入（他组空间）', '未被拦截', current_user);
\endif
\else
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (11, '跨空间写入（他组空间）', 'INCONCLUSIVE', current_user);
\endif

-- 12 · 同空间写入：显式事务 + returning id 证明"确实写入"，随后无条件 ROLLBACK
--      ss_id 默认 0（= 没拿到行）；ss_ok 默认 true（= 没成功）
\set ON_ERROR_STOP off
\set ss_ok true
\set ss_id 0
\set ss_state ''
\set ss_msg ''
begin;
insert into public.messages (owner_name, space_id, text)
values (current_setting('pactfit.probe_marker'),
        current_setting('pactfit.own_space'),
        'own-space probe')
returning id \gset ss_
\set ss_ok :ERROR
\set ss_state :SQLSTATE
\set ss_msg :LAST_ERROR_MESSAGE
rollback;
\set ON_ERROR_STOP on

\if :ss_ok
insert into drill_meta.rls_actual (ord, item, actual, sqlstate, errmsg, actor)
values (12, '同空间写入（应成功并回滚）', '失败', :'ss_state', :'ss_msg', current_user);
\else
-- 没有报错还不够：必须真的拿到一个正数 id，才算"写入成功"
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (12, '同空间写入（应成功并回滚）',
        case when :ss_id::bigint > 0 then 'ok' else 'no-row-written' end,
        current_user);
\endif

-- 13 · 隔离证据（此处只落一个计数，比较在视图里做）
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 13, '隔离证据：可见 profiles < 全库', count(*)::text, current_user from public.profiles;

-- 14 · 跨空间 UPDATE：WHERE 用 postgres 侧算好的他组行 id，
--      USING 应把该行过滤掉 → 影响 0 行且不报错（与"看不见"是两件事）。
--      语句是 no-op 自赋值（nickname = nickname），即使隔离失效也不会改动内容；
--      外加事务无条件 ROLLBACK，双保险。
\if :has_foreign
\set ON_ERROR_STOP off
\set up_ok true
\set up_rows -1
begin;
with u as (
  update public.profiles
     set nickname = nickname
   where id = current_setting('pactfit.foreign_profile_id')::bigint
  returning 1
)
select count(*) as rows from u \gset up_
\set up_ok :ERROR
rollback;
\set ON_ERROR_STOP on
\if :up_ok
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (14, '跨空间 UPDATE（USING 过滤）影响行数', 'error-or-filtered-unexpectedly', current_user);
\else
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (14, '跨空间 UPDATE（USING 过滤）影响行数',
        case when :up_rows = '0' then '0' else 'rows:' || :up_rows end,
        current_user);
\endif
\else
insert into drill_meta.rls_actual (ord, item, actual, actor)
values (14, '跨空间 UPDATE（USING 过滤）影响行数', 'INCONCLUSIVE', current_user);
\endif

-- ===========================================================================
-- E · 回到 postgres：残留核查、序列恢复、前后不变量、判定
-- ===========================================================================
reset role;

-- 15 · 探针残留（三段探针都已无条件回滚，这里应为 0）
--      注意：**不在这里 DELETE**。残留 = 回滚链路失效的信号，
--      删掉只会让 item 15 之外的人看不到异常；正确处置是判 FAIL 后重建演练库。
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 15, '探针行残留', count(*)::text, current_user
from public.messages
where owner_name = current_setting('pactfit.probe_marker');

-- 序列恢复：按测试前的 (last_value, is_called) 原样写回，而不是按 max(id) 推算。
-- nextval 不随事务回滚，同空间写入探针会让 messages 序列前进一格。
select setval(
         pg_get_serial_sequence('public.messages', 'id')::regclass,
         (select v::bigint  from drill_meta.rls_baseline where k = 'msg_seq_last'),
         (select v::boolean from drill_meta.rls_baseline where k = 'msg_seq_called')
       ) as messages_seq_restored;

-- 16 · 六表行数与测试前基线一致
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 16, '六表行数未变（对比测试前基线）',
       case when
         (select string_agg(v, ',' order by array_position(
                    array['profiles','records','todos','tags','rewards','messages'], k))
            from drill_meta.rls_baseline
           where k in ('profiles','records','todos','tags','rewards','messages'))
         =
         (select string_agg(n::text, ',' order by array_position(
                    array['profiles','records','todos','tags','rewards','messages'], t))
            from (
                        select 'profiles'::text as t, count(*) as n from public.profiles
              union all select 'records'::text,  count(*) from public.records
              union all select 'todos'::text,    count(*) from public.todos
              union all select 'tags'::text,     count(*) from public.tags
              union all select 'rewards'::text,  count(*) from public.rewards
              union all select 'messages'::text, count(*) from public.messages
            ) x)
       then 'unchanged' else 'changed' end,
       current_user;

-- 17 · 业务数据指纹与测试前基线一致（32 条记录的字段值一个都没变）
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 17, '业务数据指纹未变（对比测试前基线）',
       case when (select v from drill_meta.rls_baseline where k = 'fp')
                 = drill_meta.biz_fingerprint()
            then 'unchanged' else 'changed' end,
       current_user;

-- 18 · messages 序列状态与测试前一致（last_value 与 is_called 都要相等）
insert into drill_meta.rls_actual (ord, item, actual, actor)
select 18, 'messages 序列状态未变（对比测试前基线）',
       case when (select v from drill_meta.rls_baseline where k = 'msg_seq_last')
                 = (select last_value::text from public.messages_id_seq)
             and (select v from drill_meta.rls_baseline where k = 'msg_seq_called')
                 = (select is_called::text from public.messages_id_seq)
            then 'unchanged' else 'changed' end,
       current_user;

-- 判定视图：一条 SQL 定义清楚三种比较规则
create or replace view drill_meta.rls_verdict as
select e.ord,
       e.item,
       e.cmp,
       e.expected,
       a.actual,
       a.sqlstate,
       a.actor,
       case
         when a.actual is null                          then 'FAIL'
         when a.actual = 'INCONCLUSIVE'                 then 'INCONCLUSIVE'
         when e.cmp = 'eq'                              then
           case when a.actual = e.expected then 'PASS' else 'FAIL' end
         when e.cmp = 'lt'                              then
           case when a.actual ~ '^[0-9]+$'
                     and a.actual::numeric < e.expected::numeric
                then 'PASS' else 'FAIL' end
         when e.cmp = 'rls'                             then
           -- 只有 42501 且消息含 row-level security 才算被 RLS 拒绝；
           -- 42501 的 permission denied、23502 的 NOT NULL 等一律 FAIL
           case when a.sqlstate = '42501'
                     and coalesce(a.errmsg, '') ilike '%row-level security%'
                then 'PASS' else 'FAIL' end
         else 'FAIL'
       end as verdict,
       case
         when e.cmp = 'rls' then
           'sqlstate=' || coalesce(a.sqlstate, 'NULL')
           || ', 消息含 row-level security='
           || case when coalesce(a.errmsg, '') ilike '%row-level security%'
                   then 'true' else 'false' end
         when e.cmp = 'lt' then '要求 < ' || e.expected
         when a.actual = 'INCONCLUSIVE' then '只存在一个空间，无法验证跨空间隔离'
         else null
       end as detail
from drill_meta.rls_expect e
left join drill_meta.rls_actual a on a.ord = e.ord;

select ord, item, cmp, expected, actual, verdict, detail
from drill_meta.rls_verdict
order by ord;

-- ===========================================================================
-- F · 终局判定：任一非 PASS → raise → 非零退出
-- ===========================================================================
do $$
declare
  v_fail int;
  v_incon int;
begin
  select count(*) filter (where verdict = 'FAIL'),
         count(*) filter (where verdict = 'INCONCLUSIVE')
    into v_fail, v_incon
    from drill_meta.rls_verdict;

  if v_fail > 0 or v_incon > 0 then
    raise exception 'DRILL-FAIL: RLS 测试 FAIL % 项 / INCONCLUSIVE % 项，本步不通过',
                    v_fail, v_incon;
  end if;
  raise notice 'PASS: RLS 测试 18 项全部通过';
end $$;

\echo '=== 45 · RLS 测试结束 ==='
\echo ''
