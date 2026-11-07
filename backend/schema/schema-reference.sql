-- =============================================================================
-- PactFit (减脂搭子) — 生产库结构参考（脱敏版）
-- 生成时间 : 2026-10-24（由 2026-10-19 的生产结构快照脱敏而来）
-- 生成方式 : 从生产库 pg_catalog 实时读取后重写为 DDL，再按公开仓库安全口径脱敏。
--
-- 【本文件是什么 / 不是什么】
--   ✅ 是：六张业务表的完整结构（列 / 类型 / 可空 / 默认 / 约束 / 索引），
--         以及 RLS 与函数的**元信息**（策略名、命令、角色、函数签名）。
--         迁移设计（Phase 1-d）可以直接以本文件为结构输入。
--   ❌ 不是：完整生产快照。以下内容**已按公开安全口径移除**，完整原件仅存于私有归档：
--         ① 行级安全策略的 USING / WITH CHECK 表达式原文；
--         ② SECURITY DEFINER 函数的函数体原文；
--         ③ 数据库实例标识、平台内部角色名等内部资源信息。
--         因此：**不要把本文件当作"线上原文"引用，也不要用它复现历史 RLS 验收结果。**
--
-- 【与私有原件的对应关系】
--   完整原件（含上述①②③）保存在仓库外私有归档，路径见项目私有文档（不在公开仓库披露）。
--
-- 【业务行数】profiles 4 / records 1 / tags 18 / todos 9 / rewards 0 / messages 0
--             （仅为恢复验收用的计数，不含任何行级数据）
--
-- 【未覆盖项，已知且有意留空】
--   1. identity 列背后的序列由 GENERATED ALWAYS AS IDENTITY 隐式创建；
--      迁移时新库自行生成，若要保 id 一致需显式 setval。
--   2. 平台 schema（auth / storage / cloudbase_migrations 等）由云服务托管，不在本文件范围。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles —— 成员身份（一个用户在一个空间里一行）
-- 业务唯一键: (owner_id, space_id)
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id            bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  owner_id      text        NOT NULL DEFAULT auth.uid(),
  owner_name    text,
  space_id      text        NOT NULL,
  nickname      text        NOT NULL,
  role          text        NOT NULL DEFAULT 'her'::text,
  start_weight  numeric(5,1),
  target_weight numeric(5,1),
  target_date   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_owner_space_key UNIQUE (owner_id, space_id)
);

-- ---------------------------------------------------------------------------
-- records —— 每日体重打卡（一天一人一空间一条）
-- 业务唯一键: (owner_id, record_date, space_id)  ← 迁移去重必须用这个，不是 id
-- ---------------------------------------------------------------------------
CREATE TABLE public.records (
  id          bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  owner_id    text        NOT NULL DEFAULT auth.uid(),
  owner_name  text,
  space_id    text        NOT NULL,
  record_date date        NOT NULL,
  weight      numeric(5,1) NOT NULL,
  tags        jsonb       DEFAULT '[]'::jsonb,
  todo_done   jsonb       DEFAULT '[]'::jsonb,
  mood        text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT records_pkey PRIMARY KEY (id),
  CONSTRAINT records_owner_date_space_key UNIQUE (owner_id, record_date, space_id)
);

-- ---------------------------------------------------------------------------
-- tags —— 空间级共享标签（不是个人数据；前端只 insert/delete，从不 update）
-- ---------------------------------------------------------------------------
CREATE TABLE public.tags (
  id         bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  owner_id   text        NOT NULL DEFAULT auth.uid(),
  owner_name text,
  space_id   text        NOT NULL,
  text       text        NOT NULL,
  sort       integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------------
-- todos —— 空间级共享小目标（同上）
-- ---------------------------------------------------------------------------
CREATE TABLE public.todos (
  id         bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  owner_id   text        NOT NULL DEFAULT auth.uid(),
  owner_name text,
  space_id   text        NOT NULL,
  text       text        NOT NULL,
  sort       integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT todos_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------------
-- rewards —— 互相奖励的约定（状态由"提出 → 达成 → 兑现"的确认流程推进）
-- ---------------------------------------------------------------------------
CREATE TABLE public.rewards (
  id             bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  owner_id       text        NOT NULL DEFAULT auth.uid(),
  owner_name     text,
  space_id       text        NOT NULL,
  condition_text text        NOT NULL,
  target_weight  numeric(5,1),
  prize          text        NOT NULL,
  promise_by     text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active'::text,
  achieved_at    timestamptz,
  redeemed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rewards_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------------
-- messages —— 空间内留言
-- ---------------------------------------------------------------------------
CREATE TABLE public.messages (
  id         bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  owner_id   text        NOT NULL DEFAULT auth.uid(),
  owner_name text,
  space_id   text        NOT NULL,
  text       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id)
);

-- =============================================================================
-- 索引（生产实际存在的全部索引，均为 PK / UNIQUE 隐式索引）
-- 注意：目前没有任何以 space_id 为前导列的索引。数据量小时无影响；
--       迁移到新后端后若空间增多，建议补 (space_id, created_at)。
-- =============================================================================
CREATE UNIQUE INDEX profiles_pkey             ON public.profiles USING btree (id);
CREATE UNIQUE INDEX profiles_owner_space_key  ON public.profiles USING btree (owner_id, space_id);
CREATE UNIQUE INDEX records_pkey              ON public.records  USING btree (id);
CREATE UNIQUE INDEX records_owner_date_space_key ON public.records USING btree (owner_id, record_date, space_id);
CREATE UNIQUE INDEX tags_pkey                 ON public.tags     USING btree (id);
CREATE UNIQUE INDEX todos_pkey                ON public.todos    USING btree (id);
CREATE UNIQUE INDEX rewards_pkey              ON public.rewards  USING btree (id);
CREATE UNIQUE INDEX messages_pkey             ON public.messages USING btree (id);

-- =============================================================================
-- 行级安全（元信息；表达式原文不公开，见文件头说明）
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rewards  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 生产共有 6 条策略，全部满足以下特征：
--   * 每表恰好 1 条；命令为 FOR ALL；角色为 authenticated。
--   * USING / WITH CHECK 的具体表达式**不在本公开文件中**（私有归档持有原文）。
--   * 新库（Supabase / 自建）应按操作拆分策略、独立设计，**不要复制旧策略**
--     —— 旧策略存在需重新设计的覆盖面问题，逐条分析仅存于私有归档。
--
-- 策略名清单（仅名称，不含表达式）：
--   profiles_space_all / records_space_all / tags_space_all /
--   todos_space_all     / rewards_space_all / messages_space_all

-- =============================================================================
-- 函数（仅签名；函数体原文不公开，见文件头说明）
-- =============================================================================
-- CREATE FUNCTION public.my_space_ids()
--   RETURNS SETOF text
--   LANGUAGE sql / STABLE / SECURITY DEFINER / SET search_path TO 'public'
--   语义（公开规格，非原文）：返回当前调用者所属的全部 space_id。
--
-- CREATE FUNCTION public.space_peek(code text)
--   RETURNS jsonb
--   LANGUAGE sql / STABLE / SECURITY DEFINER / SET search_path TO 'public'
--   语义（公开规格，非原文）：按口令查询空间，返回 {count, names[]}；
--   口令在比较前做大小写与首尾空白归一化。
--
-- ⚠️ 上述两个函数为 SECURITY DEFINER —— 即以函数属主身份执行、可绕过行级安全。
--    新库设计时必须重新评估函数级授权（勿沿用默认 PUBLIC EXECUTE），
--    并重新评估"按口令返回成员昵称"这一行为的必要性。
--    本文件**不提供**它们的可执行实现。
-- =============================================================================

-- =============================================================================
-- 授权现状（仅元信息；细节与内部角色名已移除）
--   表的 DML 授权（anon / authenticated 的具体权限矩阵）**不在本公开文件中**，
--   完整授权清单保存在私有归档。
--   新库（Supabase / 自建）应从零设计授权矩阵，逐表最小化授予，
--   并特别注意：任何绕过行级安全的语句类型（如全表清空类命令）默认一律不授予。
-- =============================================================================
