# PactFit V2.0 Preview

独立分支 `feat/pactfit-v2-product-redesign`，基线 `187d10d`。V1 的 web/index.html、Docker、Supabase staging 和 Pages 入口保留原样。V2 不导入旧数据，不访问 WorkBuddy，也不连接已有 staging。

## 本地启动（真实后端，无模拟业务数据）

需要 Docker Compose、Node 18+；数据库检查另需 Python 3。

```sh
git switch feat/pactfit-v2-product-redesign
./scripts/v2-up.sh
```

打开 **http://127.0.0.1:18899/v2/**（根路径也只提供 V2）。首次自行注册邮箱＋密码；本地 GoTrue 自动确认，仅用于本机预览。支持多个浏览器/无痕窗口分别注册账号。角色、数据和认证均为真实服务，不依赖假成功或前端账本。

- PostgREST：127.0.0.1:13000；GoTrue：127.0.0.1:19999。
- 本地邮件查看：http://127.0.0.1:18025（恢复密码或更换邮箱所需邮件只发 Mailpit）。
- `.env.v2` 自动生成随机数据库/认证秘密，已被 .gitignore 排除；不要提交。
- 新 Compose 项目 `pactfit-v2-preview`、新数据库 `pactfit_v2`、新卷 `pactfit-v2-preview_v2pg`；不复用 V1 卷或端口。
- 停止：`./scripts/v2-down.sh`。此命令保留数据，不删除卷。
- 个人会话只在内存，刷新后用密码重新登录；空间选择、主题、字体和伙伴图标偏好可本地保留，健康数据和密码不进 localStorage。

## 可演示流程

1. A 注册 → 自动获得唯一个人 ID 和私人空间 → 编辑昵称/官方头像、设置减重目标。
2. 管理私人清单 → 今日记录：体重可空、选择心情和完成项 → 趋势、日历、历史、清单和心情统计更新。
3. 创建公共团队，自动切换；B 注册后输入 A 的空间口令，A 在消息待处理中审批，B 刷新并切入团队。
4. 或队长输入 C 的个人 ID 邀请，C 在消息中接受。有效期七天，不能重复有效申请/邀请；并发也受五空间/六人额度约束。
5. 普通成员默认看不到口令、体重、目标。队长可开放复制口令；只有队长能重置。各成员分别打开团队共享权限，撤销后服务端不再返回对应数据。
6. 每日打卡和首次/连续成就触发真实宝石流水，重复编辑/多团队打卡不重复奖励；团队全员打卡产生团队徽章及各自个人历史荣誉。
7. 共同成员已授权的成就动态可喜欢/取消；通知、申请和动态属于账号，不被当前空间局限。
8. 队长退出自动由最早加入的现存成员接任。移除成员和解散需要二次确认；私人数据、宝石、个人荣誉保留。
9. 在设置中配置通知、公开成就动态、字体、主题和动态伙伴图标；可删除自己的健康记录，或单独处理退出/解散后的团队打卡历史。

伙伴图标只使用服务端返回的当天打卡状态：未记录为困倦、我已记录为清醒加状态点、我已记录且至少一位当前搭子也已记录为笑脸。它不读取体重变化，也不暴露搭子的健康数据；关闭动态后始终显示默认表情。此设置仅控制应用内图标，不承诺改变手机系统桌面上的 PWA 图标。

里程碑图形对应既有服务端规则：脚印为 `first_checkin`，日常毛巾为 `streak_7`，约定结为 `team_together`。锁定与达成样式由真实奖励数据决定，不在前端伪造成就。

跨账号变化在下一次服务端请求立即按新权限过滤；前端提供刷新按钮、窗口激活刷新和 20 秒轮询。Preview 未接入 Realtime 推送，不能承诺其他浏览器零延迟刷新。

## 工程入口与权限

- `web/v2/index.html`：V2 唯一页面入口；`style.css`：设计变量、抽屉、统一手机布局及深色模式。
- `web/v2/app.js`：全局账号/空间/路由状态、页面组件、弹窗操作；消息始终为账号级。
- `web/v2/model.js`：派生趋势、日历、完成率和安全文本；没有数据的日期不生成体重。
- `web/v2/api.js`：GoTrue/PostgREST 客户端，会话代数与过期刷新；无 WorkBuddy 回退。
- `db/migrations/03-v2-preview.sql`：增量且可重复的 V2 业务迁移，全部使用 v2_ 前缀，不更改旧表或托管 auth。
- `public.v2_command`：服务端允许的业务动作；`public.v2_snapshot`：按身份和当前空间过滤的数据投影。
- 私人健康记录统一存储于 v2_daily；v2_checkins 保存各空间的状态/清单；v2_sharing 保存每个团队独立、默认关闭的授权。
- 基础表启用 RLS，业务直写全部撤销；仅自己的 daily 和 ledger 可直接 SELECT。其他成员数据仅经受控 RPC 返回。
- 为可验证地避免额度、奖励和扣费竞态，Preview 命令采用固定顺序的事务级全局 advisory lock。高并发正式版本应改为经过测试的资源级锁，不能只删除锁。
- 昵称前端按 Intl.Segmenter、服务端按常见 Unicode 可见字符规则计数，支持组合音标/ZWJ emoji/肤色/旗帜；复杂文字的完整 UAX #29 一致性仍待加强。

## 宝石与未定运营规则

默认奖励是**明确标注的 Preview 测试积分**，由 v2_reward_rules 配置：每日一次 1、首次打卡 1、连续七天 3、个人首次团队全员打卡 1。它们不是正式运营定价，不能通过反复输入或下降体重刷取。每笔流水有唯一来源，余额取自服务端流水和；04 迁移另加个人规则领取凭证，即使解散再创建团队，也不会重复获得同一成就宝石。不同团队获得的历史荣誉仍分别保留。

v2_catalog 提供空间名额、团队席位、装饰商品结构。默认价格和最大兑换量都为 NULL、enabled=false，UI 禁用、服务端也拒绝兑换。只有规则经确认后才能设置价格/上限并启用；测试里的定价只存在一次性数据库。个人空间额度永久归个人；团队席位只绑定原团队，解散后不能转移；从不允许第二个私人空间。

## 明确未接入的能力

- **彻底注销认证账号**需要受信服务端使用管理接口，并设计数据保留/匿名化政策；当前设置明确禁用，不以退出登录冒充注销。健康和历史打卡删除是独立且已实现的操作。
- 没有手机号/第三方登录、图片上传、完整私信/评论。官方预设头像可切换。
- 官方活动/公告支持通知数据模型，但没有管理发布控制台；不会生成虚构公告。
- 没有已授权的独立 V2 Supabase/Pages 资源，因此不在现有 staging 上执行迁移，也不更换既有域名或流量。

## 独立 Cloudflare/Supabase 预览配置

在**新建、独立**的 Supabase 项目 SQL Editor 依次执行 `db/migrations/03-v2-preview.sql`、`db/migrations/04-v2-reward-claims.sql`，不要执行 `v2/roles.sql`（仅限本地）。开启 Data API 的 public schema，保留托管 auth。生产式邮箱验证/SMTP 按该新项目单独设置。

编辑 `v2/wrangler.toml` 的三个公开变量：

- PACTFIT_V2_SUPABASE_URL：新项目根 HTTPS 地址。
- PACTFIT_V2_PUBLIC_KEY：该新项目的 publishable key。
- PACTFIT_V2_APP_ORIGIN：新 Pages 项目 HTTPS 根地址。

`build-v2.js` 故意拒绝已有 `ksridewbjuwckuvougma` staging 项目、非 HTTPS、secret/service_role 或无配置的构建；没有其他地址回退。

新建独立 Pages 项目，配置：

| 项目 | 值 |
|---|---|
| Production branch | feat/pactfit-v2-product-redesign |
| Root directory | v2 |
| Build command | node ../scripts/build-v2.js |
| Build output | dist |
| Framework preset | None |

使用 v2/wrangler.toml 作为配置来源，**不要修改根目录 V1 的 wrangler.toml**。Supabase Site URL 和 Redirect URLs 只加入新 Pages 地址。V2 产物是 `v2/dist/index.html`，不包含 V1 页面或真实秘密。未配置的 Preview 环境应构建失败。

## 检查

```sh
node backend/tests/v2/client.test.js
node backend/tests/v2/build.test.js
./scripts/check-v2-db.sh
```

数据库脚本只允许一次性 `pactfit-v2-test-*` 容器，测试结束删除该容器，无端口开放或外部数据库 URL。覆盖审批/拒绝、私有数据、口令、队长、奖励、清除历史，以及并发额度/席位、重复发奖/扣费、余额不透支。

真实浏览器联调（合成测试账号会留在本地 V2 测试栈，可用独立项目隔离）：

```sh
./scripts/v2-up.sh
npm ci --prefix v2
./v2/node_modules/.bin/playwright install chromium
npm --prefix v2 run test:browser
# 已有系统 Chromium 时可设置 CHROMIUM_PATH=/usr/bin/chromium
```

浏览器测试仅允许本机网络，真实创建三个 .test 邮箱账号，验证注册、记录、申请、邀请、RLS、撤权、继任、解散、荣誉/流水与喜欢，并检查移动端、大字体和深色模式。不会请求 WorkBuddy 或真实 staging。

后续修改优先从上述组件和 model 派生函数进入；数据库后续变更使用新的编号迁移，不把真实用户数据放入样本。


## 移动端布局约定

PactFit 只维护手机竖屏布局。仓库源码、本地预览和 GitHub/Cloudflare 构建产物均使用最大 430px 的居中手机画布，宽屏两侧留白；小于 430px 时占满窗口。底部四项导航始终显示，空间侧栏始终为抽屉，记录和设置弹层始终为底部面板；它们与手机画布对齐，不覆盖电脑两侧留白。首页与其他页面均为单列，不再维护桌面侧栏、顶栏导航或双栏内容布局。电脑版浏览器只作为手机页面预览窗口。

## 视觉基准

V2 主题取自伙伴 Logo：砖红／珊瑚橙为主色，奶油白为页面底色，深棕用于正文，琥珀黄用于达成状态；蓝色和深绿色只保留在各自的里程碑图形中，不作为全站主题色。后续调整应优先延续 Logo 配色，不恢复早期绿色预览主题。
