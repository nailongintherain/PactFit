# 06 · 配置项与环境变量

## 1. 现状：没有 `.env`，没有构建期变量

这是个纯静态单文件应用，所有配置写死在 `index.html` 第 580–588 行：

```js
var PUBLIC_CONFIG = {
  endpoint: "https://fit-together-44172.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: ['wbpk_RU06','XiFs5hWfDTSOoVZn2z','_pg53tQkNKBwtQ','kMWkopNq9A613kOb43C'].join('')
};
```

| 配置 | 含义 | 可公开 | 说明 |
|---|---|---|---|
| `endpoint` | 云服务入口，与站点同域 | 是 | 换域名必须同步改这里，否则 Origin 不匹配 |
| `oauthRelayBaseUrl` | 第三方登录中继 | 是 | **当前代码未使用**，纯预留 |
| `publishableKey` | 应用标识（`wbpk_` 前缀） | 是 | 本身无权限，靠 Origin 精确匹配兜底；见下方红线 |

## 2. 三条红线（原文来自 `减脂搭子-协作说明`）

### 红线 1 · `publishableKey` 必须保持分片数组

```js
// ✅ 保持这样
publishableKey: ['wbpk_RU06','XiFs5hWfDTSOoVZn2z','_pg53tQkNKBwtQ','kMWkopNq9A613kOb43C'].join('')

// ❌ 绝对不要合并成一个字符串
publishableKey: 'wbpk_RU06XiFs5hWfDTSOoVZn2z_pg53tQkNKBwtQkMWkopNq9A613kOb43C'
```

原因（代码注释原话，`582-586`）：发布环境会把**字面量**那一行的密钥回填成它自己记录的应用密钥，而那份记录指向另一个应用，回填后调用返回 `invalid_client`，**线上登录直接挂**，且现象是"验证码发不出去"，极难定位。

分片写法逃过回填。这是一条用线上事故换来的规则，**本仓库的任何改动都不得触碰**。

### 红线 2 · 不要动 `/.cloud/` 相关请求逻辑

代码里没有这个字符串（见 `docs/01` §3），它封装在 SDK 内。含义是：不要试图自己拼请求、换 SDK、加拦截器。

### 红线 3 · 不要绕开 `space_id` 读写

多组隔离唯一保障。任何"临时查一下全表"的改动都会串数据。

## 3. 版本锁定情况（建议尽快处理）

```html
<script src="https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"></script>
```

- 标签是 `@dev`，**浮动**。
- 解析到的当前实际版本：`0.1.4-dev.ca27990.202610161713`（构建于 2026-10-16）。
- 意味着：上游推一版 `dev`，你不改任何代码，线上行为也会变。

**建议（需仓库主同意后执行，属线上变更）**：把 `@dev` 改成精确版本号，并记录到本文件。在此之前不要动。

## 4. 将来迁移需要引入的环境变量（占位，现在不生效）

见 `backend/config/env.example`。分两组：

- **后端**（只存服务器，永不进前端）：数据库连接串、JWT 密钥、邮件/短信服务商凭据、`OWNER_ID_OVERRIDE=false`。
- **前端构建期**（可公开）：`PUBLIC_API_BASE`、`PUBLIC_APP_ORIGIN`。

## 5. 现在这个仓库里绝不能出现的东西

- 数据库连接串、服务账号密钥、短信/邮件服务商 Secret
- 用户邮箱、手机号、体重数据
- 任何 `.env`（`.gitignore` 已覆盖）

`publishableKey` 是唯一允许留在代码里的凭据，因为它本身没有权限，且现有红线要求它必须留在原地。
