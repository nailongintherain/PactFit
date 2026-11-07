-- =============================================================================
-- 10_tables.sql —— 演练用建表脚本【公开脱敏版】
--
-- ⚠️ 本文件为公开示例，不能复现历史 RLS 18/18 验收结果。
--    RLS 策略表达式（USING / WITH CHECK）与 SECURITY DEFINER 函数体均以
--    示意形式呈现，不是线上原文；逐字原始版仅存于私有归档（drill-as-run/），
--    不在本仓库。
--
-- 来源：backend/schema/schema-reference.sql（脱敏结构参考）。
--       生产快照原件仅存私有归档，不在本仓库。
-- 前置：00_harness.sql 已执行成功（原始演练流程）。
--
-- 公开版相对原始演练脚本的主要差异：
--   [差异 1] 两个 SECURITY DEFINER 函数体改为"语义等价的示意实现"，非线上原文。
--   [差异 2] 6 条 RLS 策略仅保留策略名与元信息，USING / WITH CHECK 表达式不公开。
--   [差异 3] 函数与表级授权仅保留最小化描述，生产授权矩阵细节不披露。
--   [差异 4] 删除 8 条 CREATE UNIQUE INDEX
--            （PK / UNIQUE 约束在建表时已隐式创建同名索引，重复创建会报 42P07）。
--   [差异 5] 把 2 个函数移到策略之前（CREATE POLICY 依赖 my_space_ids()，
--            顺序颠倒会报 42883）。
--
-- 表结构、列类型、可空性、默认值、唯一约束：与生产结构一致，未做"优化"。
-- ⚠️ 由于策略与函数以示意形式呈现，本文件不再保证可直接执行，仅用于阅读与结构参考。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 表
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            bigint generated always as identity not null,
  owner_id      text        not null default auth.uid(),
  owner_name    text,
  space_id      text        not null,
  nickname      text        not null,
  role          text        not null default 'her'::text,
  start_weight  numeric(5,1),
  target_weight numeric(5,1),
  target_date   date,
  created_at    timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_owner_space_key unique (owner_id, space_id)
);

create table public.records (
  id          bigint generated always as identity not null,
  owner_id    text        not null default auth.uid(),
  owner_name  text,
  space_id    text        not null,
  record_date date        not null,
  weight      numeric(5,1) not null,
  tags        jsonb        default '[]'::jsonb,
  todo_done   jsonb        default '[]'::jsonb,
  mood        text,
  note        text,
  created_at  timestamptz not null default now(),
  constraint records_pkey primary key (id),
  constraint records_owner_date_space_key unique (owner_id, record_date, space_id)
);

create table public.tags (
  id         bigint generated always as identity not null,
  owner_id   text        not null default auth.uid(),
  owner_name text,
  space_id   text        not null,
  text       text        not null,
  sort       integer     not null default 0,
  created_at timestamptz not null default now(),
  constraint tags_pkey primary key (id)
);

create table public.todos (
  id         bigint generated always as identity not null,
  owner_id   text        not null default auth.uid(),
  owner_name text,
  space_id   text        not null,
  text       text        not null,
  sort       integer     not null default 0,
  created_at timestamptz not null default now(),
  constraint todos_pkey primary key (id)
);

create table public.rewards (
  id             bigint generated always as identity not null,
  owner_id       text        not null default auth.uid(),
  owner_name     text,
  space_id       text        not null,
  condition_text text        not null,
  target_weight  numeric(5,1),
  prize          text        not null,
  promise_by     text        not null,
  status         text        not null default 'active'::text,
  achieved_at    timestamptz,
  redeemed_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint rewards_pkey primary key (id)
);

create table public.messages (
  id         bigint generated always as identity not null,
  owner_id   text        not null default auth.uid(),
  owner_name text,
  space_id   text        not null,
  text       text        not null,
  created_at timestamptz not null default now(),
  constraint messages_pkey primary key (id)
);

-- ---------------------------------------------------------------------------
-- 函数（必须在策略之前）
-- ⚠️ 以下函数体为示意实现，非线上原文；SECURITY DEFINER 函数体的生产原文
--    仅存于私有归档，不在本仓库公开。
-- ---------------------------------------------------------------------------
create or replace function public.my_space_ids()
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 示意实现：返回当前用户所属的空间标识集合。
  select distinct space_id
  from profiles
  where owner_id = auth.uid()
$function$;

create or replace function public.space_peek(code text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 示意实现：按空间标识返回成员概要（数量与昵称列表）。
  with member as (
    select nickname
    from profiles
    where space_id = upper(trim(code))
  )
  select jsonb_build_object(
    'count', (select count(*) from member),
    'names', (select coalesce(jsonb_agg(nickname), '[]'::jsonb) from member)
  )
$function$;

-- 函数级授权（EXECUTE）矩阵不在公开版披露；演练库按最小化原则仅对
-- authenticated 开放，生产口径差异见 backend/schema/schema-reference.sql 的元信息说明。

-- ---------------------------------------------------------------------------
-- RLS（元信息版）
--
-- 生产结构：每表 1 条 FOR ALL TO authenticated 策略，共 6 条，策略名如下：
--   profiles_space_all / records_space_all / tags_space_all /
--   todos_space_all / rewards_space_all / messages_space_all
--
-- ⚠️ 各策略的 USING / WITH CHECK 表达式不在公开版披露；
--    完整原文仅存于私有归档。公开示例不能复现历史 RLS 18/18 验收结果。
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.records  enable row level security;
alter table public.tags     enable row level security;
alter table public.todos    enable row level security;
alter table public.rewards  enable row level security;
alter table public.messages enable row level security;

-- ---------------------------------------------------------------------------
-- 授权（最小化描述）
-- 演练库仅授予 authenticated 六表 CRUD 与序列使用；生产授权矩阵细节
-- 不在公开版披露。
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.profiles, public.records, public.todos,
  public.tags, public.rewards, public.messages
  to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 结构自检（原始演练流程用；公开版因策略与函数为示意形式，不可直接执行）
--
-- 原始流程期望：6 张表 / 6 条策略 / 2 个函数 / 2 个唯一约束 / 0 个 CHECK
--
-- CHECK 为什么不用 information_schema.check_constraints 统计：
--   PostgreSQL 17 的该视图会把**每一个 NOT NULL 列**也暴露成一条
--   `2200_<oid>_<attnum>_not_null`，check_clause 形如 `col IS NOT NULL`。
--   本演练 6 表共 37 个 NOT NULL 列，用它统计会得到 37 而不是 0，
--   属于视图口径差异，不是真的混进了 CHECK 约束。
--   权威口径是 pg_constraint.contype='c'（c=CHECK，n=NOT NULL，f=FK）。
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE')                  as tables,
  (select count(*) from pg_policies where schemaname='public')                 as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('my_space_ids','space_peek'))  as functions,
  (select count(*) from information_schema.table_constraints
     where table_schema='public' and constraint_type='UNIQUE')                 as uniques,
  (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
     where n.nspname='public' and c.contype='c')                               as checks;
-- 注：上述自检查询仅在原始演练库可得到 6 / 6 / 2 / 2 / 0；
--     公开示例不能复现历史 RLS 18/18 验收结果。
