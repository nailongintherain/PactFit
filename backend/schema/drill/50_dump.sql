-- =============================================================================
-- 50_dump.sql —— 把恢复结果整表导出成一份 JSON，供离线逐字段比对
--
-- 为什么单独一步：
--   逐字段比对需要"库里的真实值"和"备份文件里的原始值"同时在场。库内 SQL 拿不到
--   备份 JSON（除非把个人数据再灌一遍），所以把库侧导出到容器 /tmp，再由
--   scripts/drill-compare.py 在库外做语义比对。
--
-- 权限控制（Phase 1-c-fix-2）：
--   1. 先用 `install -m 600` 把目标文件建成 0600，再让 \o 覆盖写 ——
--      这样不存在"先 0644 再 chmod"的窗口期。
--   2. 导出后再 chmod 0600 并用 stat 打印实际权限，肉眼可核。
--   3. 复制到本机后必须再 chmod 600（见文末提示与 docs/11 Step 10）：
--      docker cp 会按容器内属主 uid 落盘，本机权限不一定还是 0600。
--
-- 用法：
--   docker cp backend/schema/drill/50_dump.sql pactfit-drill-pg:/tmp/
--   docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
--     -v ON_ERROR_STOP=1 -f /tmp/50_dump.sql
--   docker cp pactfit-drill-pg:/tmp/pactfit-actual.json ~/PactFit-drill/
--   chmod 600 ~/PactFit-drill/pactfit-actual.json
--
-- 输出文件格式（重要）：
--   第 1 行 = 一整行 JSON：{"messages":[...],"profiles":[...],...}
--   之后可能跟一行 psql 行数脚注 "(1 row)"，比对脚本会忽略。
--
-- 隐私：导出文件含个人数据，只存在容器 /tmp 与本机 ~/PactFit-drill/，
--       不进仓库、不进聊天记录；比对通过后立即删除（--purge-on-pass）。
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- 预建 0600 空文件，消除"写出来是 0644 再改"的窗口
\! install -m 600 /dev/null /tmp/pactfit-actual.json

\o /tmp/pactfit-actual.json
\pset format unaligned
\pset tuples_only on

select jsonb_object_agg(t, v)::text
from (
            select 'profiles'::text as t, coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) as v from public.profiles x
  union all select 'records'::text,  coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.records  x
  union all select 'todos'::text,    coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.todos    x
  union all select 'tags'::text,     coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.tags     x
  union all select 'rewards'::text,  coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.rewards  x
  union all select 'messages'::text, coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.messages x
) s;

\o
\pset format aligned
\pset tuples_only off

-- 收口：再确认一次权限，并打印出来（此行输出形如 "600 /tmp/pactfit-actual.json"）
\! chmod 0600 /tmp/pactfit-actual.json
\! stat -c '容器内文件权限: %a  %n' /tmp/pactfit-actual.json

\echo ''
\echo '已导出：/tmp/pactfit-actual.json（容器内 mode 0600）'
\echo '下一步（在宿主机执行）：'
\echo '  docker cp pactfit-drill-pg:/tmp/pactfit-actual.json ~/PactFit-drill/'
\echo '  chmod 600 ~/PactFit-drill/pactfit-actual.json'
\echo '  python3 scripts/drill-compare.py --src <raw/> --actual ~/PactFit-drill/pactfit-actual.json --expect ~/PactFit-drill/expected.json --purge-on-pass'
\echo '  （--purge-on-pass：比对 PASS 时自动删除该导出文件；FAIL 时保留供排查）'
\echo ''
