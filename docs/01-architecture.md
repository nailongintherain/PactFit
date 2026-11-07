# 01 · 架构与依赖清单

## 1. 运行拓扑（当前线上）

```
┌──────────────────────────────┐
│  用户手机 / 浏览器            │
│  PWA（添加到主屏幕）          │
└──────────────┬───────────────┘
               │ HTTPS
               ▼
┌──────────────────────────────┐        ┌─────────────────────────────┐
│ 静态托管：WorkBuddy Sites     │        │ WorkBuddy 托管云服务         │
│ fit-together-44172.app.       │        │ ┌─────────────────────────┐ │
│        workbuddy.host         │        │ │ PostgreSQL（6 张表）     │ │
│  - index.html（单文件）       │        │ ├─────────────────────────┤ │
│  - manifest.json              │        │ │ 验证码登录（手机/邮箱）   │ │
│  - sw.js                      │        │ ├─────────────────────────┤ │
│  - icons/*                    │        │ │ RLS 行级权限             │ │
└──────────────┬───────────────┘        │ ├─────────────────────────┤ │
               │                        │ │ space_peek 存储过程      │ │
               │ SDK 内部走 /.cloud/**   │ └─────────────────────────┘ │
               └───────────────────────►│  实例由 publishableKey 标识  │
                                        └─────────────────────────────┘
```

## 2. 依赖逐项清单

| # | 依赖 | 具体地址 / 形态 | 是否 WorkBuddy 专有 | 能否本地导出 |
|---|---|---|---|---|
| 1 | 静态托管 | `https://fit-together-44172.app.workbuddy.host` | 是（Sites 发布） | 是（`web/index.html` 已归档，PWA 三件套需从发布端取） |
| 2 | 前端 SDK | `https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js` | 是（腾讯自研，非标准 supabase-js） | 否（CDN 远程，无法拷进仓库） |
| 3 | SDK 实际版本 | `0.1.4-dev.ca27990.202610161713`（`@dev` 浮动标签，构建于 2026-10-16） | 是 | 否 |
| 4 | 云服务 endpoint | 与站点同域：`https://fit-together-44172.app.workbuddy.host` | 是 | 否 |
| 5 | 应用标识 | `publishableKey`（`wbpk_` 前缀，分片拼接） | 是 | 部分（密钥本身在代码里，但对应的应用实例不可导出） |
| 6 | OAuth 中继 | `https://www.workbuddy.cn/v2/as/genie-baas/oauth` | 是 | 否（当前代码未使用，仅为第三方登录预留） |
| 7 | 数据库 | PostgreSQL，由 genie-baas 平台承载，实例 id 服务端保管、不返回前端 | 是（托管） | 表结构可查、数据可导，实例不可搬 |
| 8 | 认证 | 手机号 / 邮箱验证码（OTP），session 由 SDK 持久化 | 是 | 流程可文档化，实现不可导出 |
| 9 | 短信通道 | 平台侧统一接入，`需平台审核`（页面文案原话） | 是 | 否 |
| 10 | 行级权限 | PostgreSQL RLS，策略内容前端不可见 | 是 | 只能反推 |
| 11 | 存储过程 | `space_peek(code)` → `{count, names[]}` | 是 | 只能反推 |

## 3. `/.cloud/` 到底在哪

**前端代码里没有任何一处硬编码 `/.cloud/`。** 全文检索结果：0 处 `fetch(`、0 处 `XMLHttpRequest`、0 处 `axios`、0 处字符串 `/.cloud/`。

所有网络请求都由这一行创建出来的 SDK 实例内部完成：

```js
cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: PUBLIC_CONFIG.endpoint,                 // https://fit-together-44172.app.workbuddy.host
  oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: PUBLIC_CONFIG.publishableKey      // wbpk_... 分片拼接
});
```

含义：

- `/.cloud/**` 是 **SDK 内部实现细节**，不是应用代码。想改也无处可改。
- 迁出时**不能"搬运"这一层**，只能重写一个同形接口的实现（见 `docs/08` 的 shim 方案）。
- 反过来说，这也是好消息：只要 shim 复刻同样的方法签名，`index.html` 的 38 个调用点一行都不用动。

## 4. 认证方式

- 主方式：验证码登录（`sendOtp` → `verifyOtp`），支持手机号与邮箱两条通道。
- 首次登录**自动注册**，`isExistingUser` 只是提示，不影响流程。
- Session 持久化在浏览器（SDK 内部管理），`getSession()` 恢复登录态。
- 站点 Origin 与云服务实例**精确绑定**：换域名 = 登录必然失败（`invalid_client`）。
- 页面默认登录方式为邮箱（`setLoginMode('email')`，`index.html:1938`）。

## 5. 明确无法导出的能力（以及原因）

| 能力 | 为什么导不出 | 替代方案 |
|---|---|---|
| 数据库实例本体 | 托管服务，实例 id/凭据在服务端，前端只有 publishableKey | 新建 Postgres 实例（Supabase / 自建），按 `backend/schema` 重建 |
| RLS 策略原文 | 前端无 `pg_catalog` 读权限；只能从"哪行能读能写"反推 | Phase 1 在原应用所属工作区执行 `999_verify-live-schema.sql` 取权威定义 |
| `space_peek` 函数体 | 同上 | 同上（`pg_get_functiondef`） |
| 验证码发送逻辑 | 平台服务，含短信通道、频控、模板 | 自建：邮箱走 Resend/SES，手机走阿里云/腾讯云短信 |
| SDK 客户端实现 | CDN 上的压缩产物，非本仓库代码 | 重写 shim（约 200 行），或改用 supabase-js |
| 已发布产物（manifest/sw/icons） | 资料库那份只有 index.html | 从线上站点直接抓取，或按 `web/pwa/` 规范补写 |

> 结论：**后端不是"搬迁"，是"重写"。** 本仓库提供的是重写所需的全部规格，不是可以直接运行的旧后端。
