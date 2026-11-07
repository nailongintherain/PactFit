-- =============================================================================
-- 30_postload.sql —— 导入后修正 identity 序列（含撞号探针与序列复原）
--
-- 为什么必须做：
--   导入用 OVERRIDING SYSTEM VALUE 保留了原始 id，但 identity 序列仍停在初始值，
--   下一次真实插入会撞主键（23505）。
--
-- 三条关键事实（本文件据此设计，均已在文档中标注依据）：
--   1. setval 的第一个参数虽然有 text→regclass 的隐式转换，但版本间行为不稳，
--      这里统一显式 ::regclass，避免报
--      "function setval(text, bigint, boolean) does not exist"（42883）。
--   2. nextval 是**非事务性**的：即使 INSERT 回滚，序列也已经前进。
--      所以探针会消耗一个号，必须在探针后把序列重置回 max(id)，否则留下空洞。
--   3. 空表要 setval(seq, 1, false)，让下一次 nextval 返回 1；
--      若用 setval(seq, 1, true)，下一次会返回 2，与"全新表"语义不符。
--
-- 状态：本文件尚未实际执行（Phase 1-c-fix 阶段未启动 Docker、未建库、未导入）。
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------------------
-- 第一部分：按 max(id) 对齐 6 个序列
-- ---------------------------------------------------------------------------
do $$
declare
  tbl      text;
  seq_name regclass;
  mx       bigint;
begin
  foreach tbl in array array['profiles','records','todos','tags','rewards','messages']
  loop
    seq_name := pg_get_serial_sequence('public.' || tbl, 'id')::regclass;

    if seq_name is null then
      raise exception '表 public.% 没有 identity 序列，停手', tbl;
    end if;

    execute format('select coalesce(max(id), 0) from public.%I', tbl) into mx;

    if mx > 0 then
      perform setval(seq_name, mx, true);    -- 下一个 nextval = mx + 1
    else
      perform setval(seq_name, 1, false);    -- 空表：下一个 nextval = 1
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 第二部分：核对（走 pg_sequences 视图，是文档化 API，不依赖内部函数）
--   注意：pg_sequences **没有 is_called 列**（只有 last_value）。
--         "从没被取过号"表现为 last_value IS NULL；
--         setval(seq, 1, false) 之后 last_value 就是 1，下一次 nextval 返回 1。
--   期望：last_value = greatest(max_id, 1)，即空表为 1、非空表等于 max_id
-- ---------------------------------------------------------------------------
select t.tbl                                   as table_name,
       t.mx                                    as max_id,
       s.last_value                            as seq_last_value,
       (s.last_value = greatest(t.mx, 1))      as seq_ok
from (
  select 'profiles' as tbl, coalesce(max(id),0) as mx from public.profiles
  union all select 'records',  coalesce(max(id),0) from public.records
  union all select 'todos',    coalesce(max(id),0) from public.todos
  union all select 'tags',     coalesce(max(id),0) from public.tags
  union all select 'rewards',  coalesce(max(id),0) from public.rewards
  union all select 'messages', coalesce(max(id),0) from public.messages
) t
left join pg_sequences s
       on s.schemaname = 'public'
      and s.sequencename = split_part(
            pg_get_serial_sequence('public.' || t.tbl, 'id'), '.', 2)
order by array_position(array['profiles','records','todos','tags','rewards','messages'], t.tbl::text);

-- ---------------------------------------------------------------------------
-- 第三部分：撞号探针
--   在事务里插一条再回滚 —— 业务行不会留下，但 nextval 已经消耗。
--   所以回滚后必须把序列重新 setval 回 max(id)，否则会留下一个空洞。
--   探针依赖 owner_id 的默认值 auth.uid()（harness 的占位值）来满足 NOT NULL，
--   且以超级用户身份执行、绕过 RLS —— 这正是本步要的"纯序列行为"。
-- ---------------------------------------------------------------------------
begin;

insert into public.todos (owner_name, space_id, text, sort)
values ('drill-probe', 'FIT-DRILL', 'sequence probe', 0)
returning id as probe_todo_id;

-- 期望：probe_todo_id = todos.max(id) + 1（本基线为 10）
rollback;

-- 复原序列（nextval 不随事务回滚，必须显式重置）
select setval(
         pg_get_serial_sequence('public.todos', 'id')::regclass,
         coalesce((select max(id) from public.todos), 1),
         (select max(id) from public.todos) is not null
       ) as todos_seq_restored;

-- 复原后核对：序列值回到 max(id)、行数没变、探针没留下
select (select last_value from pg_sequences
         where schemaname='public' and sequencename='todos_id_seq')      as todos_seq_last_value,
       (select max(id) from public.todos)                                as todos_max_id,
       (select count(*) from public.todos)                               as todos_rows,
       (select count(*) from public.todos where owner_name = 'drill-probe') as probe_rows_left;
-- 期望：9 / 9 / 9 / 0
