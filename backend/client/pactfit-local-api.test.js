/* =============================================================================
 * PactFit · 本地后端适配层 mock 测试（零依赖，Node 18+ 直接运行）
 *   node backend/client/pactfit-local-api.test.js
 * 全部为 mock PASS——真实 HTTP PASS 需在 13-G 已验证的本地栈上另行执行。
 * 用例：T1–T18（13-H-1 原有）+ T19–T34（13-H-1-FIX 新增：查询编码 / 刷新异常 /
 *       登出语义 / owner_id 注入）。
 * ============================================================================= */
'use strict';

const assert = require('assert');
const API = require('./pactfit-local-api.js');

let passed = 0, failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    passed++; results.push(['PASS', name]);
    console.log('PASS  ' + name);
  } catch (e) {
    failed++; results.push(['FAIL', name + ' :: ' + e.message]);
    console.log('FAIL  ' + name + ' :: ' + e.message);
  }
}

/* ---------- mock fetch 基建 ---------- */
function mockFetch(handler) {
  const calls = [];
  const fn = function (url, opts) {
    calls.push({ url: String(url), opts: opts || {} });
    /* 与真实 fetch 对齐：handler 抛出 = 网络层拒绝（异步 Promise rejection），
     * 而非同步 throw。用于模拟断网/连接拒绝。 */
    let r;
    try {
      r = handler(url, opts || {}, calls.length);
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve({
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: () => Promise.resolve(r.text === undefined ? '' : r.text)
    });
  };
  fn.calls = calls;
  return fn;
}

function makeBackend(fetchImpl) {
  return API.createLocalBackend({
    mode: 'local',
    authUrl: 'http://127.0.0.1:9999',
    restUrl: 'http://127.0.0.1:3000'
  }, fetchImpl);
}

const SESSION_BODY = JSON.stringify({
  access_token: 'fake.jwt.sig', refresh_token: 'rt_abc',
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@pactfit.local' },
  expires_in: 3600, expires_at: 9999999999
});

const SESSION2_BODY = JSON.stringify({
  access_token: 'new.jwt.sig2', refresh_token: 'rt_new',
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@pactfit.local' },
  expires_in: 3600, expires_at: 9999999999
});

/* 可控 Deferred fetch（13-H-2A-FIX 竞态测试专用）：
 * immediate(url,opts) 返回响应对象则立即应答；否则请求进入 pending 队列，
 * 由测试用 respond/rejectAt 以任意顺序手动放行——确定性构造交错，不依赖 setTimeout。 */
function queueFetch(immediate) {
  const calls = [];
  const pending = [];
  const fn = function (url, opts) {
    calls.push({ url: String(url), opts: opts || {} });
    const r = immediate ? immediate(String(url), opts || {}) : null;
    if (r) {
      return Promise.resolve({
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        text: () => Promise.resolve(r.text === undefined ? '' : r.text)
      });
    }
    return new Promise((res, rej) => pending.push({ url: String(url), res, rej, done: false }));
  };
  fn.calls = calls;
  fn.pending = pending;
  fn.firstPending = function (part) {
    for (let i = 0; i < pending.length; i++) {
      if (!pending[i].done && pending[i].url.includes(part)) return i;
    }
    return -1;
  };
  fn.respond = function (idx, r) {
    const p = pending[idx];
    p.done = true;
    p.res({
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: () => Promise.resolve(r.text === undefined ? '' : r.text)
    });
  };
  fn.rejectAt = function (idx, e) {
    pending[idx].done = true;
    pending[idx].rej(e);
  };
  return fn;
}

(async function main() {

  /* 1. 默认选择 cloud */
  await test('T1 默认 mode=cloud，不产生 auth/db 客户端', () => {
    const b = API.createLocalBackend({});
    assert.strictEqual(b.mode, 'cloud');
    assert.strictEqual(b.auth, null);
    assert.strictEqual(b.db, null);
  });

  /* 2/3. local 配置缺失明确报错；不静默访问云端 */
  await test('T2 local 缺少地址时明确报错（不静默回退）', () => {
    assert.throws(() => API.createLocalBackend({ mode: 'local' }),
      /config_missing|authUrl/);
    assert.throws(() => API.createLocalBackend({ mode: 'local', authUrl: 'http://127.0.0.1:9999' }),
      /config_missing/);
  });

  /* 4a. 非回环地址被拒绝（防远程注入） */
  await test('T3 拒绝非回环地址（config_invalid）', () => {
    assert.throws(() => API.createLocalBackend({
      mode: 'local', authUrl: 'http://10.0.0.5:9999', restUrl: 'http://127.0.0.1:3000'
    }), /非回环主机|config_invalid/);
    assert.throws(() => API.createLocalBackend({
      mode: 'local', authUrl: 'https://evil.example.com', restUrl: 'http://127.0.0.1:3000'
    }), /回环|config_invalid/);
  });

  /* 4b. OTP 请求参数构造 */
  await test('T4 requestEmailOtp 构造 POST /otp {email,create_user}', async () => {
    let seen = null;
    const f = mockFetch((url, opts) => {
      seen = { url, body: JSON.parse(opts.body) };
      return { status: 200, text: '{}' };
    });
    const b = makeBackend(f);
    const r = await b.auth.requestEmailOtp('a@pactfit.local');
    assert.strictEqual(r.error, null);
    assert.strictEqual(seen.url, 'http://127.0.0.1:9999/otp');
    assert.deepStrictEqual(seen.body, { email: 'a@pactfit.local', create_user: true });
  });

  /* 4c. OTP 请求 500 业务错误映射 */
  await test('T5 OTP 请求失败（如 SMTP 500）映射为 error', async () => {
    const f = mockFetch(() => ({ status: 500, text: JSON.stringify({ code: 500, msg: 'Error sending confirmation email' }) }));
    const b = makeBackend(f);
    await assert.rejects(() => b.auth.requestEmailOtp('a@pactfit.local'), /otp_request_failed|sending/);
  });

  /* 4d. 手机号登录明确不支持 */
  await test('T6 手机号登录明确返回 unsupported（不伪装成功）', async () => {
    const b = makeBackend(mockFetch(() => { throw new Error('must not be called'); }));
    await assert.rejects(() => b.auth.requestPhoneOtp('13800138000'), /unsupported|手机号/);
  });

  /* 5/7. verify 成功建立会话；401/403/406 错误映射；token 自动附加 */
  await test('T7 verifyEmailOtp(token_hash) 成功 → 内存会话建立', async () => {
    const f = mockFetch((url, opts) => {
      if (url.includes('/verify')) {
        const body = JSON.parse(opts.body);
        assert.strictEqual(body.type, 'magiclink');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(body, 'email'), false,
          'token_hash 模式不得附带 email');
        return { status: 200, text: SESSION_BODY };
      }
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    const r = await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    assert.strictEqual(r.error, null);
    assert.strictEqual(b.auth.getUserId(), '11111111-1111-1111-1111-111111111111');
    assert.ok(b.auth.getAccessToken());
  });

  await test('T8 token_hash 模式附带 email 被拒（契约保护）', async () => {
    const b = makeBackend(mockFetch(() => ({ status: 500, text: '' })));
    await assert.rejects(() => b.auth.verifyEmailOtp({ type: 'signup', token_hash: 'a'.repeat(56), email: 'x@y.z' }), /bad_request|email/);
  });

  /* 6. 未登录拒绝 authenticated 操作 */
  await test('T9 未登录时 select/insert/rpc 全部拒绝', async () => {
    const f = mockFetch(() => ({ status: 200, text: '[]' }));
    const b = makeBackend(f);
    b.auth._clearSessionForTest();
    await assert.rejects(() => b.db.select('profiles'), /unauthenticated|未登录/);
    await assert.rejects(() => b.db.rpc('rpc_space_peek', { code: 'FIT-AAAAAA' }), /unauthenticated|未登录/);
    assert.strictEqual(f.calls.length, 0, '未登录不得发出任何请求');
  });

  /* 5. access_token 自动附加且不出现在 URL */
  await test('T10 已登录请求自动附加 Bearer，token 不进 URL', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return { status: 200, text: '[]' };
    });
    const b = makeBackend(f);
    /* 经真实 verify 流程建立会话（模拟已登录） */
    const r = await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    assert.strictEqual(r.error, null);
    const at = b.auth.getAccessToken();
    await b.db.select('profiles');
    const call = f.calls[f.calls.length - 1];
    assert.strictEqual(call.opts.headers['Authorization'], 'Bearer ' + at);
    assert.strictEqual(call.url.indexOf('fake.jwt'), -1, 'token 不得出现在 URL');
  });

  /* 7. HTTP 错误映射 */
  await test('T11 401/403/406/PGRST301 错误映射', async () => {
    const cases = [
      [401, 'anon permission denied', 'unauthenticated'],
      [403, 'new row violates row-level security policy', 'permission_denied'],
      [406, 'could not parse Accept-Profile header', 'schema_mismatch'],
      [401, JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), 'invalid_jwt']
    ];
    for (const [status, text, expect] of cases) {
      const f = mockFetch(() => ({ status, text }));
      const b = makeBackend(f);
      /* 注入会话以越过未登录门槛 */
      await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) }).catch(() => {});
      b.auth._clearSessionForTest();
      /* 直接以 getSession 绕过——改用内部注入：重新验证后测试 */
      const f2 = mockFetch(() => ({ status, text }));
      const b2 = makeBackend(f2);
      const okF = mockFetch((url) => url.includes('/verify') ? { status: 200, text: SESSION_BODY } : { status, text });
      const b3 = makeBackend(okF);
      await b3.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
      await assert.rejects(() => b3.db.select('profiles'), new RegExp(expect));
    }
  });

  /* 8. HTTP 200 + {ok:false} 业务拒绝信封 */
  await test('T12 rpc HTTP 200 业务拒绝原样透传（页面按 code 分支）', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/rpc/rpc_join_space')) {
        return { status: 200, text: JSON.stringify({ ok: false, code: 'invalid_nickname' }) };
      }
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const r = await b.joinSpace({ code: 'FIT-ZZ99ZZ', nickname: 'n'.repeat(25) });
    assert.strictEqual(r.error, null);                 /* HTTP 层成功 */
    assert.strictEqual(r.data.ok, false);              /* 业务拒绝原样透传 */
    assert.strictEqual(r.data.code, 'invalid_nickname');
  });

  /* 10/11. profiles.insert 禁止；rewards 直写禁止；未授权表/RPC 禁止 */
  await test('T13 profiles.insert / rewards 写入 / 未授权表与 RPC 全部阻止', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return { status: 200, text: '[]' };
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const sub = b.auth.getUserId();
    await assert.rejects(() => b.db.insert('profiles', { owner_id: sub, nickname: 'x' }),
      /rpc_create_space|rpc_join_space/);
    await assert.rejects(() => b.db.insert('rewards', { owner_id: sub }), /reward RPC|仅允许 SELECT/);
    await assert.rejects(() => b.db.update('rewards', { status: 'done' }, { id: 1 }), /reward RPC|仅允许 SELECT|无 UPDATE/);
    await assert.rejects(() => b.db.select('private.rate_hits'), /未授权的表/);
    await assert.rejects(() => b.db.select('auth.users'), /未授权的表/);
    await assert.rejects(() => b.db.rpc('rpc_admin_backdoor', {}), /未授权的 RPC/);
    await assert.rejects(() => b.db.remove('profiles', { id: 1 }), /不允许客户端删除/);
    await assert.rejects(() => b.db.remove('records', { id: 1 }), /不允许客户端删除/);
    assert.ok(f.calls.every(c => !c.url.includes('/private/') && !c.url.includes('/auth/')),
      '不得向 private/auth schema 发请求');
  });

  /* 列级授权：非法列与必填列 */
  await test('T14 列级授权（非法列拒绝）与必填列校验', async () => {
    const f = mockFetch((url, opts) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return { status: 201, text: JSON.stringify([opts.body]) };
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const sub = b.auth.getUserId();
    /* records 非法列 */
    await assert.rejects(() => b.db.insert('records', {
      owner_id: sub, space_id: 'FIT-AAAAAA', record_date: '2026-11-14', weight: 80, owner_status: 'x'
    }), /column_forbidden/);
    /* records 缺必填 weight */
    await assert.rejects(() => b.db.insert('records', {
      owner_id: sub, space_id: 'FIT-AAAAAA', record_date: '2026-11-14'
    }), /missing_required/);
    /* profiles 非法更新列 */
    await assert.rejects(() => b.db.update('profiles', { email: 'x' }, { id: 1 }), /column_forbidden/);
    /* owner_id 伪造拒绝 */
    await assert.rejects(() => b.db.insert('records', {
      owner_id: '22222222-2222-2222-2222-222222222222', space_id: 'FIT-AAAAAA',
      record_date: '2026-11-14', weight: 80
    }), /owner_mismatch/);
    /* 合法 records insert 通过并自动附 Bearer */
    const r = await b.db.insert('records', {
      owner_id: sub, space_id: 'FIT-AAAAAA', record_date: '2026-11-14', weight: 80.5, mood: 'good'
    });
    assert.strictEqual(r.error, null);
    assert.ok(Array.isArray(r.data));
  });

  /* 9. PATCH 204 零行歧义处理 */
  await test('T15 PATCH 返回空数组 → meta.updated=0（不解释为成功）', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/records')) return { status: 200, text: '[]' }; /* RLS 过滤零行 */
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const r = await b.db.update('records', { mood: 'x' }, { id: 21 });
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.meta.updated, 0);
    /* 无过滤条件的 update/delete 被拒 */
    await assert.rejects(() => b.db.update('records', { mood: 'x' }, null), /bad_request/);
    await assert.rejects(() => b.db.remove('todos', null), /bad_request/);
  });

  /* 14. refresh/logout 边界 */
  await test('T16 刷新失败清空会话（不再使用失效 token）；登出清会话', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/token?grant_type=refresh_token')) return { status: 401, text: '{}' };
      return { status: 204, text: '' };
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    await assert.rejects(() => b.auth.refreshSession(f), /refresh_failed/);
    assert.strictEqual(b.auth.getAccessToken(), null, '刷新失败后不得保留 access_token');
    /* 无会话刷新 */
    await assert.rejects(() => b.auth.refreshSession(f), /no_session/);
    /* 登出：清会话且带 Bearer */
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const lo = await b.auth.signOut();
    assert.strictEqual(lo.data.signedOut, true);
    assert.strictEqual(b.auth.getAccessToken(), null);
  });

  /* 13. 日志脱敏 */
  await test('T17 脱敏日志：请求日志不包含 token/Authorization', async () => {
    const logs = [];
    const orig = console.log;
    console.log = function () { logs.push([].slice.call(arguments).join(' ')); };
    try {
      API._internal.safeLog.enable();
      const f = mockFetch((url) => {
        if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
        return { status: 401, text: '{}' };
      });
      const b = makeBackend(f);
      await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) }).catch(() => {});
      await b.db.select('profiles').catch(() => {});
    } finally {
      console.log = orig;
    }
    const all = logs.join('\n');
    assert.strictEqual(all.indexOf('fake.jwt'), -1, '日志不得包含 access_token');
    assert.strictEqual(all.indexOf('Authorization'), -1, '日志不得包含 Authorization');
    assert.strictEqual(all.indexOf('rt_abc'), -1, '日志不得包含 refresh_token');
  });

  /* 12. 白名单导出完整性 */
  await test('T18 白名单与 createSpace/joinSpace RPC 映射正确', async () => {
    assert.ok(API.RPC_ALLOWLIST.indexOf('rpc_create_space') >= 0);
    assert.ok(API.RPC_ALLOWLIST.indexOf('rpc_join_space') >= 0);
    assert.ok(API.RPC_ALLOWLIST.indexOf('rpc_reward_create') >= 0);
    assert.strictEqual(API.RPC_ALLOWLIST.indexOf('auth.users'), -1);
    let seen = null;
    const f = mockFetch((url, opts) => {
      if (url.includes('/rpc/rpc_create_space')) {
        seen = { url, body: JSON.parse(opts.body) };
        return { status: 200, text: JSON.stringify({ ok: true, code: 'FIT-H3UHYR' }) };
      }
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const r = await b.createSpace({ nickname: 'AliceX', role: 'her', startWeight: 80, targetWeight: 70 });
    assert.strictEqual(r.data.code, 'FIT-H3UHYR');
    assert.deepStrictEqual(seen.body, {
      p_nickname: 'AliceX', p_role: 'her', p_start_weight: 80, p_target_weight: 70
    });
  });

  /* ===================== 13-H-1-FIX 新增专项测试 ===================== */

  /* ---- 查询参数编码（修复二） ---- */

  await test('T19 过滤值特殊字符（中文/空格/&/#/?/等号）标准编码且语义不变', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return { status: 200, text: '[]' };
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const r = await b.db.select('records', { space_id: 'FIT-AAAAAA', note: '中文 & # ? = 空格' });
    assert.strictEqual(r.error, null);
    const u = new URL(f.calls[f.calls.length - 1].url);
    const qs = new URLSearchParams(u.search);
    /* 解码回读：eq. 语义 + 原值无损 */
    assert.strictEqual(qs.get('space_id'), 'eq.FIT-AAAAAA');
    assert.strictEqual(qs.get('note'), 'eq.中文 & # ? = 空格');
    /* 不应出现额外查询参数 */
    assert.deepStrictEqual(qs.getAll('order'), [], '无 order 时不得出现 order 参数');
    assert.deepStrictEqual([...qs.keys()].sort(), ['note', 'space_id']);
    /* 结构性字符不得裸露破坏查询 */
    assert.strictEqual(u.search.indexOf('#'), -1, '# 不得裸露');
    assert.ok(u.search.includes('%26'), '& 必须被编码');
    assert.ok(u.search.includes('%3F'), '? 必须被编码');
    assert.ok(u.search.includes('%3D'), '值内等号必须被编码');
    assert.ok(u.search.includes('%20'), '空格必须被编码');
    assert.ok(u.search.includes('%E4%B8%AD'), '中文必须按 UTF-8 编码');
    assert.strictEqual((u.search.match(/\?/g) || []).length, 1, '仅允许 query 起始一个 ?');
  });

  await test('T20 多条件过滤 + 双级排序参数构造正确', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return { status: 200, text: '[]' };
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const r = await b.db.select('records',
      { space_id: 'FIT-AAAAAA', owner_name: 'Alice' },
      { column: 'record_date', ascending: false, then: { column: 'id', ascending: true } });
    assert.strictEqual(r.error, null);
    const qs = new URLSearchParams(new URL(f.calls[f.calls.length - 1].url).search);
    assert.strictEqual(qs.get('space_id'), 'eq.FIT-AAAAAA');
    assert.strictEqual(qs.get('owner_name'), 'eq.Alice');
    assert.deepStrictEqual(qs.getAll('order'), ['record_date.desc', 'id.asc']);
    assert.deepStrictEqual([...new Set(qs.keys())].sort(), ['order', 'owner_name', 'space_id'],
      '不应出现额外查询参数（order 双级排序为合法重复）');
  });

  await test('T21 非法/保留字段名拒绝且零请求（防结构性参数注入）', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return { status: 200, text: '[]' };
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const callsBefore = f.calls.length; /* verify 本身占 1 次 */
    const badFilters = [
      { or: '(id.eq.1,owner_id.is,null)' },
      { and: '(id.eq.1)' },
      { select: '*' },
      { limit: '1' },
      { offset: '5' },
      { 'id=1': 'x' },
      { 'a&b': 'x' },
      { '含 中 文': 'x' },
      { 'a b': 'x' },
      { '': 'x' }
    ];
    for (const bf of badFilters) {
      await assert.rejects(() => b.db.select('records', bf),
        (e) => e.code === 'bad_request', '应拒绝: ' + JSON.stringify(bf));
    }
    /* 非法排序列名 */
    await assert.rejects(() => b.db.select('records', {},
      { column: 'id;select=*' }), (e) => e.code === 'bad_request');
    await assert.rejects(() => b.db.select('records', {},
      { column: 'order', ascending: false }), (e) => e.code === 'bad_request');
    /* update/remove 的过滤同样受白名单约束 */
    await assert.rejects(() => b.db.update('records', { mood: 'x' }, { or: '(...)' }),
      (e) => e.code === 'bad_request');
    assert.strictEqual(f.calls.length, callsBefore, '非法字段名不得发出任何数据请求');
  });

  /* ---- refreshSession 异常处理与并发保护（修复三） ---- */

  await test('T22 刷新成功更新会话；并发刷新去重为一次请求（防旧覆盖新）', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/token?grant_type=refresh_token')) return { status: 200, text: SESSION2_BODY };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const p1 = b.auth.refreshSession();
    const p2 = b.auth.refreshSession();
    assert.strictEqual(p1, p2, '并发刷新必须复用同一在途 Promise');
    const r1 = await p1, r2 = await p2;
    assert.strictEqual(r1.error, null);
    assert.strictEqual(r2.error, null);
    assert.strictEqual(b.auth.getAccessToken(), 'new.jwt.sig2');
    const tokenCalls = f.calls.filter((c) => c.url.includes('/token?grant_type=refresh_token'));
    assert.strictEqual(tokenCalls.length, 1, '并发刷新去重为一次 HTTP 请求');
    assert.strictEqual(tokenCalls[0].url.indexOf('rt_abc'), -1, 'refresh_token 不得出现在 URL');
    /* 刷新完成后在途标记复位（允许下一次刷新） */
    const f2 = mockFetch((url) => {
      if (url.includes('/token?grant_type=refresh_token')) return { status: 200, text: SESSION2_BODY };
      throw new Error('unexpected ' + url);
    });
    const b2 = makeBackend(f2);
    b2.auth._setSessionForTest(JSON.parse(SESSION_BODY));
    const r3 = await b2.auth.refreshSession();
    assert.strictEqual(r3.error, null);
  });

  await test('T23 刷新 HTTP 401 → refresh_failed 且清会话；错误不泄漏 refresh_token', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/token?grant_type=refresh_token')) return { status: 401, text: '{}' };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    let caught = null;
    try { await b.auth.refreshSession(); } catch (e) { caught = e; }
    assert.ok(caught, '应抛出错误');
    assert.strictEqual(caught.code, 'refresh_failed', '服务端明确拒绝 → refresh_failed');
    assert.ok(caught instanceof Error, '必须是真实 Error 实例');
    assert.ok(caught.message.indexOf('rt_abc') === -1, '错误信息不得包含 refresh_token');
    assert.strictEqual(b.auth.getAccessToken(), null, '服务端拒绝后不得保留失效 token');
  });

  await test('T24 刷新 HTTP 500（服务端明确响应）→ refresh_failed 且清会话', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/token?grant_type=refresh_token')) return { status: 500, text: '{}' };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    await assert.rejects(() => b.auth.refreshSession(), (e) => e.code === 'refresh_failed');
    assert.strictEqual(b.auth.getAccessToken(), null);
  });

  await test('T25 fetch 网络拒绝 → refresh_network_failed（区分服务端拒绝）且保守清会话', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      throw new TypeError('fetch failed (网络拒绝模拟)');
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    let caught = null;
    try { await b.auth.refreshSession(); } catch (e) { caught = e; }
    assert.ok(caught, '应抛出错误');
    assert.strictEqual(caught.code, 'refresh_network_failed', '网络异常不得误报为服务端拒绝');
    assert.ok(caught.message.indexOf('服务端拒绝') === -1, '不得把网络异常描述为服务端撤销');
    assert.ok(caught.message.indexOf('网络') >= 0, '应描述为网络状态未知');
    assert.ok(caught.message.indexOf('rt_abc') === -1, '不得泄漏 refresh_token');
    assert.strictEqual(b.auth.getAccessToken(), null, '保守处理：不保留有效性未确认的 token');
  });

  /* ---- signOut 结果语义（修复四） ---- */

  await test('T26 正常登出 → localCleared=true 且 serverRevoked=true', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/logout')) return { status: 204, text: '' };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const lo = await b.auth.signOut();
    assert.strictEqual(lo.data.signedOut, true);
    assert.strictEqual(lo.data.localCleared, true);
    assert.strictEqual(lo.data.serverRevoked, true);
    assert.strictEqual(lo.error, null);
    const loCall = f.calls[f.calls.length - 1];
    assert.strictEqual(loCall.opts.headers['Authorization'], 'Bearer fake.jwt.sig');
    assert.strictEqual(b.auth.getAccessToken(), null, '请求结束后本地 token 必须清理');
  });

  await test('T27 登出 HTTP 500 → 本地清理但 serverRevoked=false，不声称服务端已撤销', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/logout')) return { status: 500, text: '{}' };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const lo = await b.auth.signOut();
    assert.strictEqual(lo.data.signedOut, true);
    assert.strictEqual(lo.data.localCleared, true);
    assert.strictEqual(lo.data.serverRevoked, false, '不得声称服务端已成功撤销');
    assert.ok(lo.error instanceof Error);
    assert.strictEqual(lo.error.code, 'logout_http_failed');
    assert.strictEqual(JSON.stringify(lo).indexOf('fake.jwt'), -1, '结果不得泄漏旧 token');
    assert.strictEqual(b.auth.getAccessToken(), null, '服务端撤销失败仍清理本地 token');
  });

  await test('T28 登出网络错误 → logout_network_failed（撤销状态未知）且本地清理', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      throw new TypeError('fetch failed (网络拒绝模拟)');
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const lo = await b.auth.signOut();
    assert.strictEqual(lo.data.serverRevoked, false);
    assert.strictEqual(lo.data.localCleared, true);
    assert.ok(lo.error instanceof Error);
    assert.strictEqual(lo.error.code, 'logout_network_failed');
    assert.ok(lo.error.message.indexOf('未知') >= 0, '网络错误不得描述为确定的服务端撤销');
    assert.strictEqual(b.auth.getAccessToken(), null);
    /* 登出后再次登出：无会话，零请求 */
    const callsBefore = f.calls.length;
    const lo2 = await b.auth.signOut();
    assert.strictEqual(lo2.data.signedOut, false);
    assert.strictEqual(f.calls.length, callsBefore, '无会话登出不得发请求');
  });

  await test('T29 无会话登出 → signedOut=false / localCleared=true / 零请求', async () => {
    const f = mockFetch(() => ({ status: 204, text: '' }));
    const b = makeBackend(f);
    const lo = await b.auth.signOut();
    assert.strictEqual(lo.data.signedOut, false);
    assert.strictEqual(lo.data.localCleared, true);
    assert.strictEqual(lo.data.serverRevoked, false);
    assert.strictEqual(lo.error, null);
    assert.strictEqual(f.calls.length, 0);
  });

  /* ---- owner_id 自动注入（修复五） ---- */

  await test('T30 缺省 owner_id 自动注入当前登录用户（原 payload 对象不被污染）', async () => {
    const f = mockFetch((url, opts) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/records')) return { status: 201, text: JSON.stringify([JSON.parse(opts.body)]) };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const sub = b.auth.getUserId();
    const payload = { space_id: 'FIT-AAAAAA', record_date: '2026-11-14', weight: 80 };
    const r = await b.db.insert('records', payload);
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.data[0].owner_id, sub, '自动注入当前真实用户 sub');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, 'owner_id'), false,
      '调用方原对象不得被污染');
    const sent = JSON.parse(f.calls[f.calls.length - 1].opts.body);
    assert.strictEqual(sent.owner_id, sub);
  });

  await test('T31 显式传入自身 owner_id → 通过且原样发送', async () => {
    const f = mockFetch((url, opts) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/records')) return { status: 201, text: JSON.stringify([JSON.parse(opts.body)]) };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const sub = b.auth.getUserId();
    const r = await b.db.insert('records', {
      owner_id: sub, space_id: 'FIT-AAAAAA', record_date: '2026-11-14', weight: 79.5
    });
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.data[0].owner_id, sub);
  });

  await test('T32 伪造他人 owner_id / UPDATE 带 owner_id / RPC 参数不注入', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/rpc/rpc_space_peek')) return { status: 200, text: JSON.stringify({ ok: true }) };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    /* 伪造他人 owner_id */
    await assert.rejects(() => b.db.insert('records', {
      owner_id: '22222222-2222-2222-2222-222222222222', space_id: 'FIT-AAAAAA',
      record_date: '2026-11-14', weight: 80
    }), (e) => e.code === 'owner_mismatch');
    /* UPDATE 不允许 owner_id（列级拒绝，不注入） */
    await assert.rejects(() => b.db.update('records', { owner_id: b.auth.getUserId(), mood: 'x' }, { id: 1 }),
      (e) => e.code === 'column_forbidden');
    /* RPC 参数原样透传，绝不自动注入 owner_id */
    const r = await b.db.rpc('rpc_space_peek', { code: 'FIT-AAAAAA' });
    const sent = JSON.parse(f.calls[f.calls.length - 1].opts.body);
    assert.deepStrictEqual(sent, { code: 'FIT-AAAAAA' }, 'RPC 参数不得被注入 owner_id');
    assert.strictEqual(r.error, null);
    assert.strictEqual(f.calls.some((c) => c.url.includes('owner_id')), false,
      'URL 中不得出现 owner_id');
  });

  await test('T33 未登录缺省 owner_id → unauthenticated 且零请求', async () => {
    const f = mockFetch(() => ({ status: 200, text: '[]' }));
    const b = makeBackend(f);
    await assert.rejects(() => b.db.insert('records', {
      space_id: 'FIT-AAAAAA', record_date: '2026-11-14', weight: 80
    }), (e) => e.code === 'unauthenticated');
    assert.strictEqual(f.calls.length, 0, '未登录缺省 owner_id 不得发出请求');
  });

  /* ================ 13-H-2A-FIX 竞态安全测试（Deferred 确定性交错） ================ */

  await test('T34 正常刷新成功，session 仍有效（回归基线）', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/token?grant_type=refresh_token')) return { status: 200, text: SESSION2_BODY };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const r = await b.auth.refreshSession();
    assert.strictEqual(r.error, null);
    assert.strictEqual(b.auth.getAccessToken(), 'new.jwt.sig2');
    assert.ok(b.auth.getSession().data.session);
  });

  await test('T35 refresh 在途 → signOut 完成 → 迟到 200 被拒（会话不得恢复）', async () => {
    const f = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/logout')) return { status: 204, text: '' };
      return null; /* /token 进 pending */
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const p = b.auth.refreshSession();
    await b.auth.signOut();
    assert.strictEqual(b.auth.getAccessToken(), null);
    f.respond(f.firstPending('/token'), { status: 200, text: SESSION2_BODY });
    await assert.rejects(p, (e) => e.code === 'refresh_stale_after_logout',
      '迟到的 200 必须被拒绝');
    assert.strictEqual(b.auth.getAccessToken(), null, '不得恢复 access_token');
    assert.strictEqual(b.auth.getSession().data.session, null, '不得恢复会话');
    await assert.rejects(() => b.db.select('profiles'), (e) => e.code === 'unauthenticated',
      '后续数据请求由本地守卫拒绝');
    assert.strictEqual(f.calls.some((c) => c.url.includes('/profiles')), false, '零业务 HTTP 请求');
  });

  await test('T36 refresh 在途 → signOut 开始（/logout 未完成）→ 迟到 200 被拒', async () => {
    const f = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return null; /* /token 与 /logout 都进 pending，手动排序 */
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const p = b.auth.refreshSession();
    const lo = b.auth.signOut(); /* 调用开始即失效旧代；/logout 在途 */
    assert.strictEqual(b.auth.getAccessToken(), null, 'signOut 调用开始即清理本地会话');
    f.respond(f.firstPending('/token'), { status: 200, text: SESSION2_BODY });
    await assert.rejects(p, (e) => e.code === 'refresh_stale_after_logout',
      'signOut 开始后旧刷新绝不能重新建会话');
    assert.strictEqual(b.auth.getSession().data.session, null);
    f.respond(f.firstPending('/logout'), { status: 204, text: '' });
    const loR = await lo;
    assert.strictEqual(loR.data.signedOut, true);
    assert.strictEqual(loR.data.serverRevoked, true);
    assert.strictEqual(b.auth.getAccessToken(), null);
  });

  await test('T37 refresh 在途 → signOut → 新 verify 会话 → 旧 200 不得覆盖新会话', async () => {
    const f = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/logout')) return { status: 204, text: '' };
      return null; /* /token pending */
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const p = b.auth.refreshSession();
    await b.auth.signOut();
    const r2 = await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'b'.repeat(56) });
    assert.strictEqual(r2.error, null, '重新合法登录建立新会话');
    const at2 = b.auth.getAccessToken();
    const rt2 = b.auth.getSession().data.session.refresh_token;
    f.respond(f.firstPending('/token'), { status: 200, text: SESSION2_BODY });
    await assert.rejects(p, (e) => e.code === 'refresh_stale_after_logout');
    assert.strictEqual(b.auth.getAccessToken(), at2, '新 access_token 不被旧响应覆盖');
    assert.strictEqual(b.auth.getSession().data.session.refresh_token, rt2, '新 refresh_token 不被覆盖');
    assert.strictEqual(b.auth.getUserId(), '11111111-1111-1111-1111-111111111111');
  });

  await test('T38 旧刷新失败（401 / 网络错误）在新会话建立后 → 保留分类且不清新会话', async () => {
    /* 401 变体 */
    const f = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/logout')) return { status: 204, text: '' };
      return null;
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const p = b.auth.refreshSession();
    await b.auth.signOut();
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'b'.repeat(56) });
    const at2 = b.auth.getAccessToken();
    f.respond(f.firstPending('/token'), { status: 401, text: '{}' });
    await assert.rejects(p, (e) => e.code === 'refresh_failed', '401 分类保留');
    assert.strictEqual(b.auth.getAccessToken(), at2, '旧请求失败不得清除新会话');
    /* 网络错误变体 */
    const f2 = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/logout')) return { status: 204, text: '' };
      return null;
    });
    const b2 = makeBackend(f2);
    await b2.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const p2 = b2.auth.refreshSession();
    await b2.auth.signOut();
    await b2.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'b'.repeat(56) });
    const at2b = b2.auth.getAccessToken();
    f2.rejectAt(f2.firstPending('/token'), new TypeError('fetch failed'));
    await assert.rejects(p2, (e) => e.code === 'refresh_network_failed', '网络错误分类保留');
    assert.strictEqual(b2.auth.getAccessToken(), at2b, '新会话保持不变');
  });

  await test('T39 同一有效会话内两次并发 refresh → 去重单次请求（回归基线）', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/token?grant_type=refresh_token')) return { status: 200, text: SESSION2_BODY };
      throw new Error('unexpected ' + url);
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const p1 = b.auth.refreshSession();
    const p2 = b.auth.refreshSession();
    assert.strictEqual(p1, p2, '复用同一 Promise');
    const rs = await Promise.all([p1, p2]);
    assert.ok(rs.every((r) => r.error === null));
    assert.strictEqual(b.auth.getAccessToken(), 'new.jwt.sig2');
    const tokenCalls = f.calls.filter((c) => c.url.includes('/token?grant_type=refresh_token'));
    assert.strictEqual(tokenCalls.length, 1, '实际只有一次 /token 请求');
  });

  await test('T40 signOut 立即清理本地 + 捕获旧 Bearer；2xx/拒绝/网络三态 serverRevoked 正确', async () => {
    /* A：本地立即清理 + 旧 Bearer + 2xx */
    const f = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return null; /* /logout pending */
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const loP = b.auth.signOut();
    assert.strictEqual(b.auth.getAccessToken(), null, '调用开始即不可再获取旧 token');
    const loCall = f.calls.find((c) => c.url.includes('/logout'));
    assert.strictEqual(loCall.opts.headers['Authorization'], 'Bearer fake.jwt.sig',
      '服务端撤销仍使用调用开始时捕获的旧 Bearer');
    f.respond(f.firstPending('/logout'), { status: 204, text: '' });
    const lo = await loP;
    assert.strictEqual(lo.data.signedOut, true);
    assert.strictEqual(lo.data.localCleared, true);
    assert.strictEqual(lo.data.serverRevoked, true);
    assert.strictEqual(lo.error, null);
    assert.strictEqual(b.auth.getAccessToken(), null);
    /* B：服务端拒绝（500） */
    const f2 = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return null;
    });
    const b2 = makeBackend(f2);
    await b2.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const lo2P = b2.auth.signOut();
    assert.strictEqual(b2.auth.getAccessToken(), null);
    f2.respond(f2.firstPending('/logout'), { status: 500, text: '{}' });
    const lo2 = await lo2P;
    assert.strictEqual(lo2.data.serverRevoked, false);
    assert.strictEqual(lo2.error.code, 'logout_http_failed');
    assert.strictEqual(b2.auth.getAccessToken(), null, '本地状态始终安全');
    /* C：网络失败 */
    const f3 = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      return null;
    });
    const b3 = makeBackend(f3);
    await b3.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const lo3P = b3.auth.signOut();
    f3.rejectAt(f3.firstPending('/logout'), new TypeError('fetch failed'));
    const lo3 = await lo3P;
    assert.strictEqual(lo3.data.serverRevoked, false);
    assert.strictEqual(lo3.error.code, 'logout_network_failed');
    assert.strictEqual(b3.auth.getAccessToken(), null);
    assert.strictEqual(JSON.stringify([lo2, lo3]).indexOf('fake.jwt'), -1, '结果不得泄漏旧 token');
  });

  await test('T41 旧请求 finally 与新请求交错 → 去重位不被误清，新请求正常完成', async () => {
    const f = queueFetch((url) => {
      if (url.includes('/verify')) return { status: 200, text: SESSION_BODY };
      if (url.includes('/logout')) return { status: 204, text: '' };
      return null; /* /token pending（可多个） */
    });
    const b = makeBackend(f);
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'a'.repeat(56) });
    const pOld = b.auth.refreshSession(); /* 旧代在途 */
    await b.auth.signOut();               /* 旧代失效 */
    await b.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'b'.repeat(56) }); /* 新会话 */
    const pNew = b.auth.refreshSession(); /* 新代在途（不被旧在途阻塞） */
    assert.notStrictEqual(pNew, pOld, '跨会话不得复用旧去重 Promise');
    f.respond(f.firstPending('/token'), { status: 200, text: SESSION2_BODY }); /* 旧请求迟到 200 */
    await assert.rejects(pOld, (e) => e.code === 'refresh_stale_after_logout');
    /* 旧 finally 运行后：不得清除新请求的去重位 */
    const pNew2 = b.auth.refreshSession();
    assert.strictEqual(pNew2, pNew, '旧 finally 不得误清新请求的去重标识');
    f.respond(f.firstPending('/token'), { status: 200, text: SESSION2_BODY }); /* 新请求完成 */
    const rNew = await pNew;
    assert.strictEqual(rNew.error, null);
    assert.strictEqual(b.auth.getAccessToken(), 'new.jwt.sig2');
    assert.strictEqual(f.calls.filter((c) => c.url.includes('/token?grant_type=refresh_token')).length, 2,
      '旧+新各一次（跨会话不去重）');
  });

  console.log('\n===== SUMMARY =====');
  console.log('PASS=' + passed + ' FAIL=' + failed);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
