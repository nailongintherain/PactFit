# PactFit staging：Supabase + Cloudflare Pages

仅连接 `pactfit-staging`（us-east-1）；不导入真实数据，不执行 `db/init/01-roles.sql`，不改变 Docker 或 WorkBuddy 配置。

## 公开项目配置

`staging/env.example` 已填写 Project URL 与 publishable key，均可公开。适配层接受项目根地址或用户提供的 `/rest/v1/` 地址，再派生同一项目的 `/auth/v1`、`/rest/v1`。publishable key 经 `apikey` 头传入，不是 JWT；业务 Authorization 只传登录用户的 access_token。刷新、回调校验、登出也带 apikey，无需改用 legacy anon key。

## Supabase 控制台

1. 确认项目为 pactfit-staging / us-east-1，在 SQL Editor 执行 `staging/migrations/001-business.sql`，再执行 `staging/verify.sql`。迁移在单个事务中提交，已有业务表时拒绝重新初始化，不修改托管 auth 或角色。
2. Data API 启用 public schema，不暴露 private / migration。若已迁移但 API 仍报 PGRST205，检查 schema 设置，再执行 `NOTIFY pgrst, 'reload schema';`，不要重复 bootstrap。
3. Authentication → Sign In / Providers → Email：启用 Email。staging 使用邮箱＋密码；若要注册时无需确认邮件，将 **Confirm email 关闭并保存**。密码登录不会发送邮件。该设置仅适用于独立 staging。内置邮件服务有收件人和发信限额；设置／找回密码仍需邮件，限额用尽须等待额度恢复或在 Supabase 配置 SMTP，凭据只留服务端。
4. Authentication → URL Configuration：Site URL 和 Redirect URLs 均填最终 Pages HTTPS 根地址，含 `/`。例如 `https://pactfit-staging.pages.dev/`，以 Cloudflare 实际分配地址为准。不要添加 WorkBuddy 域名。
5. staging 页面提供独立“注册”“登录”“设置／找回密码”，不显示手机号或验证码。注册走 `/auth/v1/signup`，登录走 `/auth/v1/token?grant_type=password`。关闭 Confirm email 后新账号注册可直接建立会话；若仍返回需确认，页面提示确认要求，不伪造登录成功。会话仅内存，刷新后可再次用密码登录。
6. 旧邮件链接账号没有密码：使用“设置／找回密码”接收一次密码恢复邮件，点击后在本站设置新密码。保留 Supabase 默认 Recovery 邮件的 ConfirmationURL 模板，恢复回调先向本项目 `/auth/v1/user` 校验，再调用带用户 JWT 的 PUT `/auth/v1/user` 更新密码。已有账号不能靠重新注册覆盖；关闭 Confirm email 不会给旧账号自动设置密码。旧 signup 邮件链接只能使用一次，不能用于二次登录。

## Cloudflare Pages 控制台

创建 Workers & Pages → Pages → Connect to Git：

- 仓库：`nailongintherain/PactFit`。
- 项目：`pactfit-staging`，如名字被占用须同步更改 APP_ORIGIN 和认证回调。
- Production branch：`feat/local-backend-adapter-h1`。
- Root directory：仓库根；Framework preset：None。
- Build command：`node scripts/build-staging.js`。
- Build output directory：`dist`；实际源码入口是 **web/index.html**，构建生成 dist/index.html。
- Production 公开变量已写入 `wrangler.toml` 的 `[vars]`，与 `staging/env.example` 一致；无需重复在控制台设置。变量名为 `PACTFIT_STAGING_SUPABASE_URL`、`PACTFIT_STAGING_PUBLIC_KEY`、`PACTFIT_STAGING_APP_ORIGIN`。
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
node backend/tests/staging-password.test.js
node backend/tests/staging-records.test.js
./scripts/check-staging-db.sh
python scripts/check-staging-remote.py
```

CI `.github/workflows/staging-checks.yml` 运行本地测试、生成迁移一致性和一次性 PostgreSQL 验证，无需云账号。数据库检查模拟托管角色/auth.uid 和默认授权，以虚构 UUID 验证创建空间、加入、记录共享、非成员隔离、伪造 owner 拒绝，再回滚并删除容器，绝不连接开发或远程数据库。远程探针仅 GET 指定 staging 的 settings 及 limit=0 查询，退出码 2 表示表待迁移或 schema cache 未刷新，不发送邮件或写入数据。

迁移由 `python scripts/prepare-staging-migration.py` 从已验证的 `db/migrations/02-business.sql` 生成，去除 psql 元命令、所有权变更和宽泛默认授权，保留业务/内部十表、RLS、触发器、RPC、列级 GRANT。不要手改生成 SQL 或本地原始迁移。

部署后用两个专用测试邮箱验收：邮箱＋密码注册 → 退出 → 同一账号密码登录两次 → A 创建空间 → B 加入 → A 记体重 → B 可读 → 登出。Network 中认证/业务请求应全部去新项目。小目标、标签、奖励、留言、资料编辑等原独立页面未接入能力继续明确提示不可用，不能宣称全功能上线。

## 同步及状态

本代码由会话记录恢复为新提交，原 `6a201af` 不在远程。只有 GitHub 远程提交确认后才算代码交付成功；数据库迁移和 Pages 发布仍需按上述控制台步骤完成，构建通过不代表已上线。

Pages 检测到含 pages_build_output_dir 的 wrangler.toml 后，以该文件管理支持的配置项。公开 URL/key/回调统一维护在 [vars]；修改最终域名时须更新此文件、staging/env.example 及 Supabase allowlist。Preview 显式为空，未配置独立回调前构建应拒绝。控制台填写正确不代表旧构建已收到变量，构建日志中的变量诊断是实际证据。

## 已保存内容与编辑区

staging 首页优先展示从账号、当前空间加载的已保存打卡（日期、体重、心情、备注、条数）；趋势页独立展示我的打卡历史。首次打卡当天也显示已有数据。记录页上方是只读已保存内容，下方是填写／编辑区；输入或选择心情只修改草稿，点击保存成功并重新读取后才更新已保存展示。重新登录回到首页，并从服务器重载记录；起始体重不计为打卡，草稿不持久化。引导填写信息流程未改。
