# 10 · Schema 基线核对与差异分析（Phase 1）

> 调查日期：2026-10-21
> 基线文件：`backend/schema/schema-reference.sql`（脱敏结构参考；生产快照原件 202 行 / 10,099 字节，
> 2026-10-19 17:20 GMT+8 从线上 `pg_catalog` 读取重写，**原件仅存仓库外私有归档**）
> 对照文件：`001/002/003_*.inferred.sql`（001 在仓库；002/003 已移入私有归档）
> 本次未连接、未查询、未修改生产库；未执行任何 DDL/DML/RLS 变更；未提交 Git。

---

## 0. 文件位置（重要，已按私有化整理更新）

| 位置 | 状态 |
|---|---|
| 仓库 `backend/schema/` | ✅ `schema-reference.sql`（脱敏结构参考） |
| 仓库外私有归档 | ✅ 生产快照原件 `schema-live-2026-10-19.full.sql`（路径仅团队内部可知） |

**结论：生产快照原件已归档至仓库外私有目录（0700/0600），仓库内只保留脱敏参考版。**
本次分析读取的是原件副本（只读）。

### 基线文件的可信度

文件头部自述"从线上库 `pg_catalog` 实时读取后重写，不是推断、不是手写"，并主动声明三处有意留空：

1. identity 列背后的序列名（及当前值）
2. 平台 schema（`auth` / `storage` / `cloudbase_migrations` / `workbuddy_internal`）不在范围
3. 表/序列 owner 与 schema 级 GRANT 细节只在文末注释

这三点与我下文「仍无法确认」一节完全对应，说明该文件作者清楚边界，可作为**可信基线**使用。

来源库：PostgreSQL **17.11**（实例标识与应用标识已脱敏）。

业务行数（文件头声明）：profiles 4 / records 1 / tags 18 / todos 9 / rewards 0 / messages 0 = **32**，与你给的口径一致 ✅。

---

## 1. 总览：推断稿与真实结构的偏差规模

| 维度 | 真实 | 推断稿 | 结论 |
|---|---|---|---|
| 业务表 | 6 | 6 | ✅ 表集合正确 |
| 列 | 见 §2 | 见 §2 | ⚠️ 列名基本正确，**类型与可空性有系统性错误** |
| 主键 | 6 个（均为 `id`） | 6 个 | ✅ |
| 唯一约束 | 2 个（profiles、records） | 2 个（列序不同） | ⚠️ 语义相同、定义不同 |
| 外键 | **0 个** | 0 个（但文档暗示了引用关系） | ⚠️ 需在文档中显式声明"零外键" |
| CHECK 约束 | **0 个** | 8 个 | ❌ **推断多加了 8 个** |
| 索引 | 8 个（全部来自 PK/UNIQUE） | 14 个 | ❌ **多了 6 个业务索引** |
| RLS 策略 | 6 条（每表 1 条 `FOR ALL`） | 18 条（按操作拆分） | ❌ 结构不同，且有 4 处权限面更宽 |
| 函数 | 2 个 | 2 个 | ✅ 行为等价 |
| GRANT | 生产授权面比"最小化 CRUD"更宽 | 仅 authenticated 的 CRUD | ❌ 关键差异（明细仅存私有归档） |

一句话评价：**推断稿是一份"理想化的、带防御性约束的"设计，而真实库是一份"只靠应用层校验的、极简的"实现。** 直接拿推断稿建新库，会因多出的 NOT NULL / CHECK / 唯一键在导入阶段大面积失败。

---

## 2. 逐表字段对比

标记：✅ 一致 · ⚠️ 语义等价但定义不同 · ❌ 推断错误 · ➕ 推断多出

### 2.1 profiles

| 项 | 真实 | 001 推断 | 判定 |
|---|---|---|---|
| id | `bigint GENERATED ALWAYS AS IDENTITY NOT NULL` | `bigint generated always as identity` | ✅ |
| owner_id | **`text NOT NULL DEFAULT auth.uid()`** | `uuid` | ❌ **类型错误（uuid → text）** |
| owner_name | `text`（**可空**） | `text NOT NULL` | ❌ 多加了 NOT NULL |
| space_id | `text NOT NULL` | `text NOT NULL` | ✅ |
| nickname | `text NOT NULL` | `text NOT NULL` | ✅ |
| role | `text NOT NULL DEFAULT 'her'::text`，**无 CHECK** | `text NOT NULL DEFAULT 'her' CHECK (role in ('her','him'))` | ❌ CHECK 不存在 |
| start_weight | `numeric(5,1)` | 同 | ✅ |
| target_weight | `numeric(5,1)` | 同 | ✅ |
| target_date | `date` | `date` | ✅（10-19 已补） |
| created_at | `timestamptz NOT NULL DEFAULT now()` | 同 | ✅ |
| PK | `profiles_pkey (id)` | 同 | ✅ |
| UNIQUE | `profiles_owner_space_key (owner_id, space_id)` | `profiles_space_owner_key (space_id, owner_id)` | ⚠️ 列序相反、命名不同 |

### 2.2 records

| 项 | 真实 | 001 推断 | 判定 |
|---|---|---|---|
| owner_id | `text NOT NULL DEFAULT auth.uid()` | `uuid` | ❌ |
| owner_name | `text`（可空） | `NOT NULL` | ❌ |
| record_date | `date NOT NULL` | `date NOT NULL` | ✅ |
| weight | `numeric(5,1) NOT NULL`，**无 CHECK** | `check (weight between 20 and 400)` | ❌ |
| tags | `jsonb DEFAULT '[]'::jsonb`（**可空**） | `jsonb NOT NULL DEFAULT '[]'` | ❌ 多加了 NOT NULL |
| todo_done | `jsonb DEFAULT '[]'::jsonb`（**可空**） | `jsonb NOT NULL DEFAULT '[]'` | ❌ |
| mood / note | `text` | 同 | ✅ |
| created_at | `timestamptz NOT NULL DEFAULT now()` | 同 | ✅ |
| updated_at | **不存在** | 已移除 | ✅（10-19 已修正） |
| UNIQUE | `(owner_id, record_date, space_id)` | `(space_id, owner_id, record_date)` | ⚠️ 列序不同 |
| 业务索引 | **无** | `records_space_date_idx`、`records_owner_idx` | ➕ 多 2 个 |

### 2.3 todos / tags（结构完全相同）

| 项 | 真实 | 001 推断 | 判定 |
|---|---|---|---|
| owner_id | `text NOT NULL DEFAULT auth.uid()` | `uuid` | ❌ |
| owner_name | `text`（可空） | `NOT NULL` | ❌ |
| text | `text NOT NULL`，**无长度 CHECK** | `check (char_length(text) <= 40 / 20)` | ❌ |
| sort | `integer NOT NULL DEFAULT 0` | 同 | ✅ |
| created_at | `timestamptz NOT NULL DEFAULT now()` | 同 | ✅ |
| 业务索引 | **无** | `todos_space_sort_idx`、`tags_space_sort_idx` | ➕ 多 2 个 |

### 2.4 rewards

| 项 | 真实 | 001 推断 | 判定 |
|---|---|---|---|
| owner_id | `text NOT NULL DEFAULT auth.uid()` | `uuid` | ❌ |
| owner_name | `text`（可空） | `NOT NULL` | ❌ |
| condition_text | **`text NOT NULL`** | `text`（可空） | ❌ 少写了 NOT NULL |
| target_weight | `numeric(5,1)` | 同 | ✅ |
| prize | **`text NOT NULL`**，**无长度 CHECK** | `check (char_length(prize) <= 30)` | ❌ |
| promise_by | **`text NOT NULL`** | `uuid`（可空） | ❌ 类型 + 可空性都错 |
| status | `text NOT NULL DEFAULT 'active'::text`，**无 CHECK** | `check (status in ('active','pending','done'))` | ❌ |
| achieved_at / redeemed_at | `timestamptz` | 同 | ✅ |
| 业务索引 | **无** | `rewards_space_idx` | ➕ 多 1 个 |

### 2.5 messages

| 项 | 真实 | 001 推断 | 判定 |
|---|---|---|---|
| owner_id | `text NOT NULL DEFAULT auth.uid()` | `uuid` | ❌ |
| owner_name | `text`（可空） | `NOT NULL` | ❌ |
| text | `text NOT NULL` | 同 | ✅ |
| created_at | `timestamptz NOT NULL DEFAULT now()` | 同 | ✅ |
| 业务索引 | **无** | `messages_space_id_idx` | ➕ 多 1 个 |

### 2.6 跨表层面

| 项 | 真实 | 推断 | 判定 |
|---|---|---|---|
| 外键 | **0 个**（`promise_by` 只存 owner_id 字符串，无 FK） | 未声明，但文档写成"指向" | ❌ 需显式写"零外键" |
| CHECK | **0 个** | 8 个 | ❌ |
| 触发器 | **0 个** | 0 个 | ✅ |
| 序列 | identity 隐式创建，名称与当前值未记录 | 未写 | ⚠️ 待补 |

---

## 3. RLS / 权限 / 函数差异

### 3.1 策略结构

真实是**每表一条 `FOR ALL`**，推断是**按 SELECT/INSERT/UPDATE/DELETE 拆分**。这不是风格差异，会改变实际效果：`FOR ALL` 的 `USING` 同时作用于 SELECT / UPDATE / DELETE，所以两版行为差异需逐表重新推导（公开结论见 §3.2）。

### 3.2 按操作推导的真实有效权限（PostgreSQL 语义）

> 逐表越权路径与操作级推导属"诊断结论"，**不在公开版披露**；完整分析仅存私有归档
> `security-findings.md`（缺陷编号 S1–S7）。

公开版保留的净结论：

- 真实权限面比 002 推断稿**更宽**（无一处更严），差异共 4 处（涉及 DELETE 与 INSERT 的表级差异）；
- 现有策略存在多项设计缺陷（S1–S7），**新库必须从零重新设计并逐条实测，不可原样照搬**。

### 3.3 rewards 的策略差异（结论级）

`rewards` 的策略与其他表存在设计差异（具体表达式不公开）。它解释了两件事：

1. **兑现功能能成立**——兑现人可以更新别人立的约定行 ✅（这证实了 `docs/05` 的 Q2）。
2. **代价**：该表存在越权写入面（缺陷编号 S2，机制与影响分析仅存私有归档）。

### 3.4 GRANT

| 角色 | 真实权限 | 002 推断 | 判定 |
|---|---|---|---|
| anon | 有超出推断的授权（明细仅存私有归档） | 未授予 | ❌ |
| authenticated | 超出 CRUD 的语句类型授权（明细仅存私有归档） | 仅 CRUD | ❌ |
| service_role | 同 authenticated | — | 未涉及 |

公开版保留的结论：**生产授权矩阵存在冗余面，绝不能复制到新库**；新库应逐表最小化授予。
（逐角色、逐语句类型的完整矩阵仅存私有归档。）

### 3.5 函数

| 函数 | 真实 | 003 推断 | 判定 |
|---|---|---|---|
| `my_space_ids()` | `RETURNS SETOF text`，`STABLE SECURITY DEFINER`，`SET search_path TO 'public'`；函数体不公开（示意实现见 `schema-reference.sql`） | 同（等价） | ✅ |
| `space_peek(code text)` | `RETURNS jsonb`，返回 count 与 names 两类概要 | 等价实现 | ✅ 行为等价 |
| 函数级授权 | **基线文件未记录**；完整口径仅存私有归档 | 推断写了显式收紧 | ❌ 与推断不一致 |

`space_peek` 为 `SECURITY DEFINER`，其授权面与信息暴露分析印证了 `docs/07` 风险 R6；
具体结论仅存私有归档（缺陷编号 S4）。新库必须显式收紧函数级授权。

---

## 4. `docs/03-data-model.md` 是否需要更新

**需要，且改动较多。** 逐条列出（本次未修改，等你确认后再动）：

| 位置 | 现状 | 应改为 |
|---|---|---|
| §1 通用约定 | "`owner_id`：uuid 字符串" | **text**（不是 uuid）；默认值 `auth.uid()` |
| §1 | "每张表都有 owner_id / owner_name" | 保留，但注明 `owner_name` **可空**（应用层总写） |
| §2 profiles | `(space_id, owner_id)` 唯一约束"可能没有" | **确定存在**：`profiles_owner_space_key (owner_id, space_id)` |
| §2 | `role` 两值枚举 | 无 CHECK，仅前端约定（脏值可能存在） |
| §2 | `created_at?` 待核对 | 确定存在，`timestamptz NOT NULL DEFAULT now()` |
| §3 records | 唯一约束"未必有" | **确定存在**：`(owner_id, record_date, space_id)` |
| §3 | `tags` / `todo_done` 数组类型"二选一" | 确定为 **jsonb**，**可空**，默认 `'[]'` |
| §3 | 无 `updated_at` | 已修正，补一句"确认不存在" |
| §4 todos/tags | `text` 有长度上限 | 无 DB 约束，仅前端截断 |
| §5 rewards | `condition_text` / `prize` 可空 | 均 **NOT NULL** |
| §5 | `promise_by` uuid | **text NOT NULL**，无外键 |
| §5 | `status` 三态 CHECK | 无 CHECK，仅默认 `'active'` |
| §7 全篇 | 未提索引与 CHECK | 补一节"零 CHECK、零 FK、无业务索引" |

---

## 5. 对未来数据迁移与身份认证的影响

### 5.1 数据迁移（按风险从高到低）

| # | 影响 | 说明 | 应对 |
|---|---|---|---|
| M1 | **`id` 是 `GENERATED ALWAYS AS IDENTITY`** | 带 id 导入会直接报错 `cannot insert into column "id"` | CSV 导入必须 `INSERT ... OVERRIDING SYSTEM VALUE`，或去掉 id 列后重建映射 |
| M2 | **`records.todo_done` 里存的是 `todos.id` 数组** | 若导入后 todos.id 变化，勾选记录全部失联（表现为"勾了但显示没勾"） | 必须保持 todos.id 原值；若必须重编号，要同步重写 `todo_done` 数组 |
| M3 | 唯一约束决定去重键 | `(owner_id, space_id)` 与 `(owner_id, record_date, space_id)` | 导入前按这两组键去重，**不要按 id 去重**（基线文件原话） |
| M4 | **零 CHECK 约束** | 线上可能存在越界数据（体重 <20 或 >400、超长文本） | 新库不要加 CHECK，否则导入中断；校验留在应用层 |
| M5 | **零外键** | `promise_by` 可能指向已不存在的用户；`todo_done` 可能含已删 todo | 导入不要假设引用完整性；导入后跑一次孤儿引用统计 |
| M6 | `owner_id` 为 text | 大小写、前后空格都会原样保留，不会像 uuid 那样规范化 | 导入时原样搬运，不要 trim、不要 lowercase |
| M7 | 无 `space_id` 索引 | 量大后 RLS 子查询变慢 | 导入完成后再补 `(space_id)` 索引（属新库优化，非线上改动） |
| M8 | 序列值未记录 | 见 §6 | 导入后 `setval` 到 max(id) |
| M9 | 数据分布：todos 9 / tags 18 | 恰好 = 3 个空间 × (3, 6)，与 `docs/09` 推断的"第三个空间"吻合 | 全量导出才能覆盖，客户端并集只有 2 个空间 |

### 5.2 身份认证

| # | 影响 | 说明 |
|---|---|---|
| A1 | **`auth.uid()` 的返回类型** | 真实列是 `text` 且 `DEFAULT auth.uid()` 能成立，强烈暗示该平台的 `auth.uid()` 返回 **text**（若返回 uuid，建表时会因无赋值转换而报错）。迁到 Supabase 时其 `auth.uid()` 返回 **uuid**，默认值必须写成 `auth.uid()::text`，否则建表失败。**这是最容易踩的坑，需在新库实测确认。** |
| A2 | `owner_id` 是 text 而非 uuid | 新库若把列改成 uuid，`todo_done` 之外的关联字符串（`promise_by`）也要一起改，且历史脏值无法转换 → 建议**保持 text** |
| A3 | 组隔离完全依赖 `my_space_ids()` | 该函数用 `auth.uid()` 与 profiles 比对；类型不一致会导致隐式转换或索引失效 |
| A4 | 认证用户表在平台 `auth` schema | 基线文件刻意不覆盖。迁出时必须重建用户（邮箱/手机号 → 新库 auth），并建立"旧 owner_id → 新 user id"映射表，否则所有 `owner_id` 失效 |
| A5 | RLS 策略角色是 `authenticated` | 说明平台采用 PostgREST 风格的 anon/authenticated/service_role 模型，与 Supabase 同构，迁移路径可行 |
| A6 | 授权矩阵存在冗余面 | 不要复制；新库 authenticated 只给最小 CRUD |
| A7 | `space_peek` 等函数的授权口径 | 新库必须显式收紧函数级授权，勿沿用默认 PUBLIC EXECUTE |

---

## 6. 仍然无法确认的内容

| # | 未知项 | 为什么重要 | 怎么补 |
|---|---|---|---|
| U1 | `auth.uid()` 实际返回类型（text / uuid） | 决定新库 DEFAULT 怎么写（A1） | 在基线文件生成环境跑 `SELECT pg_get_functiondef('auth.uid'::regproc)` 或看 `pg_proc.prorettype` |
| U2 | 函数级授权（`space_peek` 的 ACL） | 决定函数级授权风险的口径（分析仅存私有归档） | `SELECT proacl FROM pg_proc WHERE proname='space_peek'` |
| U3 | 序列名与当前值 | id 连续性与碰撞（M8） | `SELECT sequencename, last_value FROM pg_sequences` |
| U4 | 表 owner 与 schema 级 GRANT（`USAGE ON SCHEMA public`） | 新库建角色时会遇到 42501 | `\dp` / `information_schema.role_usage_grants` |
| U5 | 平台 `auth` schema 的用户结构（邮箱/手机号/验证码如何存） | 决定用户如何迁出、能否保留原账号 | 基线文件明确排除；需单独导出（只读） |
| U6 | 是否安装扩展、是否有未记录触发器 | 迁移后行为差异 | `pg_extension` / `pg_trigger` |
| U7 | `role` 字段的实际取值分布 | 无 CHECK，可能有脏值 | `SELECT role, count(*) FROM profiles GROUP BY role` |
| U8 | 服务器 `TimeZone` 设置 | `timestamptz` 显示口径 | `SHOW timezone` |
| U9 | 真实数据里 `todo_done` 是否存在跨 id 引用 | 影响 M2 的补救成本 | 导入后做引用完整性检查（只读） |

---

## 7. 结论与建议下一步

**结论**

1. 推断稿的**表集合与列名是对的**，错在**类型（owner_id/promise_by）、可空性、以及多出的约束**。
2. 推断稿的 RLS 结构不可直接沿用：真实是 `FOR ALL`，且实际允许的删除面更宽。
3. 推断稿的函数实现**可以直接沿用**（行为等价），但授权必须收紧。
4. 基线文件质量高、边界清晰，可作为唯一结构真源。

**建议（均未执行，等指令）**

- P1-a：**已完成调整**——生产快照原件归档至仓库外私有目录（0700/0600），仓库内以 `backend/schema/schema-reference.sql`（脱敏结构参考）为唯一结构来源；`001_tables.inferred.sql` 顶部已加"已被真实基线取代"声明；002/003 已移出仓库（仅存私有归档）。
- P1-b：按 §4 更新 `docs/03-data-model.md`。
- P1-c：补 U1 / U2 / U3 三项查询（只读），把认证与授权面彻底锁死。
- P1-d：在写导入脚本前，先做 M1 / M2 的验证（拿 1 条 records + 全部 todos 在本地临时库试导入，不上生产、不上新环境）。

---

## 附：本次操作边界

**做过**：读取本机磁盘上的基线文件（只读）、读取仓库内三份推断稿与 `docs/03`（只读）、检查目录与 Git 状态（只读）、写入本报告。

**没做**：未连接 / 查询 / 修改生产库；未执行 DDL、DML、RLS 变更、迁移脚本或部署；未修改任何现有 SQL、前端代码、环境变量、部署配置；未提交 Git；未上传任何备份或个人数据。
