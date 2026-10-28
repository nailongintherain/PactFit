-- =============================================================================
-- 40_verify.sql —— 恢复演练验收查询（库内部分）
--
-- 执行时机：10_tables.sql → 20_import.sql → 30_postload.sql 全部成功之后
--
-- 本文件负责"库内能自证"的部分：
--   V1 行数总账 / V2 主键 / V3 业务唯一键 / V4 JSONB 形态 / V5 悬空引用
--   V6 列签名逐列核对（结构保真）+ 空值单元格统计（辅助）
--   V7 owner_id 占位 / V8 空间分布 / V10 结构未被污染
--
-- 不在这里做的两件事（分工，不是遗漏）：
--   V6 的"逐表逐行逐字段值比对" → 需要备份 JSON 当期望值，库内做不到，
--      见 scripts/drill-compare.py（配合 50_dump.sql 导出）。
--   V9 RLS 冒烟 → 需要 SET ROLE 切换身份，见 45_rls_test.sql。
--
-- 基线：profiles 4 / records 1 / todos 9 / tags 18 / rewards 0 / messages 0，合计 32 条
-- 状态：以下「期望」全部来自静态设计，**尚未在本机实际运行过**
--       （Phase 1-c-fix 阶段未启动 Docker、未建库、未导入）。
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off


-- ===========================================================================
-- V1 · 行数总账
-- 期望：6 行全部 PASS；total_rows = 32
-- ===========================================================================
with expected(tbl, n) as (
  values ('profiles',4),('records',1),('todos',9),('tags',18),('rewards',0),('messages',0)
),
actual(tbl, n) as (
            select 'profiles', count(*) from public.profiles
  union all select 'records',  count(*) from public.records
  union all select 'todos',    count(*) from public.todos
  union all select 'tags',     count(*) from public.tags
  union all select 'rewards',  count(*) from public.rewards
  union all select 'messages', count(*) from public.messages
)
select e.tbl,
       e.n                                              as expected,
       a.n                                              as actual,
       case when e.n = a.n then 'PASS' else 'FAIL' end   as verdict
from expected e
join actual a using (tbl)
order by array_position(array['profiles','records','todos','tags','rewards','messages'], e.tbl::text);

select sum(n) as total_rows from (
            select count(*) n from public.profiles
  union all select count(*) from public.records
  union all select count(*) from public.todos
  union all select count(*) from public.tags
  union all select count(*) from public.rewards
  union all select count(*) from public.messages
) s;
-- 期望：32


-- ===========================================================================
-- V2 · 主键完整性
-- 期望：6 行，每行 dup = 0
-- ===========================================================================
select 'profiles' as tbl, count(*) - count(distinct id) as dup from public.profiles
union all select 'records',  count(*) - count(distinct id) from public.records
union all select 'todos',    count(*) - count(distinct id) from public.todos
union all select 'tags',     count(*) - count(distinct id) from public.tags
union all select 'rewards',  count(*) - count(distinct id) from public.rewards
union all select 'messages', count(*) - count(distinct id) from public.messages;


-- ===========================================================================
-- V3 · 业务唯一键
-- 期望：两行均为 0
-- ===========================================================================
select 'profiles(owner_id,space_id)' as uk, count(*) as dup_groups
from (select owner_id, space_id from public.profiles
      group by 1,2 having count(*) > 1) x
union all
select 'records(owner_id,record_date,space_id)', count(*)
from (select owner_id, record_date, space_id from public.records
      group by 1,2,3 having count(*) > 1) y;


-- ===========================================================================
-- V4 · JSONB 形态
-- 期望：两行均为 0；bad 计数包含"值为 NULL"和"不是 array"两种
-- 注意：快照里 tags / todo_done 是可空 jsonb 且默认 '[]'，
--       所以"非 NULL 且为 array"是本演练的期望形态（源自生产导出的事实）。
-- ===========================================================================
select 'records.tags' as col,
       count(*) filter (where tags is null or jsonb_typeof(tags) <> 'array') as bad
from public.records
union all
select 'records.todo_done',
       count(*) filter (where todo_done is null or jsonb_typeof(todo_done) <> 'array')
from public.records;


-- ===========================================================================
-- V5 · todo_done 悬空引用
-- 已知异常：reconciliation.json 记录 1 处——records.id=6 引用了已删除的 todo id=6
-- 期望：恰好 1 行（record_id=6, missing_todo_id=6）
-- 若出现 0 行，说明备份或导入与对账记录不一致，需重新核对，不要直接判 PASS
-- 本演练不清洗这条历史数据：修数据是后续独立动作，不属于"恢复是否成功"的判据。
-- ===========================================================================
select r.id                    as record_id,
       elem                    as missing_todo_id
from public.records r
cross join lateral jsonb_array_elements_text(coalesce(r.todo_done, '[]'::jsonb)) as elem
where elem ~ '^[0-9]+$'
  and not exists (select 1 from public.todos t where t.id = elem::bigint)
order by r.id, elem;

-- 附带：非数字元素（应为 0 行）
select r.id as record_id, elem as non_numeric_element
from public.records r
cross join lateral jsonb_array_elements_text(coalesce(r.todo_done, '[]'::jsonb)) as elem
where elem !~ '^[0-9]+$';


-- ===========================================================================
-- V6a · 列签名逐列核对（结构保真）
--
-- 签名格式：列名:类型:可空:identity:有无默认
--   NN = NOT NULL，N0 = 可空
--   A  = GENERATED ALWAYS AS IDENTITY，- = 非 identity
--   D  = 有默认表达式，- = 无
--
-- 为什么用签名而不是只数表：任一列被改名 / 改类型 / 丢 NOT NULL / 丢默认值 /
-- 顺序被调换，签名都不再相等。这是"逐字段"在结构层面的落地。
-- 期望：6 行全部 signature_match = true，expected_cols_missing = 0，unexpected_cols = 0
-- ===========================================================================
with spec(ord, tbl, sig) as (
  values
  (1, 'profiles',
   'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | nickname:text:NN:-:- | role:text:NN:-:D | start_weight:numeric(5,1):N0:-:- | target_weight:numeric(5,1):N0:-:- | target_date:date:N0:-:- | created_at:timestamp with time zone:NN:-:D'),
  (2, 'records',
   'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | record_date:date:NN:-:- | weight:numeric(5,1):NN:-:- | tags:jsonb:N0:-:D | todo_done:jsonb:N0:-:D | mood:text:N0:-:- | note:text:N0:-:- | created_at:timestamp with time zone:NN:-:D'),
  (3, 'todos',
   'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | text:text:NN:-:- | sort:integer:NN:-:D | created_at:timestamp with time zone:NN:-:D'),
  (4, 'tags',
   'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | text:text:NN:-:- | sort:integer:NN:-:D | created_at:timestamp with time zone:NN:-:D'),
  (5, 'rewards',
   'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | condition_text:text:NN:-:- | target_weight:numeric(5,1):N0:-:- | prize:text:NN:-:- | promise_by:text:NN:-:- | status:text:NN:-:D | achieved_at:timestamp with time zone:N0:-:- | redeemed_at:timestamp with time zone:N0:-:- | created_at:timestamp with time zone:NN:-:D'),
  (6, 'messages',
   'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | text:text:NN:-:- | created_at:timestamp with time zone:NN:-:D')
),
actual as (
  select c.relname::text as tbl,
         string_agg(
           a.attname || ':' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ':NN' else ':N0' end
           || case a.attidentity when 'a' then ':A' when 'd' then ':D' else ':-' end
           || case when d.adbin is null then ':-' else ':D' end,
           ' | ' order by a.attnum
         ) as sig
  from pg_attribute a
  join pg_class c     on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attnum > 0
    and not a.attisdropped
  group by c.relname
)
select s.tbl,
       (s.sig = coalesce(x.sig, ''))                                        as signature_match,
       (select count(*) from unnest(string_to_array(s.sig, ' | ')) e
         where e <> all (string_to_array(coalesce(x.sig, ''), ' | ')))      as expected_cols_missing,
       (select count(*) from unnest(string_to_array(coalesce(x.sig, ''), ' | ')) g
         where g <> all (string_to_array(s.sig, ' | ')))                    as unexpected_cols
from spec s
left join actual x on x.tbl = s.tbl
order by s.ord;

-- 若有 mismatch，这里会打印实际签名（只有列名与类型，无任何数据）以便定位
with spec(tbl, sig) as (
  values
  ('profiles', 'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | nickname:text:NN:-:- | role:text:NN:-:D | start_weight:numeric(5,1):N0:-:- | target_weight:numeric(5,1):N0:-:- | target_date:date:N0:-:- | created_at:timestamp with time zone:NN:-:D'),
  ('records',  'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | record_date:date:NN:-:- | weight:numeric(5,1):NN:-:- | tags:jsonb:N0:-:D | todo_done:jsonb:N0:-:D | mood:text:N0:-:- | note:text:N0:-:- | created_at:timestamp with time zone:NN:-:D'),
  ('todos',    'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | text:text:NN:-:- | sort:integer:NN:-:D | created_at:timestamp with time zone:NN:-:D'),
  ('tags',     'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | text:text:NN:-:- | sort:integer:NN:-:D | created_at:timestamp with time zone:NN:-:D'),
  ('rewards',  'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | condition_text:text:NN:-:- | target_weight:numeric(5,1):N0:-:- | prize:text:NN:-:- | promise_by:text:NN:-:- | status:text:NN:-:D | achieved_at:timestamp with time zone:N0:-:- | redeemed_at:timestamp with time zone:N0:-:- | created_at:timestamp with time zone:NN:-:D'),
  ('messages', 'id:bigint:NN:A:- | owner_id:text:NN:-:D | owner_name:text:N0:-:- | space_id:text:NN:-:- | text:text:NN:-:- | created_at:timestamp with time zone:NN:-:D')
),
actual as (
  select c.relname::text as tbl,
         string_agg(
           a.attname || ':' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ':NN' else ':N0' end
           || case a.attidentity when 'a' then ':A' when 'd' then ':D' else ':-' end
           || case when d.adbin is null then ':-' else ':D' end,
           ' | ' order by a.attnum
         ) as sig
  from pg_attribute a
  join pg_class c     on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
    and a.attnum > 0 and not a.attisdropped
  group by c.relname
)
select s.tbl, x.sig as actual_signature
from spec s
left join actual x on x.tbl = s.tbl
where coalesce(x.sig, '') <> s.sig;
-- 期望：0 行


-- ===========================================================================
-- V6b · 空值单元格统计（辅助指标，不作单独判据）
-- 用途：一旦 drill-compare.py 报某列有差异，这里能立刻看出该列是否本来就大量为空
-- 期望（按备份源文件静态统计得出，与 expected.json 的 nulls 求和一致）：
--   profiles 4 / records 0 / todos 0 / tags 0
--   rewards / messages 为 0 行，null_cells 是 NULL（sum 无行可加），不是 0
--   profiles 的 4 个空值全部来自 target_date —— 生产里该列对 4 行都是 NULL，
--   属 schema 漂移（前端不读写它），不是导入丢失。
-- 注意：这里只输出计数，不输出任何值。
-- ===========================================================================
select 'profiles' as tbl, count(*) as rows,
       sum((select count(*) from jsonb_each(to_jsonb(x)) e where e.value = 'null'::jsonb)) as null_cells
from public.profiles x
union all
select 'records', count(*),
       sum((select count(*) from jsonb_each(to_jsonb(x)) e where e.value = 'null'::jsonb))
from public.records x
union all
select 'todos', count(*),
       sum((select count(*) from jsonb_each(to_jsonb(x)) e where e.value = 'null'::jsonb))
from public.todos x
union all
select 'tags', count(*),
       sum((select count(*) from jsonb_each(to_jsonb(x)) e where e.value = 'null'::jsonb))
from public.tags x
union all
select 'rewards', count(*),
       sum((select count(*) from jsonb_each(to_jsonb(x)) e where e.value = 'null'::jsonb))
from public.rewards x
union all
select 'messages', count(*),
       sum((select count(*) from jsonb_each(to_jsonb(x)) e where e.value = 'null'::jsonb))
from public.messages x;


-- ===========================================================================
-- V6c · 辅助指纹（兼容此前口径，仅作交叉参考，不作判据）
-- 与 expected.json 的 fingerprint 相等说明 id / owner_id / created_at 三者一致；
-- 但**不覆盖**其余业务字段 —— 真正的逐字段结论看 drill-compare.py。
-- ===========================================================================
select 'profiles' as tbl, md5(string_agg(id::text||'|'||owner_id||'|'||
         round(extract(epoch from created_at))::bigint::text, ',' order by id)) as fingerprint
from public.profiles
union all
select 'records', md5(string_agg(id::text||'|'||owner_id||'|'||
         round(extract(epoch from created_at))::bigint::text, ',' order by id))
from public.records
union all
select 'todos', md5(string_agg(id::text||'|'||owner_id||'|'||
         round(extract(epoch from created_at))::bigint::text, ',' order by id))
from public.todos
union all
select 'tags', md5(string_agg(id::text||'|'||owner_id||'|'||
         round(extract(epoch from created_at))::bigint::text, ',' order by id))
from public.tags
union all
select 'rewards', coalesce(md5(string_agg(id::text||'|'||owner_id||'|'||
         round(extract(epoch from created_at))::bigint::text, ',' order by id)), 'EMPTY')
from public.rewards
union all
select 'messages', coalesce(md5(string_agg(id::text||'|'||owner_id||'|'||
         round(extract(epoch from created_at))::bigint::text, ',' order by id)), 'EMPTY')
from public.messages
order by tbl;


-- ===========================================================================
-- V7 · owner_id 不得是 harness 的占位值
-- 期望：0 行（若出现，说明导入时漏了 owner_id，落到了默认值上）
-- ===========================================================================
select 'profiles' as tbl, count(*) as placeholder_rows from public.profiles
 where owner_id = '00000000-0000-0000-0000-000000000000'
union all select 'records', count(*) from public.records
 where owner_id = '00000000-0000-0000-0000-000000000000'
union all select 'todos', count(*) from public.todos
 where owner_id = '00000000-0000-0000-0000-000000000000'
union all select 'tags', count(*) from public.tags
 where owner_id = '00000000-0000-0000-0000-000000000000';


-- ===========================================================================
-- V8 · 空间分布
-- 期望：3 个不同 space_id；profiles 按空间计数为 2 / 1 / 1
-- （对应 docs/09 推断的"第三个空间"，也是客户端并集永远看不到的那一个）
-- ===========================================================================
select count(distinct space_id) as distinct_spaces from public.profiles;

select space_id, count(*) as members
from public.profiles
group by space_id
order by members desc, space_id;


-- ===========================================================================
-- V9 · RLS 冒烟 —— 已独立为 45_rls_test.sql
-- 本文件不重复：RLS 测试需要 set role authenticated 切换身份，
-- 与上面这些"超级用户视角"的查询放在一起容易串味、也容易误判。
-- 请单独执行：psql -v ON_ERROR_STOP=1 -f 45_rls_test.sql
-- ===========================================================================


-- ===========================================================================
-- V10 · 结构未被"优化"污染
-- 期望：6 / 6 / 2 / 2 / 0 / 8
--   表 6、策略 6、函数 2、唯一约束 2、CHECK 0、索引 8（6 PK + 2 UNIQUE）
-- 若索引数 > 8，说明有人把快照里那 8 条 CREATE UNIQUE INDEX 也执行了
-- 若 CHECK 数 > 0，说明混进了"建议优化"，那不是生产结构
--
-- CHECK 口径说明（2026-10-21 修正）：
--   不查 information_schema.check_constraints —— PostgreSQL 17 的该视图会把
--   每个 NOT NULL 列也算成一条 `*_not_null` 条目（本项目 6 表共 37 条），
--   用它统计会得到 37 而非 0，属视图口径差异而非结构被污染。
--   权威口径：pg_constraint.contype='c'（c=CHECK，n=NOT NULL，f=FK，p=PK，u=UNIQUE）。
-- ===========================================================================
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE')                 as tables,
  (select count(*) from pg_policies where schemaname='public')                as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('my_space_ids','space_peek')) as functions,
  (select count(*) from information_schema.table_constraints
     where table_schema='public' and constraint_type='UNIQUE')                as uniques,
  (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
     where n.nspname='public' and c.contype='c')                              as checks,
  (select count(*) from pg_indexes where schemaname='public')                 as indexes;
