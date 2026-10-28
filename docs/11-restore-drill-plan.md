# 11 · 隔离环境恢复演练方案与实测记录（Phase 1-c）

> 起始日期：2026-10-21（方案与脚本修正：Phase 1-c / 1-c-fix / 1-c-fix-2 / 1-c-fix-3）
> 执行日期：2026-10-21（Step 0 – Step 9-B 逐步授权、逐步执行）；清理日期：2026-10-22（Step 11）
>
> **当前状态：Phase 1-c 已闭环。Step 0–9-B 全部 PASS，Step 11 清理 PASS。**
> 步骤 0–5 为环境与准备，Step 6–9-B 已在隔离容器内真实跑过，逐项实测结果见 **§14 实测执行记录**；
> 清理过程与"匿名卷"这一意外发现见 **§9**（含对"`--rm` = 零残留"这一错误假设的更正）。
> 全文仍保留原始"方案"表述，方便对照"设计期望"与"实测输出"的差异；凡已实测的条目均在正文与 §6 标注。
> 全程未连接生产库，未修改线上站点与配置。
>
> **⚠️ 公开版边界说明**：本报告记录的验收数字（32/32 行、240 次取值 0 差异、RLS 18/18 PASS）
> 均出自**私有原始演练版本**（原始脚本仅存私有归档 `drill-as-run/`）。本仓库
> `backend/schema/drill/` 为**公开脱敏示例**（策略与函数为示意形式），**不能复现上述结果**。
>
> **清理后现状**：本地演练环境**已清空**（容器 0 / 卷 0 / 临时目录不存在 / 端口无监听）；
> 原始备份**仍保留**并通过 SHA256 12/12 校验；Supabase 目标环境**尚未创建**；认证身份**尚未迁移**。

## 本文件的状态标记（重要，不要混读）

全文只用这三种标记描述"这件事到底验证到哪一步"，**计划里的 PASS 一律不等于实测 PASS**：

| 标记 | 含义 | 本次证据 |
|---|---|---|
| 【已静态审查】 | 读代码/文档/语法规则后得出的结论，没跑过 | 例如 PG 17 的 `INSERT ... OVERRIDING SYSTEM VALUE` 子句位置 |
| 【已自测】 | 用合成数据或临时文件跑过脚本本身，**但没碰数据库** | `drill-compare.py` 的 PASS / FAIL / 整列缺失三条路径 |
| 【待实测】 | 必须等 Docker + PostgreSQL 真正起来才能有结论 | 目前仅剩"迁移后才存在的事项"（§6.2、§7） |
| 【已实测通过】 | 在演练库里跑出了预期输出，且贴过原始输出 | **V1–V10 全部、RLS 18 项、Step 3–8 全部自检**（见 §14） |

---

## 0. 结论先讲

| 问题 | 结论 |
|---|---|
| 本机能不能直接跑恢复 | **不能**，缺 PostgreSQL 全套客户端/服务端 |
| 有没有现成容器运行时 | **有**，Docker 28.3.0 + Compose v2.38.1 已装，但**守护进程未启动** |
| 备份包在不在 | `PactFit-backup-2026-10-19.**zip**` **不存在**；但同名**解压目录**在，内容完整，12 个文件全部通过 SHA256 校验 |
| 生产结构快照能直接执行吗 | **不能**，有 4 类硬阻塞（§3） |
| 推荐方案 | **Docker + postgres:17 一次性容器**，绑定 `127.0.0.1:55432`，不挂载**命名**卷，用完即删（注意：镜像自带匿名卷，见 §9.1） |
| 演练脚本齐了吗 | **齐了**：harness / 建表 / 导入生成 / 序列修正 / 库内验收 / RLS 测试 / 导出 / 逐字段比对，共 8 个文件 |
| 有没有真跑过 | **跑过了**。Step 0–9-B 全部 PASS：V1–V10 全通过、V6d `240 次取值 / 0 差异 / 0 量化`、RLS **18/18 PASS**（§14） |
| 数据恢复到了吗 | **到了**。6 张业务表合计 **32 条**记录（4 / 1 / 9 / 18 / 0 / 0），主键原值、identity 序列均已修正并验证 |
| 现在能不能开跑 | 已跑完，无需再确认 C1–C7（§10 保留为当时的决策记录） |

---

## 1. 环境检查结果（问题 A）

| 项 | 状态 | 详情 |
|---|---|---|
| 系统 | ✅ | macOS **26.5**（Build 25F71），**arm64**（Apple Silicon） |
| Homebrew | ✅ | 4.6.9，位于 `/opt/homebrew/bin/brew` |
| Docker CLI | ✅ | 28.3.0（build 38b7060），`/usr/local/bin/docker` |
| Docker Compose | ✅ | v2.38.1-desktop.1 |
| **Docker 守护进程** | ⚠️ | **未运行**：`Cannot connect to the Docker daemon`（unix socket 路径含本机用户名，已脱敏） |
| psql | ❌ | 未找到 |
| postgres（服务端） | ❌ | 未找到 |
| pg_ctl / initdb | ❌ | 未找到 |
| pg_dump / pg_restore | ❌ | 未找到 |
| createdb / pg_isready | ❌ | 未找到 |
| Postgres.app | ❌ | `/Applications/Postgres.app` 不存在 |
| Homebrew 里的 postgres 类 formula | ❌ | `brew list` 无 postgres / libpq / postgis |
| 未链接的 postgres 安装 | ❌ | `/opt/homebrew/opt/postgresql*` 无匹配 |
| 端口 5432 | ✅ 空闲 | 无监听进程 |
| 端口 55432（拟用） | ✅ 空闲 | 无监听进程 |
| 磁盘可用 | ⚠️ 48 GiB | 够用（镜像约 0.4–0.6 GB，数据 < 1 MB） |
| 内存 / CPU | 8 GB / 8 核 | 跑单个 PG 容器足够 |

**一句话**：这台机器上没有任何 PostgreSQL 可执行文件，但有 Docker 客户端和 Homebrew。**离"能跑"只差启动 Docker 守护进程**。

---

## 2. 备份包检查（只报告存在性、大小、清单、校验）

### 2.1 zip 是否存在

| 查找项 | 结果 |
|---|---|
| `PactFit-backups/PactFit-backup-2026-10-19.zip` | ❌ **不存在** |
| `PactFit-backups/*.zip`（递归） | ❌ 一个都没有 |
| `PactFit-backups/PactFit-backup-2026-10-19/`（目录） | ✅ **存在**，2026-10-19 19:40 创建 |

即：**包是解压状态，不是 zip**。这不影响演练，直接使用目录即可；若你们约定要 zip，需要重新打包（本次未做）。

### 2.2 内部文件清单（12 个，已排除 `.DS_Store`）

| 文件 | 大小 | 说明 |
|---|---|---|
| `manifest.json` | 2,035 B | 导出元数据（应用 id、库、方法、行数上限说明） |
| `server_counts.json` | 205 B | 服务端行数快照 |
| `reconciliation.json` | 2,992 B | 逐文件 md5 + 行数 + 跨表引用检查 |
| `SHA256SUMS` | 984 B | 12 个文件的校验清单 |
| `README.md` | 3,077 B | 包说明 |
| `verify.py` | 9,614 B | 包自检脚本 |
| `raw/profiles.json` | 1,006 B | 4 行 |
| `raw/records.json` | 281 B | 1 行 |
| `raw/todos.json` | 1,672 B | 9 行 |
| `raw/tags.json` | 3,293 B | 18 行 |
| `raw/rewards.json` | 2 B | 0 行（空数组 `[]`） |
| `raw/messages.json` | 2 B | 0 行（空数组 `[]`） |
| `raw/auth_users.json` | 1,737 B | **5 行，私有，不参与演练** |

### 2.3 校验结果

- `shasum -a 256 -c SHA256SUMS` → **12/12 全部 OK**。
- `reconciliation.json` → `all_ok: true`，`total_business_rows: 32`。
- `server_counts.json` → `profiles 4 / records 1 / todos 9 / tags 18 / rewards 0 / messages 0`，与 manifest、与你的口径三方一致。
- manifest 记录的导出方式：`只读 SQL（SELECT json_agg(to_jsonb(t)) + md5）`，`access: read-only`，**未执行任何 write / migrate / DDL / GRANT**。
- 行数上限说明：单次查询上限 1000 行，本次各表远低于上限，无分页，因此**不存在"只导了一页"的风险**。

### 2.4 备份包已经自曝的 2 个数据异常（重要）

`reconciliation.json > cross_table_anomalies` 记录了两条：

| 类型 | 内容 | 对演练的含义 |
|---|---|---|
| `dangling_todo_ref` | `records.id=6`（归属某空间，空间口令不在本文披露）的 `todo_done` 引用了 **不存在的 todo id=6** | **验收时"悬空引用"不能以 0 为通过标准**，正确预期是"恰好 1 处，且与对账记录一致" |
| `auth_user_without_profile` | 2 个账号注册但未加入任何空间（无 profile 行） | 解释了为什么 `auth_users=5` 而 `profiles=4`；这 2 个账号不参与业务演练 |

> 这条很关键：如果不预先约定，验收脚本会把"数据本来就有问题"误判成"恢复失败"。

---

## 3. 生产结构快照的可执行性分析（问题 3）

结论：**生产结构快照（原件仅存仓库外私有归档；公开参考为 `backend/schema/schema-reference.sql`）不能直接执行**。它不是 `pg_dump` 产物，而是"读 `pg_catalog` 后重写出的 DDL"，缺少平台环境与执行顺序保障。逐项如下：

| # | 阻塞点 | 证据 | 直接执行的后果 |
|---|---|---|---|
| B1 | `auth.uid()` 依赖 | 全文出现 **13 次**（6 张表的 `owner_id default`、6 条策略、1 个函数体） | `function auth.uid() does not exist`（SQLSTATE 42883），**第 1 张表就建不下去** |
| B2 | `auth` schema 不存在 | 文件里 `CREATE SCHEMA` 出现 **0 次** | 同上 |
| B3 | 平台角色不存在 | `TO authenticated` 出现 **6 次**；`CREATE ROLE` 出现 **0 次** | `role "authenticated" does not exist`（42704） |
| B4 | **PK/UNIQUE 与 `CREATE UNIQUE INDEX` 重复定义** | 第 125–132 行有 **8 条** `CREATE UNIQUE INDEX`，其中 `profiles_pkey`、`profiles_owner_space_key`、`records_pkey`、`records_owner_date_space_key` 等，**建表时已由约束隐式创建** | `relation "profiles_pkey" already exists`（42P07），8 条全失败 |
| B5 | **对象顺序错误** | 策略在第 **145–167** 行，函数在第 **172 / 181** 行 | `CREATE POLICY` 引用的 `my_space_ids()` 尚不存在 → 42883 |
| B6 | 授权未真正执行 | 文末 194–202 行是**注释**，写着"仅记录，不要照抄到新库" | 即使建表成功，`authenticated` 也没有任何表权限；若配上策略，表现为"能连上但查不到/写不进" |
| B7 | 无事务包裹 | 文件无 `BEGIN/COMMIT` | 中途失败会留下半成品 schema，重跑会撞已存在对象 |
| B8 | 未包含扩展、owner、schema 级授权 | 文件头自述"未覆盖项" | 迁移后若缺 `pgcrypto` 之类扩展，需另行确认 |

处置方式：**不修改快照原件**（它是归档证据），另写一份"演练用派生 DDL"，只做必要改写（见 `backend/schema/drill/10_tables.sql` 头部列出的 4 处改写）。

### 3.1 快照里与"安全"相关的差异，演练时故意不复制

| 项 | 生产现状 | 演练库处理 | 原因 |
|---|---|---|---|
| 函数级 / 表级授权差异 | 生产授权面比最小化 CRUD 更宽（明细仅存私有归档） | 按最小化授权 | 演练库只授予前端实际需要的权限 |
| `space_peek` 函数级授权 | 未记录 | 按最小化处理（公开版 `10_tables.sql` 不披露具体写法） | 授权矩阵细节不在公开版披露 |

> 注：逐项生产/演练授权差异对照表仅存私有归档；公开示例不能复现历史 RLS 18/18 验收结果。

### 3.2 导入语句的 PG 17 合法性（Phase 1-c-fix 第 3 条）【已静态审查】

被质疑的写法是：

```sql
insert into public.profiles (id, owner_id, …) overriding system value
select t.id, t.owner_id, …
  from jsonb_populate_recordset(null::public.profiles, $j$[ ... ]$j$::jsonb) as t;
```

逐条核对 PG 17 官方文档，**语法与类型都成立**：

| 核对点 | 结论 | 依据 |
|---|---|---|
| `OVERRIDING SYSTEM VALUE` 的位置 | 合法：位于「列清单之后、数据来源之前」 | 17 版语法概要为 `INSERT INTO t [AS a] [(cols)] [OVERRIDING {SYSTEM\|USER} VALUE] {DEFAULT VALUES \| VALUES \| query}` |
| 与 `query`（`SELECT`）形式能否共存 | 能，`query` 就是该位置的三种数据来源之一 | 同上 |
| `jsonb_populate_recordset` 签名 | `(base anyelement, from_json jsonb) → setof anyelement`，`null::public.t` 是文档示例写法 | 9.16 节 JSON 函数表 |
| 列顺序会不会串 | 不会：Phase 1-c-fix 起改为**显式列清单 + `t.<列名>` 取值**，不再是 `select t.*` 靠位置对应 | 生成器 `build_insert()` |

同时确认了三个**文档明示的语义坑**，并已写进脚本护栏：

1. JSON 里"有键、值为 null"与"没有这个键"填充后同为 SQL NULL —— 无法区分，也不影响本演练（导出用的是 `to_jsonb`，键一定齐全）。
2. JSON 里存在、表里没有同名列的键会被**静默忽略** —— 所以生成器先做键校验，多一个键就报错退出，不赌它会不会丢。
3. NOT NULL 且带 DEFAULT 的列若在 JSON 中缺失，会填 NULL 并触发 `23502`，**不会**回落到 `DEFAULT auth.uid()` —— 所以 NOT NULL 列必须出现在 JSON 里，脚本会先拦。

> 当时的结论是【待实测】：语法合法 ≠ 语句跑通。**Step 6 已给出答案：4 条 `insert` 全部跑通，
> 未出现类型 / 权限 / 约束类运行时报错**（实测输出见 §14.3）。三个语义坑的护栏也都没被触发 ——
> 也就是说这批 JSON 的键集合与表列集合完全对齐，没有一个"多余键"或"缺失 NOT NULL 列"。

---

## 4. 隔离方案设计与取舍（问题 B）

| 方案 | 是否需安装 | 版本匹配 | 隔离度 | 清理难度 | 评价 |
|---|---|---|---|---|---|
| **A. Docker + `postgres:17`（推荐）** | 否（已装 CLI，只需启动守护进程） | ✅ 与生产 17.11 同主版本 | 高（独立容器、独立端口、不挂载命名卷） | 低（`--rm` 通常清理容器与关联匿名卷，但**需事后独立核验**，见 §9.1） | **推荐** |
| B. `brew install postgresql@17` | 是（下载 + 建集群） | ✅ | 中（本机服务，可能开机自启） | 中（需停服务、删数据目录） | 仅在 Docker 不可用时备选 |
| C. 云端临时库（Neon / Supabase branch） | 否 | 可能不同版本 | 低（数据出境，违背"完全隔离"） | 中 | **不推荐** |
| D. 复用任何现有 PG 实例 | — | — | 低 | — | 禁止 |

**推荐 A**，理由：① 你们机器已经装好 Docker，只差启动；② 主版本对齐 17.x，避免行为漂移；③ 独立容器 + 独立端口 + 不挂载命名卷，隔离度足够（但"零残留"不能靠 `--rm` 自动保证，见 §9.1）；④ 全程可用容器内的 `psql`，**不需要在本机装任何 PostgreSQL 客户端**。

关键约束（写进命令，不靠自觉）：

- 端口固定 `127.0.0.1:55432`（只监听回环，不对外）；
- 容器名固定 `pactfit-drill-pg`，库名固定 `pactfit_drill`；
- 不设任何 `PGHOST` / `PGPASSWORD` 环境变量，所有 `psql` 都在容器内执行；
- **不挂载命名卷**（`-v` / `--mount`）；但 `postgres:17` 镜像自带 `VOLUME /var/lib/postgresql/data`，不显式挂载并不等于没有卷 —— Docker 会**自动创建匿名卷**，容器销毁后必须单独核验回收（§9.1）。

---

## 5. 操作顺序（已按此顺序实际执行）

> 下列命令即**实际执行的命令**（仅把当时使用的变量替换为字面量），不是示意。
> 每一步的实际输出、异常与判定汇总在 **§14**；正文各 Step 括号内补注实测差异。

### Step 0 · 确认 Docker 就绪

```bash
docker version --format '{{.Server.Version}}'   # 期望：28.x
```

**实测**：输出 `28.3.0`，退出码 0 → PASS。

### Step 1 · 拉镜像（约 0.4–0.6 GB，仅首次）

```bash
docker pull postgres:17
docker run --rm postgres:17 postgres --version   # 期望 PostgreSQL 17.x
```

**实测**：镜像架构 `linux/arm64`（与本机 Apple Silicon 一致），
`postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2)`，
digest `sha256:2d2b8998…`（完整值见 §14），与生产 `17.11` **同为 17 主版本、小版本也相同** → PASS。

### Step 2 · 起一次性容器

```bash
docker run -d --rm \
  --name pactfit-drill-pg \
  -e POSTGRES_PASSWORD='<一次性随机串，仅存在于本地命令历史>' \
  -e POSTGRES_DB=pactfit_drill \
  -p 127.0.0.1:55432:5432 \
  postgres:17
```

验证：

```bash
docker exec pactfit-drill-pg psql -U postgres -d pactfit_drill -c "select version();"
docker exec pactfit-drill-pg psql -U postgres -d pactfit_drill -c "show server_version;"
```

**实测**：容器 `82ed4cf238d0` 状态 `Up`，端口映射 `127.0.0.1:55432->5432/tcp`，
容器内 `server_version = 17.11`，库名 `pactfit_drill` 已建 → PASS。

### Step 3 · 建 harness（auth schema + 角色 + uid 桩）

```bash
docker cp backend/schema/drill/00_harness.sql pactfit-drill-pg:/tmp/
docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
  -v ON_ERROR_STOP=1 -f /tmp/00_harness.sql
```

期望自检输出：`1 / 1 / 3 / true`（auth schema / auth.uid() / 三个角色 / authenticated 对 auth 的 USAGE）。

**实测**：`1 / 1 / 3 / t`，退出码 0 → PASS（第 4 列 `t` 说明 `authenticated` 确实拿到了 `auth` schema 的 USAGE）。

> 第 4 列是 Phase 1-c-fix 补的。没有它，`authenticated` 调 `auth.uid()` 会先撞
> 42501 "permission denied for schema auth"，而 RLS 拒绝写入**也是** 42501 ——
> V9 会把权限不足当成"隔离生效"，得出假 PASS。这一条不能省。

### Step 4 · 建表（派生 DDL，不是快照原件）

```bash
docker cp backend/schema/drill/10_tables.sql pactfit-drill-pg:/tmp/
docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
  -v ON_ERROR_STOP=1 -f /tmp/10_tables.sql
```

期望自检输出：`6 / 6 / 2 / 2 / 0`（表 / 策略 / 函数 / 唯一约束 / CHECK）。

**实测（含一处口径修正，重要）**：
- 首轮跑出 `6 / 6 / 2 / 2 / **37**`。第 5 列不是"混进了 37 个 CHECK"，而是
  `information_schema.check_constraints` 在 PG 17 会把**每个 NOT NULL 列**也报成一条
  `2200_<oid>_<attnum>_not_null`。本演练 6 表共 **37 个 NOT NULL 列**，数字正好相等。
- 权威口径是 `pg_constraint.contype='c'`。Step 5 授权后把 `10_tables.sql` 与 `40_verify.sql`
  两处统计同步改为该口径；**未重跑 Step 4**，只做只读复算，得 `6 / 6 / 2 / 2 / 0`，另有 `indexes = 8`（见 V10）。
- 结构细项实测：**53 列** / 主键 6 / UNIQUE 2 / 真 CHECK 0 / 外键 0 / 触发器 0 / 索引 8 / 序列 6 / RLS 启用 6 / 策略 6 → PASS。

### Step 5 · 生成导入 SQL（在仓库外生成，含个人数据）

```bash
mkdir -p ~/PactFit-drill
python3 scripts/drill-gen-import.py \
  --src  "$HOME/Downloads/PactFit-backups/PactFit-backup-2026-10-19/raw" \
  --out  "$HOME/PactFit-drill/20_import.sql" \
  --expect "$HOME/PactFit-drill/expected.json"
```

脚本行为（Phase 1-c-fix 后）：

- 读 6 个 JSON，**先用列清单校验键**：多一个键 / 缺一个 NOT NULL 列都直接报错退出，不赌 `jsonb_populate_recordset` 会静默忽略还是塞 NULL；
- 生成 `insert into public.t (显式列清单) overriding system value select t.<列名>... from jsonb_populate_recordset(...)`；
- 输出文件权限 **0600**、目录 0700；
- 输出路径经 `realpath` 解析后若在仓库内 → 拒绝（**符号链接指回仓库也会被识别**）；
- `expected.json` 存行数、逐列空值计数、辅助指纹，**不存任何字段值**。

【已自测】三条隐私闸门都实测过：直接写仓库 → 拒绝；`/tmp/link → 仓库/docs` 软链 → 拒绝；源目录在仓库内 → 拒绝。三条均退出码 1 且未产生文件。

**实测**：`20_import.sql` **8,155 B**、`expected.json` **3,160 B**，权限均为 `0600`，目录 `0700`；
`expected.json` 内 `total_rows = 32`，与 `server_counts.json` 一致；
生成 4 条 `insert`（rewards / messages 为空表，跳过），退出码 0 → PASS。

### Step 6 · 导入（单事务，失败全回滚）

```bash
docker cp ~/PactFit-drill/20_import.sql pactfit-drill-pg:/tmp/
docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
  -v ON_ERROR_STOP=1 -f /tmp/20_import.sql
```

期望：4 条 `INSERT 0 N`（N 依次 4 / 1 / 9 / 18），rewards / messages 打印"0 行，跳过"。
注意：**不要加 `-1`** —— 生成的文件自带 `begin; … commit;`，外面再包一层会刷 "there is already a transaction in progress" 警告。

**实测**：`BEGIN` → `INSERT 0 4` / `INSERT 0 1` / `INSERT 0 9` / `INSERT 0 18` → `COMMIT`，
退出码 0；行数与 4+1+9+18 = **32** 一致 → PASS。

### Step 7 · 修正 identity 序列

```bash
docker cp backend/schema/drill/30_postload.sql pactfit-drill-pg:/tmp/
docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
  -v ON_ERROR_STOP=1 -f /tmp/30_postload.sql
```

期望：6 行，`seq_ok` 全为 `true`，即 `seq_last_value = greatest(max_id, 1)`
（profiles 4 / records 1 / todos 9 / tags 18，空表 rewards / messages 为 1）；
探针 `probe_todo_id = 10`；末尾 `todos_seq_last_value = 9 / todos_max_id = 9 / todos_rows = 9 / probe_rows_left = 0`。

**实测（原始主键不是 1..N，所以期望值与我当时的预估算不同）**：
- 六表 `seq_ok` 全 `t`；实际 `last_value` = **profiles 22 / records 6 / todos 14 / tags 24**，
  正是各表的 `max(id)`（`t` = `is_called` 为真，说明"取过号"）。这证明**原始主键被完整保留**，
  没有重编号成 1..N ——源数据主键本来就是不连续的。
- 探针 `probe_todo_id = 15`（= 14 + 1，符合"先取号再插入"），
  末尾 `todos_seq_restored = 14`，四列核实行 `14 | 14 | 9 | 0` → 序列复原生效、探针无残留。
- rewards / messages 两行在 **`pg_sequences` 视图里 `last_value` 为 NULL**，
  最初被误读为故障；按 `select last_value, is_called from <seq>` 直接读得 **`1 / f`**，
  即"从未取过号"，与"空表应从 1 开始"一致 → 不是故障，是视图口径（见下一条注）。
- 退出码 0 → PASS。

> 这里刻意不用 `is_called`：`pg_sequences` 视图**没有这一列**（只有 `last_value`）。
> "从没取过号"表现为 `last_value IS NULL`，而 `setval(seq, 1, false)` 之后 `last_value` 就是 1。

> 探针会消耗一个序列号且**不随事务回滚**，所以脚本在探针后显式 `setval` 复原。若看到 `todos_seq_last_value = 10`，说明复原没生效 —— 这会让后续真实插入跳到 11，属 FAIL。

### Step 8 · 库内验收

```bash
docker cp backend/schema/drill/40_verify.sql pactfit-drill-pg:/tmp/
docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
  -v ON_ERROR_STOP=1 -f /tmp/40_verify.sql
```

逐项对照 §6 的 V1–V10。重点看三处：
- V6a 六行 `signature_match` 全为 `true`，且末尾"实际签名"查询 **0 行**；
- V6b `null_cells` = 4 / 0 / 0 / 0（profiles 的 4 个空值全来自 `target_date`）；
- V6c 指纹与 `expected.json` 的 `fingerprint` 相等（仅辅助，不作判据）。

**实测**：退出码 0，脚本内不 raise，因此逐项人工判读，结果如下（全部 PASS）：

| 项 | 实测关键值 |
|---|---|
| V1 | `total_rows = 32`（4 / 1 / 9 / 18 / 0 / 0） |
| V2 / V3 / V4 / V7 | 主键重复 0、业务唯一键重复 0、JSONB 非法形态 0、占位 owner 命中 0 |
| V5 | **恰好 1 行**：`exactly_one = t`、`matches_reconciliation = t`、`any_resolvable = f`（= 悬空引用确实解析不到，与备份对账一致） |
| V6a | 六表 `signature_match = t`，缺列 0、多列 0、异常签名查询 0 行 |
| V6b | `4 / 0 / 0 / 0`（空表返回 NULL） |
| V6c | 6 个指纹与 `expected.json` **全等** |
| V8 | `distinct_spaces = 3`，成员分布 **2 / 1 / 1** —— 实测确认**三个空间，第三个空间不是无成员空间**（完整服务端备份中含其 1 条 profile，该成员不持有任一备份账号）。docs/09"客户端导出并集 ≠ 数据库总行数"的结论仍成立 |
| V10 | `6 / 6 / 2 / 2 / 0 / 8`（表 / 策略 / 函数 / 唯一约束 / CHECK / 索引） |

### Step 9 · RLS 独立测试

```bash
docker cp backend/schema/drill/45_rls_test.sql pactfit-drill-pg:/tmp/
docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
  -v ON_ERROR_STOP=1 -f /tmp/45_rls_test.sql
echo "exit=$?"     # 0 = 18 项全 PASS；非零 = 有 FAIL / INCONCLUSIVE
```

**身份切换方式（Phase 1-c-fix-3 重做）**：脚本里 **不存在** 任何 PL/pgSQL 内的
`SET LOCAL ROLE` / `RESET ROLE`，也没有 `BEGIN … EXCEPTION` 包住写入。用的是 psql 层的
session 级切换：

| 阶段 | 角色 | 做什么 | 事务边界 |
|---|---|---|---|
| C | `postgres` | 算预期，写 `drill_meta.rls_expect`；把身份/空间塞进会话 GUC；**同时把六表行数、全库业务指纹、`messages` 序列的 `(last_value, is_called)` 存进 `drill_meta.rls_baseline`** | 自动提交 |
| D | `authenticated`（`SET ROLE`，session 级） | 只跑 SELECT（item 1–10、13），结果写 `drill_meta.rls_actual` | 每条语句自动提交 |
| D′ | 同上 | 三段探针：跨空间 `INSERT`、同空间 `INSERT`（`returning id`）、跨空间 `UPDATE`（no-op 自赋值）。**三段全部 `BEGIN` → 记录 `:ERROR`/`:SQLSTATE`/`:LAST_ERROR_MESSAGE` → 无条件 `ROLLBACK`** | **显式事务，必回滚** |
| E | `postgres`（`RESET ROLE`） | **不 DELETE**，只计数探针残留（item 15）；按基线把 `messages` 序列**原状态**写回；前后不变量 item 16–18；建判定视图、终局断言 | 自动提交 |

> Step 9-A / 9-B 的两处关键加固：① 三段探针**都**包显式事务并**无条件回滚**，不再依赖"被 RLS 拒绝所以语句自身回滚"这种间接保证——即使隔离失效、写入成功，`ROLLBACK` 也一定撤销；② 取消原来的"兜底 DELETE 探针行"，改为**只计数**：残留就是回滚链路失效的信号，删掉只会掩盖异常。

为什么这样更稳：`SET LOCAL` 的作用域是"当前事务/子事务"，写在异常块里时，
一旦抛出异常子事务回滚，角色设置会跟着消失——这是靠经验判断的行为，不该作为测试基线。
改成 session 级 `SET ROLE` 后，D 段每一条语句的执行身份都是确定的，
并且第 1 项直接把 `current_user` 记下来比对，**身份没切成功会立刻 FAIL**。

**18 项**检查与通过条件（编号与 `drill_meta.rls_expect.ord` 完全一致）：

| # | 检查项 | 通过条件 |
|---|---|---|
| 1 | 执行身份 | `current_user = authenticated` |
| 2 | `auth.uid()` 等于测试身份 | = `true`（只落 true/false，不落 uid） |
| 3 | 可见空间数（`distinct space_id`） | 等于该用户全部空间数 |
| 4 | `my_space_ids()` 空间数 | 与第 3 项一致 |
| 5 | profiles 可见行数（我全部空间） | 等于预期 |
| 6 | records 可见行数（我全部空间） | 等于预期 |
| 7 | todos 可见行数（我全部空间） | 等于预期 |
| 8 | tags 可见行数（我全部空间） | 等于预期 |
| 9 | messages 可见行数（我全部空间） | 等于预期 |
| 10 | 未授权空间可见行数 | = 0 |
| 11 | 跨空间写入（他组空间） | `SQLSTATE = 42501` **且** 消息含 `row-level security` |
| 12 | 同空间写入（应成功并回滚） | `returning id` 拿到正数 id（证明确实写入），随后 `ROLLBACK` |
| 13 | 隔离证据：可见 profiles < 全库 | 严格小于 |
| 14 | 跨空间 `UPDATE`（`USING` 过滤）影响行数 | = 0（no-op 自赋值，即使漏放行也改不动值） |
| 15 | 探针行残留 | = 0（**只断言，不 DELETE**） |
| 16 | 六表行数未变（对比测试前基线） | = `unchanged` |
| 17 | 业务数据指纹未变（对比测试前基线） | = `unchanged` |
| 18 | `messages` 序列状态未变（对比测试前基线） | `last_value` 与 `is_called` 均 = `unchanged` |

> 第 16–18 项是 Step 9-A 新增的"前后不变量"：不只证明"没写进去"，还要证明
> 32 条真实记录的**行数、字段值、序列状态**三点在测试前后完全一致。

**未授权空间怎么选（第 1 条）**：不是拿"第一条 profile 的 space_id"去比，而是
`space_id NOT IN (select space_id from profiles where owner_id = 本用户)`，
即先取出该用户的**全部**空间，再找一个真正不属于他的。找不到时第 10、11 项判
`INCONCLUSIVE`，整轮按**不通过**处理——"没测到"不等于"通过"。

期望输出：18 行全 `PASS`，末行 `PASS: RLS 测试 18 项全部通过`，退出码 0。

**实测（Step 9-B，18/18 PASS，退出码 0）**：

| 关键项 | 实测值 |
|---|---|
| item 1 执行身份 | `current_user = authenticated` |
| item 10 未授权空间可见行数 | `0` |
| item 11 跨空间写入 | `sqlstate = 42501`，**消息含 row-level security = true**，未出现"permission denied for schema"混淆 |
| item 12 同空间写入 | `returning id` 拿到正数 id，`ROLLBACK` 后行不存在 |
| item 13 隔离证据 | 可见 profiles `3` < 全库 `4` |
| item 14 跨空间 UPDATE | 影响 **0 行** |
| item 15 探针残留 | `0` |
| item 16 / 17 / 18 | `unchanged` / `unchanged` / `unchanged` |
| 事后独立复核 | 六表 `4 / 1 / 9 / 18 / 0 / 0`、`probe_rows = 0`、`fp_match = true`、`messages` 序列 `1 / false` |
| 结构未被污染 | public 仍为 6 表 / 6 策略 / 2 函数 |

> 全程不打印 owner_id、空间口令、昵称、留言；第 11 项只打印 SQLSTATE 与
> "消息含 row-level security = true/false"，不打印错误原文。

### Step 10 · 逐字段保真比对（库外）

```bash
docker cp backend/schema/drill/50_dump.sql pactfit-drill-pg:/tmp/
docker exec -i pactfit-drill-pg psql -U postgres -d pactfit_drill \
  -v ON_ERROR_STOP=1 -f /tmp/50_dump.sql

# 复制出来必须自己收紧权限：docker cp 按容器内属主落盘，本机权限不一定还是 0600
docker cp pactfit-drill-pg:/tmp/pactfit-actual.json ~/PactFit-drill/
chmod 600 ~/PactFit-drill/pactfit-actual.json
ls -l ~/PactFit-drill/pactfit-actual.json      # 期望 -rw-------

python3 scripts/drill-compare.py \
  --src    "$HOME/Downloads/PactFit-backups/PactFit-backup-2026-10-19/raw" \
  --actual "$HOME/PactFit-drill/pactfit-actual.json" \
  --expect "$HOME/PactFit-drill/expected.json" \
  --purge-on-pass
echo "exit=$?"     # 0 = 全 PASS（且已自动删除导出文件）；1 = 有差异/有量化且开了严格口径/权限不严
```

期望：`合计：6 张表 / 32 行 / 240 次取值 / 0 处差异 / 0 处量化`，`V6d 结论：PASS`，退出码 0，
末行 `已删除临时导出：.../pactfit-actual.json`。
每张表还会多打一行 `id 重复 源 0 / 库 0`：主键重复会让"后一条盖掉前一条"，
不单独查就会漏字段。

**实测（Step 8，真实备份 vs 真实恢复库）**：退出码 0，与期望值逐字一致。

| 表 | 取值次数 | 差异 | 量化 | id 重复 |
|---|---|---|---|---|
| profiles | 40 | 0 | 0 | 0 / 0 |
| records | 11 | 0 | 0 | 0 / 0 |
| todos | 63 | 0 | 0 | 0 / 0 |
| tags | 126 | 0 | 0 | 0 / 0 |
| rewards / messages | 0 | 0 | 0 | 0 / 0 |
| **合计** | **240** | **0** | **0** | — |

- 追加 `--strict-precision`（要求"量化也必须为 0，一位小数都不能变"）**同判 PASS**，说明连"被量化掩盖的偏差"也不存在。
- `--purge-on-pass` 生效，导出文件已删除；`~/PactFit-drill/` 只剩 `20_import.sql` 与 `expected.json`
  （**该目录已于 Step 11 整体删除，见 §9**）。

比对规则（语义级，不是字符串级），每格只可能是三种结论：

| 类型 | 一致（match） | 已量化（quantized，会单独计数并告知） | 差异（diff） |
|---|---|---|---|
| `numeric(5,1)` | 数值完全相等 | 源值小数位超过 1 位，四舍五入后相等 | 量化后仍不等 |
| `date` | 日期相同 | 源里带时分秒，落库只剩日期 | 日期不同 |
| `timestamptz` | 时刻完全相同 | 源小数秒超过 6 位，按 PG 规则**四舍五入**到微秒后相同 | 时刻不同（含 1µs 真实偏差） |
| `jsonb` | 语义相等（键序/空格无关） | — | 语义不同 |
| 其余 | 逐字符相等 | — | 不同 |
| NULL | 两侧同为 NULL | — | 一侧有值一侧 NULL |

> `timestamptz` 为什么不能"先转 datetime 再比"：Python 的 `datetime` 只有微秒，
> `fromisoformat` 对 `.123456789` 是**截断**，而 PostgreSQL 是**四舍五入**（→ `.123457`）。
> 拿截断值去比会把正常量化误报成真实差异，所以这里用精确十进制保存原始小数位，
> 再用 `HALF_UP` 量化到 6 位后比较。

**关于"量化"的口径**：量化不是无损。脚本会逐列打印 `量化 N` 并在总账里单列
`N 处量化`；默认仍判 PASS（因为这是目标字段精度决定的类型转换，不是恢复出错），
但如果你要求"一位小数都不能变"，加 `--strict-precision` 让它直接 FAIL。

**权限控制**：`50_dump.sql` 先用 `install -m 600` 把容器内目标文件建成 0600 再写，
导出后 `chmod` + `stat` 复查；宿主机 `docker cp` 后再 `chmod 600`；
比对器开头会 `stat` 这个文件，**权限宽于 0600 直接退出码 1**，不进入比对。

【已自测】本轮全部用**合成数据**（假 owner、假空间、假时间戳），没有引入真实个人数据：

| 场景 | 输出 | 退出码 |
|---|---|---|
| 基线（源=库） | `6 表 / 32 行 / 240 次取值 / 0 差异 / 0 量化`，PASS | 0 |
| 注入 5 类缺陷（数值/文本/时间漂移、单行丢列、主键撞号） | 7 处差异，FAIL | 1 |
| `todos.text` 整列缺失 | `列集合 库少 1 [库少: text]`，FAIL | 1 |
| `60.55 → 60.6` | `量化 1`，`PASS(量化 1)` | 0 |
| 小数秒 `.123456789 → .123457`（PG 四舍五入） | `量化 1`，**不误报为差异** | 0 |
| 小数秒 `.123456123 → .123456`（舍去） | `量化 1` | 0 |
| 小数秒 `.000000 → .000001`（真差 1µs） | `差异 1`，FAIL | 1 |
| `profiles` 出现重复 id | `id 重复 源 0 / 库 1`，FAIL | 1 |
| 加 `--strict-precision` | 量化改判 FAIL | 1 |
| 导出文件 `chmod 644` | 权限检查 FAIL（比对不启动） | 1 |
| `--purge-on-pass` | 文件被删除 | 0 |

全部为脚本逻辑自测（Phase 1-c-fix 阶段，未碰数据库）。**这些不是恢复结果**。
真实端到端比对在 Step 8 完成：`6 表 / 32 行 / 240 次取值 / 0 差异 / 0 量化`，退出码 0（结果见上表）。

---

## 6. 成功标准（PASS 判据）

> **状态列读法**：全部 13 项现为【已实测通过】——即在 `pactfit-drill-pg` 容器里跑出了预期输出，
> 且原始输出已核对（汇总见 §14）。下表期望值最初来自静态设计与备份对账，**实测后已逐项确认一致**；
> 唯一与预估不同的一处是 V8 的推断来源（已实测确认 3 个空间，见该行说明）。
>
> 仍属【待实测】的只有**迁移后才存在的事项**（目标库结构、身份映射、新 RLS 策略等），列在 §6.2。

| 编号 | 检查项 | PASS 条件 | 状态 |
|---|---|---|---|
| V1 | 行数总账 | 4 / 1 / 9 / 18 / 0 / 0，合计 **32** | 【已实测通过】 |
| V2 | 主键唯一 | 6 张表 `count(*) - count(distinct id)` 全为 **0** | 【已实测通过】 |
| V3 | 业务唯一键 | `(owner_id, space_id)` 与 `(owner_id, record_date, space_id)` 重复组均为 **0** | 【已实测通过】 |
| V4 | JSONB 形态 | `tags` / `todo_done` 中 `NULL` 或非 `array` 的记录数均为 **0** | 【已实测通过】 |
| V5 | 悬空引用 | **恰好 1 行**：`record_id=6, missing_todo_id=6`；非数字元素 **0 行** | 【已实测通过】 |
| V6a | 列签名逐列核对 | 6 行 `signature_match = true`，`expected_cols_missing = 0`，`unexpected_cols = 0`；异常签名查询 **0 行** | 【已实测通过】 |
| V6b | 空值单元格统计 | profiles **4** / records **0** / todos **0** / tags **0**；空表为 NULL | 【已实测通过】 |
| V6c | 辅助指纹 | 6 个指纹与 `expected.json` 相等（空表 `EMPTY`）—— **仅辅助，不作判据** | 【已实测通过】 |
| V6d | 逐字段比对 | `240 次取值 / 0 处差异`，退出码 0；**量化处数必须被显式打印**，为 0 才算完全无损 | 【已实测通过】 |
| V7 | owner_id 未被占位 | 4 张有数据的表命中占位值均为 **0** | 【已实测通过】 |
| V8 | 空间分布 | 不同 `space_id` = **3**；成员数 **2 / 1 / 1**（实测确认三个空间、分布 2/1/1；**第三个空间不是无成员空间**——完整服务端备份中含其 1 条 profile，该成员不持有任一备份账号；docs/09 的客户端可见范围口径不受影响） | 【已实测通过】 |
| V9 | RLS 隔离 | **18 项**全 PASS（含 item 14 跨空间 `UPDATE` 影响 0 行、item 16–18 行数/指纹/序列前后不变量）；`current_user = authenticated`；`auth.uid()` 返回测试身份；未授权空间按"该用户全部空间"之外的集合选取，选不出则 `INCONCLUSIVE`；跨空间写入 `42501` **且** 消息含 `row-level security`；同空间写入成功且已回滚；`可见 < 全库`；探针残留 0；**脚本退出码 0** | 【已实测通过】 |
| V10 | 结构无污染 | 表 **6** / 策略 **6** / 函数 **2** / 唯一约束 **2** / CHECK **0** / 索引 **8** | 【已实测通过】 |

任一不符 = 演练失败，**不得进入 Phase 1-d**。本次演练 13 项**全部满足**（实测值见 §14）。

> 特别说明 V5：这是"数据本来就有洞"，不是"恢复出错"。判据是"与 `reconciliation.json` 记录一致"，不是"零异常"。
> 特别说明 V6c/V6d 的关系：指纹只覆盖 `id / owner_id / created_at` 三列，剩下 8～10 个业务字段它看不见。
> Phase 1-c-fix 之后**判据以 V6d 为准**，V6c 退为交叉参考 —— 别再拿指纹当"值保真"的通行证。
> 特别说明 V10 的索引数：若 > 8，说明有人执行了快照里那 8 条重复的 `CREATE UNIQUE INDEX`；
> 若 CHECK > 0，说明把 docs/03 §8 的"建议优化"当成既成事实建了进去。**实测为 8 / 0，两处都没被污染。**

### 6.1 各验收项由谁执行

| 项 | 执行文件 | 跑在哪 | 失败时怎么"出声" |
|---|---|---|---|
| V1–V5、V6a–V6c、V7、V8、V10 | `backend/schema/drill/40_verify.sql` | 容器内 psql | 输出 FAIL 行；SQL 本身不 raise（人工判读） |
| V6d | `50_dump.sql` + `scripts/drill-compare.py` | 容器导出 → 本机比对 | **退出码 1** |
| V9 | `backend/schema/drill/45_rls_test.sql` | 容器内 psql（**psql 层** `SET ROLE`，非 plpgsql 内） | **退出码非零**（raise + `ON_ERROR_STOP`） |

### 6.2 演练**没有**覆盖、仍属【待实测】的事项

V1–V10 全部通过**不等于**迁移方案已就绪。下面这些在这次演练里根本不存在，仍未验证：

| 未覆盖项 | 为什么这次测不到 | 归到哪一步 |
|---|---|---|
| 目标库类型（Supabase / 其他）的 `auth.uid()` 实现 | 演练用**桩函数**（`returns text`），与 Supabase 的 `uuid` 返回类型不同 | Phase 1-d |
| 真实认证（验证码 / session / JWT 签发） | 演练只有 `set_config('pactfit.uid', …)` 模拟身份，没有登录链路 | Phase 1-d |
| 新 RLS 策略是否修掉已知缺陷 | 演练**刻意复制**旧策略形态，只为验证"旧策略在旧数据上表现如何"，未做任何加固（缺陷编号 S1–S7 仅存私有归档） | Phase 1-d |
| 生产授权矩阵中的冗余面（明细仅存私有归档） | 演练库**故意不授予**，未验证其真实危害 | 安全审计 |
| 前端 SDK 替换、`unwrap()` 契约变更 | 演练只碰数据库，前端一行未动 | Phase 2 |
| 并发写入 / 长事务 / 连接池行为 | 单连接串行执行，没有并发场景 | Phase 2 联调 |
| 数据规模（当前 32 行）下的性能 | 数据量极小，指标无参考意义 | Phase 2 |

---

## 7. 认证迁移边界（本次未实施，演练后仍未实施）

> **明确结论：认证身份一个都没有迁移。** `raw/auth_users.json`（5 行）从未导入任何数据库，
> 演练库里也没有 `auth.users` 表 —— 它不属于"已迁移内容"，只能算"已备份、待映射的原始材料"。

| 项 | 处理 |
|---|---|
| `raw/auth_users.json`（5 行） | **不导入**。演练库没有 `auth.users` 表，也刻意不建 |
| 字段范围 | 仅 `id / email / phone_number / providers / 状态 / 时间戳`；manifest 明确声明**不含 password、token、two_factor、register_info** |
| 输出 | 本次及后续报告中**不出现任何邮箱、手机号、用户 id 明文** |
| 未来映射（Phase 1-d 之后才做） | 4 条 `profiles.owner_id` 需在 5 个 auth users 中找到对应；另有 2 个账号注册未加入空间（无 profile） |
| 映射方式 | 建议建一张私有映射表 `old_owner_id → new_user_id`，只存本机，不入库、不入仓；迁移时以 `owner_id` 为唯一锚点 |
| 验证码通道 | 仍完全依赖平台，迁移前无法自测 |

---

## 8. 风险与应对

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | **误连生产库** | 致命 | 所有命令硬编码 `127.0.0.1:55432`；不设 `PGHOST`/`PGPASSWORD`；`psql` 只在容器内跑；导入脚本拒绝写入仓库路径 |
| R2 | **PII 落盘扩散** | 高 | 导入 SQL 与 expected.json 只生成在 `~/PactFit-drill/`（仓库外）；演练后删除；`.gitignore` 已覆盖 `*-backup-*.json` |
| R3 | `jsonb_populate_recordset` 对时间字符串的时区解释与生产不同 | 中 | V6d 把 `timestamptz` 解析成时刻统一到 UTC 再比，`+08:00` 与 `+00:00` 不会被误判成差异；V6c 指纹（UTC 秒级 epoch）作交叉参考 |
| R3b | `numeric(5,1)` 把两位小数悄悄四舍五入，被当成"数据丢失"误报 | 中 | V6d 对数值列按同样规则量化后再比，并在 §5 Step 10 写明这是类型转换、不算丢失 |
| R3c | 拿 `id/owner_id/created_at` 指纹当"值保真"的通行证，漏掉其余 8～10 个字段 | 中 | Phase 1-c-fix 起判据改为 V6d 逐字段比对，V6c 降级为辅助（已在 §6 注明） |
| R4 | identity 序列未推进 → 后续插入撞号 | 高 | Step 7 显式 `setval` + 事务内探针验证 |
| R5 | 重复执行导入 → 唯一键冲突 | 中 | 容器一次性（`--rm`），每轮重建；导入文件自带 `begin/commit`，单事务失败即全回滚 |
| R6 | 用超级用户测 RLS 测不出真实行为 | 中 | V9 必须 `set role authenticated`；否则 RLS 被绕过，会得出"权限没问题"的错误结论 |
| R7 | PG 版本漂移 | 中 | 固定 `postgres:17`，Step 1 核对 `server_version` 与生产 17.11 同主版本 |
| R8 | 端口冲突 | 低 | 55432 已确认空闲；如冲突改 55433，不改 5432 |
| R9 | 8 GB 内存下 Docker 抢占资源 | 低 | 单容器、空库，默认配置足够；必要时 `--memory=1g` |
| R10 | 把演练库当生产用 | 中 | 容器名/库名都带 `drill`；结束后强制销毁并复查 `docker ps -a` |

---

## 9. 清理方式与实际执行结果（Step 11 已完成）

> **状态：已执行完毕，Step 11 = PASS。** 但实际过程与本方案最初的设计**不一致**，
> 差异正是本节的重点 —— 它推翻了一个曾经的错误假设（"`--rm` + 未挂载卷 = 零残留"）。

### 9.0 最初设计 vs 实际发生

| 环节 | 设计预期 | 实际发生 |
|---|---|---|
| 容器销毁方式 | 执行 `docker stop pactfit-drill-pg`，`--rm` 生效 | **容器在停止前就已消失**：`docker inspect` 报 `No such object`，全机容器 0 个 |
| 消失原因 | — | 该容器 `--rm` 且无 restart policy；10-21 16:57 之后 Docker 守护进程重启（或机器重启），auto-remove 容器被自动清除。容器内残留的 `postmaster.pid` 也印证是**非正常终止** |
| 数据卷 | 以为"未挂载 `-v`，所以没有卷" | **错。** 遗留 1 个 dangling 匿名卷，48.67 MB，`CreatedAt=2026-10-21T04:16:21Z`（与演练容器创建同刻） |
| 成因 | — | `postgres:17` 镜像声明 `VOLUME /var/lib/postgresql/data`；不显式 `-v` / `--mount` 时 Docker **自动创建匿名卷**。`--rm` 在正常移除容器时通常会一并清理关联匿名卷，但**异常路径（守护进程重启）下不保证** |
| 清理方式 | `docker stop` + `rm -rf ~/PactFit-drill` | 归属核验 → `docker volume rm <完整卷 ID>` → 逐文件 `rm -f` → `rmdir` |

**结论（已写进本文档口径）**：`--rm` 不能被当作"零残留"的保证。演练结束后必须**独立检查四类残留**：
容器、**匿名卷**、临时文件、端口。

### 9.1 匿名卷为什么会被漏掉（一个通用的坑）

1. `postgres:17` 的 Dockerfile 里有 `VOLUME /var/lib/postgresql/data`，这是镜像层面的声明；
2. `docker run` 不带 `-v` / `--mount` 时，Docker 会为这个路径**隐式创建匿名卷**（名字是 64 位随机串，不带项目前缀）；
3. 因此 `docker volume ls | grep pactfit` **永远查不到它** —— 这条检查是无效检查，会给出"无残留数据卷"的假结论；
4. 正确查法是 `docker volume ls --filter dangling=true`（或直接看全量卷清单里有没有不属于已知项目的卷）。

### 9.2 Step 11 实际执行的清理命令与退出码

```bash
# 阶段一：只读归属核验（不启动 PostgreSQL、不读业务表文件）
#   关键手法：用 --tmpfs 覆盖镜像自带的 VOLUME 路径，避免检查容器再造一个匿名卷
docker run --rm --name pactfit-vol-inspect --network none --entrypoint sh \
  --mount type=volume,source="<完整卷ID>",target=/inspect,readonly \
  --tmpfs /var/lib/postgresql/data:rw,size=1m \
  postgres:17 -c 'ls -la /inspect; cat /inspect/PG_VERSION; mount | grep -E " /inspect | /var/lib/postgresql/data "'
#   结果：PG_VERSION=17，标准 PG 数据目录（base/global/pg_wal/postgresql.conf 等）
#         /inspect 为 ro；/var/lib/postgresql/data 为 tmpfs；容器 --rm 自动删除；卷总数未增加
#   退出码 0

# 阶段二：定向删除（仅用完整卷 ID，不使用任何 prune）
docker volume rm <完整卷ID>          # 退出码 0
rm -f "$HOME/PactFit-drill/20_import.sql"   # 退出码 0
rm -f "$HOME/PactFit-drill/expected.json"   # 退出码 0
rmdir "$HOME/PactFit-drill"                 # 退出码 0

# 阶段三：独立复核（只读）
docker volume inspect <完整卷ID>   # 失败 = 已不存在
docker volume ls -q | wc -l        # 0
docker ps -aq | wc -l              # 0
lsof -nP -iTCP:55432 -sTCP:LISTEN  # 无输出
test -e "$HOME/PactFit-drill"      # 不存在
cd "$HOME/Downloads/PactFit-backups/PactFit-backup-2026-10-19" && shasum -a 256 -c SHA256SUMS  # 12/12 OK
```

删除前的前置核验（全部通过才执行）：卷 ID 完全匹配、无容器引用、路径字面量精确等于 `$HOME/PactFit-drill`、
`realpath` 一致、非符号链接、目录内**恰好 2 个**已知文件、子目录 0、符号链接 0、无挂载点。

### 9.3 最终残留情况

| 对象 | 结果 |
|---|---|
| 演练容器 | 0 个 |
| 数据卷（含匿名卷） | **0 个**（全机卷数为 0） |
| `~/PactFit-drill/` | 不存在 |
| 端口 55432 | 无监听 |
| 镜像 `postgres:17` | **保留未删**（不属清理范围） |
| 原始备份 | 原样保留，`SHA256SUMS` **12/12 OK** |
| 仓库 | 未受清理动作影响 |

> 注：备份目录内共 13 个文件 = `SHA256SUMS` 列出的 12 个受检文件 + `SHA256SUMS` 自身。

### 9.4 复跑本演练时的清理清单（改进版）

```bash
# 1. 停止并移除容器（若仍存在）
docker stop pactfit-drill-pg 2>/dev/null || true

# 2. 复查四类残留 —— 注意第 2 条，不要用 grep 项目名查匿名卷
docker ps -a --format '{{.Names}}' | grep -i pactfit || echo "无残留容器"
docker volume ls -q --filter dangling=true        # 匿名卷只能这样查
lsof -nP -iTCP:55432 -sTCP:LISTEN || echo "无监听"

# 3. 删除含 PII 的生成物（逐文件，不用通配符）
rm -f "$HOME/PactFit-drill/20_import.sql"
rm -f "$HOME/PactFit-drill/expected.json"
rmdir "$HOME/PactFit-drill"

# 4. 复查仓库未被污染
git status --short
```

清理后应满足：无 `pactfit` 容器、**全机无 dangling 匿名卷**、`~/PactFit-drill` 不存在、
端口无监听、`git status` 中没有 `.json/.csv/.sql` 数据产物。

---

## 10. 需要你确认的事项（问题 C）

| # | 待确认 | 我的建议 |
|---|---|---|
| C1 | 是否允许我**代你启动 Docker Desktop**？ | 建议由你手动启动（属"启动服务"，超出本次授权） |
| C2 | 是否同意使用 `postgres:17` 官方镜像（首次下载约 0.4–0.6 GB） | 同意则版本与生产 17.11 对齐 |
| C3 | 演练产物目录用 `~/PactFit-drill/`（仓库外）是否可接受 | 建议接受；备选 `~/Downloads/PactFit-drill/` |
| C4 | 是否同意把本次新增的 6 个 drill SQL + 2 个脚本入仓（**不含任何数据**） | 建议入仓，便于复跑与评审 |
| C5 | 验收口径是否认可：V5 以"恰好 1 处悬空"为通过；V6 拆成「V6a 列签名 + V6b 空值统计 + V6c 辅助指纹 + V6d 逐字段比对」，**以 V6d 为判据** | 建议认可，否则请指定替代口径 |
| C6 | 是否允许容器内执行 `SET ROLE authenticated` 做 RLS 测试 | 建议允许（只读 + 事务内回滚，且是唯一能测出权限真实行为的方式） |
| C7 | 是否允许把 `pactfit-actual.json`（含个人数据）从容器 `docker cp` 到 `~/PactFit-drill/`，供库外比对脚本读取 | 建议允许：文件权限 0600、只在仓库外、比对完即删；否则 V6d 无法执行，只能退回指纹口径 |

确认 C1–C7 后，我会按 §5 的顺序执行，并在每步之后贴出实际输出与判定。

---

## 11. Phase 1-c-fix 修正记录（对应你提的 7 条）

本轮**只改脚本与文档**，未启动 Docker、未下镜像、未建库、未导入、未连接生产、未提交 Git。

| # | 你的要求 | 改了什么 | 落到哪个文件 | 状态 |
|---|---|---|---|---|
| 1 | V6 增加完整字段保真校验 | V6 拆四段：V6a 列签名逐列核对（列名/类型/可空/identity/默认，顺序敏感）、V6b 空值单元格统计、V6c 辅助指纹、**V6d 逐字段比对**（另起比对器，库外做语义比较） | `40_verify.sql`、`50_dump.sql`、`scripts/drill-compare.py` | 【已自测】V6d 逻辑；V6a/b/c【待实测】 |
| 2 | V9 从注释改成可执行 RLS 测试 | 独立成文件：`\gset` 从数据算预期（不写死 2）、`set_config('pactfit.uid')` 模拟身份、`SET ROLE authenticated` 让 RLS 生效、跨空间写入捕获 `SQLSTATE` 期望 42501、同空间写入事务内回滚、额外验证未授权空间不可见、隔离不成立时拒绝判 PASS | `45_rls_test.sql` | 【已静态审查】 |
| 3 | 检查 `OVERRIDING SYSTEM VALUE … jsonb_populate_recordset` 合法性 | 逐条核对 PG 17 文档，确认子句位置合法；顺手改成显式列清单 + `t.<列名>`，不再依赖 `select t.*` 位置对应；三个语义坑写进护栏 | 见 §3.2、`scripts/drill-gen-import.py` | 【已静态审查】 |
| 4 | 导入生成脚本隐私保护 | `realpath` 判仓库包含关系（防软链绕过）、目录 0700 / 文件 0600、报错只出表名·列名·行号、禁止源目录在仓库内、`--out` 与 `--expect` 不得同路径 | `scripts/drill-gen-import.py` | 【已自测】三条闸门实测拒绝 |
| 5 | `30_postload.sql` 探针是否真回滚、是否影响序列、空表初始化 | 确认 `nextval` 非事务性 → 探针后**显式 `setval` 复原**，并复验 `seq_last_value / max_id / 行数 / 探针残留` 四项；空表走 `setval(seq,1,false)`；`setval` 首参显式 `::regclass`；核对改用文档化视图 `pg_sequences`（并修正上一版误用不存在的 `is_called` 列） | `30_postload.sql` | 【已静态审查】 |
| 6 | 文档区分三态 | 全文加【已静态审查】/【已自测】/【待实测】/【已实测通过】图例；§6 每项带状态列；明确「已实测通过 = 0 项」 | 本文件 | 已改 |
| 7 | 只报修改清单、diff、剩余风险、能否开跑 | 见交付说明 | — | 已交付 |
| 额外 | 修正一个会**假 PASS** 的隐患 | harness 原来只给 `public` 的 USAGE，没给 `auth`。`authenticated` 调 `auth.uid()` 会先撞 42501 "permission denied for schema auth"，与"RLS 拒绝写入"同码 → V9 会把权限不足当隔离生效。已补 `grant usage on schema auth`，自检从 3 列扩到 4 列，V9 额外打印错误消息并要求含 `row-level security` | `00_harness.sql`、`45_rls_test.sql` | 【已静态审查】 |

### 11.1 本轮**没有**做的事（避免误读）

- 没有运行任何 SQL：`00`/`10`/`30`/`40`/`45`/`50` 全部只做过语法与逻辑审查。
- 没有连数据库：既没连生产，也没连演练库（还没建）。
- 没有把指纹当成"值保真"结论 —— V6d 才是判据。
- 没有清洗历史数据：`records.id=6` 的悬空 `todo_done` 引用原样保留，验收口径仍是"恰好 1 处"。

---

## 12. Phase 1-c-fix-2 修正记录（对应本轮 6 条）

仍未启动 Docker、未连接生产、未导入、未提交。

| # | 你的要求 | 改法 | 状态 |
|---|---|---|---|
| 1 | 跨空间写入必须严格判 `42501` **且**消息含 `row-level security`，失败要非零退出 | 测试整体改写为 plpgsql：在 `BEGIN … EXCEPTION` 里 `GET STACKED DIAGNOSTICS` 取 `returned_sqlstate` 与 `message_text`，两个条件同时满足才记 PASS；否则记 `blocked_other:<state>` 并 FAIL。字符串比较交给 SQL，不再靠 `\if`（它只能判布尔） | 【已静态审查】 |
| 2 | 修 `(:'act_profiles'::int …)` 的变量引用语法 | 该写法已随重构整体移除：预期值、实际值、比对全部在 plpgsql 变量里完成，脚本里不再有 `(:'…'::int)` 这种拼接 | 【已静态审查】 |
| 3 | 同空间写入失败 / 结果不符 / 未授权空间可见，也要非零退出 | 新增结果表 `rls_result`（9 项），末尾 `if exists(verdict <> 'PASS') then raise exception` → `ON_ERROR_STOP` 下 psql 退出码非零。`INCONCLUSIVE`（只有一个空间）同样计入失败 | 【已静态审查】 |
| 4 | `50_dump.sql` 与本机副本都要 0600；比对成功后删临时文件 | 导出前 `install -m 600` 预建文件（消除"先 0644 再 chmod"窗口），导出后 `chmod` + `stat` 打印；宿主机 `docker cp` 后显式 `chmod 600`；比对器开头 `stat` 校验，**宽于 0600 直接退出码 1**；新增 `--purge-on-pass`，PASS 后删除导出文件，FAIL 则保留供排查 | 【已自测】权限拒绝与自动删除都实测过 |
| 5 | 数值精度口径：量化必须显式报告，不能当无损 | 单元格结论从两态扩为三态 `match / quantized / diff`：`numeric(5,1)` 小数位超限、`timestamptz` 超 6 位小数秒、源里带时分秒落进 `date` 列，都判 `quantized`；逐列打印 `量化 N`，总账单列合计并附说明；`--strict-precision` 可让量化直接 FAIL | 【已自测】`60.55→60.6` 与 9 位小数秒 → 2 处量化 / `PASS(量化 2)`；加严格开关后 FAIL |
| 6 | 只做静态检查，不跑 Docker / 不连生产 / 不导入 / 不提交 | 仅 `py_compile` + 合成数据自测 + 文本核对；未执行任何 `.sql`，未触碰任何数据库 | 已遵守 |

### 12.1 顺带修掉的两处内部不一致

- `45_rls_test.sql` 原先把结果写进注释里描述、实际只打印数字；现在有真正的结果表与终局断言，`FAIL` 不再"看起来像过"。
- `40_verify.sql` 的 V9 段落改为指向本文件，避免两份实现漂移。

---

## 13. Phase 1-c-fix-3 修正记录（最后一轮静态修正）

仍未启动 Docker、未连接生产、未导入、未提交。

| # | 要求 | 改法 | 状态 |
|---|---|---|---|
| 1 | 未授权空间选择要基于**全部**空间成员关系；找不到判 INCONCLUSIVE；并验证该用户**所有**空间 | 改为 `space_id NOT IN (select space_id from profiles where owner_id = 本用户)`；预期行数全部按"该用户全部空间"聚合（第 5–9 项），另加第 3 项按 `count(distinct space_id)` 交叉验证；选不出时第 10、11 项落 `INCONCLUSIVE`，整轮判不通过 | 【已静态审查】 |
| 2 | 不要依赖 PL/pgSQL 异常块里的 `SET LOCAL ROLE` / `RESET ROLE` | 角色切换整体移到 psql 层：`SET ROLE authenticated` 一次 → 跑完所有查询与探针 → `RESET ROLE`。脚本里已无 `BEGIN … EXCEPTION` 包写入，也无 `SET LOCAL ROLE`。同空间写入用 psql 级 `BEGIN` / `ROLLBACK`（先 `\set` 快照 `:ERROR`/`:SQLSTATE`，再回滚，最后写结果），跨空间写入用单条自动提交语句。第 1 项把 `current_user` 记下来比对，身份没切成功立刻 FAIL；第 14 项 + E 段 `delete` 保证无残留 | 【已静态审查】 |
| 3 | `drill-compare.py` 加重复主键检测；修正 `timestamptz` 超 6 位的量化判定 | 新增 `id 重复 源 N / 库 N` 一行，重复即 FAIL（避免字典覆盖漏检）；时间比较改为**精确十进制**：保留原始小数位，判断 `a == b` → match、`a.quantize(1e-6, HALF_UP) == b` → quantized、其余 → diff，不再用 `datetime`（它只有微秒且是截断，与 PG 的四舍五入冲突） | 【已自测】 |
| 4 | 保持隐私保护 | 仍只输出计数 / 布尔 / SQLSTATE；不打印 uid、空间口令、昵称、留言、错误原文；真实备份不进仓库（生成物一律在 `~/PactFit-drill/`） | 已遵守 |
| 5 | 同步更新本文档 | Step 9 重写（阶段表 + 14 项 + 未授权空间选取规则 + 退出码）、Step 10 补 `id 重复` 行与四舍五入说明、§6 的 V9 行、本表 | 已改 |

### 13.1 本轮遗留的两个"未实测"点 —— 已在 Step 9-B 消除

| 当时的疑虑 | Step 9-B 实测结果 |
|---|---|
| `SET ROLE` 之后对 `drill_meta.rls_actual` 的 INSERT 依赖显式 `grant`，逻辑成立但没在真库跑过 | **通过**。未出现 `permission denied for schema drill_meta`，`grant usage on schema drill_meta` 那一行有效 |
| `\set xs_state :SQLSTATE` 这种"把 psql 变量快照下来再回滚"的写法依赖 psql 变量语义，未实测 | **通过**。item 11 取到 `sqlstate = 42501` 且消息含 `row-level security = true`，不是空值、也没有误取成上一条语句的状态 |

> 另有一处本轮未预料到、但实测中暴露并已确认无害的口径问题：`pg_sequences.last_value`
> 对"从未取过号"的序列返回 **NULL**（而非 1）。它不影响判定（脚本用的是
> `select last_value, is_called from <seq>`），但足以让人误判成故障 —— 已写进 §5 Step 7 的注。

---

## 14. 实测执行记录（Step 0 – Step 11）

> 本节是"跑过之后"的记录，与前面各节的"设计期望"对照阅读。
> 所有数字来自容器内 `psql` 的原始输出与库外脚本的退出码，**不含任何行级数据**。

### 14.1 编号对照（先看这个，否则会错位）

执行时按"授权轮次"编号，它与本文 §5 的"操作步骤"编号**不完全一致**，逐一对应如下：

| 授权轮次 | 覆盖的 §5 步骤 | 内容 |
|---|---|---|
| Step 0 | Step 0 | Docker 守护进程就绪检查 |
| Step 1 | Step 1 | 拉 `postgres:17` + 版本/架构核对 |
| Step 2 | Step 2 | 起一次性容器并验证端口、库名 |
| Step 3 | Step 3 | `00_harness.sql` 认证环境桩 |
| Step 4 | Step 4 | `10_tables.sql` 建表 + 结构验证 |
| Step 5 | Step 5 | 修 CHECK 统计口径 + 生成导入文件 |
| **Step 6** | **Step 6 + Step 7** | **导入 32 行 + `30_postload.sql` 序列修正（两件合并执行）** |
| **Step 7** | **Step 8** | **`40_verify.sql` 库内验收 V1–V10** |
| **Step 8** | **Step 10** | **`50_dump.sql` + `drill-compare.py` 逐字段比对** |
| Step 9-A | Step 9（只改不跑） | 静态加固 `45_rls_test.sql`：14 → 17 → **18** 项 |
| Step 9-B | Step 9 | 实跑 RLS：**18/18 PASS** |
| **Step 10** | — | 文档固化（`docs/11`、`docs/12`、`README`），未执行任何 SQL |
| **Step 11** | **Step 9 → 9.2 / 9.4** | **环境清理：发现容器已消失 + 1 个遗留匿名卷 → 只读核验归属 → 定向删除 → 独立复核（四类残留全清，备份 12/12 OK）** |
| Step 12-A | — | 文档修正（匿名卷口径、空间成员表述、清理状态）+ Git 提交前只读审查 |

### 14.2 环境事实

| 项 | 实测值 |
|---|---|
| 宿主 | macOS 26.5（25F71），arm64 |
| Docker | 28.3.0（build 38b7060），Compose v2.38.1-desktop.1 |
| 镜像 | `postgres:17` → `linux/arm64`，`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`，digest `sha256:2d2b8998…` |
| 与生产对齐 | 生产 `17.11` / 演练 `17.11` —— **主版本与小版本均一致** |
| 容器 | `82ed4cf238d0`，`--rm`，未挂载**命名**卷，`127.0.0.1:55432->5432/tcp` |
| 数据卷 | **未挂载命名卷**；但 `postgres:17` 的 `VOLUME` 声明使 Docker 自动创建了 **1 个匿名卷**（48.67 MB，演练库数据），Step 11 已按完整卷 ID 定向删除，详见 §9.1 |
| 库 | `pactfit_drill`（owner `postgres`） |
| 网络暴露面 | 仅回环 `127.0.0.1`，不对外；未设 `PGHOST` / `PGPASSWORD` |

### 14.3 逐轮结果

| 轮次 | 退出码 | 关键实测输出 | 结论 |
|---|---|---|---|
| Step 0 | 0 | `28.3.0` | PASS |
| Step 1 | 0 | `linux/arm64` / `17.11` | PASS |
| Step 2 | 0 | `Up` / `127.0.0.1:55432->5432` | PASS |
| Step 3 | 0 | 自检 `1 / 1 / 3 / t` | PASS |
| Step 4 | 0 | `6 / 6 / 2 / 2 / 37`（第 5 列为视图口径，见 14.4-①）；结构细项 53 列 / 索引 8 / 序列 6 | PASS |
| Step 5 | 0 | `20_import.sql` 8,155 B、`expected.json` 3,160 B，均 0600；`total_rows = 32` | PASS |
| Step 6 | 0 | `INSERT 0 4 / 0 1 / 0 9 / 0 18` → `COMMIT`；`probe_todo_id = 15`；`todos_seq_restored = 14`；末行 `14 \| 14 \| 9 \| 0` | PASS |
| Step 7 | 0 | V1–V10 全项符合；V5 恰好 1 行；V8 `3`（2/1/1）；V10 `6/6/2/2/0/8` | PASS |
| Step 8 | 0 | `6 表 / 32 行 / 240 次取值 / 0 差异 / 0 量化`；`--strict-precision` 同判 PASS | PASS |
| Step 9-A | — | 静态检查 18 项结构、判定规则、回滚路径、序列基线 | PASS |
| Step 9-B | 0 | **18/18 PASS**；item 11 `42501 + row-level security`；item 14 影响 0 行；item 16–18 全部 `unchanged` | PASS |

事后独立复核（不在测试脚本内，另起连接查）：六表 `4 / 1 / 9 / 18 / 0 / 0`、`probe_rows = 0`、
`fp_match = true`、`messages` 序列 `1 / false`、public 仍 6 表 / 6 策略 / 2 函数。

### 14.4 实测中暴露的 4 个问题（都已处置，不隐藏）

| # | 现象 | 真实原因 | 处置 |
|---|---|---|---|
| ① | Step 4 第 5 列得 **37** 而非 0 | `information_schema.check_constraints` 在 PG 17 把**每个 NOT NULL 列**也报成一条 `2200_<oid>_<attnum>_not_null`；6 表共 37 个 NOT NULL 列，数字刚好相等 | 判定口径改为 `pg_constraint.contype='c'`；`10_tables.sql` 与 `40_verify.sql` 同步修改，只读复算得 0。**未重跑建表** |
| ② | rewards / messages 的序列在 `pg_sequences` 里 `last_value` 为 **NULL**，看起来像"序列没初始化" | 该视图对 `is_called = false` 的序列返回 NULL；权威读法是直接 `select last_value, is_called from <seq>` | 确认实为 `1 / f`（"从未取过号"），符合预期；已写进 §5 Step 7 的注 |
| ③ | 静态检查脚本自身两处正则写错，误报"变量未定义" | `\set ON_ERROR_STOP on` 被当成 `off` 配对；`returning id \gset ss_` 未带 `as` 别名识别不到 | 修正正则后重跑，问题消失（**错的是检查器，不是被检查的脚本**） |
| ④ | 判定逻辑模拟脚本抛 `TypeError` | `verdict()` 形参与位置传参冲突 | 改为显式按位置取 `it[3]` / `it[4]`，模拟结果与 SQL 判定一致 |

### 14.5 红线遵守情况

| 红线 | 结果 |
|---|---|
| 不连接生产库 | ✅ 全程只连 `127.0.0.1:55432`；生产库（实例标识已脱敏）零连接 |
| 不修改线上站点/配置 | ✅ 未发布、未改 `PUBLIC_CONFIG`、未动前端 |
| PII 不落仓库 | ✅ 导入 SQL、`expected.json` 只在演练工作目录；导出文件比对后自动删除 |
| 不写水印/不改原文件 | ✅ 生产快照原件零改动（现归档于仓库外私有目录） |
| 不 commit / 不 push | ✅ 本文档与 drill 脚本仍是未跟踪/未提交状态 |

---

## 附：演练相关文件（全部不含数据）

| 文件 | 作用 | 含数据 | 状态 |
|---|---|---|---|
| `backend/schema/drill/00_harness.sql` | auth schema + `auth.uid()` 桩 + 三角色 | 否 | 【已实测通过】Step 3 |
| `backend/schema/drill/10_tables.sql` | 派生建表（表/函数/RLS/授权，4 处必要改写） | 否 | 【已实测通过】Step 4（CHECK 口径经 Step 5 修正） |
| `backend/schema/drill/30_postload.sql` | identity 序列修正 + 撞号探针 + 序列复原 | 否 | 【已实测通过】Step 6 |
| `backend/schema/drill/40_verify.sql` | V1–V5、V6a–V6c、V7、V8、V10 | 否 | 【已实测通过】Step 7 |
| `backend/schema/drill/45_rls_test.sql` | V9：**18 项** RLS 断言（psql 层切身份，失败退出码非零） | 否 | 【已实测通过】Step 9-B（18/18） |
| `backend/schema/drill/50_dump.sql` | 导出 `to_jsonb` 全量 JSON（容器内 0600）供库外比对 | 否（运行产物含） | 【已实测通过】Step 8 |
| `scripts/drill-gen-import.py` | JSON → 导入 SQL 生成器（键校验 + 隐私闸门） | 否（运行时读私有备份） | 【已自测】+ 【已实测通过】Step 5 |
| `scripts/drill-compare.py` | 逐表/逐行/逐字段保真比对（三态判定 + 权限校验 + PASS 后自动清理） | 否（运行时读导出文件） | 【已自测】+ 【已实测通过】Step 8 |

`20_import.sql`、`expected.json`、`pactfit-actual.json` **一律不在仓库内生成**；
其中 `pactfit-actual.json` 在 V6d 判 PASS 时由 `--purge-on-pass` 自动删除，FAIL 时保留供排查、处置完手动删。
