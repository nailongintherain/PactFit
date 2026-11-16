# AGENTS.md — PactFit 独立开发说明（Codex / GitHub 协作者必读）

PactFit 是一个双人减脂打卡 PWA（纯静态前端 + PostgREST/GoTrue 后端）。本仓库已脱离原托管平台，
可用 Docker Compose 在本机独立运行全部后端服务。

## 架构

```
web/                 纯静态前端（index.html 单页应用 + sw.js PWA）
  pactfit-be.js      接线层：模式判定（local/cloud）/ 会话代数守卫 / 写入结果分类
  pactfit-local-api.js  local 模式认证+数据适配层（直连 GoTrue / PostgREST，双份源文件见 backend/client）
backend/client/      适配层源码（与 web/ 下部署副本字节一致，由测试锁定）
backend/tests/       页面/适配层/SW 三套 Mock 测试（67 + 41 + 16 项，纯 Node，零容器依赖）
db/init/             PostgreSQL 首次初始化（角色；entrypoint 自动执行）
db/migrations/       业务 schema（十表 + RLS + RPC + GRANT；dev-up 在 GoTrue 迁移后应用）
compose.yaml         PostgreSQL 17 / GoTrue v2.197.0 / PostgREST v16.5 / Mailpit v1.31.3 / nginx(前端)
```

## 启动

```bash
./scripts/dev-up.sh      # 自动生成 .env（随机密钥）→ 起库 → GoTrue 迁移 → 业务 schema → 全服务
./scripts/dev-check.sh   # 健康检查
./scripts/dev-down.sh    # 停止（保留数据卷）
```

打开 `http://127.0.0.1:8899/?local=1`（**必须带 `?local=1`**，loopback + 标记才进入本地模式）。

首次注册/登录：输入任意邮箱 → GoTrue 发链接邮件到 Mailpit（`http://127.0.0.1:8025`）→ 复制邮件里的完整
链接粘贴到页面 → 登录。

## 关键约定（改代码前必读）

1. **两种模式**：`local`（GoTrue+PostgREST，本仓库）与 `cloud`（原 WorkBuddy 托管，仅线上残留运行）。
   改动不得让 local 依赖 WorkBuddy Cloud SDK；不得修改 `PUBLIC_CONFIG`。
2. **模式判定**在 `web/index.html` 顶部内联脚本：loopback 主机 + `?local=1`（或 localStorage
   `pactfit_local_dev=1`）→ local；公网恒为 cloud。判定一次确定，运行期不变。
3. **两份适配层**（`backend/client/pactfit-local-api.js` 与 `web/pactfit-local-api.js`）必须字节一致，
   `backend/client/pactfit-local-api.test.js` 断言锁定——改源码后重新部署副本。
4. **客户端授权矩阵** `TABLE_MATRIX`（适配层内）与数据库 GRANT/RLS 对齐：
   - todos/tags：SELECT / 列级 INSERT / DELETE；**无 UPDATE**
   - profiles：SELECT/UPDATE（无直写 INSERT——空间操作走 `rpc_create_space`/`rpc_join_space`）
   - rewards：仅 SELECT（写入走 reward RPC）
   - records：SELECT / INSERT / UPDATE（tags、todo_done 为 jsonb 软引用）
   - `owner_id` 由适配层自动注入当前 JWT sub；显式传入不同值会被拒绝（owner_mismatch）
5. **RLS 语义**：todos/tags/records 按 `space_id` 共享（同空间成员互见）；todos/tags 的 DELETE 仅限
   `owner_id = auth.uid()` 的行。安全边界在数据库 RLS，客户端校验只是前置防线。
6. **PostgREST 错误映射**在适配层统一处理（401→unauthenticated、403→permission_denied、
   PGRST301→invalid_jwt）；PATCH 204 可能更新 0 行（RLS 过滤），页面必须检查 `meta.updated`。
7. **会话代数守卫**（`guard`）：登录/登出都会 bump；迟到的异步响应必须用 `guard.isCurrent(ep)` 丢弃，
   不写回 S、不弹提示。doLogout 的锁归「最新一次登出」，旧流程 finally 不得解除新会话的锁。
8. **测试**：`node backend/tests/pactfit-be.test.js`（67）、`node backend/client/pactfit-local-api.test.js`（41）、
   `node backend/tests/pactfit-sw.test.js`（16）——全部应保持全绿；改行为前先改/加测试。
9. **数据库变更**：业务 schema 变更须在 `db/migrations/` 新增编号迁移文件（不要改 02-business.sql 的
   已验证内容），并在 mock 契约测试同步更新。不要手工对开发库改结构后不落迁移文件。
10. **安全**：`.env`（真实密钥）不入 Git；所有服务仅绑定 127.0.0.1；不要向外部 SMTP 发信（Mailpit 本地捕获）。

## 已知边界

- `web/index.html` 的模式判定要求 loopback 主机；把前端部署到公网域名时 local 模式不会激活
  （需要后续小改动放宽判定，当前刻意保守）。
- todos/tags 增删后，历史 `records.todo_done` / `records.tags` 中的旧引用不级联清理（与原版行为一致）。

## 独立预生产 staging

- 操作入口 `staging/README.md`；`node scripts/build-staging.js` 从 web/index.html 生成 dist/index.html。
- PACTFIT_STAGING_* 不复用 Docker .env；PUBLIC_CONFIG 保持不变。
- staging 复用独立页面分支（内部 BACKEND=local），适配层显式接收 mode=staging，固定派生同一 Supabase 项目的 auth/v1、rest/v1；所有请求带公开 apikey，Authorization 仅传用户 JWT。
- `staging/migrations/001-business.sql` 由生成脚本产生，仅用于空托管项目，不运行本地角色初始化。
- 新增检查：node backend/tests/staging.test.js、scripts/check-staging-db.sh、python scripts/check-staging-remote.py（只读指定 staging）。

- staging 认证使用独立邮箱＋密码页面 `web/pactfit-staging-auth.js`；Docker 保持链接登录。密码仅经本项目 HTTPS Auth 接口传输，不持久化或写日志。新增回归 `node backend/tests/staging-password.test.js`；无邮件注册须在 staging Supabase 关闭 Confirm email，旧无密码账号通过 recovery 设置密码。

- staging 已保存记录与编辑区分开；`summarizeSavedRecords` 仅汇总当前账号和空间的服务端行，不把草稿或起始体重当打卡。新增回归 `node backend/tests/staging-records.test.js`。

## PactFit V2 独立改版

- V2 基线为 187d10d，新分支 feat/pactfit-v2-product-redesign；入口 web/v2/，说明 v2/README.md。
- 禁止将 V2 迁移应用到已有 staging 或覆盖 V1 数据。V2 的 03-v2-preview.sql 只新增 v2_* 对象，不依赖旧业务表。
- scripts/v2-up.sh 使用独立 compose 项目、数据库和随机 .env.v2，启动后端及 http://127.0.0.1:18899/v2/。
- 身份、当前空间、健康源数据、空间打卡和共享授权分离。隐私必须在 v2_snapshot 和 RLS/RPC 中落实，不可只隐藏前端。
- 所有业务写入经 v2_command 原子校验；保留并发锁、服务端额度/权限/奖励幂等检查。宝石商品价格和上限未批准前保持禁用。
- 新测试：backend/tests/v2/client.test.js、build.test.js、scripts/check-v2-db.sh、browser.test.js（真实隔离 Docker 后端）。

- V2 只维护手机布局：最大 430px 居中画布，宽屏留白；任何窗口均使用底部导航、抽屉侧栏、底部弹层和单列页面，不恢复桌面断点或桌面专用交互。
