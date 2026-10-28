# 03 · 数据模型

> **基线已切换（2026-10-21）**
> 本文件现在以**生产库真实结构**为准，来源：
> `backend/schema/schema-reference.sql`（脱敏结构参考；生产快照原件仅存仓库外私有归档，
> 2026-10-19 17:20 从线上 `pg_catalog` 读取重写，PostgreSQL 17.11，实例标识已脱敏）。
> 旧的「推断稿」仅 `001_tables.inferred.sql` 保留在仓库供复盘（002/003 已移入仓库外私有归档），但**不再是事实来源**。
> 差异过程见 `docs/10-schema-gap-analysis.md`。

## 阅读约定

| 标记 | 含义 |
|---|---|
| **【事实】** | 已由生产结构基线证实的当前状态。可直接依赖。 |
| **【建议】** | 未来新库的优化想法。**当前库中并不存在**，不得当作现状引用。 |

两者的分界线在 §8：**§1–§7 全部是事实，§8 全部是建议。**

---

## 1. 通用约定【事实】

- 每张表都有 `id`：`bigint GENERATED ALWAYS AS IDENTITY NOT NULL`，主键。
  → 导入数据时不能直接指定 id，必须 `OVERRIDING SYSTEM VALUE`（见 §9）。
- 每张表都有 `owner_id`：**`text`，不是 uuid**，`NOT NULL DEFAULT auth.uid()`。
  前端从不传该字段，由服务端注入，是"谁能改这行"的唯一依据。
- 每张表都有 `owner_name`：`text`，**可空**。它是昵称的冗余副本，改昵称时会 fire-and-forget 回刷。
- 除 `profiles` 外，每张表都有 `space_id`：`text NOT NULL`，形如 `FIT-XXXXXX`（`FIT-` + 6 位大写字母/数字，此处为格式占位，非真实口令）。
- 全库**零外键、零 CHECK 约束、零触发器**。所有取值校验都在前端（体重 20–400、文本截断、role/status 枚举）。
- 时间列统一 `timestamptz NOT NULL DEFAULT now()`。

---

## 2. profiles【事实】

一个用户在一个空间里一行。多组 = 同一 `owner_id` 多行。

| 字段 | 真实类型 | 约束 / 默认值 | 说明 |
|---|---|---|---|
| id | bigint | PK，identity always | |
| owner_id | **text** | NOT NULL，DEFAULT `auth.uid()` | 服务端注入 |
| owner_name | text | 可空 | 与 nickname 冗余 |
| space_id | text | NOT NULL | 一个空间一行 |
| nickname | text | NOT NULL | 展示名，可改 |
| role | text | NOT NULL，DEFAULT `'her'` | **无 CHECK**，`'her'/'him'` 只是前端约定，可能存在脏值 |
| start_weight | numeric(5,1) | 可空 | 初始体重 |
| target_weight | numeric(5,1) | 可空 | 目标体重 |
| target_date | date | 可空 | 前端代码未读写（见 §7 schema 漂移） |
| created_at | timestamptz | NOT NULL，DEFAULT `now()` | |

**唯一约束**：`profiles_owner_space_key UNIQUE (owner_id, space_id)`

→ 早期推断稿说"可能没有唯一约束"，**这是错的，实际存在**。前端 `index.html:1816` 的"先查后加"只是体验优化，防重复的底线在数据库。

---

## 3. records【事实】

一人一天一空间一条。

| 字段 | 真实类型 | 约束 / 默认值 | 说明 |
|---|---|---|---|
| id | bigint | PK，identity always | |
| owner_id | **text** | NOT NULL，DEFAULT `auth.uid()` | |
| owner_name | text | 可空 | 改昵称会回刷 |
| space_id | text | NOT NULL | |
| record_date | **date** | NOT NULL | 前端 `slice(0,10)` 比较，实际就是 date |
| weight | numeric(5,1) | NOT NULL | **无 CHECK**，20–400 只是前端限制 |
| tags | **jsonb** | DEFAULT `'[]'::jsonb`，**可空** | 元素是标签文本 |
| todo_done | **jsonb** | DEFAULT `'[]'::jsonb`，**可空** | 元素是 `todos.id`，`indexOf(id)` 判断勾选 |
| mood | text | 可空 | |
| note | text | 可空 | |
| created_at | timestamptz | NOT NULL，DEFAULT `now()` | |
| ~~updated_at~~ | — | **不存在** | 早期推断属过度设计 |

**唯一约束**：`records_owner_date_space_key UNIQUE (owner_id, record_date, space_id)`

→ 同样，早先说"未必有约束"是错的，**实际存在**。注意区分两个概念：迁移时的**业务判重**以这条唯一约束
`(owner_id, record_date, space_id)` 为准；主键 `id` 仅作行标识（导入保留原值），**不用于业务判重**。

---

## 4. todos / tags【事实】

两张表结构完全相同，都是空间级共享（不是个人数据）。

| 字段 | 真实类型 | 约束 / 默认值 | 说明 |
|---|---|---|---|
| id | bigint | PK，identity always | |
| owner_id | **text** | NOT NULL，DEFAULT `auth.uid()` | 创建者 |
| owner_name | text | 可空 | 创建者昵称 |
| space_id | text | NOT NULL | 空间级共享 |
| text | text | NOT NULL | **无长度约束**；≤40 / ≤20 字是前端截断 |
| sort | integer | NOT NULL，DEFAULT `0` | 按 `(n+1)*10` 递增 |
| created_at | timestamptz | NOT NULL，DEFAULT `now()` | |

**无唯一约束**（同空间允许同名条目）。

> ⚠️ `todos.id` 被 `records.todo_done` 以**数组元素**形式引用（无外键）。迁移时必须保持 id 原值，否则勾选记录全部失联。详见 `docs/10` M2。

---

## 5. rewards【事实】

| 字段 | 真实类型 | 约束 / 默认值 | 说明 |
|---|---|---|---|
| id | bigint | PK，identity always | |
| owner_id | **text** | NOT NULL，DEFAULT `auth.uid()` | 立约人（受益方） |
| owner_name | text | 可空 | |
| space_id | text | NOT NULL | |
| condition_text | text | **NOT NULL** | 展示文案，如"体重到 <目标值> kg"（此处为格式占位，不引真实数值） |
| target_weight | numeric(5,1) | 可空 | 达标自动点亮的判定依据 |
| prize | text | **NOT NULL** | 奖励内容；≤30 字是前端限制 |
| promise_by | **text** | **NOT NULL** | 兑现人的 `owner_id`；**无外键** |
| status | text | NOT NULL，DEFAULT `'active'` | **无 CHECK**；`active/pending/done` 是前端约定 |
| achieved_at | timestamptz | 可空 | |
| redeemed_at | timestamptz | 可空 | |
| created_at | timestamptz | NOT NULL，DEFAULT `now()` | |

注意：`owner_id` 与 `promise_by` 都是 **text 类型、存的是身份 id**，不是 `profiles.id`。
两者之间**没有外键**，可能与已删除的成员形成悬空引用。

---

## 6. messages【事实】

| 字段 | 真实类型 | 约束 / 默认值 | 说明 |
|---|---|---|---|
| id | bigint | PK，identity always | 天然按 id 排序 = 时间序 |
| owner_id | **text** | NOT NULL，DEFAULT `auth.uid()` | |
| owner_name | text | 可空 | |
| space_id | text | NOT NULL | |
| text | text | NOT NULL | 无长度约束 |
| created_at | timestamptz | NOT NULL，DEFAULT `now()` | 前端未读，但库里有 |

---

## 7. 约束、索引、权限总览【事实】

### 7.1 约束

| 类型 | 数量 | 明细 |
|---|---|---|
| 主键 | 6 | 每表 `id` |
| 唯一 | 2 | `profiles(owner_id, space_id)`、`records(owner_id, record_date, space_id)` |
| CHECK | **0** | — |
| 外键 | **0** | — |
| 触发器 | **0** | — |

### 7.2 索引

线上只有 8 个索引，**全部由主键/唯一约束隐式产生**（6 个 PK + 2 个 UNIQUE）。
**没有任何以 `space_id` 为前导列的索引。** 数据量小时无影响，但 RLS 里每条策略都要做
`space_id IN (SELECT my_space_ids())`，量大后会是全表扫描。

### 7.3 RLS 与授权

6 张表全部开启 RLS，每表仅 1 条 `FOR ALL TO authenticated` 策略（策略名见
`backend/schema/schema-reference.sql`）。各策略的表达式不在公开版披露，
逐表可见性推导要点：

- 同组可读全部；
- 写入与更新以行归属为准（单表差异与具体表达式仅存私有归档）；
- 现有策略存在多项设计缺陷（编号 S1–S7，机制与影响分析仅存私有归档
  `security-findings.md`），**新库必须从零重新设计并实测，不可原样照搬**。

授权现状：生产授权面比"最小化 CRUD"更宽，具体矩阵细节不在公开版披露（仅存私有归档）；
新库应按逐表最小化原则重新授权（见 §8.4）。

### 7.4 函数

| 函数 | 返回 | 特性 | 用途 |
|---|---|---|---|
| `my_space_ids()` | `SETOF text` | STABLE, SECURITY DEFINER, search_path=public | 返回我加入的全部 space_id，RLS 的基石 |
| `space_peek(code text)` | `jsonb` | STABLE, SECURITY DEFINER | 返回 `{count, names[]}`，加入前预览空间 |

`space_peek` 为 `SECURITY DEFINER`，函数级授权矩阵细节不在公开版披露；
新库设计时必须重新评估其函数级授权（见 `backend/schema/schema-reference.sql` 的元信息说明）。

### 7.5 schema 漂移（仍成立）

生产 `profiles` 有 `target_date`，而归档的 `web/index.html`（10-17 快照）从不读写它。
说明仓库里的前端不是当前生产构建。迁移建表必须保留该字段，否则导数据会丢列。

---

## 8. 未来新库的建议优化【建议 · 当前均不存在】

> **这一节全部是提议，不是现状。** 任何一条在写进迁移脚本前都需要单独评审。
> 顺序按"先保正确、再保性能、最后收紧"排列。

| # | 建议 | 理由 | 风险 |
|---|---|---|---|
| 8.1 | 授权矩阵按逐表最小化重新设计（仅授予前端实际需要的语句类型） | 生产授权矩阵存在冗余面，细节仅存私有归档 | 低，前端只用 CRUD |
| 8.2 | 函数级授权显式收紧（勿沿用默认 PUBLIC EXECUTE） | 默认授权面过宽，具体分析仅存私有归档 | 低 |
| 8.3 | 各表 `WITH CHECK` 与行归属校验从零设计并逐条实测 | 现有策略存在设计缺陷（S1–S7，仅存私有归档） | **中**：可能影响兑现流程，需实测 |
| 8.4 | 补索引 `(space_id)` 或 `(space_id, created_at)` | RLS 子查询与列表查询都按 space 过滤，现在全表扫 | 低（纯性能） |
| 8.5 | 把 `owner_name` 冗余改为 join `profiles(owner_id, space_id)` | 消除"改昵称要回刷 4 张表、回刷失败即不一致"的设计债 | **高**：需改前端渲染，不建议在迁移期做 |
| 8.6 | 为 `todo_done` 建立引用完整性校验（应用层或定期任务） | 删除 todo 不会清理 records 里的数组元素 | 中 |
| 8.7 | 时间列加 `DEFAULT now()` 之外的审计字段（如 `updated_at`） | 便于排查 | 低，但会改变结构，非必要不加 |

**明确不建议的**：不要在新库补 CHECK 约束（体重范围、文本长度、role/status 枚举）。
线上历史数据可能已越界，加 CHECK 会让导入直接失败。校验留在应用层。

---

## 9. 数据迁移注意（由结构直接决定）

| # | 事实 | 后果 |
|---|---|---|
| 1 | `id` 是 `GENERATED ALWAYS AS IDENTITY` | 带 id 导入必须 `OVERRIDING SYSTEM VALUE` |
| 2 | `records.todo_done` 存 `todos.id` 数组 | todos.id 必须保原值，否则勾选失联 |
| 3 | 业务唯一约束是 `(owner_id, space_id)` / `(owner_id, record_date, space_id)` | 业务判重按这两组约束；`id` 是主键、仅作行标识（导入保留原值），不作判重键 |
| 4 | 零 CHECK / 零外键 | 可能有脏值与悬空引用，导入不要假设完整性 |
| 5 | `owner_id` 为 text | 原样搬运，不要 trim / lowercase（uuid 会规范化，text 不会） |
| 6 | 序列当前值未记录 | 导入后需 `setval` 到 `max(id)` |

---

## 10. 字段血缘

```
auth.uid() ──默认值注入──► 每张表的 owner_id (text)
                                │
profiles(space_id) ◄────────────┘  我加入的空间集合
      │
      ├─► 决定我能读哪些 space_id 的行（RLS: my_space_ids）
      │
      ├─► records：每人每天一行，跨组成倍复制（mirrorToday）
      ├─► todos/tags：空间级共享，首次建空间时铺默认值
      ├─► rewards：owner_id=立约人，promise_by=兑现人（同为 text）
      └─► messages：纯追加
```

---

## 11. 仍待确认

| # | 问题 | 为什么重要 |
|---|---|---|
| 1 | `auth.uid()` 返回 text 还是 uuid | 列是 text 且默认值成立，强烈暗示返回 text；新库若是 uuid，DEFAULT 需写 `auth.uid()::text` |
| 2 | `space_peek` 的函数级 ACL | 决定函数级授权风险的口径（分析仅存私有归档） |
| 3 | 序列名与当前值 | 导入后 setval 的基准 |
| 4 | 平台 `auth` schema 用户结构 | 旧 owner_id 如何映射到新库用户 |
| 5 | `role` / `status` 的实际取值分布 | 无 CHECK，可能已有脏值 |
| 6 | 是否存在悬空引用（`promise_by`、`todo_done`） | 决定导入后要不要清洗 |

详见 `docs/10` §6。
