/*!
 * PactFit 后端接线层（backend bridge）—— H-2B-1
 * ------------------------------------------------------------------
 * 职责（纯逻辑，无 DOM 依赖，可在 Node 下 Mock 测试）：
 *   1) resolveBackendMode：页面启动时一次性判定 cloud / local
 *      —— 仅回环主机（127.0.0.1 / localhost / ::1）+ 显式开发开关才允许 local；
 *         公网/任意其他来源恒为 cloud；hash 不参与判定。
 *   2) createLocalBridge：local 模式下的最小业务桥（OTP / 链接验证 / 会话 /
 *      profiles / records / 空间 RPC），全部复用 PactFitLocalApi 适配层，
 *      不请求 WorkBuddy Cloud SDK。
 *   3) createSessionGuard：页面级会话代数，防旧异步回调复活已清理的 UI 状态。
 *   4) parseEmailLink：从粘贴的完整邮件链接严格解析 { token_hash, type }
 *      （H-3-M5：signup 首次注册 / magiclink 已有用户登录，类型只取自链接，
 *        歧义一律本地拒绝，token 不落日志、不进错误消息）。
 *   5) WRITE_OUTCOME / classifyWriteError / summarizeMirror / describeSaveOutcome：
 *      H-3-M1M2 写入结果分类（纯函数）。把「写入是否确认」与「写入后的刷新是否
 *      成功」拆成两件事，避免「已落库却报保存失败」「结果未知却断言未写入」。
 * ------------------------------------------------------------------
 * 未适配功能一律抛 unsupported_in_local_mode（明确失败，绝不伪造成功、
 * 绝不回退云端）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PactFitBE = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LOOPBACK_HOSTS = { '127.0.0.1': 1, 'localhost': 1, '::1': 1, '[::1]': 1 };

  /* local 模式未适配的能力（供页面做「本地模式暂不支持」提示） */
  var UNSUPPORTED_FEATURES = [
    'phone-login',   /* 手机号登录：GoTrue 本地无 SMS provider */
    'todos',         /* 小目标 */
    'tags',          /* 标签 */
    'rewards',       /* 奖励 */
    'messages',      /* 留言 */
    'space-peek',    /* 口令探测 */
    'install-pack'   /* 非核心设置类操作 */
  ];

  function beErr(code, message) {
    var e = new Error(code + ': ' + message);
    e.code = code;
    return e;
  }

  /* 模式判定（页面启动时一次确定，之后不再变）
   * opt = { hostname, search, storageFlag }
   *   storageFlag：localStorage['pactfit_local_dev'] === '1' 的结果
   * 返回 'cloud' | 'local'
   */
  function resolveBackendMode(opt) {
    opt = opt || {};
    var host = String(opt.hostname || '').toLowerCase();
    var search = String(opt.search || '');
    var loopback = !!LOOPBACK_HOSTS[host];
    if (!loopback) return 'cloud';           /* 非回环来源：永远 cloud */
    var m = /[?&]local=([^&#]*)/.exec(search);
    var flag = !!(m && m[1] === '1') || opt.storageFlag === true;
    return flag ? 'local' : 'cloud';
  }

  /* ------------------------------------------------------------------
   * 邮件链接解析（M5：signup / magiclink 类型自适应）
   *
   * 契约依据（GoTrue v2.197.0，只读镜像核验 + 既有实测）：
   *   邮件里的链接形态为 {SiteURL}/verify?token=<hash>&type=<signup|magiclink>&redirect_to=<...>
   *   —— 二进制内 URL 构造串为 "token=%s&type=%s&redirect_to=%s"；
   *   —— token 实测为 56 位十六进制（H-2A / 2C-1-R2）。
   *
   * 安全原则（不可放宽）：
   *   1) 类型只从链接的 type 参数取得，绝不接受调用方指定或透传；
   *   2) 只接受 signup / magiclink，其他类型明确拒绝；
   *   3) 任何歧义（缺 token / 缺 type / 重复冲突参数 / 非法百分号编码 /
   *      token 形态不符 / 非链接输入）一律本地拒绝：零网络、零一次性 token 消耗；
   *   4) 绝不「先试 magiclink 失败再试 signup」——实测「类型不匹配」与「确实过期」
   *      在服务端返回同一个 otp_expired，重试只会掩盖真实错误并白白消耗一次性 token；
   *   5) 裸 token 无法判定类型，明确要求粘贴完整链接，不做无依据猜测。
   * ------------------------------------------------------------------ */
  var VERIFY_TYPES = { signup: 1, magiclink: 1 };
  var TOKEN_HASH_RE = /^[0-9a-f]{56}$/i;
  var LINK_URL_RE = /https?:\/\/[^\s<>"']+/i;

  function safeDecode(v, what) {
    try { return decodeURIComponent(v); }
    catch (e) {
      throw beErr('bad_request', '链接里的' + what + '百分号编码不合法，请重新复制整条邮件链接');
    }
  }

  function uniqStrings(arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    }
    return out;
  }

  /* 解析粘贴的邮件链接 → { tokenHash, type }；任何不合法输入抛错且不发起请求 */
  function parseEmailLink(input) {
    if (typeof input !== 'string') {
      throw beErr('bad_request', '请粘贴邮件里的完整登录链接（不接受自定义参数或非文本输入）');
    }
    var s = input.trim();
    if (!s) throw beErr('bad_request', '请粘贴邮件里的完整登录链接');

    var m = LINK_URL_RE.exec(s);
    if (!m) {
      throw beErr('bad_request',
        '无法识别链接：本地模式需要邮件里的完整链接（其中带有 type=signup 或 type=magiclink），不能只粘贴 token');
    }
    /* 去掉从邮件/聊天工具复制时常见的尾随标点 */
    var url = m[0].replace(/[.,;:!?)\]}>'"」』]+$/, '');
    var qi = url.indexOf('?');
    if (qi < 0) throw beErr('bad_request', '链接缺少查询参数，请重新复制整条邮件链接');
    var hi = url.indexOf('#', qi);
    var query = url.slice(qi + 1, hi < 0 ? url.length : hi);

    var tokens = [], types = [];
    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var eq = p.indexOf('=');
      var k = safeDecode(eq < 0 ? p : p.slice(0, eq), '参数名');
      var v = safeDecode(eq < 0 ? '' : p.slice(eq + 1), '参数值');
      if (k === 'token') tokens.push(v);
      else if (k === 'type') types.push(v.trim());
    }

    if (!tokens.length) {
      throw beErr('bad_request', '链接里没有 token 参数，请确认粘贴的是邮件中的完整登录链接');
    }
    if (uniqStrings(tokens).length > 1) {
      throw beErr('bad_request', '链接里出现多个不一致的 token 参数，已拒绝，请重新复制整条邮件链接');
    }
    if (!types.length) {
      throw beErr('bad_request',
        '链接里没有 type 参数，无法判断这是注册确认链接还是登录链接；请粘贴邮件里的完整链接（不要手工截断参数）');
    }
    if (uniqStrings(types).length > 1) {
      throw beErr('bad_request', '链接里出现多个不一致的 type 参数，已拒绝，请重新复制整条邮件链接');
    }

    var rawType = String(types[0] || '');
    var type = rawType.toLowerCase();
    if (!VERIFY_TYPES[type]) {
      throw beErr('unsupported_verification_type',
        '不支持的验证类型「' + rawType.slice(0, 24) + '」：本地仅支持 signup（首次注册确认）与 magiclink（已有用户登录）');
    }

    var tokenHash = tokens[0];
    if (!TOKEN_HASH_RE.test(tokenHash)) {
      throw beErr('bad_request', '链接里的 token 形态不正确（应为 56 位十六进制），请重新复制整条邮件链接');
    }
    return { tokenHash: tokenHash, type: type };
  }

  /* 兼容导出：仅返回 token_hash；仍走同一套严格解析（无 type 的输入不再接受） */
  function extractTokenHash(input) {
    return parseEmailLink(input).tokenHash;
  }

  /* local 桥：所有方法均为 Promise；失败统一 reject(Error{code}) */
  function createLocalBridge(cfg) {
    var api = cfg && cfg.api;
    if (!api || api.mode !== 'local') {
      throw beErr('config_missing', 'createLocalBridge 需要 local 模式适配层实例');
    }
    var auth = api.auth, db = api.db;

    function unsupported(what) {
      return Promise.reject(beErr('unsupported_in_local_mode', what + ' 在本地模式暂不支持'));
    }

    /* 邮箱 OTP：真实 GoTrue /otp，邮件里是 magiclink 链接（非六位码） */
    function requestEmailOtp(email) {
      return auth.requestEmailOtp(String(email || '').trim()).then(function (r) {
        if (r.error) throw r.error;
        return { sent: true };
      });
    }

    function requestPhoneOtp() {
      return unsupported('手机号登录');
    }

    /* 链接验证：按链接自带的 type 构造 signup / magiclink 请求
     * - 接口保持 verifyEmailLink(input) 单参数，页面无法传入 type；
     * - 解析失败 → 直接 reject，零 adapter 调用、零网络；
     * - 服务端错误（如 otp_expired）原样透出类别，不改写文案、不换 type 重试。 */
    function verifyEmailLink(input) {
      var cred;
      try {
        cred = parseEmailLink(input);
      } catch (e) {
        return Promise.reject(e);
      }
      return auth.verifyEmailOtp({ type: cred.type, token_hash: cred.tokenHash }).then(function (r) {
        if (r.error) throw r.error;
        var s = r.data && r.data.session;
        return { userId: (s && s.user && s.user.id) || null, hasSession: !!s, type: cred.type };
      });
    }

    function getSession() {
      var r = auth.getSession();
      var u = r && r.data && r.data.user;
      return Promise.resolve({
        userId: (u && (u.id || u.uid)) || null,
        hasSession: !!(r && r.data && r.data.session)
      });
    }

    /* 登出：区分本地清理与服务端撤销（两者独立） */
    function signOut() {
      return auth.signOut().then(function (r) {
        var d = (r && r.data) || {};
        return {
          localCleared: d.localCleared === true,
          serverRevoked: d.serverRevoked === true,
          error: (r && r.error) || null
        };
      });
    }

    function listProfiles() {
      return db.select('profiles').then(function (r) {
        if (r.error) throw r.error;
        return r.data || [];
      });
    }

    function listRecords() {
      return db.select('records', null, { column: 'record_date', ascending: true }).then(function (r) {
        if (r.error) throw r.error;
        return r.data || [];
      });
    }

    /* records 新增：必填 space_id / record_date / weight；
       owner_id 一律由适配层按当前 sub 注入，调用方不得传入 */
    function insertRecord(payload) {
      var p = payload || {};
      if (!p.space_id) return Promise.reject(beErr('bad_request', '缺少 space_id'));
      if (!p.record_date) return Promise.reject(beErr('bad_request', '缺少 record_date'));
      if (p.weight == null || p.weight === '' || isNaN(Number(p.weight))) {
        return Promise.reject(beErr('bad_request', 'weight 必须是数字'));
      }
      if (Object.prototype.hasOwnProperty.call(p, 'owner_id')) {
        return Promise.reject(beErr('owner_mismatch', 'owner_id 由适配层注入，调用方不得传入'));
      }
      var body = {
        space_id: String(p.space_id),
        record_date: String(p.record_date),
        weight: Number(p.weight)
      };
      ['owner_name', 'tags', 'todo_done', 'mood', 'note'].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined) body[k] = p[k];
      });
      return db.insert('records', body).then(function (r) {
        if (r.error) throw r.error;
        return (r.data && r.data[0]) || null;
      });
    }

    /* records 更新：以 meta.updated 判定是否真的改动（0 行不得当成功） */
    function updateRecord(id, patch) {
      if (id == null || id === '') return Promise.reject(beErr('bad_request', '缺少记录 id'));
      return db.update('records', patch || {}, { id: id }).then(function (r) {
        if (r.error) throw r.error;
        var updated = r.meta && typeof r.meta.updated === 'number' ? r.meta.updated : 0;
        return { updated: updated, applied: updated > 0 };
      });
    }

    /* 业务信封：HTTP 200 + {ok:false} 必须判为失败 */
    function envelope(r) {
      if (r.error) throw r.error;
      var d = (r && r.data) || {};
      return {
        ok: d.ok === true,
        code: d.code || (d.ok === true ? 'ok' : 'unknown'),
        raw: d
      };
    }

    function createSpace(args) {
      var a = args || {};
      return api.createSpace({
        nickname: a.nickname,
        role: a.role || 'her',
        startWeight: a.startWeight,
        targetWeight: a.targetWeight
      }).then(envelope);
    }

    function joinSpace(args) {
      var a = args || {};
      if (!a.code) return Promise.reject(beErr('bad_request', '缺少空间口令'));
      return api.joinSpace({
        code: String(a.code).toUpperCase(),
        nickname: a.nickname,
        role: a.role || 'her',
        startWeight: a.startWeight,
        targetWeight: a.targetWeight
      }).then(envelope);
    }

    return {
      mode: 'local',
      requestEmailOtp: requestEmailOtp,
      requestPhoneOtp: requestPhoneOtp,
      verifyEmailLink: verifyEmailLink,
      getSession: getSession,
      signOut: signOut,
      listProfiles: listProfiles,
      listRecords: listRecords,
      insertRecord: insertRecord,
      updateRecord: updateRecord,
      createSpace: createSpace,
      joinSpace: joinSpace,
      unsupported: unsupported
    };
  }

  /* 会话代数守卫：任何异步回调落地前先比对代数。
   * 用法：
   *   var ep = guard.current();
   *   ...await 任意异步...
   *   if (!guard.isCurrent(ep)) return;   // 已登出/已切换，丢弃结果
   */
  function createSessionGuard() {
    var epoch = 0;
    return {
      current: function () { return epoch; },
      bump: function () { epoch++; return epoch; },
      isCurrent: function (ep) { return ep === epoch; }
    };
  }

  /* 登出/切换身份时的页面状态清理（纯函数，页面直接调用以保证可测）
   * 范围 = S 的全部用户相关字段。新增字段时必须同步登记到这里，
   * 否则登出后旧用户的残留会漏给下一个登录的人（H-2B-2 R1/R2/R5 的成因之一）。 */
  function clearUserState(S) {
    if (!S) return S;
    S.loggedIn = false;
    S.profile = null;
    S.partner = null;
    S.others = [];
    S.profiles = [];
    S.myProfiles = [];
    S.allProfiles = [];
    S.space = '';
    S.records = [];
    S.allRecords = [];
    S.todos = [];
    S.tags = [];
    S.rewards = [];
    S.messages = [];
    /* 未提交的草稿也是上个用户的输入（体重/心情/备注），一并清掉 */
    S.draft = { weight: null, tags: [], todoDone: [], mood: null, note: '' };
    return S;
  }

  /* ==================================================================
   * H-3-M1M2：写入结果分类（纯函数，无 DOM / 网络依赖，可独立 Mock）
   *
   * 目的：把「写入本身」和「写入后的刷新」拆成两件独立的事。
   *   - 写入已被服务端确认、但随后的数据加载失败 → 绝不能改口说「保存失败」；
   *   - 请求已发出但没拿到答复（断网/超时/登出打断）→ 不能武断判为「未保存」；
   *   - PATCH 的 meta.updated=0 是「明确没改到行」，与「未知」不是一回事。
   * ================================================================== */

  /* 单次写入的四种结果 */
  var WRITE_OUTCOME = {
    CONFIRMED: 'confirmed',     /* 服务端已确认写入（INSERT 返回行 / PATCH updated>0） */
    NOT_APPLIED: 'not_applied', /* 明确没写入任何行（PATCH updated=0，含 204 零行） */
    REJECTED: 'rejected',       /* 服务端明确拒绝，或本地前置校验拒绝（请求未发出） */
    UNKNOWN: 'unknown'          /* 已发出但没拿到答复：断网 / 超时 / 中断 */
  };

  /* 错误 → 写入结果。
   * 判据只有一条：客户端是否可能已经把请求送到了服务端却没拿到答复。
   *   - 适配层业务错误一律带 code（bad_request / unauthenticated / table_forbidden…），
   *     且都在 fetch 之前或响应已解析之后产生 → 明确未知「没写进去」→ rejected；
   *   - fetch 本身被拒绝时适配层不包装，是裸 TypeError（Failed to fetch / fetch failed），
   *     没有 code → 服务端可能已处理 → unknown。 */
  function classifyWriteError(e) {
    var code = (e && e.code) ? String(e.code) : '';
    var name = (e && e.name) ? String(e.name) : '';
    var msg = String((e && e.message) || '');

    if (code === 'network_error' || code === 'timeout' || code === 'abort') return WRITE_OUTCOME.UNKNOWN;
    if (!code && (name === 'AbortError' || name === 'TimeoutError')) return WRITE_OUTCOME.UNKNOWN;
    if (!code && /failed to fetch|fetch failed|network ?error|networkerror|socket|econnrefused|econnreset|eai_again|timed out|timeout/i.test(msg)) {
      return WRITE_OUTCOME.UNKNOWN;
    }
    return WRITE_OUTCOME.REJECTED;
  }

  /* 跨空间镜像写入的汇总：逐项计数，绝不把部分成功折成全成功或全失败。
   * items = [{ space, outcome }] → { total, confirmed, notApplied, rejected, unknown, items } */
  function summarizeMirror(items) {
    var out = { total: 0, confirmed: 0, notApplied: 0, rejected: 0, unknown: 0, items: [] };
    (items || []).forEach(function (it) {
      var o = it && it.outcome;
      if (o !== WRITE_OUTCOME.CONFIRMED && o !== WRITE_OUTCOME.NOT_APPLIED &&
          o !== WRITE_OUTCOME.REJECTED && o !== WRITE_OUTCOME.UNKNOWN) {
        o = WRITE_OUTCOME.UNKNOWN;
      }
      out.total++;
      if (o === WRITE_OUTCOME.CONFIRMED) out.confirmed++;
      else if (o === WRITE_OUTCOME.NOT_APPLIED) out.notApplied++;
      else if (o === WRITE_OUTCOME.REJECTED) out.rejected++;
      else out.unknown++;
      out.items.push({ space: (it && it.space) || '', outcome: o });
    });
    return out;
  }

  /* 保存结果 → 页面提示文案（纯函数）
   * o = { primary, error, refresh:'ok'|'failed'|'skipped', mirror, stale }
   *   stale=true：本次流程所属会话已失效（已登出/已换身份）→ 静默，不出任何提示
   * 返回 { kind:'success'|'warning'|'error'|'silent', message } */
  function describeSaveOutcome(o) {
    o = o || {};
    var primary = o.primary || WRITE_OUTCOME.UNKNOWN;

    if (o.stale) return { kind: 'silent', message: '' };

    if (primary === WRITE_OUTCOME.REJECTED) {
      return { kind: 'error', message: '保存失败：' + ((o.error && o.error.message) || '请重试') };
    }
    if (primary === WRITE_OUTCOME.UNKNOWN) {
      return { kind: 'warning', message: '写入结果尚未确认，请重新查看记录（不要重复提交）' };
    }
    if (primary === WRITE_OUTCOME.NOT_APPLIED) {
      return { kind: 'warning', message: '这条记录没更新到（可能已被删除），已刷新' };
    }

    /* 以下：写入已被服务端确认，只剩「镜像同步」与「刷新」两件附属事实 */
    var parts = ['已保存'];
    var m = o.mirror;
    if (m && m.total > 0) {
      if (m.confirmed === m.total) {
        parts.push('其他 ' + m.total + ' 个空间也已同步');
      } else {
        var seg = [];
        if (m.confirmed) seg.push(m.confirmed + ' 个已同步');
        var bad = m.notApplied + m.rejected;
        if (bad) seg.push(bad + ' 个未写入');
        if (m.unknown) seg.push(m.unknown + ' 个未确认');
        parts.push('其他 ' + m.total + ' 个空间：' + seg.join('、'));
      }
    }
    if (o.refresh === 'failed') parts.push('数据刷新暂未完成');
    return { kind: 'success', message: parts.join('；') };
  }

  /* local 模式替代 Cloud SDK 的拒绝桩：
     任何未适配调用都明确失败（unsupported_in_local_mode），
     绝不静默成功、绝不产生网络请求、绝无回退云端路径。 */
  function createBlockedCloud() {
    function deny(name) {
      return function () {
        throw beErr('unsupported_in_local_mode',
          name + ' 在本地模式暂不支持（该功能尚未接入本地后端）');
      };
    }
    return {
      auth: {
        sendOtp: deny('auth.sendOtp'),
        verifyOtp: deny('auth.verifyOtp'),
        signOut: deny('auth.signOut'),
        getSession: deny('auth.getSession')
      },
      database: {
        from: deny('database.from'),
        rpc: deny('database.rpc')
      }
    };
  }

  return {
    resolveBackendMode: resolveBackendMode,
    parseEmailLink: parseEmailLink,
    extractTokenHash: extractTokenHash,
    createLocalBridge: createLocalBridge,
    createSessionGuard: createSessionGuard,
    clearUserState: clearUserState,
    createBlockedCloud: createBlockedCloud,
    WRITE_OUTCOME: WRITE_OUTCOME,
    classifyWriteError: classifyWriteError,
    summarizeMirror: summarizeMirror,
    describeSaveOutcome: describeSaveOutcome,
    UNSUPPORTED_FEATURES: UNSUPPORTED_FEATURES
  };
});
