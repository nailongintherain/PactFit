# PactFit 本地后端适配层（GoTrue + PostgREST）

> 分支：`feat/local-backend-adapter-h1`（13-H-1 + 13-H-1-FIX + 13-H-2A-FIX）·
> 状态：mock 测试 41/41 PASS（**Mock PASS ≠ 真实 HTTP PASS**）；真实栈联调见 13-H-2A，
> **竞态修复后的会话行为尚未在真实栈复测**（属后续授权范围）

## 这是什么

`pactfit-local-api.js` 是一个**零依赖**前端适配层，为 `web/index.html` 单文件 SPA 提供
可切换的本地后端客户端（自托管 GoTrue + PostgREST），目标是不改动任何现有页面代码的
前提下为后续本地真实栈联调（13-H-2+）做好准备。

- **cloud 模式（默认）**：`createLocalBackend({})` 返回 `{ mode:'cloud', auth:null, db:null }`，
  本文件完全不接管任何请求——现有页面继续使用 WorkBuddy Cloud SDK，行为零变化。
- **local 模式**：显式传入 `mode:'local'` + `authUrl`（GoTrue :9999）+ `restUrl`（PostgREST :3000）。
  仅允许本机回环地址（127.0.0.1 / localhost / [::1] + http），缺失或非法配置即抛错，
  **绝不静默回退到云端**。

## 运行测试

```bash
node backend/client/pactfit-local-api.test.js
# 41 个用例，零依赖（Node 18+ 自带 assert），全部为 mock PASS
# T1–T18=13-H-1；T19–T33=13-H-1-FIX；T34–T41=13-H-2A-FIX 竞态矩阵（queueFetch 手动交错）
# 真实 HTTP PASS 需在 13-G 已验证的本地栈上另行执行
```

## API 概览

### Auth（GoTrue，内存会话）

| 方法 | 说明 |
|---|---|
| `requestEmailOtp(email)` | POST `/otp {email, create_user:true}`；失败映射 `otp_request_failed` |
| `verifyEmailOtp({type, token_hash})` | 链接式验证（token_hash 不得附带 email）；或 `{type, email, token}` 6 位码模式 |
| `verifyEmailOtp({type, email, token})` | 6 位码形态（自托管默认模板为链接式，需自定义模板才可用） |
| `requestPhoneOtp(...)` | **明确拒绝** `unsupported`（GoTrue 未配置 SMS provider，不伪装成功） |
| `getSession / getAccessToken / getUserId` | 读内存会话 |
| `refreshSession()` | POST `/token?grant_type=refresh_token`。**会话代数（sessionGen）竞态保护**：发起时快照当前代数；结果到达时若代数已变（已登出/已换新会话）则**丢弃该结果**——200 → `refresh_stale_after_logout`（绝不重建会话/恢复 token）；失败 → 保留 `refresh_failed`/`refresh_network_failed` 原分类但**不清除当前会话**。代数未变时：服务端明确拒绝 → `refresh_failed` 清会话；网络层失败 → `refresh_network_failed` 保守清会话。**并发去重按会话代数**：同一会话内并发刷新复用同一 Promise（单次 HTTP）；登出/换新会话后新刷新不被旧在途请求阻塞；旧请求 finally 仅在仍持有去重位时清空。不实现自动重试。 |
| `signOut()` | POST `/logout`（Bearer）。**调用开始即同步生效**：sessionGen 递增使旧代全部异步结果作废 + 本地会话立即清空（后续数据请求无法再取得旧 access_token），不等 /logout 返回；服务端撤销使用调用开始时捕获的旧 Bearer。结果区分：`data.localCleared`（恒 true）、`data.serverRevoked`（仅 2xx 为 true）、`error`（`logout_http_failed` / `logout_network_failed`）。不输出旧 token、不自动恢复会话。无会话时零请求返回 `signedOut:false`。 |

会话仅存内存（刷新页面即失效），不落 localStorage——PWA 环境下避免 token 持久化风险。

### Db（PostgREST，白名单守卫 + {data,error} 信封）

- `select(table, filters?, order?)` — GET，`eq.` 过滤 + order。
  **查询参数经 URLSearchParams 标准编码**（中文/空格/`&`/`#`/`?`/`=` 等特殊字符全部转义，
  `+` 统一替换为 `%20`），`eq.` 语义与多条件过滤/双级排序保留。
  **字段名白名单**：过滤字段与排序列必须是合法标识符（`^[A-Za-z_][A-Za-z0-9_]*$`），
  且不得为 PostgREST 结构性保留参数（`select/order/limit/offset/or/and/not/on_conflict/
  columns/accept-profile/content-profile/range/range-unit` 等），非法即 `bad_request` 且**零请求发出**——
  防止通过特殊字段名注入额外查询操作。
- `insert(table, payload)` — POST + `Prefer: return=representation`，回读整行数组
- `update(table, payload, filter)` — PATCH，必须带 filter；返回 `{data, error, meta:{updated:N}}`。
  **updated=0 = 越权或不存在**（PATCH 204 零行歧义，13-G-2C-3 实测），页面必须检查 updated
- `remove(table, filter)` — DELETE，仅 todos/tags 授权，必须带 filter
- `rpc(name, params)` — 仅白名单 9 个 RPC；HTTP 200 + `{ok:false,code}` 业务拒绝**原样透传**
  （`error=null, data.ok=false`），页面按 `data.code` 分支

### owner_id 自动注入（local 模式统一规则）

对齐旧 WorkBuddy Cloud SDK 的服务端注入习惯，**仅适用于 INSERT 且该表授权列含 owner_id 的直写表**：

- payload 缺省 owner_id → **自动注入当前真实登录用户 sub**（调用方原对象不被污染，内部拷贝后注入）；
- 未登录且缺省 → `unauthenticated` 拒绝且零请求；
- 显式传入 owner_id ≠ 当前 sub → `owner_mismatch` 拒绝（**绝不悄悄覆盖**，不允许页面指定他人身份）；
- 该操作列授权不含 owner_id（如各表 UPDATE）→ 维持 `column_forbidden`，不注入；
- **RPC 参数一律原样透传，不注入**；
- profiles（无 INSERT）/ rewards（仅 SELECT）禁直写规则不变；
- 客户端校验仅为前置防线，最终安全边界仍是数据库 RLS（后端权限/RLS 零改动）。

### 业务映射

`createSpace / joinSpace / dissolveSpace / createReward` 固定走对应 RPC
（profiles 无 INSERT 授权、rewards 仅 SELECT，已按克隆库实测列级授权约束）。

## 安全设计

1. **白名单**：表级能力矩阵（6 表 select/insert/update/remove）+ RPC 白名单（9 个）+
   列级校验（镜像克隆库 GRANT）+ 必填列前置校验（records: space_id/record_date/weight）。
2. **owner_id 强制取当前登录用户 sub**：payload 中 owner_id ≠ `auth.getUserId()` 即拒绝
   （`owner_mismatch`），不信任页面传值。
3. **无密钥**：不携带 service_role / 数据库密码 / JWT 签名密钥。
4. **日志脱敏**：`safeLog` 默认关闭，开启后也永不输出 Authorization / token / refresh_token。
5. **回环限定**：authUrl/restUrl 仅允许本机 http 回环，防配置注入远程地址。

## 会话失效的三层边界（13-H-2A-FIX 明确声明）

本适配层的竞态修复**只保证前端本地状态安全**，三层语义必须区分：

1. **前端本地会话失效（本层实现）**：signOut 调用开始即 sessionGen 递增 + 内存会话清空；
   迟到的刷新结果（无论 200 还是失败）一律作废，绝不重建/覆盖/清除会话。
2. **GoTrue 服务端 session / refresh_token 撤销（服务端行为）**：/logout 2xx 表示服务端已撤销；
   撤销失败（HTTP 非 2xx 或网络错误）时服务端状态未知，页面需按 serverRevoked=false 复核。
3. **已签发 JWT 的剩余有效期（协议固有）**：PostgREST 仅做 JWT 验签与 role 解析，**不查询会话表**。
   即使服务端已撤销 session，签名有效的 access_token 在 `exp` 之前仍可能被 PostgREST 接受。

**本适配层不实现、也不声称实现 JWT 即时撤销机制**（那需要 GoTrue/PostgREST 侧的
claims 演进或 token 黑名单方案，属后续独立设计）。缓解措施：JWT 过期时间 3600s 内可控，
前端本地状态已保证用户视角的"已登出"。

## 错误码约定

错误为真实 `Error` 实例，`message` 以 code 为前缀，`code` / `details` 挂在 Error 属性上：
`unauthenticated` / `permission_denied` / `schema_mismatch` / `invalid_jwt`（PGRST301，优先于 401）/
`table_forbidden` / `operation_forbidden` / `column_forbidden` / `missing_required` /
`owner_mismatch` / `rpc_forbidden` / `config_missing` / `config_invalid` / `mode_mismatch` /
`unsupported` / `otp_request_failed` / `refresh_failed`（服务端明确拒绝，代数未变）/
`refresh_network_failed`（网络层失败）/ `refresh_stale_after_logout`（迟到的刷新结果：会话已登出或更换）/
`no_session` / `logout_http_failed` / `logout_network_failed` /
`bad_request`（含非法过滤字段名/排序列名）。所有守卫失败均以 **rejected Promise** 形式
返回（不同步 throw），页面可统一 `.catch()`。

## ⚠ 未实测项（真实栈验证属后续授权范围）

- **13-H-2A-FIX 竞态修复后的真实栈复测**：sessionGen 语义已由 41 项确定性 Mock 覆盖，
  但真实 GoTrue + 真实浏览器的交错行为（含 2A 报告 H 节的延迟 route 方法）未重跑。
- 真实栈已验证项（13-H-2A）：OTP 登录、createSpace/profiles/records 全链路、owner_id 注入、
  刷新轮换、并发去重、正常登出、CORS——**修复未触及这些路径的请求构造**，但严格意义上
  需回归复测后才能升级为真实 HTTP PASS。

## 契约来源

全部 HTTP 契约与列级授权来自 13-G-2C-1/2/3 三轮真实栈实测（见
`~/PactFit-local-supabase/design/notes/` 各轮报告）与 `backend/contract/endpoints.yaml`
（既有 37 处 SDK 调用点机器可读契约）。
