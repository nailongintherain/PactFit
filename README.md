# 关于PactFit减脂搭子

减脂搭子的雏形由我们的**麦辣鸡腿堡**用了一个下午操刀搭建的，本**奶鼠**作为后续的协作者参与这个项目。  

最初的构想来源于**奶鼠**戒掉奶酪之后成功掉秤，达到了目标进度的30%。跟**麦辣鸡腿堡**炫耀之后，某人表示自己也得加把劲，于是便有了减脂搭子的初始001用户与002用户。 

**奶鼠**请求奶蛙之神，将最美好的祝愿赐福给我们的**PactFit减脂搭子**。  
![奶蛙之神](Images/Other/奶蛙之神.jpg)

---

> **📄 整合说明（2026-10-27，协作者补充）**
>
> - 上一节为**原作者项目介绍，原文保留、未做任何改写**；如以下技术部分与该介绍存在事实出入，以原作者介绍为准。
> - 以下为协作者整理的技术文档（结构基线、接口契约、迁移清单、恢复演练等），全部内容已经过公开前脱敏复核；技术细节以 `docs/` 目录为准。
> - ⚠️ **前端路径说明**：`Code/index.html` 与 `web/index.html` 内容相同（同一 Git blob `a1247826`）。
>   **H-2B-1 已判定 `web/index.html` 为实际部署入口**：PWA 完整单元（`manifest.json`、`sw.js`、`icons/`）均在 `web/`，
>   且页面内以相对路径注册 `sw.js`；`Code/` 仅 1 文件 + `.gitkeep`，为初版归档。
>   本地后端接入只改 `web/index.html`；`Code/index.html` 保持归档原样（若后续统一入口请先删/移动 `Code/`，避免双入口漂移）。
> - ⚠️ **状态边界**：本地恢复演练（Phase 1-c）已完成并验收；Supabase 目标环境**尚未创建**；认证身份迁移**尚未开始**。详见下方"迁移进度"与 `docs/12`。

# 减脂搭子 · 代码与后端契约仓库

> 状态：**后端仍在 WorkBuddy 托管云服务上运行，本仓库尚未接管任何运行时。**
> 本仓库当前只做一件事：把散落在代码里的后端事实（表结构、接口契约、权限规则、认证流程、配置）
> 固化成可版本管理的文件，为将来的真正迁出做准备。

## 现在的事实（不要记错）

| 项目 | 现状 |
|---|---|
| 线上地址 | https://fit-together-44172.app.workbuddy.host |
| 前端 | 单文件 `web/index.html`（106,424 字节，CSS/JS 全内联，无构建、无框架、无 npm 依赖） |
| 后端 | WorkBuddy 托管云服务（PostgreSQL + 验证码登录），**没有源码，只有行为** |
| 数据库表 | 6 张（`profiles` / `records` / `todos` / `tags` / `rewards` / `messages`），结构基线已归档 |
| 数据 | 已导出业务备份（6 表合计 32 条：profiles 4 / records 1 / tags 18 / todos 9 / rewards 0 / messages 0），**并已在本地 Docker + PostgreSQL 17.11 隔离环境完成恢复演练**：32 条全量还原、240 次字段取值比对 0 差异 0 量化、RLS 18/18 PASS（⚠️ 以上验收数字出自**私有原始演练**；本仓库公开的脱敏示例**不能复现**，见下文分层说明） |
| 本仓库能跑起来吗 | **不能。** 少了云服务实例，`index.html` 只是离线壳 |

## 目录

```
fit-together/
├── web/index.html                    前端唯一产物（H-2B-1 起含 cloud/local 双模式接线）
├── docs/
│   ├── 01-architecture.md            依赖清单：服务、地址、数据库类型、认证方式
│   ├── 02-backend-contract.md        37 个调用点的完整接口契约
│   ├── 03-data-model.md              6 张表的真实结构与约束（以生产基线为准）
│   ├── 04-auth.md                    验证码登录的完整时序与隐藏约定
│   ├── 05-permissions.md             权限模型（RLS 真实推导）
│   ├── 06-config-and-env.md          配置项、环境变量、三条红线
│   ├── 07-risks.md                   风险登记表（按影响排序）
│   ├── 08-migration-checklist.md     分阶段迁移清单，标注每阶段是否影响线上
│   ├── 09-access-investigation.md    生产库访问权限调查（谁有权限、缺什么、要谁去做）
│   ├── 10-schema-gap-analysis.md     真实结构 vs 推断稿的逐项差异与迁移影响
│   ├── 11-restore-drill-plan.md      恢复演练方案 + Step 0–9-B 实测记录
│   └── 12-local-restore-acceptance.md ★ 本地恢复演练正式验收报告
├── backend/
│   ├── schema/
│   │   ├── schema-reference.sql       ★ 生产结构脱敏参考（结构真实；策略/函数体/授权矩阵不公开）
│   │   ├── 001_tables.inferred.sql    ⚠️ 历史推断稿（禁止执行，仅供参考）
│   │   ├── 999_verify-live-schema.sql 只读核对查询（已被真实基线取代，留作复现）
│   │   └── drill/                     演练示例脚本（脱敏版；不含数据，不能复现历史验收结果）
│   │
│   │   ⚠️ 生产快照原件与 002/003 推断稿仅存仓库外私有归档（0700/0600），不在本仓库。
│   ├── contract/endpoints.yaml        机器可读的接口契约
│   └── config/env.example             将来迁移需要的配置项清单
└── scripts/
    ├── export-data.console.js         浏览器控制台只读导出脚本（备份用）
    ├── drill-gen-import.py            备份 JSON → 导入 SQL（含隐私闸门，产物只出仓库外）
    └── drill-compare.py               恢复结果与备份的逐字段保真比对
```

## 公开 / 私有分层说明（协作者必读）

本仓库刻意只保留"设计"，不保留"诊断结论"。四类材料请勿混淆：

| 层 | 内容 | 位置 | 协作者注意 |
|---|---|---|---|
| 生产原件（私有） | 生产快照原件、002/003 推断稿、演练脚本原始版、docs/10–12 完整版、S1–S7 缺陷分析 | 仓库外私有归档（0700/0600，路径仅团队内部可知） | **不得**提交、粘贴或复制进任何公开渠道 |
| 公开参考（本仓库） | `backend/schema/schema-reference.sql`：结构真实，但 RLS 表达式、SECURITY DEFINER 函数体、授权矩阵一律不公开 | 本仓库 | 结构迁移可据此讨论；**不要**据此复现历史验收结果 |
| 私有演练（私有） | 演练库实际执行的 6 个 SQL 原始版 | 私有归档 `drill-as-run/` | 历史记录，勿当公开示例转发 |
| 公开示例（本仓库） | `backend/schema/drill/` 脱敏版：策略与函数为示意形式 | 本仓库 | **公开示例不能复现历史 RLS 18/18 验收结果** |

## 三条红线（来自协作说明，迁移期间继续生效）

1. `PUBLIC_CONFIG.publishableKey` **必须保持分片数组写法**，不要合并成字符串字面量。
   发布环境会把它自己记录的密钥回填到这一行，回填后指向另一个应用，线上登录会直接挂。
2. 不要改 `/.cloud/` 相关的请求行为（它封装在 SDK 内部，见 `docs/02`）。
3. 不要绕开 `space_id` 读写数据——它是多组隔离的唯一保障。

## 迁移进度

### 已完成

| 阶段 | 内容 | 产物 |
|---|---|---|
| Phase 0 | 代码入仓、接口契约固化、依赖与风险登记 | `web/`、`docs/01~08`、`backend/contract/` |
| Phase 1-a | 生产业务数据备份（6 表合计 32 条） | 仓库外（本机与私有存储），**不入库** |
| Phase 1-a | 生产库访问权限调查 | `docs/09` |
| Phase 1-b | 结构基线归档 + 逐项差异核对 | 公开参考 `backend/schema/schema-reference.sql`（原件在私有归档）、`docs/10` |
| Phase 1-b | 数据模型文档切换到真实结构 | `docs/03` 已按真实基线重写 |
| **Phase 1-c** | **隔离环境恢复演练（Docker + PostgreSQL 17.11，Step 0–9-B 全 PASS）** | `backend/schema/drill/`、`scripts/drill-*.py`、`docs/11`、**`docs/12`** |
| **Phase 1-c 收尾** | **演练环境清理（Step 11 PASS）：容器 0 / 卷 0（含匿名卷）/ 临时目录已删 / 原始备份保留** | `docs/11` §9、`docs/12` §3.1 |

### 恢复演练结论（一句话）

**备份是可用的，不是"可能可用"。** 在 `127.0.0.1:55432` 的一次性容器里，从零建库到数据验收全部跑通：

| 指标 | 结果 |
|---|---|
| 业务表 | 6 张（`profiles` / `records` / `todos` / `tags` / `rewards` / `messages`） |
| 记录数 | **32 条**全量恢复（4 / 1 / 9 / 18 / 0 / 0） |
| 主键保真 | 原始主键原值保留（`max(id)` 22 / 6 / 14 / 24），identity 序列已修正 |
| 逐字段比对 | **240 次取值 / 0 处差异 / 0 处量化**；`--strict-precision` 同判 PASS |
| RLS 隔离 | **18 / 18 PASS**，退出码 0，测试前后六表行数、业务指纹、序列状态均未变 |
| 已知历史异常 | 1 处悬空 `todo` 引用，**保持原状**（属"数据本来就有洞"，非恢复失败） |
| 环境清理 | **已完成（Step 11 PASS）**：容器 0、卷 0（**含匿名卷**）、临时目录不存在、端口 55432 无监听 |
| 备份留存 | **原始备份仍保留**，`SHA256SUMS` **12/12 OK** |

> ⚠️ 上表全部验收数字（32/32、240 次取值、18/18）出自**私有原始演练版本**（原始脚本仅存私有归档）。
> 本仓库 `backend/schema/drill/` 为**公开脱敏示例**，不能复现这些结果。

> ⚠️ **一条踩过的坑，写在这里防止再犯**：`postgres:17` 镜像声明了 `VOLUME /var/lib/postgresql/data`，
> 所以"没写 `-v`"**不等于**"没有数据卷" —— Docker 会自动创建匿名卷。`--rm` 在正常移除容器时通常会
> 一并清理，但守护进程重启等异常路径下**不保证**。本次演练结束后容器自行消失，却残留了一个
> 48.67 MB 的匿名卷（内含演练库全部数据），且 `docker volume ls | grep pactfit` **查不到它**
> （匿名卷名字是随机串）。正确查法是 `docker volume ls --filter dangling=true`。
> 详见 `docs/12` §3.1。

### 尚未完成（不要误认为已就绪）

| 项 | 状态 | 说明 |
|---|---|---|
| ~~恢复演练~~ | ✅ **已完成** | 见上表与 `docs/12`，Step 0–9-B 全 PASS |
| **Supabase 开发环境创建** | ❌ 未做 | 尚未新建目标项目与数据库实例 |
| **目标数据库结构设计** | ❌ 未做 | 需按目标平台重写 DDL（`auth.uid()` 返回类型、扩展、schema 授权） |
| **新旧认证用户身份映射** | ❌ 未做 | `auth_users` 的 5 行**从未迁移**、也不属于已迁移内容；`owner_id → 新用户 id` 映射表尚未建立 |
| **新 RLS 策略设计** | ❌ 未做 | 现有策略存在多项设计缺陷（编号 S1–S7，详情仅存私有归档），**不可原样照搬** |
| **业务数据迁移与验证** | ❌ 未做 | 本次只在本地容器验证"能还原"，尚未向任何目标环境迁移 |
| **前端 SDK 替换** | 🟡 **最小功能已接入（H-2B-1）** | `web/index.html` 新增 cloud/local 双模式：默认 cloud 行为不变；回环来源显式开启 local 后，邮箱链接登录 / 建加空间 / profiles / records / 登出 走本地 GoTrue+PostgREST。**仅 Mock + 静态验证，真实浏览器验收待 H-2B-2；生产仍为 cloud** |
| **联调、回归测试与切换方案** | ❌ 未做 | 含双写/灰度/回滚，见 `docs/08` Phase 3 / 4 |
| 结构待确认项 | ⚠️ 部分 | `space_peek` 函数级授权、平台 auth 表结构等，见 `docs/10` §6 |

> 一句话现状：**"能不能还原"已经有答案了 —— 能，且逐字段对得上。"能不能登录、能不能切过去"仍然没有答案。**
>
> 当前确定的六件事：① Phase 1-c **已完成**；② Step 11 环境清理 **PASS**；
> ③ 本地演练环境**已清空**（容器 0 / 卷 0 / 临时目录不存在 / 端口无监听）；
> ④ **原始备份仍保留**（`SHA256SUMS` 12/12 OK，且是唯一数据副本，不要动）；
> ⑤ **Supabase 目标环境尚未创建**；⑥ **认证身份尚未迁移**（`auth_users` 从未导入任何库）。
>
> 恢复演练通过只证明数据可用，不证明认证可迁移，也不证明旧权限策略可照搬。

---

## 独立运行（Compose 一键启动，脱离原托管平台）

本仓库自 2026-11-15 起包含完整的独立运行环境（`compose.yaml` + `db/` + `scripts/`），
不再依赖原平台即可本地开发与验收：

```bash
./scripts/dev-up.sh      # 首次运行自动生成 .env（随机密钥）→ 起库 → GoTrue 迁移 → 业务 schema → 全服务
./scripts/dev-check.sh   # 健康检查（PostgreSQL / GoTrue / PostgREST / Mailpit / 前端 / 业务 schema）
./scripts/dev-down.sh    # 停止（数据卷保留）
```

- 前端：`http://127.0.0.1:8899/?local=1`（必须带 `?local=1`）
- 收件箱：`http://127.0.0.1:8025`（Mailpit；登录链接邮件在这里取）
- 数据库初始化：`db/init/01-roles.sql`（角色，entrypoint 自动执行）+ `db/migrations/02-business.sql`
  （业务十表 + RLS + RPC + GRANT，dev-up 在 GoTrue auth 迁移后自动应用）
- 协作与改动约定见 `AGENTS.md`；环境变量说明见 `.env.example`（真实 `.env` 不入 Git）
- 服务全部仅绑定 127.0.0.1；登录邮件只进本地 Mailpit，不外发

## 本地后端接入（H-2 系列）

> 目标：在**不改变线上行为**的前提下，为 PactFit 前端接入一套可本地验证的 GoTrue + PostgREST 后端（克隆库），
> 把「能不能登录、能不能读写」从纸面推进到可复测。生产迁移仍然 **BLOCKED**。

### 已验证事实（截至 H-2A-RETEST）

| 项 | 状态 | 证据 |
|---|---|---|
| 适配层 Mock | ✅ 41/41 PASS | `node backend/client/pactfit-local-api.test.js` |
| 会话竞态（刷新在途 + 登出 → 迟到 200 重建会话） | ✅ **真实 GoTrue + Chromium 已闭环** | `design/notes` 在私有仓库；场景 C/D/E/F1/F2/G 全过，迟到结果统一 `refresh_stale_after_logout` 丢弃 |
| 并发刷新去重 | ✅ 真实栈验证 | 同会话并发仅 1 次 `/token` |
| 登出三态 | ✅ 真实栈验证 | `localCleared` / `serverRevoked` 分别上报 |

**⚠️ 边界（不要误读）**：前端本地失效与 GoTrue 服务端 session/refresh_token 撤销均已实测；
但**已签发的 JWT 在 `exp` 前仍会被 PostgREST 验签接受**（PostgREST 不查会话表）。
因此**本方案不宣称“JWT 即时撤销”**——撤销只保证新会话建立/数据请求需重新登录，不保证旧 JWT 立刻失效。

### 页面如何开启 local 模式（仅开发机）

1. 启动本地后端：GoTrue `127.0.0.1:9999`、PostgREST `127.0.0.1:3000`（配置在 `backend/` 与私有笔记中，不在前端）。
2. 把 `web/` 作为静态根启动（例：`cd web && python3 -m http.server 8899 --bind 127.0.0.1`）。
3. 打开 `http://127.0.0.1:8899/index.html?local=1`（或先执行 `localStorage.setItem('pactfit_local_dev','1')` 再刷新）。

判定规则（页面头部脚本，启动时一次确定）：

- 仅 `127.0.0.1` / `localhost` / `::1` 且显式开启 → `local`；
- **公网/任意其他来源恒为 `cloud`**，`?local=1` 与 `localStorage` 都无法越权；hash 不参与判定；
- `local` 模式**不加载 Cloud SDK**（零云端请求），出错不回退 cloud，不做双写；
- 页面状态栏显示 `LOCAL hh:mm`、登录页有黄色横幅，避免把本地环境误认成线上。

### 已接入的最小功能（local 模式）

| 功能 | 本地路径 | 说明 |
|---|---|---|
| 邮箱登录 | `POST /otp` → 邮件链接 → 粘贴**完整链接** → 按链接里的 `type` 走 `POST /verify`（`signup` / `magiclink`） | 发的是**链接**不是六位码。首次注册的邮件是 `type=signup` 确认链接，已有用户是 `type=magiclink` 登录链接，由 `web/pactfit-be.js` 的 `parseEmailLink()` 从链接解析，页面无法指定类型；只接受完整链接（裸 token 无法判定类型，会被本地拒绝） |
| 手机号登录 | — | 明确提示「本地模式暂不支持」（GoTrue 无 SMS provider），不伪装成功 |
| 创建空间 | `rpc_create_space` | 口令由服务端生成，页面以返回信封 `code` 为准 |
| 加入空间 | `rpc_join_space` | 业务信封 `{ok:false,code}` 原样映射为中文提示 |
| profiles | 已授权 `SELECT` | **禁止**客户端直插 profiles（适配层会拒绝） |
| records | 已授权 `SELECT` / `INSERT` / `UPDATE` | 必填 `space_id`/`record_date`/`weight`；`owner_id` 由适配层按当前 `sub` 注入；`meta.updated=0` 不当成功 |
| 登出 | `POST /logout` + 本地代数失效 | 页面立即清空用户态；区分本地清理与服务端撤销 |

未接入（local 下明确提示，**不触发任何云端请求**）：手机号、小目标、标签、奖励、留言、口令探测、设置里改资料。
实现方式：`web/pactfit-be.js` 的 `createBlockedCloud()` 拒绝桩 + `UNSUPPORTED_FEATURES` 清单；
页面侧再用 `localUnsupported()` 在**调用之前**判定，给出「XX在本地开发模式下暂不支持」，
而不是让拒绝桩抛出后被统一 catch 说成「添加失败」（见下文 H-3-M3）。

#### 登录链接的类型判定（H-3-M5）

GoTrue v2.197.0 的邮件链接形如 `{SiteURL}/verify?token=<56hex>&type=<signup|magiclink>&redirect_to=…`：

| 场景 | 邮件类型 | 桥层提交 |
|---|---|---|
| 首次注册（GoTrue 新建用户） | `type=signup`（主题 Confirm your email address） | `verifyEmailOtp({ type:'signup', token_hash })` |
| 已有用户登录 | `type=magiclink`（主题 Your sign-in link） | `verifyEmailOtp({ type:'magiclink', token_hash })` |

安全规则（`parseEmailLink()`，均为**本地拒绝、零请求**）：
- 类型只从链接的 `type` 参数取，页面只传原始文本，无法指定类型；仅接受 `signup` / `magiclink`。
- 缺 `token`、缺 `type`、非法百分号编码、重复冲突参数、token 形态不符（非 56 位十六进制）、非 http(s) 链接 → `bad_request`。
- 未知类型 → `unsupported_verification_type`。
- **裸 token 会被拒绝**：无法判定注册确认还是登录链接，提示粘贴完整链接。
- 绝不「先试 magiclink 失败再试 signup」：实测类型不匹配与真过期在服务端返回同一个 `otp_expired`，重试只会掩盖真实错误并浪费一次性 token；服务端错误码原样透出。

#### 页面异步写回与会话边界（H-3-M1M2）

`web/index.html` 里每个异步流程都遵守同一条规则：**先记会话代数，每个 `await` 回来先校验，再写状态**。
守卫只能拦住「旧响应写回页面」，撤不回已经发出的请求——两者必须分开表述。

| 机制 | 规则 |
|---|---|
| 会话代数 `guard` | 登出 / 新登录都 `bump()`；旧代响应一律丢弃（不写 `S`、不渲染、不弹提示） |
| 加载序号 `loadSeq` | 同一次登录内并发 `loadAll`，只有最后发起的那次允许落地（多空间切换用） |
| 身份校验 | 落地前再比一次发起时的 `uid`，旧用户请求即便回到同一空间也不得写新用户字段 |
| `loadAll` 返回值 | `true` 已加载 / `false` 还没有空间 / `null` 结果作废（调用方必须区分后两者） |
| 写回方式 | 先算局部结果，最后一次提交；不再「边 await 边往 `S` 里写」 |
| 登出顺序 | 先作废旧代 → 清 `S`/`uid` → 同步退回登录页 → 再去等 HTTP 撤销结果 |

写入结果分四态（`web/pactfit-be.js` 的 `WRITE_OUTCOME`，纯函数、可独立 Mock）：

| 结果 | 判据 | 页面提示 |
|---|---|---|
| `confirmed` | INSERT 返回行 / PATCH `meta.updated>0` | 已保存 |
| `not_applied` | PATCH `meta.updated=0`（含 204 零行） | 这条记录没更新到（可能已被删除），已刷新 |
| `rejected` | 带 `code` 的业务错误 / 前置校验拒绝 | 保存失败：<原因> |
| `unknown` | 网络中断、超时、中断（无 `code` 的 fetch 失败） | 写入结果尚未确认，请重新查看记录（不要重复提交） |

- **写入与刷新分开记账**：写入已确认、后续 `loadAll` 失败 → 「已保存；数据刷新暂未完成」，绝不改口说保存失败。
- **`mirrorToday` 逐项记账**：其他空间分别计 `confirmed` / `notApplied` / `rejected` / `unknown`，
  部分成功时提示「其他 N 个空间：x 个已同步、y 个未写入、z 个未确认」，不报全成功也不报全失败。
- **不自动重试 INSERT**（会产生重复数据）；结果未知时让用户自己核对。

#### 未适配功能的提示统一（H-3-M3）

`local` 模式下 `cloud` 是拒绝桩，`database.from()` 会**同步抛** `unsupported_in_local_mode`。
小目标 / 标签的四个入口原本把任何异常都吞成「添加失败 / 删除失败」，用户看到的是
「我填错了」而不是「这个功能没接」；`addCustomTag` 更是没有 `catch`，本地点一下直接中断渲染。

现在统一为三层判定，**顺序不能颠倒**：

| 顺序 | 判据 | 提示 |
|---|---|---|
| 1 | 先判模式（`localUnsupported()`），**早于 `prompt()` 和任何写入** | 「小目标在本地开发模式下暂不支持」 |
| 2 | 已接入功能的输入校验（保持原顺序，如体重 20–400） | 「请填一个合理的体重」 |
| 3 | 真发请求后的失败按 `classifyWriteError()` 分类 | 业务拒绝 → 原兜底文案；无 `code` 的网络失败 → 「网络不通，操作结果尚未确认」 |

约束：判定阶段**不写 `S`、不发请求、不回退 cloud、不塞假数据**；`cloud` 模式（`BACKEND!=='local'`）
完全走原逻辑，调用顺序与字段逐字不变（Mock SDK 断言）。

#### Service Worker 回退策略（H-3-M4）

旧版 `sw.js` 对**所有**同源 GET 失败一律回退 `index.html`：离线时 JS/CSS/JSON 请求会拿到
一份 200 的 HTML 冒充目标资源，浏览器按 JS/CSS 解析直接语法报错；且 install 失败也会
`skipWaiting` 上岗并在 activate 时清掉旧缓存（带病上岗 + 自毁退路）。

现行策略（`fit-together-v3`）：

| 请求 | 策略 |
|---|---|
| 非 GET（POST/PATCH/DELETE） | 不拦截，不做任何离线伪造 |
| 跨源（Cloud SDK CDN / GoTrue / PostgREST） | 放行：不缓存、不兜底、不读缓存 |
| 同源 `/.cloud/` 数据接口 | 放行：不缓存、不兜底 |
| 同源 + `Authorization` 头或敏感查询（`token/code/access_token/refresh_token/otp`） | 放行但不写缓存（凭据不落盘） |
| 同源导航（`request.mode === 'navigate'`） | 网络优先；离线先找本请求缓存，再回退 `index.html` 外壳；连外壳都没有 → 503 明确失败 |
| 其余同源 GET（JS/CSS/图片/字体/manifest/JSON） | 网络优先 + 运行时缓存（仅 200 basic）；离线有缓存返回原资源，**无缓存 503，绝不用 HTML 冒充** |

生命周期：

- **install**：`addAll` 预缓存全部成功才 `skipWaiting`；任一资源失败 → install 整体失败 →
  旧 SW 继续服务（不再「失败也上岗」）。
- **activate**：只回收 `fit-together-` 前缀的旧版本缓存，其他应用/无关缓存一律不动。
- **预缓存清单（v3）**：外壳 + manifest + 两个图标 + **`pactfit-be.js`（两模式共用）与
  `pactfit-local-api.js`** —— 后两者旧版未预缓存，离线时会拿到 HTML 冒充 JS。
- **版本**：`v2 → v3`（回退语义、预缓存清单、install 失败语义、activate 回收范围都变了）。
  回滚到 v2 代码的风险：v3 的 activate 已回收 v2 缓存，回滚版会重建 5 项旧清单
  （重新引入 HTML 冒充问题），功能可用但离线体验退化。
- **local 模式不注册 SW、并清理旧注册**的策略保持不变；cloud 模式仍走原 CDN 加载契约。

### 新增文件与测试

| 文件 | 作用 |
|---|---|
| `web/pactfit-be.js` | 接线层（模式判定 / local 桥 / 会话代数守卫 / 清理 / 写入结果分类 / 拒绝桩），纯逻辑无 DOM |
| `web/pactfit-local-api.js` | `backend/client/pactfit-local-api.js` 的部署副本（测试断言两文件字节一致，防漂移） |
| `backend/tests/pactfit-be.test.js` | 67 项页面 Mock（B1–B16 + M5×10 + M1×5 + M2×8 + M3×10 + PAIR×10 + RACE×8，含适配层 41 项回归） |
| `backend/tests/pactfit-sw.test.js` | 16 项 Service Worker Mock（运行真实 `web/sw.js` + 隔离 CacheStorage） |

```bash
node backend/client/pactfit-local-api.test.js   # 41/41
node backend/tests/pactfit-be.test.js           # 67/67（含上者）
node backend/tests/pactfit-sw.test.js           # 16/16
```

> M1/M2 的 13 项跑的是**页面自己的函数**：测试把 `web/index.html` 的内联主脚本放进 `vm` 上下文，
> 用可控 Promise 手动制造交错，驱动真实的 `loadAllLocal` / `saveRecord` / `mirrorToday` /
> `doLogout` / `afterLogin`，不是另写一套仿制状态机。DOM、`localStorage`、定时器全为桩，零网络、零容器。
>
> M3 的 10 项同样驱动真实入口：`openSettings()` 绑定出的 `btn-add-todo` / `btn-add-tag`、
> 真实 `renderRecord()` 绑定出的 `rec-tag-add`，以及 `toggleTodo` / `delTodo` / `delTag` 本身；
> local 侧给拒绝桩装探针（`database.from` 计数必须为 0），cloud 侧用 Mock SDK 逐字比对插入/删除载荷。
>
> PAIR 的 10 项（H-3-PAIR）驱动真实 `afterLogin` → 无空间 → `show('view-pair')` 流程，
> 断言 `btn-pair-logout` 复用既有 `doLogout()`：同步段即清理个人状态与草稿并切回登录页、
> signOut 在途不等网络、撤销失败不谎称成功、迟到 afterLogin/loadAll/doPair 响应无法恢复页面、
> 防重入（同会话代数内连续点击只发一次登出）、cloud 分支走 Mock SDK `auth.signOut` 原契约、
> pair 表单/登录页/app 设置退出入口均不退化。
>
> RACE 的 8 项（H-3-PAIR-RACE）锁定 doLogout **锁所有权语义**：登出锁归「最新一次实际
> 开始的登出」（`doLogoutEpoch`），旧流程的 `finally` 仅在自己仍是持有者时才解锁——
> 跨会话重叠登出（A 登出在途 → B 登录 → B 登出在途 → A 先收尾）绝不清除 B 持有的锁，
> A=1、B=1、signOut 总数恰 2 次，永不出现第 3 次；覆盖正常/网络错误/cloud/异常收尾、
> 旧流程零 toast（会话代数守卫）、同会话连点不退化（RACE-5）与三会话链式场景。
> 变异验证已确认：临时恢复旧的「finally 无条件解锁」会使 RACE-1/2/7 FAIL，
> 且失败原因恰为 signOut 次数 2→3。

### Mock 与真实 HTTP 的边界

- **已 Mock 验证**：模式判定与隔离、OTP/链接验证接线、**邮件链接类型判定（M5：signup / magiclink / 歧义一律本地拒绝）**、
  RPC 创建/加入、records 字段与 `owner_id` 注入、`{ok:false}` 判定、
  `updated=0` 语义、登出清理、异步不复活、**页面级异步写回守卫与写入结果分类（M1/M2）**、
  **local 未适配功能的提示统一与 cloud 接线不变（M3）**、
  **view-pair 退出登录入口（PAIR：复用 doLogout、防重入、跨会话竞态锁所有权 RACE）**、未适配隔离
  （`node backend/tests/pactfit-be.test.js` → 67 项）。
- **Service Worker 逻辑 Mock（H-3-M4）**：`node backend/tests/pactfit-sw.test.js` → 16 项
  （运行**真实 `web/sw.js` 源码** + 隔离 CacheStorage Mock：导航/静态资源/API/敏感请求分类回退、
  install 失败可识别、activate 只清本应用缓存、升级回滚演练、local 不注册 SW、cloud 加载契约）。
  **Mock 只证明代码逻辑，不等于真实 Chromium 离线行为已验证。**
- **已在真实栈验证（H-2A/RETEST）**：GoTrue OTP/magiclink、refresh 轮换与竞态、CORS、PostgREST 读写与 RLS 可见性。
- **已在真实浏览器验证（H-2B-2）**：`web/index.html` 走完登录→建/加空间→记体重→登出、页面级竞态 6 项、cloud Mock 回归、PWA 升级/回滚演练。
- **已在真实邮件 + 真实浏览器验证（H-3-M5-RETEST）**：新用户 `type=signup` 与原样粘贴的完整链接登录成功；已有用户 magiclink 重登不受影响。
- **已在真实 Chromium + GoTrue + PostgREST 验证（H-3-M1M2-RETEST）**：R1/R2/R5/R6 旧响应无法写回已登出或新登录用户缓存、
  已落库后登出不再报错、保存成功与刷新失败被区分、结果未知不武断判失败；主复测 61/63 + 定向复测 14/14（2 项为断言窗口错误）。
  该栈仍为**本地**（回环 GoTrue/PostgREST + 克隆库），生产零请求。

### H-2B-2 剩余工作

1. ~~登出后回写防护~~ → H-3-M1M2 已在页面层修复并完成 Mock 验收（真实浏览器复测见 `H-3-M1M2-RETEST`）；
2. 真实浏览器端到端：local 模式全流程 + 双账号（创建/加入）；
2. cloud 模式回归：确认线上页面加载、登录、读写行为与改动前一致（含发布环境的 SDK 加载路径）；
3. ~~未接入功能补齐（todos/tags/rewards/messages/设置资料）或统一「本地不支持」文案验收~~
   → H-3-M3 已完成 todos/tags 的文案统一与前端接线（Mock 层）；todos/tags **仍未迁到本地数据库**，
   rewards/messages 维持既有明确拒绝语义；
4. ~~`sw.js` 缓存策略落地~~ → H-3-M4 已完成回退策略修复与 Mock 验收（详见下节）；
   真实 Chromium 离线复测（CacheStorage 生命周期、离线导航/资源行为）另行授权；
5. 清理克隆库 Auth 测试残留（users/sessions/refresh_tokens/audit_log_entries）。

## 备份与安全约定

- 业务数据备份（JSON / CSV）**只存仓库外**，`.gitignore` 已覆盖 `*-backup-*.json`、`backups/`、`exports/`。
- 仓库里只允许出现结构（DDL）与文档，不出现任何行级数据、手机号、邮箱、体重记录。
- `publishableKey` 是唯一允许留在代码里的凭据，且必须保持分片写法（见上文「三条红线」）。
- 恢复演练的**脚本**入仓（`backend/schema/drill/`、`scripts/drill-*.py`）；**产物**不入仓 ——
  `20_import.sql`、`expected.json`、`pactfit-actual.json` 一律生成在 `$HOME/PactFit-drill/`（0700 / 0600）。
- 演练文档只写计数、布尔、SQLSTATE，不写用户 ID、昵称、空间口令、体重、备注、邮箱。
