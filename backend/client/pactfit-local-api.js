/* =============================================================================
 * PactFit · 本地后端适配层（GoTrue + PostgREST）
 * -----------------------------------------------------------------------------
 * 用途 : 为 web/index.html 单文件 SPA 提供可切换的 local 后端客户端。
 *        cloud 模式 = 现有 WorkBuddy Cloud SDK（默认，本文件不接管页面）。
 *        local 模式 = 自托管 GoTrue(:9999) + PostgREST(:3000)，仅限本机回环。
 * 契约 : 全部依据 13-G-2C-1/2/3 已实测的 v2.197.0 HTTP 契约与列级授权。
 * 安全 : 不携带 service_role / 数据库密码 / JWT 签名密钥；不输出 token 到日志；
 *        会话仅存内存；sessionGen 会话代数保证登出/换会话后旧异步结果一律作废
 *        （13-H-2A-FIX）；JWT 在 exp 前服务端仍验签有效，本层不实现即时撤销（见 README）。
 * 依赖 : 无（浏览器原生 fetch / Node 18+ 全局 fetch 均可运行）。
 * ============================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PactFitLocalApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 常量与白名单（镜像克隆库实际 GRANT / 已实测 RPC）                     */
  /* ------------------------------------------------------------------ */

  var RPC_ALLOWLIST = [
    'rpc_space_peek',
    'rpc_create_space',
    'rpc_join_space',
    'rpc_leave_space',
    'rpc_dissolve_space',
    'rpc_reward_create',
    'rpc_reward_mark_pending',
    'rpc_reward_redeem',
    'rpc_reward_delete'
  ];

  /* 表级能力矩阵：select / insert 列 / update 列 / delete 是否允许 */
  var TABLE_MATRIX = {
    profiles: {
      select: true,
      insert: null, /* profiles 无 INSERT 授权——必须走 rpc_create_space / rpc_join_space */
      update: ['nickname', 'owner_name', 'role', 'start_weight', 'target_weight'],
      remove: false
    },
    records: {
      select: true,
      insert: ['owner_id', 'owner_name', 'space_id', 'record_date', 'weight', 'tags', 'todo_done', 'mood', 'note'],
      requiredInsert: ['space_id', 'record_date', 'weight'],
      update: ['owner_name', 'weight', 'tags', 'todo_done', 'mood', 'note'],
      remove: false
    },
    todos: {
      select: true,
      insert: ['owner_id', 'owner_name', 'space_id', 'text', 'sort'],
      requiredInsert: ['space_id', 'text'],
      update: null, /* todos 无 UPDATE 授权 */
      remove: true
    },
    tags: {
      select: true,
      insert: ['owner_id', 'owner_name', 'space_id', 'text', 'sort'],
      requiredInsert: ['space_id', 'text'],
      update: null, /* tags 无 UPDATE 授权 */
      remove: true
    },
    messages: {
      select: true,
      insert: ['owner_id', 'owner_name', 'space_id', 'text'],
      requiredInsert: ['space_id', 'text'],
      update: null, /* messages 仅 INSERT */
      remove: false
    },
    rewards: {
      select: true,
      insert: null, /* rewards 仅 SELECT——写入必须走 RPC */
      update: null,
      remove: false
    }
  };

  var LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

  /* ------------------------------------------------------------------ */
  /* 工具                                                                */
  /* ------------------------------------------------------------------ */

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /* 统一错误构造：真实 Error 实例（便于 try/catch 与 assert.rejects 正则），
   * message 以 code 为前缀，code/details 挂在 Error 属性上 */
  function err(code, message, details) {
    var e = new Error(code + ': ' + message);
    e.code = code;
    if (details !== undefined) { e.details = details; }
    return e;
  }

  /* 脱敏日志：永不输出 Authorization / token / OTP / 密码 */
  function safeLog() {
    if (!safeLog.enabled) return;
    try {
      console.log.apply(console, ['[pactfit-local]'].concat([].slice.call(arguments)));
    } catch (e) { /* ignore */ }
  }

  function assertLoopback(url, label) {
    var u;
    try {
      u = new URL(url);
    } catch (e) {
      throw err('config_invalid', label + ' 地址无法解析: ' + url);
    }
    if (u.protocol !== 'http:') {
      throw err('config_invalid', label + ' 仅允许本机 http 回环地址');
    }
    if (LOOPBACK_HOSTS.indexOf(u.hostname) === -1) {
      throw err('config_invalid', label + ' 拒绝非回环主机: ' + u.hostname + '（防配置注入远程地址）');
    }
    return u.origin;
  }

  function hasEqFilter(filter) {
    return isPlainObject(filter) && Object.keys(filter).length > 0 &&
      Object.keys(filter).every(function (k) { return typeof k === 'string' && k.length > 0; });
  }

  /* ------------------------------------------------------------------ */
  /* GoTrue Auth 客户端（内存会话）                                       */
  /* ------------------------------------------------------------------ */

  function createAuth(fetchImpl, cfg) {
    var session = null; /* 仅内存：{access_token, refresh_token, user:{id,...}, expires_at} */
    var sessionGen = 0; /* 会话代数：setSession/signOut 均递增；旧代异步结果一律作废 */
    var refreshInFlight = null; /* 并发刷新去重标记 */
    var refreshInFlightGen = 0; /* 在途刷新归属的会话代数（按代去重，防跨会话误复用） */

    function ensureLocal() {
      if (cfg.mode !== 'local') {
        throw err('mode_mismatch', 'Auth 客户端仅在 local 模式可用（当前 mode=' + cfg.mode + '）');
      }
    }

    function base() { return cfg.authUrl; }

    function http(method, path, body, headers) {
      var h = { 'Content-Type': 'application/json' };
      if (cfg.publicKey) h.apikey = cfg.publicKey;
      if (headers) { Object.keys(headers).forEach(function (k) { h[k] = headers[k]; }); }
      return fetchImpl(base() + path, {
        method: method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body)
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          return { status: res.status, ok: res.ok, data: data };
        });
      });
    }

    function setSession(d) {
      if (!d || !d.access_token || !d.user) {
        throw err('session_invalid', '认证响应缺少 access_token 或 user');
      }
      session = {
        access_token: d.access_token,
        refresh_token: d.refresh_token || null,
        user: { id: d.user.id, email: d.user.email || null },
        expires_at: d.expires_at || null
      };
      sessionGen++; /* 新会话代数：使所有旧代在途异步结果失效 */
      return session;
    }

    return {
      // Validate implicit email callbacks against this project's Auth before accepting the session.
      consumeCallback: function (hash) {
        if (!cfg.publicKey) return Promise.resolve(false);
        var params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
        if (params.has('error')) return Promise.reject(err('auth_callback_failed', '登录链接无效或已过期，请重新发送'));
        var myGen = sessionGen;
        var access = params.get('access_token');
        if (!access) return Promise.resolve(false);
        return http('GET', '/user', undefined, { Authorization: 'Bearer ' + access }).then(function (r) {
          if (!r.ok || !r.data || !r.data.id) throw err('auth_callback_failed', '登录链接验证失败');
          if (myGen !== sessionGen) throw err('session_stale', '登录状态已变更');
          setSession({ access_token: access, refresh_token: params.get('refresh_token'), user: r.data });
          return true;
        });
      },

      /* 手机号登录：自托管 GoTrue 未配置 SMS provider，明确不支持（不伪装成功） */
      requestPhoneOtp: function () {
        return Promise.reject(err('unsupported',
          '本地后端未实现手机号登录（GoTrue 无 SMS provider）；请使用邮箱登录'));
      },

      /* 请求邮箱 OTP —— POST /otp {email, create_user}（已实测契约） */
      requestEmailOtp: function (email) {
        ensureLocal();
        if (!email || typeof email !== 'string' || email.indexOf('@') < 1) {
          return Promise.reject(err('bad_request', '邮箱格式不正确'));
        }
        return http('POST', '/otp' + (cfg.redirectUrl ? '?redirect_to=' + encodeURIComponent(cfg.redirectUrl) : ''), { email: email, create_user: true })
          .then(function (r) {
            if (r.status !== 200) {
              var msg = r.data && r.data.msg ? r.data.msg : ('OTP 请求失败 HTTP ' + r.status);
              return Promise.reject(err('otp_request_failed', msg, r.data));
            }
            safeLog('email otp requested (邮件内容请查 Mailpit)');
            return { data: { sent: true }, error: null };
          });
      },

      /*
       * 验证 OTP —— POST /verify（已实测契约）:
       *   type='signup'    → { type:'signup',    token_hash }（注册确认链接）
       *   type='magiclink' → { type:'magiclink', token_hash }（后续登录链接）
       *   6 位码形态       → { type:'signup'|'magiclink', email, token }（需自定义邮件模板）
       * 成功签发 {access_token, refresh_token, user}，存入内存会话。
       */
      verifyEmailOtp: function (args) {
        ensureLocal();
        if (!isPlainObject(args)) {
          return Promise.reject(err('bad_request', 'verifyEmailOtp 需要 {token_hash} 或 {email, token}'));
        }
        var payload;
        if (args.token_hash) {
          payload = { type: args.type || 'signup', token_hash: args.token_hash };
          if (args.email) {
            return Promise.reject(err('bad_request', 'token_hash 模式不可附带 email（PostgREST/GoTrue 契约）'));
          }
        } else if (args.email && args.token) {
          payload = { type: args.type || 'magiclink', email: args.email, token: String(args.token) };
        } else {
          return Promise.reject(err('bad_request', '需要 token_hash 或 (email + token)'));
        }
        return http('POST', '/verify', payload)
          .then(function (r) {
            if (r.status !== 200) {
              var code = r.data && r.data.error_code ? r.data.error_code : 'verify_failed';
              var msg = r.data && r.data.msg ? r.data.msg : ('验证失败 HTTP ' + r.status);
              return Promise.reject(err(code, msg, r.data));
            }
            var s = setSession(r.data);
            safeLog('session established for user', s.user.id);
            return { data: { session: s }, error: null };
          });
      },

      /* 内存会话读取 */
      getSession: function () {
        ensureLocal();
        return session
          ? { data: { session: session, user: session.user }, error: null }
          : { data: { session: null, user: null }, error: null };
      },

      getAccessToken: function () {
        return session ? session.access_token : null;
      },

      getUserId: function () {
        return session ? session.user.id : null;
      },

      /*
       * 刷新会话 —— POST /token grant_type=refresh_token。
       * ⚠ 真实栈行为已在 13-H-2A 验证（轮换/role/并发去重）；**本轮竞态修复后**的行为
       *   尚未在真实栈复测（见 README 未实测项）。
       * 失败与竞态语义（sessionGen 会话代数判定）：
       *   - HTTP 非 200 且代数未变 → refresh_failed，清会话；
       *   - 网络层失败且代数未变 → refresh_network_failed，保守清会话；
       *   - 结果到达时代数已变（已登出/已换新会话）→ 丢弃该结果：
       *     200 → refresh_stale_after_logout（绝不 setSession、绝不恢复 token、
       *           绝不清除新会话；token 不进日志）；
       *     失败 → 保留 refresh_failed / refresh_network_failed 原分类，但不清会话。
       * 并发保护：refreshInFlight + refreshInFlightGen **按会话代数**去重——
       *   同一会话内并发刷新复用同一 Promise（单次 HTTP）；signOut/换新会话后
       *   新刷新不被旧在途请求阻塞；旧请求 finally 仅在仍持有去重位时清空。
       * 不实现自动重试。
       */
      refreshSession: function (fetchImplRef) {
        ensureLocal();
        if (refreshInFlight && refreshInFlightGen === sessionGen) {
          return refreshInFlight; /* 同一会话内并发去重 */
        }
        if (!session || !session.refresh_token) {
          return Promise.reject(err('no_session', '无可刷新的会话'));
        }
        var f = fetchImplRef || fetchImpl;
        var myGen = sessionGen; /* 本请求归属的会话代数 */
        refreshInFlightGen = myGen;
        var p = f(base() + '/token?grant_type=refresh_token', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, cfg.publicKey ? { apikey: cfg.publicKey } : {}),
          body: JSON.stringify({ refresh_token: session.refresh_token })
        }).then(function (res) {
          return res.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e2) { data = null; }
            return { status: res.status, data: data };
          });
        }).then(function (r) {
          if (r.status === 200 && r.data && r.data.access_token) {
            if (sessionGen !== myGen) {
              /* 迟到的成功结果：会话已登出/已更换——丢弃，不恢复任何状态 */
              throw err('refresh_stale_after_logout',
                '会话已登出或更换，迟到的刷新结果已丢弃（不恢复任何 token）');
            }
            var s = setSession(r.data);
            safeLog('session refreshed for user', s.user.id);
            return { data: { session: s }, error: null };
          }
          /* HTTP 明确拒绝：仅当仍归属当前会话时才清本地会话 */
          if (sessionGen === myGen) { session = null; }
          throw err('refresh_failed',
            '服务端拒绝会话刷新（HTTP ' + r.status + '）' +
            (sessionGen !== myGen ? '（会话已变更，未影响当前会话）' : '，已清除本地会话'));
        }).catch(function (e) {
          if (e && (e.code === 'refresh_stale_after_logout' || e.code === 'refresh_failed')) { throw e; }
          /* 网络层失败（含 200 但响应损坏）：状态未知 */
          if (sessionGen !== myGen) {
            /* 旧请求失败但会话已变更：保留分类，不清除当前（新）会话 */
            throw err('refresh_network_failed',
              '迟到的刷新网络失败（会话已变更，未影响当前会话）');
          }
          session = null;
          throw err('refresh_network_failed',
            '会话刷新网络请求失败（服务端响应未知），已保守清除本地会话');
        });
        var q = p.finally(function () {
          /* 仅当去重位仍属于本请求时清空——旧请求的 finally 不误清新请求 */
          if (refreshInFlight === q) { refreshInFlight = null; }
        });
        refreshInFlight = q;
        return q;
      },

      /*
       * 登出 —— POST /logout（Bearer）。
       * 竞态语义（13-H-2A-FIX）：**调用开始即同步生效**——sessionGen 递增使旧代全部
       * 异步结果（含在途刷新）作废 + 本地会话立即清空（后续数据请求无法再取得旧
       * access_token）；不等 /logout 返回。服务端 /logout 使用调用开始时安全捕获的
       * 旧 token 撤销，仅用于 serverRevoked 判定。
       * 结果（保留 {data,error} 风格）：
       *   data.localCleared  —— 本地会话已清理（恒 true）
       *   data.serverRevoked —— 服务端 /logout 确认成功（仅 2xx 为 true）
       *   error              —— 服务端拒绝(logout_http_failed)或网络失败(logout_network_failed)
       * 不输出旧 token；不自动恢复会话。
       */
      signOut: function () {
        ensureLocal();
        if (!session) {
          sessionGen++; // also invalidate callbacks before the first session
          return Promise.resolve({
            data: { signedOut: false, localCleared: true, serverRevoked: false, reason: 'no_session' },
            error: null
          });
        }
        var captured = session; /* 仅供 /logout Bearer 使用，不再进入任何本地状态 */
        sessionGen++;           /* 立即失效旧会话代数 */
        session = null;         /* 立即清理本地登录状态 */
        return http('POST', '/logout', undefined, { Authorization: 'Bearer ' + captured.access_token })
          .then(function (r) {
            if (r.status >= 200 && r.status < 300) {
              return { serverRevoked: true, error: null };
            }
            return { serverRevoked: false, error: err('logout_http_failed',
              '服务端登出未确认（HTTP ' + r.status + '）；本地会话已清理，但服务端撤销状态需复核') };
          })
          .catch(function () {
            return { serverRevoked: false, error: err('logout_network_failed',
              '登出网络请求失败（服务端撤销状态未知）；本地会话已清理') };
          })
          .then(function (out) {
            return {
              data: { signedOut: true, localCleared: true, serverRevoked: out.serverRevoked },
              error: out.error
            };
          });
      },

      _clearSessionForTest: function () { session = null; },
      _setSessionForTest: function (d) { setSession(d); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* PostgREST 数据客户端（白名单 + {data,error} 信封）                    */
  /* ------------------------------------------------------------------ */

  function createDb(fetchImpl, cfg, auth) {
    function ensureLocal() {
      if (cfg.mode !== 'local') {
        throw err('mode_mismatch', '数据客户端仅在 local 模式可用');
      }
    }
    function token() {
      var t = auth.getAccessToken();
      if (!t) throw err('unauthenticated', '未登录：authenticated 操作需要先完成 OTP 验证');
      return t;
    }
    function base() { return cfg.restUrl; }

    function request(method, path, body, preferRepresentation) {
      var t;
      try { t = token(); } catch (e) { return Promise.reject(e); } /* 未登录：统一走 Promise 拒绝 */
      var h = { 'Content-Type': 'application/json' };
      if (cfg.publicKey) h.apikey = cfg.publicKey;
      h['Authorization'] = 'Bearer ' + t;
      if (preferRepresentation) h['Prefer'] = 'return=representation';
      return fetchImpl(base() + path, {
        method: method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body)
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          return { status: res.status, ok: res.ok, data: data };
        });
      }).then(function (r) {
        /* 统一 HTTP 错误映射（PostgREST 16 实测行为） */
        if (!r.ok) {
          var d = r.data || {};
          var code = d.code || ('http_' + r.status);
          var mapped = code;
          if (code === 'PGRST301') mapped = 'invalid_jwt';         /* JWT 失效/签名错误（优先于 401） */
          else if (r.status === 401) mapped = 'unauthenticated';   /* 坏/缺 JWT、anon 权限拒绝 */
          else if (r.status === 403) mapped = 'permission_denied'; /* RLS WITH CHECK / 授权拒绝 */
          else if (r.status === 406) mapped = 'schema_mismatch';   /* Accept-Profile / 表示协商失败 */
          safeLog('http error', r.status, code);
          return Promise.reject(err(mapped, d.message || ('HTTP ' + r.status), d));
        }
        return r;
      });
    }

  /* 查询参数白名单：字段名必须为合法标识符，且不得为 PostgREST 结构性保留参数
   * （select/order/limit/or 等只应由本适配层自己构造，禁止来自页面过滤条件） */
  var IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  var RESERVED_PARAMS = [
    'select', 'order', 'limit', 'offset', 'or', 'and', 'not', 'on_conflict',
    'columns', 'accept-profile', 'content-profile', 'range', 'range-unit',
    'authorization', 'prefer'
  ];

  function validFieldName(name) {
    return typeof name === 'string' && IDENT_RE.test(name) &&
      RESERVED_PARAMS.indexOf(name.toLowerCase()) === -1;
  }

  /*
   * buildQuery —— 使用 URLSearchParams 标准编码（等效于 URL 标准转义）：
   *   - 过滤值统一走 eq. 语义（'eq.' 前缀拼接后整体编码，PostgREST 解码后语义不变）
   *   - 中文/空格/&/#/?/等号 等特殊字符全部被编码，不会破坏查询结构
   *   - '+' 统一替换为 %20，避免 PostgREST 解析差异
   *   - 字段名/排序列名经 validFieldName 白名单校验，非法即抛 bad_request
   */
  function buildQuery(filters, order) {
    var qs = new URLSearchParams();
    if (isPlainObject(filters)) {
      Object.keys(filters).forEach(function (k) {
        if (!validFieldName(k)) {
          throw err('bad_request', '非法过滤字段名: ' + k + '（仅允许标识符，且不得为 PostgREST 保留参数）');
        }
        qs.append(k, 'eq.' + String(filters[k]));
      });
    }
    if (order && order.column) {
      if (!validFieldName(order.column)) {
        throw err('bad_request', '非法排序列名: ' + order.column);
      }
      qs.append('order', order.column + (order.ascending === false ? '.desc' : '.asc'));
      if (order.then) {
        if (!validFieldName(order.then.column)) {
          throw err('bad_request', '非法排序列名: ' + order.then.column);
        }
        qs.append('order', order.then.column + (order.then.ascending === false ? '.desc' : '.asc'));
      }
    }
    var s = qs.toString().replace(/\+/g, '%20');
    return s ? '?' + s : '';
  }

    function guardPayload(table, op, payload, session) {
      var rule = TABLE_MATRIX[table];
      if (!rule) throw err('table_forbidden', '未授权的表: ' + table);
      var allowed = op === 'insert' ? rule.insert : rule.update;
      if (!allowed) {
        var hint = table === 'profiles'
          ? 'profiles 不允许客户端直接插入——请使用 createSpace() / joinSpace()（走 rpc_create_space / rpc_join_space）'
          : (table === 'rewards'
            ? 'rewards 仅允许 SELECT——写入请使用 createReward()/markPending()/redeemReward()/deleteReward()（走 reward RPC）'
            : (op === 'update' ? '该表无 UPDATE 授权' : '该表不允许 ' + op));
        throw err('operation_forbidden', hint);
      }
      var keys = Object.keys(payload);
      var bad = keys.filter(function (k) { return allowed.indexOf(k) === -1; });
      if (bad.length) {
        throw err('column_forbidden', table + ' ' + op + ' 不允许列: ' + bad.join(',') + '（允许: ' + allowed.join(',') + '）');
      }
      /* owner_id 统一规则（仅适用于 INSERT 且该表授权含 owner_id 的直写表）：
       *   - 缺省时自动注入当前真实登录用户 sub（对齐旧 Cloud SDK 的服务端注入习惯）；
       *   - 未登录且缺省 → unauthenticated；
       *   - 显式传入但 ≠ 当前 sub → owner_mismatch（拒绝，绝不悄悄覆盖）；
       *   - 该表/操作不含 owner_id（如各表 UPDATE）→ 维持 column_forbidden，不注入；
       *   - RPC 参数一律不注入；profiles/rewards 禁直写规则不变。
       *   客户端校验仅为前置防线，最终安全边界仍是数据库 RLS。 */
      if (allowed.indexOf('owner_id') !== -1) {
        var sub = auth.getUserId();
        if (keys.indexOf('owner_id') === -1 || payload.owner_id === undefined || payload.owner_id === null) {
          if (!sub) {
            throw err('unauthenticated', '未登录且缺少 owner_id：请先完成 OTP 验证');
          }
          payload.owner_id = sub; /* 自动注入当前真实用户 */
        } else if (payload.owner_id !== sub) {
          throw err('owner_mismatch', 'owner_id 必须为当前登录用户（' + sub + '），已拒绝伪造值');
        }
      }
      /* 必填列前置校验（records: record_date + weight） */
      if (op === 'insert' && rule.requiredInsert) {
        var missing = rule.requiredInsert.filter(function (k) {
          return payload[k] === undefined || payload[k] === null || payload[k] === '';
        });
        if (missing.length) {
          throw err('missing_required', table + ' 缺少必填列: ' + missing.join(','));
        }
      }
      return payload;
    }

    return {
      /* SELECT —— GET /table?col=eq.v&order=...（字段名白名单校验失败 → bad_request） */
      select: function (table, filters, order) {
        ensureLocal();
        var rule = TABLE_MATRIX[table];
        if (!rule || !rule.select) {
          return Promise.reject(err('table_forbidden', '未授权的表: ' + table));
        }
        var path;
        try { path = '/' + table + buildQuery(filters, order); } catch (e) { return Promise.reject(e); }
        return request('GET', path)
          .then(function (r) { return { data: Array.isArray(r.data) ? r.data : [], error: null }; });
      },

      /* INSERT —— POST /table（Prefer return=representation 回读整行）。
       * owner_id 自动注入会修改 payload，先浅拷贝避免污染调用方对象。 */
      insert: function (table, payload) {
        ensureLocal();
        payload = Object.assign({}, payload);
        try { guardPayload(table, 'insert', payload); } catch (e) { return Promise.reject(e); }
        return request('POST', '/' + table, payload, true)
          .then(function (r) {
            return { data: Array.isArray(r.data) ? r.data : [r.data], error: null };
          });
      },

      /*
       * UPDATE —— PATCH /table?filter（Prefer return=representation）。
       * ⚠ PATCH 204 可能实际更新零行（RLS using() 过滤，实测行为）。
       * 返回 {data:<回读行数组>, meta:{updated:N}}——updated=0 即越权或不存在，
       * 页面必须检查 updated，不得把 204 视为成功修改。
       */
      update: function (table, payload, filter) {
        ensureLocal();
        if (!hasEqFilter(filter)) {
          return Promise.reject(err('bad_request', 'update 必须携带明确过滤条件（如 {id: ...}）'));
        }
        try { guardPayload(table, 'update', payload); } catch (e) { return Promise.reject(e); }
        var path;
        try { path = '/' + table + buildQuery(filter); } catch (e) { return Promise.reject(e); }
        return request('PATCH', path, payload, true)
          .then(function (r) {
            var rows = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
            return { data: rows, error: null, meta: { updated: rows.length } };
          });
      },

      /* DELETE —— DELETE /table?filter（必须带过滤条件；仅 todos/tags 授权） */
      remove: function (table, filter) {
        ensureLocal();
        var rule = TABLE_MATRIX[table];
        if (!rule || !rule.remove) {
          return Promise.reject(err('operation_forbidden', '该表不允许客户端删除: ' + table));
        }
        if (!hasEqFilter(filter)) {
          return Promise.reject(err('bad_request', 'delete 必须携带明确过滤条件'));
        }
        var path;
        try { path = '/' + table + buildQuery(filter); } catch (e) { return Promise.reject(e); }
        return request('DELETE', path)
          .then(function (r) { return { data: [], error: null }; });
      },

      /*
       * RPC —— POST /rpc/<name>。
       * 仅允许 RPC_ALLOWLIST 内的函数；返回原始业务信封（HTTP 200 + {ok:false,code}
       * 属业务拒绝，本层不做二次包装——data.ok 由页面判断）。
       */
      rpc: function (name, params) {
        ensureLocal();
        if (RPC_ALLOWLIST.indexOf(name) === -1) {
          return Promise.reject(err('rpc_forbidden', '未授权的 RPC: ' + name));
        }
        return request('POST', '/rpc/' + name, params || {})
          .then(function (r) {
            return { data: r.data, error: null };
          });
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 工厂与业务映射（对齐 endpoints.yaml 的迁移路径）                      */
  /* ------------------------------------------------------------------ */

  function createLocalBackend(config, fetchImpl) {
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) throw err('no_fetch', '运行环境缺少 fetch（需要浏览器或 Node 18+）');

    var mode = config && typeof config.mode === 'string' ? config.mode : 'cloud';
    if (mode !== 'cloud' && mode !== 'local' && mode !== 'staging') {
      throw err('config_invalid', 'mode 仅允许 cloud | local | staging');
    }

    if (mode === 'cloud') {
      /* cloud 模式：本适配层不接管任何请求，页面继续使用 WorkBuddy Cloud SDK */
      return { mode: 'cloud', auth: null, db: null, createSpace: null, joinSpace: null };
    }

    /* local 模式：必须显式提供两个地址，缺失即报错（绝不静默回退云端） */
    if (mode === 'local' && (!config.authUrl || !config.restUrl)) {
      throw err('config_missing',
        'local 模式需要显式 authUrl（GoTrue）与 restUrl（PostgREST）——缺失时禁止回退到云端');
    }
    var cfg;
    if (mode === 'staging') {
      var u;
      try { u = new URL(config.supabaseUrl); } catch (e) { throw err('config_invalid', 'Supabase URL 无效'); }
      if (u.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname) ||
          u.username || u.password || u.search || u.hash || u.port || !/^\/(?:rest\/v1\/?)?$/.test(u.pathname)) {
        throw err('config_invalid', 'staging 必须使用精确的 Supabase HTTPS 项目地址');
      }
      var key = config.publicKey || '';
      var publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
      if (!publicKey) {
        try {
          var payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          publicKey = payload.role === 'anon';
        } catch (e) {}
      }
      if (!publicKey) throw err('config_invalid', '只接受 publishable / anon 公开客户端密钥');
      var redirect;
      try { redirect = new URL(config.redirectUrl); } catch (e) { throw err('config_invalid', '认证回调地址缺失'); }
      if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/') {
        throw err('config_invalid', '认证回调必须是 HTTPS 站点根地址');
      }
      cfg = { mode: 'local', authUrl: u.origin + '/auth/v1', restUrl: u.origin + '/rest/v1', publicKey: key, redirectUrl: redirect.href };
    } else {
      cfg = { mode: 'local', authUrl: assertLoopback(config.authUrl, 'authUrl'), restUrl: assertLoopback(config.restUrl, 'restUrl') };
    }

    var auth = createAuth(f, cfg);
    var db = createDb(f, cfg, auth);

    /* 业务映射：profiles.insert 不可用 → 建/加空间固定走 RPC。
     * 业务拒绝信封（HTTP 200 + {ok:false,code}）原样透传：error=null、
     * data.ok=false，由页面按 data.code 分支（本层不做二次包装）。 */
    function createSpace(args) {
      return db.rpc('rpc_create_space', {
        p_nickname: args.nickname,
        p_role: args.role || 'her',
        p_start_weight: args.startWeight,
        p_target_weight: args.targetWeight
      });
    }

    function joinSpace(args) {
      return db.rpc('rpc_join_space', {
        p_code: args.code,
        p_nickname: args.nickname,
        p_role: args.role || 'her',
        p_start_weight: args.startWeight,
        p_target_weight: args.targetWeight
      });
    }

    function dissolveSpace(code) {
      return db.rpc('rpc_dissolve_space', { p_code: code });
    }

    /* 奖励四件套（rewards 表仅 SELECT，写入固定走 RPC） */
    function createReward(args) {
      return db.rpc('rpc_reward_create', {
        p_code: args.spaceCode,
        p_owner: args.owner,
        p_prize: args.prize,
        p_condition: args.condition,
        p_target_weight: args.targetWeight == null ? null : args.targetWeight
      });
    }

    return {
      mode: 'local',
      auth: auth,
      db: db,
      createSpace: createSpace,
      joinSpace: joinSpace,
      dissolveSpace: dissolveSpace,
      createReward: createReward,
      allowlist: { tables: TABLE_MATRIX, rpc: RPC_ALLOWLIST }
    };
  }

  safeLog.enabled = false;
  safeLog.enable = function () { safeLog.enabled = true; };

  return {
    createLocalBackend: createLocalBackend,
    RPC_ALLOWLIST: RPC_ALLOWLIST,
    TABLE_MATRIX: TABLE_MATRIX,
    _internal: { assertLoopback: assertLoopback, err: err, safeLog: safeLog }
  };
});
