-- #############################################################################
-- ⚠️  历史推断稿 · 仅供参考 · 禁止直接执行  ⚠️
--
-- 本文件是 2026-10-19 由前端代码反推的草稿，**已于 2026-10-21 被真实结构基线取代**。
-- 公开参考结构：backend/schema/schema-reference.sql（脱敏版）
-- 生产快照原件仅存仓库外私有归档；差异明细：docs/10-schema-gap-analysis.md
--
-- 已知错误（不要照抄）：
--   · owner_id / promise_by 真实类型是 text，不是 uuid
--   · owner_name 在 6 张表上均可空，本文件写成了 NOT NULL
--   · 真实库零 CHECK 约束，本文件多出 8 个（体重范围、文本长度、role/status 枚举）
--   · 真实库只有 PK / UNIQUE 索引，本文件多出 6 个业务索引
--   · tags / todo_done 为可空 jsonb，本文件写成了 NOT NULL
--   · rewards 的 condition_text / prize / promise_by 真实为 NOT NULL，本文件漏了
--
-- 保留本文件的唯一目的：记录推断过程与差异来源，供复盘。
-- 请勿在生产库、测试库或新库执行本文件。需要建表，请以真实基线为准。
-- #############################################################################

-- =============================================================
-- 001_tables.inferred.sql
-- 由前端读写行为反推的建表语句（迁移用起点，不是线上真实 DDL）
--
-- 使用前提：
--   1. PostgreSQL 13+
--   2. 若跑在 Supabase 上，auth.uid() 已存在；自建需自行提供同名函数
--   3. 所有 UNIQUE / INDEX / FK 都标了「推断」，执行前请用
--      backend/schema/999_verify-live-schema.sql 的查询结果核对
-- =============================================================

-- 依赖：身份函数。Supabase 自带；自建环境用下面的占位实现。
-- create schema if not exists auth;
-- create or replace function auth.uid() returns uuid language sql stable as $$
--   select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
-- $$;

-- -------------------------------------------------------------
-- profiles：一个空间一人一行。多组 = 同一 owner_id 多行。
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id            bigint generated always as identity primary key,
  owner_id      uuid        not null default auth.uid(),  -- 前端从不传，必须由服务端注入
  owner_name    text        not null,
  space_id      text        not null,
  nickname      text        not null,
  role          text        not null default 'her'
                            check (role in ('her','him')),
  start_weight  numeric(5,1),
  target_weight numeric(5,1),
  target_date   date,                                     -- ! 生产备份实证存在，但归档前端不读写（见 docs/09 §6.1）
  created_at    timestamptz not null default now(),
  -- 推断：同一人在同一空间只应有一行。线上未必有这条约束（前端靠「先查后加」防重）。
  constraint profiles_space_owner_key unique (space_id, owner_id)
);

comment on table  public.profiles is '成员档案；space_id 一行一人，多组即多行';
comment on column public.profiles.role is '仅影响旧版配色缓存，无业务含义';

-- -------------------------------------------------------------
-- records：每日记录，核心表。跨组镜像会产生多条同日记录。
-- -------------------------------------------------------------
create table if not exists public.records (
  id           bigint generated always as identity primary key,
  owner_id     uuid        not null default auth.uid(),
  owner_name   text        not null,
  space_id     text        not null,
  record_date  date        not null,          -- 前端按日粒度比较（slice(0,10)）
  weight       numeric(5,1) not null check (weight between 20 and 400),
  tags         jsonb       not null default '[]'::jsonb,  -- 也可能是 text[]，见 999 核对
  todo_done    jsonb       not null default '[]'::jsonb,  -- 元素为 todos.id
  mood         text,
  note         text,
  created_at   timestamptz not null default now(),
  -- 注意：生产备份行里**没有** updated_at，此处不建该字段（早期推断过度设计）
  -- 推断：一人一天一空间一条。前端 recOn() 先查后写，线上未必有唯一约束。
  constraint records_space_owner_date_key unique (space_id, owner_id, record_date)
);

create index if not exists records_space_date_idx on public.records (space_id, record_date);
create index if not exists records_owner_idx      on public.records (owner_id);

-- -------------------------------------------------------------
-- todos：空间共享的小目标
-- -------------------------------------------------------------
create table if not exists public.todos (
  id         bigint generated always as identity primary key,
  owner_id   uuid        not null default auth.uid(),
  owner_name text        not null,
  space_id   text        not null,
  text       text        not null check (char_length(text) <= 40),
  sort       integer     not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists todos_space_sort_idx on public.todos (space_id, sort);

-- -------------------------------------------------------------
-- tags：空间共享的标签
-- -------------------------------------------------------------
create table if not exists public.tags (
  id         bigint generated always as identity primary key,
  owner_id   uuid        not null default auth.uid(),
  owner_name text        not null,
  space_id   text        not null,
  text       text        not null check (char_length(text) <= 20),
  sort       integer     not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tags_space_sort_idx on public.tags (space_id, sort);

-- -------------------------------------------------------------
-- rewards：约定与兑现
--   owner_id   = 立约人（达标方）
--   promise_by = 兑现人（对方的 owner_id，不是 profiles.id！）
-- -------------------------------------------------------------
create table if not exists public.rewards (
  id             bigint generated always as identity primary key,
  owner_id       uuid        not null default auth.uid(),
  owner_name     text        not null,
  space_id       text        not null,
  condition_text text,
  target_weight  numeric(5,1),
  prize          text        check (char_length(prize) <= 30),
  promise_by     uuid,
  status         text        not null default 'active'
                             check (status in ('active','pending','done')),
  achieved_at    timestamptz,
  redeemed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists rewards_space_idx on public.rewards (space_id);

-- -------------------------------------------------------------
-- messages：纯追加留言
-- -------------------------------------------------------------
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  owner_id   uuid        not null default auth.uid(),
  owner_name text        not null,
  space_id   text        not null,
  text       text        not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_space_id_idx on public.messages (space_id, id);

-- -------------------------------------------------------------
-- 说明：生产备份未出现 updated_at，故不建该列与触发器。
-- 若创建者的 999 查询结果显示线上确实有 updated_at，再补这一段。
-- -------------------------------------------------------------
