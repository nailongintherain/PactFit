# 04 · 登录认证逻辑

## 1. 完整时序

```
启动 boot()                                   index.html:1936
  ├─ initCloud()                              663   创建 SDK 实例
  ├─ getSession()                             1941
  │    ├─ 有 session → afterLogin()           1679
  │    └─ 无 session → show('view-login')
  └─ 失败 → "连接失败：..."                    1946

登录
  ├─ sendOtp({ phone })                       1637
  │     ← { verificationId, isExistingUser }
  ├─ sendOtp({ email })                       1649
  │     ← { verificationId, isExistingUser }
  ├─ verifyOtp({ phone|email, verificationId, isExistingUser, token })   1664
  │     ← { user, session }   （session 由 SDK 自行落地）
  └─ afterLogin()
        ├─ getSession() → uid = user.id       1680-1682
        ├─ loadAll()                          679
        ├─ 有 ?space=XXX 且未加入 → 进「加入空间」
        └─ 否则 → 进主界面
```

## 2. 三个必须复刻的细节

### 2.1 两段式验证码

`sendOtp` 返回的 `verificationId` **不是验证码**，是服务端签发的会话句柄。`verifyOtp` 必须同时收到句柄和用户输入的 6 位码才能换 session。

意义：验证码本身不落前端、不可重放、有时效。自建时若简化成"邮箱+验证码"直接校验，前端要改（`pendingOtp` 结构、`doLogin` 入参），且安全性下降。

### 2.2 `isExistingUser` 只是提示

前端把它原样带进 `verifyOtp`，但从不分支处理。首次登录即自动注册。自建时可忽略该字段，只要接口签名一致。

### 2.3 session 由 SDK 保管

前端只调 `getSession()`，从不自己写 localStorage 存 token。迁移时 shim 必须自己实现持久化（建议 `localStorage` + 过期时间 + 刷新），否则刷新页面就掉登录。

## 3. 状态机

```
        ┌──────────┐  sendOtp   ┌───────────────┐ verifyOtp ┌──────────┐
        │ 未登录    │ ─────────► │ 待验证码       │ ─────────► │ 已登录    │
        └──────────┘            │ pendingOtp    │            └────┬─────┘
             ▲                  └───────────────┘                 │
             │                        │ 60s 后可重发               │ 无 profile
             │                        └──── 倒计时 ───────────────┤
             │                                                    ▼
             │                                             ┌──────────┐
             └────────── signOut ───────────────────────── │ 待建/待加入 │
                                                           │ 空间        │
                                                           └──────────┘
```

`signOut()` 只清 session，不清业务数据（`doLogout` 手动把 `S.*` 全部置空，`1670-1676`）。

## 4. 失败模式与当前文案

| 场景 | 现象 | 前端文案 |
|---|---|---|
| SDK 加载失败 | 全站不可用 | `SDK 加载失败`（`664`） |
| 验证码发不出 | 停在登录页 | 直接显示服务端 `error.message` |
| 验证码错/过期 | 停在登录页 | `验证码不对，或者已过期` |
| 域名 Origin 不匹配 | 验证码永远发不出 | 服务端返回 `invalid_client`（极难自查） |
| session 过期 | 刷新后回登录页 | 无提示 |
| 短信通道未审核 | 手机号永远收不到码 | 页面自带的兜底文案：`短信通道需平台审核，如果一直收不到，点下面「改用邮箱登录」` |

## 5. 迁移到自建时需要补的三件事

1. **Session 持久化**：SDK 内部行为不可见，shim 必须自己实现（token + 刷新 + 过期）。
2. **频控**：现在完全依赖平台；自建必须加（同号/同 IP 每分钟 1 次、每天 10 次），否则会被刷短信费。
3. **邮箱送达率**：自建建议接 Resend / 阿里云邮件推送，别用服务器本地 SMTP（进垃圾箱概率高）。

## 6. 与 `owner_id` 的关系（最容易踩的坑）

`owner_id` 从不来自前端，而是服务端用 session 里的用户 id 注入。自建时如果忘了这一步：

- 插入会因 `owner_id not null` 直接失败；或
- 更糟：如果给了默认值 `null` 又没约束，会插入一堆无主数据，RLS 全部看不见，表现为"保存成功但刷新就没了"。

**这条必须在建表时就锁死**：`owner_id uuid not null default auth.uid()`，并在 API 层忽略客户端传来的 `owner_id`。
