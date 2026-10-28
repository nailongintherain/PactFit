# 02 · 后端接口契约（从前端 37 处调用点逐条提取）

## 0. 信封与语义

所有 SDK 调用返回统一信封：

```js
{ data: <结果>, error: <错误对象 | null> }
```

前端统一用 `unwrap()` 解包（`index.html:674`）：`error` 存在就 `throw`，否则取 `data`。

三个必须复刻的隐藏语义：

1. **写入后的 `.select()` 会回读整行**，包括服务端注入的字段。少了它，`insert` 返回空，前端拿不到新行。
2. **`owner_id` 前端从不传**，由服务端在插入时注入当前登录用户 id。
3. **`.eq()` 只是过滤条件，真正的边界由 RLS 决定**——前端能读到哪些行，完全取决于服务端策略。

## 1. 查询构造器实际用到的能力面

| 方法 | 用到的参数形态 |
|---|---|
| `.select()` | 只用 `'*'`，无列裁剪、无 join、无嵌套 |
| `.order(col)` | 单列升序，可链式调用两次（`sort` 再 `id`） |
| `.eq(col, val)` | 单条件，无 `or/in/like/range` |
| `.insert(obj)` | 单条对象，无批量数组 |
| `.update(obj)` | 部分字段 |
| `.delete()` | 无参数，必须配 `.eq()` |
| `.rpc(name, params)` | 仅 `space_peek` |

> 迁移时 shim 只需要实现这张表，不需要通用 ORM。

## 2. profiles（成员档案，一个空间一人一行）

| # | 行号 | 操作 | 字段 |
|---|---|---|---|
| 1 | 680 | `select('*').order('id')` | 读全部可见成员 |
| 2 | 1822 | `insert().select()` | `owner_name`, `space_id`, `nickname`, `role:'her'`, `start_weight`, `target_weight` |
| 3 | 1517 | `update().eq('id')` | `nickname`, `start_weight`, `target_weight` |
| 4 | 1851 | `update().eq('id')` | `role:'him'`（后来加入者自动转色） |

要点：`select` 不带 `.eq('space_id')`，是**故意拉全量**再在前端按 `space_id` 分组的（一个用户可能属于多个组）。所以 RLS 必须允许"我所在的所有空间"的成员行一次性返回。

## 3. records（每日记录，核心表）

| # | 行号 | 操作 | 字段 |
|---|---|---|---|
| 5 | 703 | `select('*').order('record_date')` | 读全部可记录 |
| 6 | 1298 | `update().eq('id')` | `todo_done` |
| 7 | 1303 | `insert().select()` | `owner_name`, `space_id`, `record_date`, `weight`, `todo_done` |
| 8 | 1326 | `update().eq('id')` | `weight`, `tags`, `todo_done`, `mood`, `note` |
| 9 | 1331 | `insert().select()` | 同上 + `owner_name`, `space_id`, `record_date` |
| 10 | 1358 | `update().eq('id')` | `weight`, `tags`, `mood`（跨组镜像当日体重） |
| 11 | 1360 | `insert().select()` | `owner_name`, `space_id`, `record_date`, `weight`, `tags`, `todo_done:[]`, `mood` |
| 12 | 1528 | `update().eq('owner_id', uid)` | `owner_name`（改昵称后回刷历史，fire-and-forget，失败忽略） |

要点：**同一个人在不同 `space_id` 下有多条同日记录**，由 `mirrorToday()` 主动复制。`record_date` 是"日"粒度，前端用 `String(x).slice(0,10)` 比较，说明服务端可能返回带时间的字符串。

## 4. todos / tags（空间共享的小目标与标签）

| # | 行号 | 操作 | 字段 |
|---|---|---|---|
| 13 | 704 | `todos.select('*').order('sort').order('id')` | — |
| 14 | 1535 | `todos.insert().select()` | `owner_name`, `space_id`, `text`(≤40 字), `sort` |
| 15 | 1543 | `todos.delete().eq('id')` | — |
| 16 | 1832 | `todos.select('*')` | 判断该空间是否已有默认项 |
| 17 | 1838 | `todos.insert()` | 默认 3 条：喝水 2L / 晚上不吃主食 / 一起走 8000 步 |
| 18 | 705 | `tags.select('*').order('sort').order('id')` | — |
| 19 | 1550 | `tags.insert().select()` | `owner_name`, `space_id`, `text`(≤20 字), `sort` |
| 20 | 1558 | `tags.delete().eq('id')` | — |
| 21 | 1567 | `tags.insert()` | 自定义标签顺手入库（fire-and-forget） |
| 22 | 1833 | `tags.select('*')` | 判断默认项是否已铺 |
| 23 | 1844 | `tags.insert()` | 默认 6 条：跑步 30 分钟 / 喝水 2L / 力量训练 / 没吃夜宵 / 步数 1w+ / 戒奶茶 |

要点：这两张表**是空间级共享的**（谁先建空间谁铺默认值，后来者复用），但 `owner_name` 记的是创建者。**删任何一条都按 `id` 直接删**，说明同空间成员的删除权是放开的。

## 5. rewards（约定与兑现）

| # | 行号 | 操作 | 字段 |
|---|---|---|---|
| 24 | 706 | `select('*').order('id')` | — |
| 25 | 1386 | `update().eq('id')` | `status:'done'`, `redeemed_at` |
| 26 | 1393 | `delete().eq('id')` | — |
| 27 | 1411 | `update().eq('id')` | `status:'pending'`, `achieved_at`（达标自动点亮） |
| 28 | 1595 | `insert().select()` | `owner_name`, `space_id`, `condition_text`, `target_weight`, `prize`, `promise_by`, `status:'active'` |

要点（权限上的关键推论）：
- `promise_by` 存的是**对方的 `owner_id`**（下拉框 value 取 `p.owner_id`，`index.html:1580`）。
- 达成奖励的人去点亮"已兑现"，而被点亮的行属于**另一个人**。所以 `rewards` 的 `update` 必须允许**同空间内跨用户**，不能只限本人。
- `status` 三态：`active` → `pending`（达标自动）→ `done`（人工兑现）。

## 6. messages（留言）

| # | 行号 | 操作 | 字段 |
|---|---|---|---|
| 29 | 1373 | `insert().select()` | `owner_name`, `space_id`, `text` |
| 30 | 707 | `select('*').order('id')` | — |

要点：只增不改不删，没有已读状态，没有 `created_at` 的显式排序（靠 `id` 递增）。

## 7. auth（验证码登录）

| # | 行号 | 方法 | 入参 | 出参 |
|---|---|---|---|---|
| 31 | 1637 | `sendOtp` | `{ phone }` | `{ verificationId, isExistingUser }` |
| 32 | 1649 | `sendOtp` | `{ email }` | 同上 |
| 33 | 1664 | `verifyOtp` | `{ phone\|email, verificationId, isExistingUser, token }` | `{ user, session }` |
| 34 | 1671 | `signOut` | — | — |
| 35 | 1680 | `getSession` | — | `{ user: { id } }` |
| 36 | 1941 | `getSession` | — | 同上（启动时静默恢复） |

`verificationId` 是服务端签发的验证码会话句柄，**不是验证码本身**。迁移后如果自建，必须保留这个两段式（发码拿句柄 → 凭句柄+码换 session），否则前端要改。

## 8. rpc

| # | 行号 | 调用 | 入参 | 出参 |
|---|---|---|---|---|
| 37 | 1789 | `database.rpc('space_peek', { code })` | `{ code }`（口令，形如 `FIT-XXXXXX`；此处为格式占位，非真实口令） | `{ count, names[] }` |

用途：加入空间前探测口令是否存在、里面是谁。入参输入 420ms 防抖后自动调用。
**这是唯一一个未登录也能调用的接口**（用户此时还没加入任何空间），必须配合 `docs/07` 风险 6 的频控与返回内容约束使用；相关风险分析仅存私有归档。

## 9. 迁移时需要保持不变的错误语义

前端只依赖 `error.message`（直接显示给用户），不依赖错误码。所以自建后端只需要：

- 失败时返回 `{ data: null, error: { message: '人话' } }`
- 不要抛 HTTP 异常给前端（SDK 层已把异常转成 `error`）

保持这一点，`index.html` 里 30 多处 `toast('保存失败：' + e.message)` 全部不用改。
