# PactFit staging：Supabase + Cloudflare Pages

仅连接 `pactfit-staging`（us-east-1）；不导入真实数据，不执行 `db/init/01-roles.sql`，不改变 Docker 或 WorkBuddy 配置。

## 公开项目配置

`staging/env.example` 已填写 Project URL 与 publishable key，均可公开。适配层接受项目根地址或用户提供的 `/rest/v1/` 地址，再派生同一项目的 `/auth/v1`、`/rest/v1`。publishable key 经 `apikey` 头传入，不是 JWT；业务 Authorization 只传登录用户的 access_token。刷新、回调校验、登出也带 apikey，无需改用 legacy anon key。

## Supabase 控制台

1. 确认项目为 pactfit-staging / us-east-1，在 SQL Editor 执行 `staging/migrations/001-business.sql`，再执行 `staging/verify.sql`。迁移在单个事务中提交，已有业务表时拒绝重新初始化，不修改托管 auth 或角色。
2. Data API 启用 public schema，不暴露 private / migration。若已迁移但 API 仍报 PGRST205，检查 schema 设置，再执行 `NOTIFY pgrst, 'reload schema';`，不要重复 bootstrap。
3. Authentication → Providers 启用 Email。内置邮件服务仅支持有限收件人且限额较低；测试账号邮箱应符合 Supabase 的团队成员限制。对外测试需在 Supabase 配置 SMTP，凭据只留服务端。
4. Authentication → URL Configuration：Site URL 和 Redirect URLs 均填最终 Pages HTTPS 根地址，含 `/`。例如 `https://pactfit-staging.pages.dev/`，以 Cloudflare 实际分配地址为准。不要添加 WorkBuddy 域名。
5. 保持默认邮件 ConfirmationURL 链接；用户点击后回到页面，应用向指定项目 `/auth/v1/user` 校验 token，再建立内存会话。刷新页面需重新登录。

## Cloudflare Pages 控制台

创建 Workers & Pages → Pages → Connect to Git：

- 仓库：`nailongintherain/PactFit`。
- 项目：`pactfit-staging`，如名字被占用须同步更改 APP_ORIGIN 和认证回调。
- Production branch：`feat/local-backend-adapter-h1`。
- Root directory：仓库根；Framework preset：None。
- Build command：`node scripts/build-staging.js`。
- Build output directory：`dist`；实际源码入口是 **web/index.html**，构建生成 dist/index.html。
- Production 构建变量：按 `staging/env.example` 设置 `PACTFIT_STAGING_SUPABASE_URL`、`PACTFIT_STAGING_PUBLIC_KEY`、`PACTFIT_STAGING_APP_ORIGIN`。
- Preview 默认不配置以阻止未配置构建；如需预览须单独配置其域名及精确回调 allowlist。

这里 Production 指独立 staging Pages 项目，并非 WorkBuddy。不要向 Pages 添加 service_role、secret key、数据库密码或 SMTP 凭据。Cloudflare 域名确认后更新 APP_ORIGIN 和 Supabase 回调，再重新部署。

构建缺少有效配置即失败。staging 复用独立业务分支（内部 BACKEND=local），即使部署配置文件丢失也不会加载 WorkBuddy SDK；CSP connect-src 只允许本源和指定 Supabase。Docker 的 web/deployment-config.js 保持空配置，原有 `?local=1` 流程不变。staging 不注册 SW，避免认证页面缓存。

有既有 Cloudflare CLI 授权时：设置三个公开构建变量 → `node scripts/build-staging.js` → `wrangler pages deploy dist --project-name pactfit-staging --branch feat/local-backend-adapter-h1`。

## 自动检查

```sh
node backend/tests/pactfit-be.test.js
node backend/client/pactfit-local-api.test.js
node backend/tests/pactfit-sw.test.js
node backend/tests/staging.test.js
./scripts/check-staging-db.sh
python scripts/check-staging-remote.py
```

CI `.github/workflows/staging-checks.yml` 运行本地测试、生成迁移一致性和一次性 PostgreSQL 验证，无需云账号。数据库检查模拟托管角色/auth.uid 和默认授权，以虚构 UUID 验证创建空间、加入、记录共享、非成员隔离、伪造 owner 拒绝，再回滚并删除容器，绝不连接开发或远程数据库。远程探针仅 GET 指定 staging 的 settings 及 limit=0 查询，退出码 2 表示表待迁移或 schema cache 未刷新，不发送邮件或写入数据。

迁移由 `python scripts/prepare-staging-migration.py` 从已验证的 `db/migrations/02-business.sql` 生成，去除 psql 元命令、所有权变更和宽泛默认授权，保留业务/内部十表、RLS、触发器、RPC、列级 GRANT。不要手改生成 SQL 或本地原始迁移。

部署后用两个专用测试邮箱验收：邮箱登录 → A 创建空间 → B 加入 → A 记体重 → B 可读 → 登出。Network 中认证/业务请求应全部去新项目。小目标、标签、奖励、留言、资料编辑等原独立页面未接入能力继续明确提示不可用，不能宣称全功能上线。

## 同步及状态

本代码由会话记录恢复为新提交，原 `6a201af` 不在远程。只有 GitHub 远程提交确认后才算代码交付成功；数据库迁移和 Pages 发布仍需按上述控制台步骤完成，构建通过不代表已上线。
