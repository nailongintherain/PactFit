-- =============================================================================
-- 00_harness.sql —— 隔离演练环境桩（只在本机临时库执行）
--
-- 为什么需要它：
--   生产结构快照（原件仅存私有归档；公开参考为 ../schema-reference.sql）里用了 3 样原生 PostgreSQL 没有的东西，
--   直接执行会立刻失败。本文件把它们补上，让快照的语义能被原样复现：
--     1) auth schema + auth.uid()      （快照里出现 13 次）
--     2) anon / authenticated / service_role 三个角色（快照里出现 6 次 TO authenticated）
--     3) 一个可切换的"当前登录身份"变量 pactfit.uid
--   另外补第 4 样（Phase 1-c-fix 新增）：auth schema 对 authenticated 的 USAGE。
--   缺它会让 "permission denied for schema auth"（42501）与 "RLS 拒绝写入"（也是 42501）
--   混为一谈，直接把 V9 判成假 PASS。
--
-- 与生产的差异：
--   生产 auth.uid() 的真实实现未知（很可能返回 text，因为列是 text）。
--   这里刻意也返回 text，以便与生产列类型一致；若后续确认生产返回 uuid，
--   应改为 `returns text` 内部 `auth.uid()::text` 的形式，而不是改列类型。
--
-- 禁止在任何非临时库执行本文件。
-- =============================================================================

create schema if not exists auth;

create or replace function auth.uid()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('pactfit.uid', true), ''),
                  '00000000-0000-0000-0000-000000000000')
$$;

comment on function auth.uid() is
  '演练桩：返回会话变量 pactfit.uid；默认全零 UUID 字符串。生产实现不在快照范围内。';

-- ---------------------------------------------------------------------------
-- 角色：生产用 PostgREST 风格的三角色模型
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- 【必须】auth schema 的 USAGE 也要给：
--   RLS 的 WITH CHECK / USING 表达式是在**调用者**身份下求值的，
--   profiles 等表的表达式里直接调 auth.uid()。若 authenticated 没有 auth 的 USAGE，
--   会先报 42501 "permission denied for schema auth" ——
--   而这个 SQLSTATE 与"RLS 拒绝写入"完全相同，会让 V9 误判成 PASS。
--   给了 USAGE 之后，跨空间写入被拒才真的是 RLS 起作用。
grant usage on schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 自检：四样依赖都在位才算 harness 成功
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_namespace where nspname = 'auth')                      as auth_schema_ok,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid')                               as auth_uid_ok,
  (select count(*) from pg_roles
    where rolname in ('anon','authenticated','service_role'))                     as roles_ok,
  has_schema_privilege('authenticated', 'auth', 'USAGE')                          as authenticated_auth_usage;
-- 期望：1 / 1 / 3 / true
