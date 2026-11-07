-- =============================================================
-- 999_verify-live-schema.sql
-- 用途：在「减脂搭子」这个应用所属的 WorkBuddy 工作区里，对线上云数据库
--       执行下面这些**只读**查询，拿到权威的 schema / 权限 / 函数原文，
--       再用结果覆盖 001~003 的推断稿。
--
-- 怎么执行：
--   1. 在当初构建该应用的那个工作区打开对话（不是本仓库所在目录）
--   2. 让它调用云服务的数据库工具，模式选 read（只读）
--   3. 一次只跑一条（工具不支持多语句），把结果贴回本文件末尾的「实跑结果」
--
-- 全部为 SELECT，不写不删不改。行数统计不含任何个人数据。
-- =============================================================


-- [1] 表清单 + 是否开启 RLS + 表注释
select c.relname                as table_name,
       c.relrowsecurity         as rls_enabled,
       c.relforcerowsecurity    as rls_forced,
       obj_description(c.oid)   as comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;


-- [2] 全部列：名称、类型、可空、默认值、注释（关键：确认 tags/todo_done 是 jsonb 还是 text[]）
select table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;


-- [3] 约束：主键、唯一、外键、check（确认有没有 (space_id, owner_id) 唯一约束）
select tc.table_name,
       tc.constraint_name,
       tc.constraint_type,
       kcu.column_name,
       cc.check_clause
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name
      and kcu.table_schema = tc.table_schema
left join information_schema.check_constraints cc
       on cc.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
order by tc.table_name, tc.constraint_type, tc.constraint_name;


-- [4] 索引（判断前端 order by 是否有索引支撑）
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;


-- [5] RLS 策略原文（最重要：002 的推断全靠它校正）
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- [6] 自定义函数原文（space_peek 的真实实现）
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                              as security_definer,
       l.lanname                                as language,
       pg_get_functiondef(p.oid)                as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language  l on l.oid = p.prolang
where n.nspname = 'public'
order by p.proname;


-- [7] 触发器（是否有自动写 owner_id / updated_at 的触发器）
select event_object_table as table_name,
       trigger_name,
       event_manipulation,
       action_timing,
       action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by table_name, trigger_name;


-- [8] 表权限（GRANT 到哪些角色；42501 类问题的根源）
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated','service_role')
order by table_name, grantee, privilege_type;


-- [9] 数据体量（只数行，不取内容；用于评估导出与迁移耗时）
select 'profiles' as t, count(*) from public.profiles
union all select 'records',  count(*) from public.records
union all select 'todos',    count(*) from public.todos
union all select 'tags',     count(*) from public.tags
union all select 'rewards',  count(*) from public.rewards
union all select 'messages', count(*) from public.messages;


-- [10] 空间分布（只输出空间口令与人数，不含昵称与体重）
select space_id, count(*) as members
from public.profiles
group by space_id
order by space_id;


-- =============================================================
-- 实跑结果（执行后粘贴到这里，作为 v1 权威版本入库）
-- =============================================================

-- [1]
-- [2]
-- [3]
-- [4]
-- [5]
-- [6]
-- [7]
-- [8]
-- [9]
-- [10]
