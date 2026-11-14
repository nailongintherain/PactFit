/* =============================================================================
 * PactFit · 页面接线层 Mock 测试（零依赖，Node 18+ 直接运行）
 *   node backend/tests/pactfit-be.test.js
 *
 * 覆盖 13-H-2B-1 第八节 16 项：
 *   B1 默认 cloud 不受影响            B2 本机显式 local 才启用
 *   B3 local 不请求线上 API           B4 OTP 事件接线
 *   B5 登录后资料读取                 B6 创建空间走 RPC
 *   B7 加入空间走 RPC                 B8 records 字段正确
 *   B9 owner_id 由当前用户注入        B10 200+{ok:false} 不算成功
 *   B11 PATCH 零行不算更新            B12 登出清理页面状态
 *   B13 异步回调不复活旧状态          B14 手机号 local unsupported
 *   B15 未适配功能不触发 Cloud SDK    B16 适配层 41 项回归
 *
 * 后续追加：M5×10（signup/magiclink）、M1×5 + M2×8（页面异步写回与写入结果分类）、
 *           M3×10（local 未适配功能的提示统一 + cloud 接线不变）、
 *           PAIR×10（H-3-PAIR：view-pair 退出登录入口，复用 doLogout）、
 *           RACE×8（H-3-PAIR-RACE：跨会话重叠登出的锁归属，确定性 Promise）——合计 67 项。
 *
 * 全部为 Mock PASS——真实 GoTrue/PostgREST 验收见 H-2B-2。
 * ============================================================================= */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { execFileSync } = require('child_process');
const BE = require('../../web/pactfit-be.js');
const API = require('../client/pactfit-local-api.js');

let passed = 0, failed = 0;

/* 超时不是「慢」：这些用例的每一步交错都是手动放行的，
   一旦某个 Promise 永远没人 resolve（守卫缺失导致多发了没人答复的请求），
   Node 会因为没有待处理句柄而静默退出——那会被误读成通过。所以显式兜住。 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error('用例超时 ' + ms + 'ms：有 Promise 始终未被 resolve（通常是守卫缺失后多发了无人答复的请求）[' + label + ']'));
    }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

async function test(name, fn) {
  try {
    await withTimeout(Promise.resolve().then(fn), 8000, name);
    passed++;
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + ' :: ' + e.message);
  }
}

/* ---------- 假适配层（记录全部调用） ----------
 * opts.verifyError：让 verifyEmailOtp 以指定错误 reject（M5-7 服务端错误透传用） */
function fakeApi(opts) {
  opts = opts || {};
  const log = [];
  const api = {
    mode: 'local',
    _updated: 1,
    auth: {
      requestEmailOtp: (email) => {
        log.push(['auth.requestEmailOtp', email]);
        return Promise.resolve({ data: { sent: true }, error: null });
      },
      verifyEmailOtp: (args) => {
        log.push(['auth.verifyEmailOtp', args]);
        if (opts.verifyError) return Promise.reject(opts.verifyError);
        return Promise.resolve({ data: { session: { user: { id: 'u-1' } } }, error: null });
      },
      getSession: () => ({ data: { session: { user: { id: 'u-1' } } }, error: null }),
      signOut: () => {
        log.push(['auth.signOut']);
        return Promise.resolve({ data: { localCleared: true, serverRevoked: true }, error: null });
      }
    },
    db: {
      select: (t, f, o) => {
        log.push(['db.select', t, f, o]);
        const rows = t === 'profiles'
          ? [{ id: 1, owner_id: 'u-1', space_id: 'FIT-A', nickname: '我' }]
          : [{ id: 9, owner_id: 'u-1', space_id: 'FIT-A', record_date: '2026-11-14', weight: 80 }];
        return Promise.resolve({ data: rows, error: null });
      },
      insert: (t, b) => {
        log.push(['db.insert', t, b]);
        return Promise.resolve({ data: [Object.assign({ id: 11 }, b)], error: null });
      },
      update: (t, p, f) => {
        log.push(['db.update', t, p, f]);
        return Promise.resolve({ data: api._updated ? [{ id: f.id }] : [], meta: { updated: api._updated }, error: null });
      }
    },
    createSpace: (a) => {
      log.push(['createSpace', a]);
      return Promise.resolve({ data: { ok: true, code: 'FIT-NEW001' }, error: null });
    },
    joinSpace: (a) => {
      log.push(['joinSpace', a]);
      return Promise.resolve({ data: { ok: true, code: a.code }, error: null });
    }
  };
  return { api, log };
}

function countLog(log, name) {
  return log.filter((x) => x[0] === name).length;
}

(async function main() {

  /* ---------------- B1 默认 cloud 不受影响 ---------------- */
  await test('B1 公网/未知来源默认 cloud（query 与 localStorage 均无法开启）', async () => {
    assert.strictEqual(BE.resolveBackendMode({ hostname: 'fit-together-44172.app.workbuddy.host', search: '' }), 'cloud');
    assert.strictEqual(BE.resolveBackendMode({ hostname: 'fit-together-44172.app.workbuddy.host', search: '?local=1' }), 'cloud');
    assert.strictEqual(BE.resolveBackendMode({ hostname: 'example.com', search: '?local=1', storageFlag: true }), 'cloud');
    assert.strictEqual(BE.resolveBackendMode({ hostname: '', search: '?local=1', storageFlag: true }), 'cloud');
    /* 后缀伪装不得通过 */
    assert.strictEqual(BE.resolveBackendMode({ hostname: '127.0.0.1.evil.com', search: '?local=1' }), 'cloud');
    assert.strictEqual(BE.resolveBackendMode({ hostname: 'localhost.evil.com', search: '?local=1' }), 'cloud');
  });

  /* ---------------- B2 本机显式 local 才启用 ---------------- */
  await test('B2 仅回环主机 + 显式开关 → local', async () => {
    assert.strictEqual(BE.resolveBackendMode({ hostname: '127.0.0.1', search: '' }), 'cloud', '回环但未显式开启仍是 cloud');
    assert.strictEqual(BE.resolveBackendMode({ hostname: '127.0.0.1', search: '?local=1' }), 'local');
    assert.strictEqual(BE.resolveBackendMode({ hostname: 'localhost', search: '?local=1' }), 'local');
    assert.strictEqual(BE.resolveBackendMode({ hostname: 'localhost', search: '', storageFlag: true }), 'local');
    assert.strictEqual(BE.resolveBackendMode({ hostname: '::1', search: '?local=1' }), 'local');
    assert.strictEqual(BE.resolveBackendMode({ hostname: '127.0.0.1', search: '?local=0' }), 'cloud', '仅 local=1 生效');
    assert.strictEqual(BE.resolveBackendMode({ hostname: '127.0.0.1', search: '?Local=1' }), 'cloud', '大小写敏感');
  });

  /* ---------------- B3 local 不请求线上 API ---------------- */
  await test('B3 local 桥零网络请求（fetch 全被拦截仍全部成功）', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const origFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = function () { fetchCalls++; return Promise.reject(new Error('禁止网络请求')); };
    try {
      await bridge.requestEmailOtp('a@b.c');
      /* H-3-M5 修订：本 fixture 原先用「带 token 但无 type」的链接，
         新契约要求 type 才能判定 signup/magiclink，故补上 &type=magiclink。
         断言强度不变（仍是 7 次适配层调用 + 零网络），仅修正输入形态。 */
      await bridge.verifyEmailLink('http://127.0.0.1:8025/verify?token=' + 'a'.repeat(56) + '&type=magiclink');
      await bridge.getSession();
      await bridge.listProfiles();
      await bridge.listRecords();
      await bridge.insertRecord({ space_id: 'FIT-A', record_date: '2026-11-14', weight: 80 });
      await bridge.createSpace({ nickname: 'n', startWeight: 80, targetWeight: 70 });
      await bridge.signOut();
    } finally {
      global.fetch = origFetch;
    }
    assert.strictEqual(fetchCalls, 0, 'local 桥自身不得发起任何网络请求');
    assert.strictEqual(log.length, 7, '全部业务经适配层完成（7 次调用：OTP/verify/2×select/insert/createSpace/signOut）');
  });

  /* ---------------- B4 OTP 事件接线 ---------------- */
  await test('B4 邮箱 OTP 走适配层 requestEmailOtp（非 SDK sendOtp）', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const r = await bridge.requestEmailOtp('  user@pactfit.local  ');
    assert.deepStrictEqual(r, { sent: true });
    assert.strictEqual(countLog(log, 'auth.requestEmailOtp'), 1);
    assert.strictEqual(log[0][1], 'user@pactfit.local', '邮箱需 trim 后传入');
    assert.strictEqual(typeof bridge.requestEmailOtp, 'function');
  });

  /* ---------------- B5 登录后资料读取 ---------------- */
  await test('B5 链接验证 token_hash + profiles 读取透传', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const v = await bridge.verifyEmailLink('打开链接 https://x/verify?token=' + 'b'.repeat(56) + '&type=magiclink');
    assert.strictEqual(v.userId, 'u-1');
    const args = log.find((x) => x[0] === 'auth.verifyEmailOtp')[1];
    assert.deepStrictEqual(args, { type: 'magiclink', token_hash: 'b'.repeat(56) },
      '必须从链接中提取 token 且使用 magiclink 类型');
    const rows = await bridge.listProfiles();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].owner_id, 'u-1');
    assert.strictEqual(countLog(log, 'db.select'), 1);
    assert.strictEqual(log.find((x) => x[0] === 'db.select')[1], 'profiles');
  });

  /* ---------------- B6 创建空间走 RPC ---------------- */
  await test('B6 创建空间走 rpc_create_space 映射，绝不直插 profiles', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const r = await bridge.createSpace({ nickname: '小明', startWeight: 82.5, targetWeight: 70 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.code, 'FIT-NEW001');
    const call = log.find((x) => x[0] === 'createSpace')[1];
    assert.deepStrictEqual(call, { nickname: '小明', role: 'her', startWeight: 82.5, targetWeight: 70 });
    assert.strictEqual(countLog(log, 'db.insert'), 0, 'profiles 直插必须为零');
  });

  /* ---------------- B7 加入空间走 RPC ---------------- */
  await test('B7 加入空间走 rpc_join_space 映射（口令大写）', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const r = await bridge.joinSpace({ code: 'fit-ab12cd', nickname: '小红', startWeight: 60, targetWeight: 52 });
    assert.strictEqual(r.ok, true);
    const call = log.find((x) => x[0] === 'joinSpace')[1];
    assert.deepStrictEqual(call, { code: 'FIT-AB12CD', nickname: '小红', role: 'her', startWeight: 60, targetWeight: 52 });
    assert.strictEqual(countLog(log, 'db.insert'), 0);
    await assert.rejects(bridge.joinSpace({ nickname: 'x', startWeight: 60, targetWeight: 52 }), (e) => e.code === 'bad_request');
  });

  /* ---------------- B8 records 字段正确 ---------------- */
  await test('B8 records 新增必填 space_id/record_date/weight 且拒绝缺项', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const row = await bridge.insertRecord({
      space_id: 'FIT-A', record_date: '2026-11-14', weight: 79.5,
      tags: ['跑步 30 分钟'], mood: '好', note: 'n', owner_name: '我'
    });
    assert.strictEqual(row.id, 11);
    const [, table, body] = log.find((x) => x[0] === 'db.insert');
    assert.strictEqual(table, 'records');
    assert.strictEqual(body.space_id, 'FIT-A');
    assert.strictEqual(body.record_date, '2026-11-14');
    assert.strictEqual(body.weight, 79.5);
    assert.ok(Array.isArray(body.tags));

    await assert.rejects(bridge.insertRecord({ record_date: '2026-11-14', weight: 79 }), (e) => e.code === 'bad_request');
    await assert.rejects(bridge.insertRecord({ space_id: 'FIT-A', weight: 79 }), (e) => e.code === 'bad_request');
    await assert.rejects(bridge.insertRecord({ space_id: 'FIT-A', record_date: '2026-11-14' }), (e) => e.code === 'bad_request');
    await assert.rejects(bridge.insertRecord({ space_id: 'FIT-A', record_date: '2026-11-14', weight: 'x' }), (e) => e.code === 'bad_request');
    assert.strictEqual(countLog(log, 'db.insert'), 1, '校验失败不得产生写请求');
  });

  /* ---------------- B9 owner_id 由当前用户注入 ---------------- */
  await test('B9 owner_id 拒绝调用方伪造；真实适配层按 sub 注入', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    await assert.rejects(
      bridge.insertRecord({ space_id: 'FIT-A', record_date: '2026-11-14', weight: 80, owner_id: 'other' }),
      (e) => e.code === 'owner_mismatch'
    );
    assert.strictEqual(countLog(log, 'db.insert'), 0, '伪造 owner_id 必须零请求');

    await bridge.insertRecord({ space_id: 'FIT-A', record_date: '2026-11-14', weight: 80 });
    const body = log.find((x) => x[0] === 'db.insert')[2];
    assert.strictEqual(body.owner_id, undefined, '桥不传 owner_id，交由适配层注入');

    /* 跨层：真实适配层 + mock fetch，验证最终 payload 的 owner_id = 当前 sub */
    const SUB = 'u-9';
    let captured = null;
    const fetchMock = (url, opts) => {
      const u = String(url);
      if (u.indexOf('/verify') >= 0) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
          access_token: 'jwt', refresh_token: 'rt', user: { id: SUB }
        })) });
      }
      if (u.indexOf('/records') >= 0) {
        captured = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('[]') });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('{}') });
    };
    const real = API.createLocalBackend(
      { mode: 'local', authUrl: 'http://127.0.0.1:9999', restUrl: 'http://127.0.0.1:3000' }, fetchMock);
    await real.auth.verifyEmailOtp({ type: 'magiclink', token_hash: 'c'.repeat(56) });
    const realBridge = BE.createLocalBridge({ api: real });
    await realBridge.insertRecord({ space_id: 'FIT-A', record_date: '2026-11-14', weight: 80 });
    assert.ok(captured, '应产生 records 写请求');
    assert.strictEqual(captured.owner_id, SUB, 'owner_id 必须由适配层按当前 sub 注入');
  });

  /* ---------------- B10 200 + {ok:false} 不算成功 ---------------- */
  await test('B10 HTTP 200 + {ok:false} 判为失败并保留业务码', async () => {
    const { api } = fakeApi();
    api.createSpace = () => Promise.resolve({ data: { ok: false, code: 'invalid_nickname' }, error: null });
    api.joinSpace = () => Promise.resolve({ data: { ok: false, code: 'invalid_code' }, error: null });
    const bridge = BE.createLocalBridge({ api: api });
    const c = await bridge.createSpace({ nickname: 'x'.repeat(30), startWeight: 80, targetWeight: 70 });
    assert.strictEqual(c.ok, false, '必须判为失败');
    assert.strictEqual(c.code, 'invalid_nickname');
    const j = await bridge.joinSpace({ code: 'FIT-NONE01', nickname: 'n', startWeight: 80, targetWeight: 70 });
    assert.strictEqual(j.ok, false);
    assert.strictEqual(j.code, 'invalid_code');
  });

  /* ---------------- B11 PATCH 零行不算更新 ---------------- */
  await test('B11 meta.updated=0（含 204 零行）不得当作更新成功', async () => {
    const { api } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    api._updated = 0;
    const r0 = await bridge.updateRecord(42, { weight: 78 });
    assert.strictEqual(r0.updated, 0);
    assert.strictEqual(r0.applied, false, '零行必须 applied=false');
    api._updated = 1;
    const r1 = await bridge.updateRecord(42, { weight: 78 });
    assert.strictEqual(r1.updated, 1);
    assert.strictEqual(r1.applied, true);
    await assert.rejects(bridge.updateRecord(null, { weight: 78 }), (e) => e.code === 'bad_request');
  });

  /* ---------------- B12 登出清理页面状态 ---------------- */
  await test('B12 登出清理全部用户态，且区分本地/服务端结果', async () => {
    const { api } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const S = {
      loggedIn: true, profile: { id: 1 }, partner: { id: 2 }, others: [{ id: 2 }],
      profiles: [{ id: 1 }], myProfiles: [{ id: 1 }], allProfiles: [{ id: 1 }],
      space: 'FIT-A', records: [{}], allRecords: [{}], todos: [{}], tags: [{}],
      rewards: [{}], messages: [{}],
      draft: { weight: 81.2, tags: ['夜宵'], todoDone: [1], mood: 'bad', note: '残留' }
    };
    BE.clearUserState(S);
    assert.strictEqual(S.loggedIn, false);
    assert.strictEqual(S.profile, null);
    assert.strictEqual(S.partner, null);
    assert.deepStrictEqual(S.others, []);
    assert.deepStrictEqual(S.profiles, []);
    assert.deepStrictEqual(S.myProfiles, []);
    assert.deepStrictEqual(S.allProfiles, []);
    assert.strictEqual(S.space, '');
    assert.deepStrictEqual(S.records, []);
    assert.deepStrictEqual(S.allRecords, []);
    assert.deepStrictEqual(S.todos, []);
    assert.deepStrictEqual(S.tags, []);
    assert.deepStrictEqual(S.rewards, []);
    assert.deepStrictEqual(S.messages, []);
    /* H-3-M1：未提交草稿也是上个用户的输入，必须一起清掉 */
    assert.deepStrictEqual(S.draft, { weight: null, tags: [], todoDone: [], mood: null, note: '' });

    const out = await bridge.signOut();
    assert.strictEqual(out.localCleared, true);
    assert.strictEqual(out.serverRevoked, true);

    api.auth.signOut = () => Promise.resolve({ data: { localCleared: true, serverRevoked: false }, error: null });
    const out2 = await BE.createLocalBridge({ api: api }).signOut();
    assert.strictEqual(out2.localCleared, true);
    assert.strictEqual(out2.serverRevoked, false, '服务端未确认时不得声称已撤销');
  });

  /* ---------------- B13 异步回调不复活旧状态 ---------------- */
  await test('B13 登出后旧的登录/加载回调不得复活 UI 状态', async () => {
    const guard = BE.createSessionGuard();
    const S = { loggedIn: false, profile: null };
    let resolveSlow;
    const slow = new Promise((r) => { resolveSlow = r; });

    /* 模拟 afterLogin：拿到代数后开始长异步 */
    const ep = guard.current();
    const flow = slow.then(() => {
      if (!guard.isCurrent(ep)) return 'dropped';
      S.loggedIn = true; S.profile = { id: 1 };
      return 'applied';
    });

    guard.bump();                       /* 用户登出：代数 +1 */
    BE.clearUserState(S);               /* 页面立即清理 */
    resolveSlow({ id: 1 });             /* 迟到的响应落地 */
    const outcome = await flow;
    assert.strictEqual(outcome, 'dropped', '过期代数必须丢弃');
    assert.strictEqual(S.loggedIn, false, '不得复活登录态');
    assert.strictEqual(S.profile, null);

    const ep2 = guard.current();
    assert.strictEqual(guard.isCurrent(ep2), true);
    assert.strictEqual(guard.isCurrent(ep), false);
  });

  /* ---------------- B14 手机号 local unsupported ---------------- */
  await test('B14 手机号登录在 local 明确不支持（零调用、零伪装）', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    await assert.rejects(bridge.requestPhoneOtp('13800000000'), (e) =>
      e.code === 'unsupported_in_local_mode' && /手机号/.test(e.message));
    assert.strictEqual(log.length, 0, '不得调用任何适配层能力');
  });

  /* ---------------- B15 未适配功能不触发 Cloud SDK ---------------- */
  await test('B15 未适配功能抛明确错误、零网络、无 SDK 调用', async () => {
    const blocked = BE.createBlockedCloud();
    const origFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = function () { fetchCalls++; return Promise.reject(new Error('no network')); };
    try {
      assert.throws(() => blocked.auth.sendOtp({ phone: '1' }), (e) => e.code === 'unsupported_in_local_mode');
      assert.throws(() => blocked.auth.verifyOtp({}), (e) => e.code === 'unsupported_in_local_mode');
      assert.throws(() => blocked.auth.getSession(), (e) => e.code === 'unsupported_in_local_mode');
      assert.throws(() => blocked.database.from('todos'), (e) => e.code === 'unsupported_in_local_mode');
      assert.throws(() => blocked.database.rpc('rpc_reward_create'), (e) => e.code === 'unsupported_in_local_mode');
    } finally {
      global.fetch = origFetch;
    }
    assert.strictEqual(fetchCalls, 0, '拒绝桩不得触发网络');
    ['phone-login', 'todos', 'tags', 'rewards', 'messages', 'space-peek'].forEach((k) => {
      assert.ok(BE.UNSUPPORTED_FEATURES.indexOf(k) >= 0, '未适配清单应包含 ' + k);
    });
    const { api } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    await assert.rejects(bridge.unsupported('奖励'), (e) => e.code === 'unsupported_in_local_mode');
  });

  /* =========================================================================
   * H-3-M5：新用户 signup / 已有用户 magiclink 兼容修复专项
   *   契约：GoTrue 邮件链接 = /verify?token=<56hex>&type=<signup|magiclink>
   *   原则：类型只取自链接；歧义一律本地拒绝（零请求）；服务端错误原样透出；
   *         绝不「先 magiclink 失败再试 signup」。
   * ========================================================================= */

  const M5_TOK = (c) => c.repeat(56);
  const M5_LINK = (token, type) =>
    'http://127.0.0.1:9999/verify?token=' + token + '&type=' + type +
    '&redirect_to=' + encodeURIComponent('http://127.0.0.1:8899/?local=1');

  /* ---------------- M5-1 完整 signup 链接 ---------------- */
  await test('M5-1 signup 链接 → type=signup 且 token_hash 正确', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const v = await bridge.verifyEmailLink(M5_LINK(M5_TOK('c'), 'signup'));
    const args = log.find((x) => x[0] === 'auth.verifyEmailOtp')[1];
    assert.deepStrictEqual(args, { type: 'signup', token_hash: M5_TOK('c') }, '必须按 signup 类型构造，且只取链接里的 token');
    assert.deepStrictEqual(v, { userId: 'u-1', hasSession: true, type: 'signup' });
    assert.strictEqual(countLog(log, 'auth.verifyEmailOtp'), 1, '只允许一次验证请求');
  });

  /* ---------------- M5-2 完整 magiclink 链接 ---------------- */
  await test('M5-2 magiclink 链接 → type=magiclink（已有用户行为不变）', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const v = await bridge.verifyEmailLink(M5_LINK(M5_TOK('d'), 'magiclink'));
    const args = log.find((x) => x[0] === 'auth.verifyEmailOtp')[1];
    assert.deepStrictEqual(args, { type: 'magiclink', token_hash: M5_TOK('d') });
    assert.deepStrictEqual(v, { userId: 'u-1', hasSession: true, type: 'magiclink' });
    assert.strictEqual(countLog(log, 'auth.verifyEmailOtp'), 1);
  });

  /* ---------------- M5-3 裸 token 兼容策略 ---------------- */
  await test('M5-3 裸 token 不猜测类型：明确要求完整链接，零请求', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    await assert.rejects(bridge.verifyEmailLink(M5_TOK('e')), (e) =>
      e.code === 'bad_request' && /完整/.test(e.message) && /链接/.test(e.message));
    assert.strictEqual(log.length, 0, '裸 token 不得触发任何适配层调用（无法判定 signup/magiclink）');
    assert.throws(() => BE.extractTokenHash(M5_TOK('e')), (e) => e.code === 'bad_request',
      '兼容导出同样不接受无 type 输入');
  });

  /* ---------------- M5-4 缺少 token ---------------- */
  await test('M5-4 链接缺 token → 本地拒绝，零 HTTP', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    await assert.rejects(bridge.verifyEmailLink('http://127.0.0.1:9999/verify?type=signup'), (e) =>
      e.code === 'bad_request' && /token/.test(e.message));
    await assert.rejects(bridge.verifyEmailLink('http://127.0.0.1:9999/verify?token=&type=signup'), (e) =>
      e.code === 'bad_request');
    assert.strictEqual(log.length, 0, '零适配层调用');
  });

  /* ---------------- M5-5 未知 / 不支持的 type ---------------- */
  await test('M5-5 未知 type → unsupported_verification_type，零 HTTP', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    for (const bad of ['recovery', 'invite', 'email_change', 'email', 'magic_link', '']) {
      await assert.rejects(bridge.verifyEmailLink(M5_LINK(M5_TOK('f'), bad)), (e) =>
        e.code === 'unsupported_verification_type', 'type=' + bad + ' 必须被拒绝');
    }
    assert.strictEqual(log.length, 0, '零适配层调用');
    /* 大小写归一：仅大小写不同的合法类型仍按小写提交（不改变语义） */
    const bridge2 = BE.createLocalBridge({ api: fakeApi().api });
    const v = await bridge2.verifyEmailLink(M5_LINK(M5_TOK('a'), 'SIGNUP'));
    assert.strictEqual(v.type, 'signup');
  });

  /* ---------------- M5-6 非法编码 / 重复冲突参数 / 非链接 ---------------- */
  await test('M5-6 歧义输入 → 安全拒绝，绝不执行错误类型的验证', async () => {
    const { api, log } = fakeApi();
    const bridge = BE.createLocalBridge({ api: api });
    const cases = [
      'http://127.0.0.1:9999/verify?token=%zz&type=signup',                                   /* 非法百分号编码 */
      'http://127.0.0.1:9999/verify?token=' + M5_TOK('a') + '&token=' + M5_TOK('b') + '&type=signup', /* 冲突 token */
      'http://127.0.0.1:9999/verify?token=' + M5_TOK('a') + '&type=signup&type=magiclink',     /* 冲突 type */
      'http://127.0.0.1:9999/verify?token=abc&type=signup',                                    /* token 形态不符 */
      '这是一段没有链接的文字',                                                                  /* 非链接 */
      'ftp://127.0.0.1/verify?token=' + M5_TOK('a') + '&type=signup',                           /* 非 http(s) */
      ''                                                                                        /* 空输入 */
    ];
    for (const c of cases) {
      await assert.rejects(bridge.verifyEmailLink(c), (e) => e.code === 'bad_request', '应拒绝：' + c.slice(0, 48));
    }
    assert.strictEqual(log.length, 0, '全部在本地拒绝，零适配层调用、零 token 消耗');
    /* 重复但一致的同名参数不构成歧义 */
    const v = await bridge.verifyEmailLink('http://127.0.0.1:9999/verify?token=' + M5_TOK('a') +
      '&token=' + M5_TOK('a') + '&type=signup');
    assert.strictEqual(v.type, 'signup');
  });

  /* ---------------- M5-7 服务端 otp_expired 原样透出 ---------------- */
  await test('M5-7 服务端 otp_expired 保留分类，不换 type 重试', async () => {
    const err = new Error('otp_expired: Email link is invalid or has expired');
    err.code = 'otp_expired';
    const { api, log } = fakeApi({ verifyError: err });
    const bridge = BE.createLocalBridge({ api: api });
    await assert.rejects(bridge.verifyEmailLink(M5_LINK(M5_TOK('b'), 'signup')), (e) =>
      e.code === 'otp_expired' && /otp_expired/.test(e.message));
    assert.strictEqual(countLog(log, 'auth.verifyEmailOtp'), 1,
      '失败后不得再尝试另一种 type（实测类型不匹配与真过期同码，重试会掩盖真错并浪费 token）');
    const calls = log.filter((x) => x[0] === 'auth.verifyEmailOtp').map((x) => x[1].type);
    assert.deepStrictEqual(calls, ['signup'], '只提交链接自带的 type');
  });

  /* ---------------- M5-8 两种类型得到一致结构 ---------------- */
  await test('M5-8 signup / magiclink 成功时返回结构一致', async () => {
    const a = BE.createLocalBridge({ api: fakeApi().api });
    const b = BE.createLocalBridge({ api: fakeApi().api });
    const [s, m] = await Promise.all([
      a.verifyEmailLink(M5_LINK(M5_TOK('c'), 'signup')),
      b.verifyEmailLink(M5_LINK(M5_TOK('d'), 'magiclink'))
    ]);
    assert.deepStrictEqual(Object.keys(s).sort(), ['hasSession', 'type', 'userId']);
    assert.deepStrictEqual(Object.keys(m).sort(), ['hasSession', 'type', 'userId']);
    assert.strictEqual(s.userId, m.userId);
    assert.strictEqual(s.hasSession, true);
    assert.strictEqual(m.hasSession, true);
    assert.notStrictEqual(s.type, m.type);
  });

  /* ---------------- M5-9 token 不泄漏 ---------------- */
  await test('M5-9 token_hash 不进入错误消息、返回值或控制台', async () => {
    const token = M5_TOK('e');
    const captured = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a) => captured.push(a.join(' '));
    console.warn = (...a) => captured.push(a.join(' '));
    console.error = (...a) => captured.push(a.join(' '));
    try {
      const { api } = fakeApi();
      const bridge = BE.createLocalBridge({ api: api });
      const ok = await bridge.verifyEmailLink(M5_LINK(token, 'signup'));
      assert.strictEqual(JSON.stringify(ok).indexOf(token), -1, '成功返回值不得含 token');

      const err = new Error('otp_expired: Email link is invalid or has expired');
      err.code = 'otp_expired';
      const bad = BE.createLocalBridge({ api: fakeApi({ verifyError: err }).api });
      await assert.rejects(bad.verifyEmailLink(M5_LINK(token, 'magiclink')),
        (e) => e.message.indexOf(token) === -1 && e.code === 'otp_expired');

      /* 解析期错误消息同样不得回显 token */
      await assert.rejects(bridge.verifyEmailLink(M5_LINK(token, 'recovery')),
        (e) => e.message.indexOf(token) === -1);
      await assert.rejects(bridge.verifyEmailLink('http://127.0.0.1:9999/verify?token=' + token + '&type=signup&type=magiclink'),
        (e) => e.message.indexOf(token) === -1);
    } finally {
      console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
    }
    assert.strictEqual(captured.filter((line) => line.indexOf(token) >= 0).length, 0,
      '控制台输出不得出现 token_hash');
  });

  /* ---------------- M5-10 cloud 默认路径与原接线不变 ---------------- */
  await test('M5-10 cloud 默认路径、SDK 初始化与登录接线不变', async () => {
    const fs = require('fs');
    /* 模式判定默认仍是 cloud */
    assert.strictEqual(BE.resolveBackendMode({ hostname: 'fit-together.example.com', search: '' }), 'cloud');
    assert.strictEqual(BE.resolveBackendMode({ hostname: '127.0.0.1', search: '' }), 'cloud');
    /* 拒绝桩仍拦截 verifyOtp（local 模式不得走 SDK） */
    const blocked = BE.createBlockedCloud();
    assert.throws(() => blocked.auth.verifyOtp({}), (e) => e.code === 'unsupported_in_local_mode');

    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
    const cdn = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';
    assert.strictEqual(html.split(cdn).length - 1, 1, 'CDN SDK 地址必须唯一且未变');
    assert.ok(/createWorkBuddyCloud\(\{[\s\S]{0,200}endpoint:[\s\S]{0,80}oauthRelayBaseUrl:[\s\S]{0,80}publishableKey:/.test(html),
      'SDK 初始化参数键名不得变化');
    /* 页面只把原始输入交给桥层，不得自带 type */
    assert.ok(/await LB\.verifyEmailLink\(token\);/.test(html), 'local 登录仍以单参数调用桥层');
    assert.ok(!/verifyEmailLink\([^)]*,\s*['"]?(signup|magiclink)/.test(html), '页面不得向桥层传 type');
    assert.ok(/cloud\.auth\.verifyOtp\(args\)/.test(html), 'cloud 登录分支保持原样');
  });

  /* ---------------- B16 适配层 41 项回归 ---------------- */
  await test('B16 适配层原有 41 项 Mock 全部通过 + web 副本与源文件一致', async () => {
    const target = path.join(__dirname, '..', 'client', 'pactfit-local-api.test.js');
    const out = execFileSync(process.execPath, [target], { encoding: 'utf8', timeout: 60000 });
    assert.ok(/PASS=41 FAIL=0/.test(out), '适配层回归必须 PASS=41 FAIL=0，实际：' + out.slice(-120));

    /* 部署单元（web/）中的副本必须与 backend/client 源文件逐字节一致，防漂移 */
    const fs = require('fs');
    const crypto = require('crypto');
    const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const src = path.join(__dirname, '..', 'client', 'pactfit-local-api.js');
    const deployed = path.join(__dirname, '..', '..', 'web', 'pactfit-local-api.js');
    assert.strictEqual(sha(deployed), sha(src), 'web/pactfit-local-api.js 必须与 backend/client 源文件一致');
  });

  /* =========================================================================
   * H-3-M1M2：真实页面函数级竞态测试
   * -------------------------------------------------------------------------
   * 直接把 web/index.html 的内联主脚本放进 vm 上下文运行，驱动页面自己的
   * loadAllLocal / saveRecord / mirrorToday / doLogout / afterLogin。
   * 理由：B13 那种「独立 guard 单测」只能证明 guard 可用，证明不了页面已经
   * 接线；本节的断言全部落在页面的真实函数与真实 S 上。
   *
   * DOM / localStorage / 定时器用最小桩；网络用可控 Promise；
   * 所有交错由测试手动 resolve / reject 决定，不用 setTimeout 赌时序。
   * 零网络、零容器、零数据库、零凭据落盘。
   * ========================================================================= */

  function beErr(code, message) {
    const e = new Error(code + ': ' + message);
    e.code = code;
    return e;
  }

  function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  function flush() { return new Promise((r) => setImmediate(r)); }

  /* 页面在 vm 里构造的对象带着另一个 realm 的 Object.prototype，
     deepStrictEqual 会因原型不同而失败——比较前先摊平成纯数据。 */
  function plain(x) { return JSON.parse(JSON.stringify(x)); }

  function todayLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 可控假适配层：每次调用都挂起，等测试显式答复 */
  function pageApi() {
    const calls = [];
    const pending = [];
    let user = null;
    let autoSignOut = true;

    function hold(kind, table, extra) {
      const d = deferred();
      const rec = Object.assign({ kind: kind, table: table, d: d, done: false }, extra || {});
      pending.push(rec);
      return d.promise;
    }
    function take(kind, table, which) {
      const idxs = [];
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (!p.done && p.kind === kind && (!table || p.table === table)) idxs.push(i);
      }
      if (!idxs.length) return null;
      const i = which === -1 ? idxs[idxs.length - 1] : idxs[0];
      pending[i].done = true;
      return pending[i];
    }

    const api = {
      mode: 'local',
      calls: calls,
      pending: pending,
      setUser(id) { user = id; },
      holdSignOut() { autoSignOut = false; },
      take: take,
      count(kind, table) {
        return calls.filter((c) => c[0] === kind && (!table || c[1] === table)).length;
      },
      live() { return pending.filter((p) => !p.done).length; },
      /* 服务端有答复（成功或业务错误信封，都由 result 决定） */
      respond(kind, table, result, which) {
        const p = take(kind, table, which);
        assert.ok(p, '期望有一条在途的 ' + kind + ' ' + (table || ''));
        p.d.resolve(Object.assign({ data: [], error: null }, result || {}));
        return p;
      },
      fail(kind, table, err, which) {
        return api.respond(kind, table, { data: null, error: err || beErr('permission_denied', 'RLS 拒绝') }, which);
      },
      /* 网络层直接失败：真实 fetch 被拒时适配层不包装，是裸 TypeError（无 code） */
      netfail(kind, table, which) {
        const p = take(kind, table, which);
        assert.ok(p, '期望有一条在途的 ' + kind + ' ' + (table || ''));
        p.d.reject(new TypeError('Failed to fetch'));
        return p;
      },
      db: {
        select(t) { calls.push(['select', t]); return hold('select', t); },
        insert(t, b) { calls.push(['insert', t, b]); return hold('insert', t, { body: b }); },
        update(t, patch, filter) { calls.push(['update', t, patch, filter]); return hold('update', t, { body: patch, filter: filter }); }
      },
      auth: {
        getSession() {
          calls.push(['getSession']);
          return {
            data: { session: user ? { user: { id: user } } : null, user: user ? { id: user } : null },
            error: null
          };
        },
        signOut() {
          calls.push(['signOut']);
          if (autoSignOut) {
            return Promise.resolve({ data: { localCleared: true, serverRevoked: true }, error: null });
          }
          return hold('signOut', null);
        },
        requestEmailOtp() { return Promise.resolve({ data: { sent: true }, error: null }); },
        verifyEmailOtp() { return Promise.resolve({ data: { session: { user: { id: user } } }, error: null }); }
      },
      createSpace(a) {
        calls.push(['createSpace', a]);
        return Promise.resolve({ data: { ok: true, code: 'FIT-NEW001' }, error: null });
      },
      joinSpace(a) {
        calls.push(['joinSpace', a]);
        return Promise.resolve({ data: { ok: true, code: a.code }, error: null });
      }
    };
    return api;
  }

  /* 把 web/index.html 的内联主脚本跑起来，返回可驱动的页面
   * opts.backend  'local'（默认）| 'cloud'
   * opts.cloud    cloud 模式下由 mock SDK 工厂返回的实例（含 database/auth）
   * opts.onInit   记录 createWorkBuddyCloud 的初始化参数（验证 SDK 参数未变）
   * opts.prompt   prompt() 的返回值（add* 类入口用） */
  function createPage(opts) {
    opts = opts || {};
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
    const blocks = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) blocks.push(m[1]);
    assert.ok(blocks.length >= 1, 'index.html 必须含内联脚本块');
    const code = blocks[blocks.length - 1];
    assert.ok(code.indexOf('async function saveRecord') > 0, '应取到页面主脚本块');

    const api = pageApi();
    const els = new Map();
    const ui = { toasts: [], renders: 0 };

    function makeEl(id) {
      return {
        id: id, textContent: '', innerHTML: '', value: '', disabled: false,
        onclick: null, oninput: null, style: { cssText: '' }, firstChild: null, scrollTop: 0,
        classList: {
          _s: {},
          add(c) { this._s[c] = 1; },
          remove(c) { delete this._s[c]; },
          contains(c) { return !!this._s[c]; },
          toggle(c, on) {
            if (on === undefined) { if (this._s[c]) delete this._s[c]; else this._s[c] = 1; }
            else if (on) this._s[c] = 1; else delete this._s[c];
          }
        },
        setAttribute(k, v) { this['attr_' + k] = v; },
        getAttribute(k) { return this['attr_' + k]; },
        insertBefore() {}, appendChild() {}, removeChild() {},
        addEventListener() {}, removeEventListener() {},
        querySelectorAll() { return []; }, querySelector() { return null; },
        focus() {}, blur() {}, click() {}, select() {}, scrollIntoView() {}
      };
    }
    function el(id) {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    }

    const store = new Map();
    const localStorage = {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
      clear() { store.clear(); }
    };

    const sandbox = {
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      setTimeout() { return 0; },
      clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
      localStorage: localStorage,
      location: {
        search: '', pathname: '/index.html', origin: 'http://127.0.0.1:8899',
        hostname: '127.0.0.1', href: 'http://127.0.0.1:8899/index.html',
        replace() {}, assign() {}
      },
      history: { replaceState() {}, pushState() {} },
      navigator: { userAgent: 'pactfit-test' },
      addEventListener() {}, removeEventListener() {},
      matchMedia() { return { matches: false, addListener() {}, removeListener() {} }; },
      /* openSheet 用 requestAnimationFrame 做入场动画：桩掉，不跑动画也不影响后续绑定 */
      requestAnimationFrame() { return 0; },
      cancelAnimationFrame() {},
      prompt() { return opts.prompt === undefined ? null : opts.prompt; },
      document: {
        getElementById(id) { return el(id); },
        createElement() { return makeEl('created'); },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        addEventListener() {}, removeEventListener() {},
        write() {},
        body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html')
      },
      PactFitBE: BE,
      PactFitLocalApi: { createLocalBackend() { return api; } },
      __PACTFIT_BACKEND__: opts.backend === 'cloud' ? 'cloud' : 'local'
    };
    if (opts.backend === 'cloud') {
      /* cloud 模式：不连真实 API，SDK 由测试注入；初始化参数原样记录下来供断言 */
      sandbox.WorkBuddyCloud = {
        createWorkBuddyCloud(cfg) {
          if (opts.onInit) opts.onInit(cfg);
          return opts.cloud;
        }
      };
    }
    sandbox.window = sandbox;
    sandbox.self = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'web/index.html#inline' });

    /* 真实渲染函数留一份：M3 需要看渲染出来的 DOM 字符串与真实绑定 */
    const origRender = {
      renderAll: sandbox.renderAll,
      renderHome: sandbox.renderHome,
      renderRecord: sandbox.renderRecord
    };

    /* 本节只验状态写入，不验 DOM 输出：渲染换计数、toast 换捕获 */
    ['renderAll', 'renderHome', 'renderTrend', 'renderUs', 'renderRecord'].forEach((k) => {
      sandbox[k] = function () { ui.renders++; };
    });
    sandbox.toast = function (msg) { ui.toasts.push(String(msg)); };

    const page = {
      api: api,
      ui: ui,
      ctx: sandbox,
      el: el,
      orig: origRender,
      get S() { return sandbox.S; },
      get uid() { return sandbox.uid; },
      view() {
        const ids = ['view-boot', 'view-login', 'view-pair', 'app'];
        for (let i = 0; i < ids.length; i++) {
          const e = els.get(ids[i]);
          if (e && !e.classList.contains('hidden')) return ids[i];
        }
        return '(none)';
      },
      lastToast() { return ui.toasts.length ? ui.toasts[ui.toasts.length - 1] : ''; },
      async settle() { await flush(); await flush(); }
    };
    return page;
  }

  const ROWS_A = [
    { id: 1, owner_id: 'user-A', space_id: 'FIT-A', nickname: '小鹿A' },
    { id: 2, owner_id: 'user-B', space_id: 'FIT-A', nickname: '小熊B' }
  ];
  const ROWS_B = [
    { id: 5, owner_id: 'user-B', space_id: 'FIT-B', nickname: '小熊B' },
    { id: 6, owner_id: 'user-A', space_id: 'FIT-B', nickname: '小鹿A' }
  ];

  /* 登录到 app（正常路径），rows/recs 由调用方给。
     which=-1 时挑最新的那条 profiles 请求（有旧会话遗留请求在途时用）。 */
  async function loginOk(page, userId, rows, recs, which) {
    page.api.setUser(userId);
    const p = page.ctx.afterLogin();
    await page.settle();
    page.api.respond('select', 'profiles', { data: rows }, which);
    await page.settle();
    page.api.respond('select', 'records', { data: recs || [] }, which);
    await p;
    await page.settle();
  }

  /* ---------------- M1-1 profiles 在途登出 ---------------- */
  await test('M1-1 profiles 在途 → 登出 → 旧响应返回：个人缓存全部保持清空', async () => {
    const page = createPage();
    await page.settle();
    page.api.setUser('user-A');
    const p = page.ctx.afterLogin();
    await page.settle();

    assert.strictEqual(page.api.count('select', 'profiles'), 1, '应停在 listProfiles');
    assert.strictEqual(page.api.live(), 1);

    const off = page.ctx.doLogout();
    await page.settle();
    await off;
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.uid, '', '登出后 uid 必须清空');

    page.api.respond('select', 'profiles', { data: ROWS_A });   /* 迟到的旧响应 */
    await p;
    await page.settle();

    const S = page.S;
    assert.strictEqual(S.allProfiles.length, 0, 'allProfiles 不得被旧响应写回');
    assert.strictEqual(S.profiles.length, 0);
    assert.strictEqual(S.myProfiles.length, 0);
    assert.strictEqual(S.allRecords.length, 0);
    assert.strictEqual(S.records.length, 0);
    assert.strictEqual(S.profile, null);
    assert.strictEqual(S.partner, null);
    assert.strictEqual(S.space, '');
    assert.strictEqual(S.loggedIn, false);
    assert.strictEqual(page.view(), 'view-login');
  });

  /* ---------------- M1-2 records 在途登出 ---------------- */
  await test('M1-2 records 请求在途 → 登出 → 旧响应返回：allRecords/records 保持清空', async () => {
    const page = createPage();
    await page.settle();
    page.api.setUser('user-A');
    const p = page.ctx.afterLogin();
    await page.settle();
    page.api.respond('select', 'profiles', { data: ROWS_A });
    await page.settle();
    assert.strictEqual(page.api.count('select', 'records'), 1, '应停在 listRecords');

    const off = page.ctx.doLogout();
    await page.settle();
    await off;

    page.api.respond('select', 'records', {
      data: [{ id: 27, owner_id: 'user-A', space_id: 'FIT-A', record_date: todayLocal(), weight: 81.2 }]
    });
    await p;
    await page.settle();

    assert.strictEqual(page.S.allRecords.length, 0);
    assert.strictEqual(page.S.records.length, 0);
    assert.strictEqual(page.S.space, '');
    assert.strictEqual(page.S.profile, null);
  });

  /* ---------------- M1-3 旧用户响应不得污染新用户 ---------------- */
  await test('M1-3 A 请求在途 → 登出 → B 登录 → A 响应迟到：B 的全部状态不变', async () => {
    const page = createPage();
    await page.settle();

    page.api.setUser('user-A');
    const a = page.ctx.afterLogin();
    await page.settle();                        /* A 停在 profiles */

    const off = page.ctx.doLogout();
    await page.settle();
    await off;

    page.api.setUser('user-B');
    const b = page.ctx.afterLogin();
    await page.settle();                        /* B 停在 profiles（比 A 晚） */
    page.api.respond('select', 'profiles', { data: ROWS_B }, -1);
    await page.settle();
    page.api.respond('select', 'records', {
      data: [{ id: 51, owner_id: 'user-B', space_id: 'FIT-B', record_date: todayLocal(), weight: 59.4 }]
    });
    await b;
    await page.settle();

    assert.strictEqual(page.view(), 'app', 'B 应已正常进入 app');
    assert.strictEqual(page.uid, 'user-B');
    const snapshot = {
      uid: page.uid,
      space: page.S.space,
      nick: page.S.profile && page.S.profile.nickname,
      profiles: page.S.profiles.length,
      myProfiles: page.S.myProfiles.length,
      allProfiles: page.S.allProfiles.length,
      records: page.S.records.length,
      allRecords: page.S.allRecords.length,
      partner: page.S.partner && page.S.partner.nickname
    };

    /* A 的旧 profiles 响应此刻才回来 */
    page.api.respond('select', 'profiles', { data: ROWS_A }, -1);
    await a;
    await page.settle();

    assert.strictEqual(page.uid, 'user-B', 'uid 必须仍是 B');
    assert.strictEqual(page.S.space, snapshot.space, '空间不得被 A 覆盖');
    assert.strictEqual(page.S.profile && page.S.profile.nickname, snapshot.nick, 'B 的昵称不变');
    assert.strictEqual(page.S.profiles.length, snapshot.profiles);
    assert.strictEqual(page.S.myProfiles.length, snapshot.myProfiles);
    assert.strictEqual(page.S.allProfiles.length, snapshot.allProfiles, 'allProfiles 不得被 A 写回');
    assert.strictEqual(page.S.records.length, snapshot.records);
    assert.strictEqual(page.S.allRecords.length, snapshot.allRecords);
    assert.strictEqual(page.S.partner && page.S.partner.nickname, snapshot.partner);
    assert.strictEqual(page.view(), 'app', '视图仍是 B 的 app');
  });

  /* ---------------- M1-4 旧请求成功但已换代数：不渲染、不弹提示 ---------------- */
  await test('M1-4 旧请求得到成功响应但 epoch 已变：不触发 render / toast', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);

    const p = page.ctx.loadAll();               /* 正常刷新，请求在途 */
    await page.settle();
    const off = page.ctx.doLogout();
    await page.settle();
    await off;

    const renders = page.ui.renders;
    const toasts = page.ui.toasts.length;

    page.api.respond('select', 'profiles', { data: ROWS_A });
    const ret = await p;
    await page.settle();

    assert.strictEqual(ret, null, '过期的加载必须返回 null（作废），不能返回 true/false');
    assert.strictEqual(page.ui.renders, renders, '过期响应不得触发 render');
    assert.strictEqual(page.ui.toasts.length, toasts, '过期响应不得弹提示');
    assert.strictEqual(page.S.allProfiles.length, 0);
  });

  /* ---------------- M1-5 旧请求失败不得污染新会话 ---------------- */
  await test('M1-5 旧请求失败且 epoch 已变：不清新会话、不写新用户的错误提示', async () => {
    const page = createPage();
    await page.settle();

    page.api.setUser('user-A');
    const a = page.ctx.afterLogin();
    await page.settle();

    const off = page.ctx.doLogout();
    await page.settle();
    await off;

    await loginOk(page, 'user-B', ROWS_B, [], -1);
    const errText = page.el('login-err').textContent;
    const toasts = page.ui.toasts.length;

    page.api.fail('select', 'profiles', beErr('permission_denied', 'RLS 拒绝'), -1);
    await a;
    await page.settle();

    assert.strictEqual(page.view(), 'app', '旧请求失败不得把新用户踢回登录页');
    assert.strictEqual(page.uid, 'user-B');
    assert.strictEqual(page.S.profile.nickname, '小熊B');
    assert.strictEqual(page.el('login-err').textContent, errText, '不得写新用户的登录错误提示');
    assert.strictEqual(page.ui.toasts.length, toasts, '不得弹旧会话的错误提示');
  });

  /* ---------------- M2-1 写入成功 + 刷新失败 ---------------- */
  await test('M2-1 INSERT 成功 + 后续 loadAll 失败：不得改口称「保存失败」', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    page.S.draft.weight = 80.4;

    const sp = page.ctx.saveRecord();
    await page.settle();
    assert.strictEqual(page.api.count('insert', 'records'), 1, '应停在 INSERT');
    page.api.respond('insert', 'records', { data: [{ id: 40 }] });
    await page.settle();                        /* 进入 loadAll */
    page.api.fail('select', 'profiles', beErr('network_down', '刷新读取失败'));
    await sp;
    await page.settle();

    const msg = page.ui.toasts.join(' | ');
    assert.ok(/已保存/.test(msg), '写入已被确认，必须说已保存：' + msg);
    assert.ok(/数据刷新暂未完成/.test(msg), '应明确告知刷新未完成：' + msg);
    assert.ok(!/保存失败/.test(msg), '不得把刷新失败说成写入失败：' + msg);
  });

  /* ---------------- M2-2 已落库但用户已登出 ---------------- */
  await test('M2-2 INSERT 已到服务端 + 登出 + 响应迟到：无旧 toast、不污染 S、不再发刷新请求', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    page.S.draft.weight = 80.4;

    const sp = page.ctx.saveRecord();
    await page.settle();
    assert.strictEqual(page.api.count('insert', 'records'), 1);

    const off = page.ctx.doLogout();
    await page.settle();
    await off;
    const toastsAfterLogout = page.ui.toasts.slice();
    const selectsAfterLogout = page.api.count('select', 'profiles');

    page.api.respond('insert', 'records', { data: [{ id: 41 }] });   /* 写入其实成功了 */
    await sp;
    await page.settle();

    assert.strictEqual(page.S.allRecords.length, 0, '不得写回 S');
    assert.strictEqual(page.S.records.length, 0);
    assert.strictEqual(page.ui.toasts.length, toastsAfterLogout.length, '不得再弹任何提示');
    assert.ok(!page.ui.toasts.some((t) => /已保存|保存失败|尚未确认/.test(t)), '旧会话的保存提示不得出现');
    assert.strictEqual(page.api.count('select', 'profiles'), selectsAfterLogout, '已登出不应再发刷新请求');
  });

  /* ---------------- M2-3 PATCH updated=1 + 刷新失败 ---------------- */
  await test('M2-3 PATCH updated=1 但后续刷新失败：写入成功与刷新失败分别表述', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, [
      { id: 27, owner_id: 'user-A', space_id: 'FIT-A', record_date: todayLocal(), weight: 81.2 }
    ]);
    page.S.draft.weight = 81.0;

    const sp = page.ctx.saveRecord();
    await page.settle();
    assert.strictEqual(page.api.count('update', 'records'), 1, '已有今日记录应走 PATCH');
    page.api.respond('update', 'records', { data: [{ id: 27 }], meta: { updated: 1 } });
    await page.settle();
    page.api.netfail('select', 'profiles');     /* 刷新直接断网 */
    await sp;
    await page.settle();

    const msg = page.ui.toasts.join(' | ');
    assert.ok(/已保存/.test(msg) && /数据刷新暂未完成/.test(msg), '应区分写入成功与刷新失败：' + msg);
    assert.ok(!/保存失败/.test(msg));
  });

  /* ---------------- M2-4 PATCH updated=0 ---------------- */
  await test('M2-4 PATCH updated=0：明确说没更新到，不得提示成功', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, [
      { id: 27, owner_id: 'user-A', space_id: 'FIT-A', record_date: todayLocal(), weight: 81.2 }
    ]);
    page.S.draft.weight = 81.0;

    const sp = page.ctx.saveRecord();
    await page.settle();
    page.api.respond('update', 'records', { data: [], meta: { updated: 0 } });
    await page.settle();
    page.api.respond('select', 'profiles', { data: ROWS_A });   /* 零行后仍会刷新 */
    await page.settle();
    page.api.respond('select', 'records', { data: [] });
    await sp;
    await page.settle();

    const msg = page.ui.toasts.join(' | ');
    assert.ok(/没更新到/.test(msg), '应明确未更新：' + msg);
    assert.ok(!/^已保存/.test(msg) && !/已保存/.test(msg), '零行绝不能说成保存成功：' + msg);
  });

  /* ---------------- M2-5 网络错误、提交状态未知 ---------------- */
  await test('M2-5 写入网络错误 → 提示结果未确认，且不自动重试', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    page.S.draft.weight = 80.4;

    const sp = page.ctx.saveRecord();
    await page.settle();
    page.api.netfail('insert', 'records');
    await sp;
    await page.settle();

    const msg = page.ui.toasts.join(' | ');
    assert.ok(/尚未确认/.test(msg), '应提示结果未确认：' + msg);
    assert.ok(/重新查看记录/.test(msg));
    assert.ok(!/保存失败/.test(msg), '不得断言未写入：' + msg);
    assert.ok(!/已保存/.test(msg), '也不得声称已保存：' + msg);
    assert.strictEqual(page.api.count('insert', 'records'), 1, '不得自动重试 INSERT（会产生重复数据）');
  });

  /* ---------------- M2-6 mirrorToday 部分成功 ---------------- */
  await test('M2-6 mirrorToday 多空间部分成功：提示逐项计数，不报全成功/全失败', async () => {
    const page = createPage();
    await page.settle();
    const rows3 = [
      { id: 1, owner_id: 'user-A', space_id: 'FIT-A', nickname: '小鹿A' },
      { id: 2, owner_id: 'user-A', space_id: 'FIT-B', nickname: '小鹿A' },
      { id: 3, owner_id: 'user-A', space_id: 'FIT-C', nickname: '小鹿A' }
    ];
    await loginOk(page, 'user-A', rows3, []);
    assert.strictEqual(page.S.space, 'FIT-A');
    assert.strictEqual(page.S.myProfiles.length, 3);
    page.S.draft.weight = 80.4;

    const sp = page.ctx.saveRecord();
    await page.settle();
    page.api.respond('insert', 'records', { data: [{ id: 60 }] });     /* 当前空间：成功 */
    await page.settle();
    page.api.respond('insert', 'records', { data: [{ id: 61 }] });     /* FIT-B：成功 */
    await page.settle();
    page.api.fail('insert', 'records', beErr('permission_denied', 'RLS 拒绝'));  /* FIT-C：明确失败 */
    await page.settle();
    page.api.respond('select', 'profiles', { data: rows3 });
    await page.settle();
    page.api.respond('select', 'records', { data: [] });
    await sp;
    await page.settle();

    const msg = page.ui.toasts.join(' | ');
    assert.ok(/已保存/.test(msg), msg);
    assert.ok(/其他 2 个空间/.test(msg), '必须说明其他空间的数量：' + msg);
    assert.ok(/1 个已同步/.test(msg) && /1 个未写入/.test(msg), '必须逐项计数：' + msg);
    assert.ok(!/都已同步/.test(msg), '不得把部分成功说成全成功：' + msg);
  });

  /* ---------------- M2-7 A 的保存结果不得落到 B 的页面 ---------------- */
  await test('M2-7 A 保存请求在途 → 登出 → B 登录 → A 结果迟到：B 页面无 A 的 toast 与状态', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    page.S.draft.weight = 80.4;

    const sp = page.ctx.saveRecord();
    await page.settle();
    assert.strictEqual(page.api.count('insert', 'records'), 1);

    const off = page.ctx.doLogout();
    await page.settle();
    await off;

    await loginOk(page, 'user-B', ROWS_B, []);
    const bBefore = {
      uid: page.uid, space: page.S.space,
      nick: page.S.profile.nickname, records: page.S.records.length,
      toasts: page.ui.toasts.length
    };

    page.api.respond('insert', 'records', { data: [{ id: 70 }] });   /* A 的写入成功，迟到 */
    await sp;
    await page.settle();

    assert.strictEqual(page.uid, 'user-B');
    assert.strictEqual(page.S.space, bBefore.space);
    assert.strictEqual(page.S.profile.nickname, bBefore.nick);
    assert.strictEqual(page.S.records.length, bBefore.records);
    assert.strictEqual(page.S.allRecords.length, 0);
    assert.strictEqual(page.ui.toasts.length, bBefore.toasts, 'B 页面不得出现 A 的保存提示');
  });

  /* ---------------- M2-8 无竞态场景不退化 ---------------- */
  await test('M2-8 正常创建/保存/刷新/登出（无竞态）功能不退化', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    assert.strictEqual(page.view(), 'app');

    page.S.draft.weight = 80.4;
    const sp = page.ctx.saveRecord();
    await page.settle();
    page.api.respond('insert', 'records', { data: [{ id: 80 }] });
    await page.settle();
    page.api.respond('select', 'profiles', { data: ROWS_A });
    await page.settle();
    page.api.respond('select', 'records', {
      data: [{ id: 80, owner_id: 'user-A', space_id: 'FIT-A', record_date: todayLocal(), weight: 80.4 }]
    });
    await sp;
    await page.settle();

    assert.strictEqual(page.ui.toasts.join(' | '), '已保存', '正常路径提示保持简洁');
    assert.strictEqual(page.S.records.length, 1, '刷新后应看到刚写入的记录');
    assert.deepStrictEqual(
      { w: page.S.draft.weight, tags: page.S.draft.tags.length, note: page.S.draft.note },
      { w: null, tags: 0, note: '' }, '保存成功后草稿应清空'
    );
    assert.strictEqual(page.ctx.currentTab, 'home');

    /* 建空间：正常走 rpc_create_space 映射后的桥方法 */
    page.S.myProfiles = [];
    page.el('pair-nick').value = '小鹿A';
    page.el('pair-start').value = '82';
    page.el('pair-target').value = '70';
    page.el('pair-space').value = 'FIT-NEW1';
    page.ctx.pairMode = 'create';
    const pair = page.ctx.doPair();
    await page.settle();
    page.api.respond('select', 'profiles', { data: ROWS_A });
    await page.settle();
    page.api.respond('select', 'records', { data: [] });
    await pair;
    await page.settle();
    assert.strictEqual(page.api.count('createSpace'), 1, '创建空间仍走桥层');
    assert.strictEqual(page.view(), 'app');

    const off = page.ctx.doLogout();
    await page.settle();
    await off;
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.uid, '');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.S.allProfiles.length, 0);
  });

  /* =========================================================================
   * H-3-M3：local 模式未适配功能（小目标 / 标签）的提示统一
   *
   * 根因：local 下 cloud 是拒绝桩，database.from() 同步抛
   *       unsupported_in_local_mode；而 addTodo/delTodo/addTag/delTag 的
   *       catch 一律吞成「添加失败 / 删除失败」，用户看到的是「我填错了」，
   *       而不是「这个功能没接」。addCustomTag 更是在本地直接崩（无 catch）。
   *
   * 本轮契约：
   *   local → 一眼看出「本地开发模式暂不支持」；零 SDK、零本地写入、S 不变；
   *   cloud → 原调用、原参数、原顺序一律不变（用 Mock SDK 逐字比对）。
   * ========================================================================= */

  const UNSUP_LOCAL = /本地开发模式下暂不支持/;

  /* local 页面 + 一个已登录画像（直接给 S，不经过网络） */
  function localReadyPage() {
    const page = createPage();
    page.ctx.uid = 'user-A';
    page.ctx.S.loggedIn = true;
    page.ctx.S.space = 'FIT-A';
    page.ctx.S.profile = {
      id: 1, owner_id: 'user-A', space_id: 'FIT-A', nickname: '小鹿A',
      start_weight: 70, target_weight: 60, role: 'her'
    };
    page.ctx.S.profiles = [page.ctx.S.profile];
    page.ctx.S.records = []; page.ctx.S.allRecords = [];
    page.ctx.S.todos = []; page.ctx.S.tags = [];
    page.ctx.S.draft = { weight: null, tags: [], todoDone: [], mood: null, note: '' };
    return page;
  }

  /* 给拒绝桩装探针：守卫若失效，页面就会真的调用到这里（并抛错） */
  function watchBlockedSdk(page) {
    const spy = { from: 0, rpc: 0, auth: 0 };
    const c = page.ctx.cloud;
    const f0 = c.database.from, r0 = c.database.rpc;
    c.database.from = function () { spy.from++; return f0.apply(null, arguments); };
    c.database.rpc  = function () { spy.rpc++;  return r0.apply(null, arguments); };
    ['sendOtp', 'verifyOtp', 'signOut', 'getSession'].forEach((k) => {
      const o = c.auth[k];
      c.auth[k] = function () { spy.auth++; return o.apply(null, arguments); };
    });
    return spy;
  }

  /* ---------------- M3-1 local 新增小目标 ---------------- */
  await test('M3-1 local 新增小目标：提示本地不支持，零 SDK、零本地写入、S 不变', async () => {
    const page = localReadyPage();
    const spy = watchBlockedSdk(page);
    page.ctx.openSettings();                     /* 真实渲染设置面板 + 真实事件绑定 */
    const btn = page.el('btn-add-todo');
    assert.strictEqual(typeof btn.onclick, 'function', '设置面板必须绑定「添加小目标」入口');
    const n0 = page.api.calls.length;

    await btn.onclick();                         /* 真实事件入口 */
    await page.settle();

    assert.ok(UNSUP_LOCAL.test(page.lastToast()),
      '应明确说明本地不支持，实际：' + page.lastToast());
    assert.ok(!/添加失败|添加成功|已添加/.test(page.ui.toasts.join(' | ')),
      '不得显示「添加失败」或虚假成功，实际：' + page.ui.toasts.join(' | '));
    assert.strictEqual(page.ctx.S.todos.length, 0, 'S.todos 不得变化');
    assert.strictEqual(spy.from, 0, '不得触碰 Cloud SDK');
    assert.strictEqual(page.api.calls.length, n0, '不得发起本地 PostgREST 请求');
    assert.strictEqual(page.api.live(), 0, '不得留下在途请求');
  });

  /* ---------------- M3-2 local 删除小目标 ---------------- */
  await test('M3-2 local 删除小目标：提示本地不支持，缓存逐字不变', async () => {
    const page = localReadyPage();
    const spy = watchBlockedSdk(page);
    page.ctx.S.todos = [{ id: 7, text: '喝水 2L', sort: 10 }];
    const before = JSON.stringify(page.ctx.S.todos);
    const n0 = page.api.calls.length;

    await page.ctx.delTodo(7);
    await page.settle();

    assert.ok(UNSUP_LOCAL.test(page.lastToast()), '实际：' + page.lastToast());
    assert.ok(!/删除失败|已删除/.test(page.ui.toasts.join(' | ')),
      '不得显示「删除失败」，也不得假装删掉了');
    assert.strictEqual(JSON.stringify(page.ctx.S.todos), before, '缓存不得变化');
    assert.strictEqual(spy.from, 0, '不得触碰 Cloud SDK');
    assert.strictEqual(page.api.calls.length, n0, '不得发起任何请求');
  });

  /* ---------------- M3-3 local 标记小目标完成 ---------------- */
  await test('M3-3 local 标记完成：不显示成功、不改记录与草稿', async () => {
    const page = localReadyPage();
    const spy = watchBlockedSdk(page);
    page.ctx.S.todos = [{ id: 7, text: '喝水 2L', sort: 10 }];
    page.ctx.S.records = [{
      id: 11, owner_id: 'user-A', space_id: 'FIT-A', record_date: todayLocal(), weight: 68, todo_done: []
    }];
    const recBefore = JSON.stringify(page.ctx.S.records);
    const n0 = page.api.calls.length;

    await page.ctx.toggleTodo(7);
    await page.settle();

    assert.ok(UNSUP_LOCAL.test(page.lastToast()), '实际：' + page.lastToast());
    assert.ok(!/保存失败|已勾选|完成了/.test(page.ui.toasts.join(' | ')),
      '不得说保存失败，也不得说已经勾上');
    assert.strictEqual(JSON.stringify(page.ctx.S.records), recBefore, '记录缓存不得变化');
    assert.deepStrictEqual(page.ctx.S.draft.todoDone, [], '草稿勾选不得变化');
    assert.strictEqual(spy.from, 0, '不得触碰 Cloud SDK');
    assert.strictEqual(page.api.calls.length, n0, '不得发起任何请求');
  });

  /* ---------------- M3-4 local 新增标签 ---------------- */
  await test('M3-4 local 新增标签：提示本地不支持，零外发请求', async () => {
    const page = localReadyPage();
    const spy = watchBlockedSdk(page);
    page.ctx.openSettings();
    const btn = page.el('btn-add-tag');
    assert.strictEqual(typeof btn.onclick, 'function', '设置面板必须绑定「自定义标签」入口');
    const n0 = page.api.calls.length;

    await btn.onclick();
    await page.settle();

    assert.ok(UNSUP_LOCAL.test(page.lastToast()), '实际：' + page.lastToast());
    assert.ok(!/添加失败|添加成功|已添加/.test(page.ui.toasts.join(' | ')));
    assert.strictEqual(page.ctx.S.tags.length, 0, 'S.tags 不得变化');
    assert.strictEqual(spy.from, 0, '不得触碰 Cloud SDK');
    assert.strictEqual(page.api.calls.length, n0, '不得发起任何请求');
  });

  /* ---------------- M3-5 local 删除标签 ---------------- */
  await test('M3-5 local 删除标签：提示本地不支持，缓存逐字不变', async () => {
    const page = localReadyPage();
    const spy = watchBlockedSdk(page);
    page.ctx.S.tags = [{ id: 3, text: '跑步 30 分钟', sort: 10 }];
    const before = JSON.stringify(page.ctx.S.tags);
    const n0 = page.api.calls.length;

    await page.ctx.delTag(3);
    await page.settle();

    assert.ok(UNSUP_LOCAL.test(page.lastToast()), '实际：' + page.lastToast());
    assert.ok(!/删除失败|已删除/.test(page.ui.toasts.join(' | ')));
    assert.strictEqual(JSON.stringify(page.ctx.S.tags), before, '缓存不得变化');
    assert.strictEqual(spy.from, 0, '不得触碰 Cloud SDK');
    assert.strictEqual(page.api.calls.length, n0, '不得发起任何请求');
  });

  /* ---------------- M3-6 local 标签选择与应用 ---------------- */
  await test('M3-6 local 标签选择与应用：无可选标签，自定义入口明确拒绝且不改草稿', async () => {
    /* 走真实 local 加载：确认 S.tags / S.todos 由 loadAllLocal 置空（而非人为清空） */
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    assert.strictEqual(page.ctx.S.tags.length, 0, 'local 加载后不应有任何常用标签');
    assert.strictEqual(page.ctx.S.todos.length, 0, 'local 加载后不应有任何小目标');

    page.orig.renderRecord();                    /* 真实 renderRecord：产出 DOM 并绑定事件 */
    const html = page.el('record-body').innerHTML;
    assert.ok(html.indexOf('data-tag=') < 0,
      '没有标签时就渲染不出可选标签 chip——不存在「点了看着像选中、其实没存」的入口');
    assert.ok(html.indexOf('id="rec-tag-add"') >= 0, '「+ 自定义」入口仍在（不改布局）');

    const spy = watchBlockedSdk(page);
    const n0 = page.api.calls.length;
    const add = page.el('rec-tag-add').onclick;
    assert.strictEqual(typeof add, 'function', '真实 renderRecord 必须绑定自定义标签入口');
    assert.doesNotThrow(() => add(), '本地点击不得抛错（原实现会同步抛 unsupported 并中断渲染）');
    await page.settle();

    assert.ok(UNSUP_LOCAL.test(page.lastToast()), '实际：' + page.lastToast());
    assert.strictEqual(plain(page.ctx.S.draft.tags).length, 0, '不得把标签塞进草稿冒充已应用');
    assert.strictEqual(spy.from, 0, '不得触碰 Cloud SDK');
    assert.strictEqual(page.api.calls.length, n0, '不得发起任何请求');
  });

  /* ---------------- M3-7 连续点击未适配按钮 ---------------- */
  await test('M3-7 连点未适配按钮：无重复写入、无未处理 rejection、不崩', async () => {
    const page = localReadyPage();
    const spy = watchBlockedSdk(page);
    page.ctx.openSettings();
    page.orig.renderRecord();
    const todoBtn = page.el('btn-add-todo').onclick;
    const tagBtn  = page.el('btn-add-tag').onclick;
    const custom  = page.el('rec-tag-add').onclick;
    const t0 = page.ui.toasts.length;

    const ps = [];
    for (let i = 0; i < 3; i++) { ps.push(todoBtn()); ps.push(tagBtn()); }
    assert.doesNotThrow(() => { custom(); custom(); custom(); }, '同步入口连点不得抛错');
    await Promise.all(ps);                       /* 任一 rejection 都会让用例失败 */
    await page.settle();

    assert.strictEqual(page.ctx.S.todos.length, 0, '不得重复写入小目标');
    assert.strictEqual(page.ctx.S.tags.length, 0, '不得重复写入标签');
    assert.deepStrictEqual(page.ctx.S.draft.tags, [], '草稿不得被连点污染');
    assert.strictEqual(spy.from, 0, '不得触碰 Cloud SDK');
    assert.strictEqual(page.api.live(), 0, '不得留下在途请求');
    const added = page.ui.toasts.slice(t0);
    assert.strictEqual(added.length, 9, '每次点击一条提示，不多不少，实际：' + added.join(' | '));
    added.forEach((t) => assert.ok(UNSUP_LOCAL.test(t), '每条都必须是「本地暂不支持」，实际：' + t));
  });

  /* ---------- 可控 Mock Cloud SDK：只记录调用，不连任何真实 API ---------- */
  function mockCloud() {
    const calls = [];
    const rows = { profiles: [], records: [], todos: [], tags: [], rewards: [], messages: [] };
    const pendingSignOuts = [];
    let holdSignOutOn = false;
    function query(table) {
      const st = { table: table, op: 'select', payload: null, filters: [] };
      const q = {
        select() { return q; },
        order() { return q; },
        insert(p) { st.op = 'insert'; st.payload = p; calls.push(['insert', table, p]); return q; },
        update(p) { st.op = 'update'; st.payload = p; calls.push(['update', table, p]); return q; },
        delete() { st.op = 'delete'; calls.push(['delete', table, st.filters]); return q; },
        eq(k, v) { st.filters.push([k, v]); return q; },
        then(onOk, onErr) {
          let data;
          if (st.op === 'select') data = (rows[table] || []).slice();
          else if (st.op === 'insert') data = [Object.assign({ id: 900 + calls.length }, st.payload)];
          else if (st.op === 'update') data = [Object.assign({ id: 1 }, st.payload)];
          else data = [{ id: st.filters.length ? st.filters[0][1] : 0 }];
          return Promise.resolve({ data: data, error: null }).then(onOk, onErr);
        }
      };
      return q;
    }
    return {
      calls: calls,
      rows: rows,
      /* H-3-PAIR-RACE：可选的 signOut 挂起（opt-in，不影响既有 auto-resolve 用例） */
      holdSignOut() { holdSignOutOn = true; },
      pendingSignOuts: pendingSignOuts,
      releaseSignOut() {
        assert.ok(pendingSignOuts.length, '期望有在途的 cloud signOut');
        pendingSignOuts.shift()();
      },
      database: {
        from: query,
        rpc(name, args) {
          calls.push(['rpc', name, args]);
          return Promise.resolve({ data: { ok: true }, error: null });
        }
      },
      auth: {
        getSession() { return Promise.resolve({ data: { session: null, user: null }, error: null }); },
        signOut() {
          calls.push(['auth.signOut']);
          if (holdSignOutOn) {
            return new Promise((res) => pendingSignOuts.push(res)).then(() => ({ data: {}, error: null }));
          }
          return Promise.resolve({ data: {}, error: null });
        }
      }
    };
  }

  function cloudReadyPage() {
    const mock = mockCloud();
    const init = { cfg: null };
    const page = createPage({
      backend: 'cloud',
      cloud: mock,
      onInit(cfg) { init.cfg = cfg; }
    });
    mock.rows.profiles = [{
      id: 1, owner_id: 'user-A', space_id: 'FIT-A', nickname: '小鹿A',
      start_weight: 70, target_weight: 60, role: 'her'
    }];
    page.ctx.uid = 'user-A';
    page.ctx.S.loggedIn = true;
    return { page: page, mock: mock, init: init };
  }

  /* ---------------- M3-8 cloud 小目标 CRUD 接线 ---------------- */
  await test('M3-8 cloud 小目标 CRUD：调用与参数逐字不变', async () => {
    const { page, mock, init } = cloudReadyPage();
    assert.strictEqual(page.ctx.BACKEND, 'cloud');
    assert.ok(init.cfg, 'cloud 模式必须初始化 SDK');
    assert.deepStrictEqual(Object.keys(init.cfg).sort(),
      ['endpoint', 'oauthRelayBaseUrl', 'publishableKey'], 'SDK 初始化参数名不得变化');
    assert.strictEqual(init.cfg.endpoint, page.ctx.PUBLIC_CONFIG.endpoint);
    assert.strictEqual(init.cfg.oauthRelayBaseUrl, page.ctx.PUBLIC_CONFIG.oauthRelayBaseUrl);
    assert.strictEqual(init.cfg.publishableKey, page.ctx.PUBLIC_CONFIG.publishableKey);

    await page.ctx.loadAll();
    assert.strictEqual(page.ctx.S.profile.nickname, '小鹿A');
    assert.strictEqual(page.ctx.S.todos.length, 0);

    /* 新增 */
    page.ctx.prompt = () => '喝水 2L';
    page.ctx.openSettings();
    await page.el('btn-add-todo').onclick();
    await page.settle();
    const ins = mock.calls.filter((c) => c[0] === 'insert' && c[1] === 'todos');
    assert.strictEqual(ins.length, 1, '新增必须只插一次');
    assert.deepStrictEqual(plain(ins[0][2]),
      { owner_name: '小鹿A', space_id: 'FIT-A', text: '喝水 2L', sort: 10 },
      'todos 插入字段与排序规则不得变化');

    /* 删除 */
    await page.ctx.delTodo(7);
    await page.settle();
    const del = mock.calls.filter((c) => c[0] === 'delete' && c[1] === 'todos');
    assert.strictEqual(del.length, 1, '删除必须只发一次');
    assert.deepStrictEqual(plain(del[0][2]), [['id', 7]], '删除条件必须精确到 id');

    /* 标记完成（写 records.todo_done，不写 todos） */
    mock.rows.records = [{
      id: 11, owner_id: 'user-A', space_id: 'FIT-A', record_date: todayLocal(), weight: 68, todo_done: []
    }];
    await page.ctx.loadAll();
    await page.ctx.toggleTodo(7);
    await page.settle();
    const upd = mock.calls.filter((c) => c[0] === 'update' && c[1] === 'records');
    assert.ok(upd.length >= 1, '标记完成应更新当天记录');
    assert.deepStrictEqual(plain(upd[upd.length - 1][2]), { todo_done: [7] }, 'todo_done 载荷不得变化');
    assert.strictEqual(mock.calls.filter((c) => c[0] === 'update' && c[1] === 'todos').length, 0,
      '不应再单独 update todos');
  });

  /* ---------------- M3-9 cloud 标签操作 ---------------- */
  await test('M3-9 cloud 标签操作：新增/删除/自定义录入参数不变', async () => {
    const { page, mock } = cloudReadyPage();
    await page.ctx.loadAll();

    /* 新增（首尾空格应被 trim，长度截断到 20） */
    page.ctx.prompt = () => '  跑步 30 分钟  ';
    page.ctx.openSettings();
    await page.el('btn-add-tag').onclick();
    await page.settle();
    const ins = mock.calls.filter((c) => c[0] === 'insert' && c[1] === 'tags');
    assert.strictEqual(ins.length, 1);
    assert.deepStrictEqual(plain(ins[0][2]),
      { owner_name: '小鹿A', space_id: 'FIT-A', text: '跑步 30 分钟', sort: 10 },
      'tags 插入字段与截断/排序规则不得变化');

    /* 删除 */
    await page.ctx.delTag(3);
    await page.settle();
    const del = mock.calls.filter((c) => c[0] === 'delete' && c[1] === 'tags');
    assert.strictEqual(del.length, 1);
    assert.deepStrictEqual(plain(del[0][2]), [['id', 3]]);

    /* 记录页「+ 自定义」：先把标签加入当天草稿，再顺手存进常用标签 */
    page.ctx.S.draft = { weight: null, tags: [], todoDone: [], mood: null, note: '' };
    page.ctx.prompt = () => '戒奶茶';
    page.orig.renderRecord();
    page.el('rec-tag-add').onclick();
    await page.settle();
    assert.deepStrictEqual(page.ctx.S.draft.tags, ['戒奶茶'], '标签应先落到当天草稿');
    const ins2 = mock.calls.filter((c) => c[0] === 'insert' && c[1] === 'tags');
    assert.strictEqual(ins2.length, 2, '应顺带存一条常用标签');
    assert.strictEqual(ins2[1][2].text, '戒奶茶');
    assert.strictEqual(ins2[1][2].owner_name, '小鹿A');
  });

  /* ---------------- M3-10 既有能力未退化 ---------------- */
  await test('M3-10 M5 解析 / M2 错误分类 / records 保存语义未退化', async () => {
    /* M5：type 只取自链接 */
    const tok = 'a'.repeat(56);
    const link = 'http://127.0.0.1:9999/verify?token=' + tok + '&type=signup&redirect_to=x';
    assert.strictEqual(BE.parseEmailLink(link).type, 'signup');
    assert.strictEqual(BE.parseEmailLink(link).tokenHash, tok);
    assert.strictEqual(BE.parseEmailLink(link.replace('signup', 'magiclink')).type, 'magiclink');
    assert.throws(() => BE.parseEmailLink('http://127.0.0.1:9999/verify?token=' + tok),
      (e) => e.code === 'bad_request', '缺 type 仍必须在本地拒绝');

    /* M2：分类判据未变 */
    assert.strictEqual(BE.classifyWriteError(new TypeError('Failed to fetch')), BE.WRITE_OUTCOME.UNKNOWN);
    assert.strictEqual(BE.classifyWriteError(beErr('permission_denied', 'x')), BE.WRITE_OUTCOME.REJECTED);

    /* records：本地保存仍带 tags / todo_done / mood，且不把 owner_id 交给页面 */
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    page.ctx.switchTab('record');            /* 记录页：switchTab 会清空草稿，必须先切再填 */
    page.ctx.S.draft = { weight: 66.5, tags: ['喝水 2L'], todoDone: [7], mood: '😀', note: '还行' };
    const sp = page.ctx.saveRecord();
    await page.settle();
    const insAll = page.api.calls.filter((c) => c[0] === 'insert' && c[1] === 'records');
    assert.strictEqual(insAll.length, 1, '应发出一次 records INSERT');
    const body = plain(insAll[0][2]);
    assert.deepStrictEqual(
      { weight: body.weight, tags: body.tags, todo_done: body.todo_done, mood: body.mood, note: body.note },
      { weight: 66.5, tags: ['喝水 2L'], todo_done: [7], mood: '😀', note: '还行' },
      'records 载荷字段不得变化'
    );
    assert.strictEqual('owner_id' in body, false, 'owner_id 仍由适配层注入，页面不传');
    page.api.respond('insert', 'records', { data: [{ id: 90 }] });
    await page.settle();
    page.api.respond('select', 'profiles', { data: ROWS_A });
    await page.settle();
    page.api.respond('select', 'records', { data: [{ id: 90, owner_id: 'user-A', space_id: 'FIT-A', record_date: todayLocal(), weight: 66.5 }] });
    await sp;
    await page.settle();
    assert.strictEqual(page.lastToast(), '已保存', '正常保存提示仍是「已保存」');
  });

  /* ================================================================
   * H-3-PAIR：view-pair 退出登录入口（复用既有 doLogout）
   * ================================================================ */

  /* 进入 view-pair 的真实路径：登录 → loadAllLocal 返回 false（无本人 profile 行）
     → afterLogin 走 show('view-pair') + initPairForm(false)。 */
  async function reachPairPage(userId) {
    const page = createPage();
    await page.settle();
    page.api.setUser(userId);
    const p = page.ctx.afterLogin();
    await page.settle();
    page.api.respond('select', 'profiles', {
      data: [{ id: 9, owner_id: 'user-B', space_id: 'FIT-B', nickname: '小熊B' }]
    });
    await page.settle();
    await p;
    await page.settle();
    return page;
  }

  /* ---------------- PAIR-1 入口存在且可达 ---------------- */
  await test('PAIR-1 已登录且无空间时 view-pair 可见退出登录按钮（HTML 结构 + 真实流程）', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
    const pairStart = src.indexOf('id="view-pair"');
    const appStart = src.indexOf('id="app"');
    assert.ok(pairStart > 0 && appStart > pairStart, '源码应含 view-pair 与 app 区块');
    const seg = src.slice(pairStart, appStart);
    assert.ok(seg.indexOf('id="btn-pair-logout"') > 0, '退出登录按钮必须位于 view-pair 区块内');
    assert.ok(/id="btn-pair-logout"[^>]*>\s*退出登录\s*</.test(seg), '按钮必须有可访问名称「退出登录」');

    const page = await reachPairPage('user-A');
    assert.strictEqual(page.view(), 'view-pair', '无本人 profile 行应停在 view-pair');
    assert.strictEqual(typeof page.el('btn-pair-logout').onclick, 'function', '退出按钮必须绑定处理器');
  });

  /* ---------------- PAIR-2 复用既有 doLogout ---------------- */
  await test('PAIR-2 事件绑定直接调用既有 doLogout（不另立登出实现）', async () => {
    const page = await reachPairPage('user-A');
    assert.strictEqual(page.el('btn-pair-logout').onclick, page.ctx.doLogout,
      'btn-pair-logout 必须绑定页面既有的 doLogout');
    await page.el('btn-pair-logout').onclick();   /* 真实事件入口 */
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.api.count('signOut'), 1, '点击应触发一次适配层 signOut');
    assert.strictEqual(page.uid, '');
  });

  /* ---------------- PAIR-3 local 同步清理 ---------------- */
  await test('PAIR-3 local 退出：同步段即切 view-login，个人状态与草稿全清，零 Cloud SDK', async () => {
    const page = await reachPairPage('user-A');
    const spy = watchBlockedSdk(page);
    page.ctx.S.myProfiles = [{ id: 5, owner_id: 'user-A', space_id: 'FIT-B', nickname: '小鹿A' }];
    page.ctx.S.draft = { weight: 66.5, tags: ['跑步'], todoDone: [3], mood: '😀', note: '备注' };

    const pr = page.el('btn-pair-logout').onclick();
    /* doLogout 的同步段（首个 await 之前）必须完成视图切换与状态清理 */
    assert.strictEqual(page.view(), 'view-login', '同步段即应切回登录页');
    assert.strictEqual(page.uid, '', '同步段即应清空 uid');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.S.profile, null);
    assert.strictEqual(page.S.myProfiles.length, 0);
    assert.strictEqual(page.S.allProfiles.length, 0);
    assert.strictEqual(page.S.space, '');
    assert.strictEqual(page.S.draft.weight, null);
    assert.deepStrictEqual(page.S.draft.tags, []);
    assert.deepStrictEqual(page.S.draft.todoDone, []);

    await pr;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(spy.from + spy.rpc + spy.auth, 0, 'local 登出不得触碰 Cloud SDK');
    assert.strictEqual(page.lastToast(), '已退出（服务端会话已撤销）');
  });

  /* ---------------- PAIR-4 signOut 在途不等网络 ---------------- */
  await test('PAIR-4 服务端 signOut 未完成时本地已清空；答复后三态提示准确', async () => {
    const page = await reachPairPage('user-A');
    page.api.holdSignOut();
    const pr = page.el('btn-pair-logout').onclick();
    await page.settle();

    assert.strictEqual(page.view(), 'view-login', '网络未完成即已切回登录页');
    assert.strictEqual(page.uid, '');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.api.live(), 1, '应恰好有一条在途 signOut');
    assert.strictEqual(page.ui.toasts.length, 0, '服务端答复前不得弹任何提示');

    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } });
    await pr;
    await page.settle();
    assert.strictEqual(page.lastToast(), '已退出（服务端会话已撤销）', '三态之一：撤销成功');
    assert.strictEqual(page.view(), 'view-login');
  });

  /* ---------------- PAIR-5 撤销失败不谎称成功 ---------------- */
  await test('PAIR-5 服务端撤销失败/未确认：保持退出状态，提示不谎称撤销成功', async () => {
    /* a) 信封 error（serverRevoked 未确认，localCleared 也未确认） */
    const p1 = await reachPairPage('user-A');
    p1.api.holdSignOut();
    const q1 = p1.el('btn-pair-logout').onclick();
    await p1.settle();
    p1.api.respond('signOut', null, { data: null, error: beErr('server_error', 'boom') });
    await q1;
    await p1.settle();
    assert.strictEqual(p1.view(), 'view-login', '撤销失败也必须保持退出');
    assert.strictEqual(p1.S.loggedIn, false);
    assert.strictEqual(p1.lastToast(), '已退出', '撤销未确认不得谎称已撤销');
    assert.ok(!/服务端会话已撤销/.test(p1.ui.toasts.join('|')));

    /* b) 网络层失败（裸 TypeError，无 code） */
    const p2 = await reachPairPage('user-A');
    p2.api.holdSignOut();
    const q2 = p2.el('btn-pair-logout').onclick();
    await p2.settle();
    p2.api.netfail('signOut', null);
    await q2;
    await p2.settle();
    assert.strictEqual(p2.view(), 'view-login');
    assert.strictEqual(p2.S.loggedIn, false, '网络失败不得恢复已清除的本地身份');
    assert.ok(/清理出错/.test(p2.lastToast()), '实际：' + p2.lastToast());
    assert.ok(!/服务端会话已撤销/.test(p2.ui.toasts.join('|')));
  });

  /* ---------------- PAIR-6 迟到响应无法恢复旧页面 ---------------- */
  await test('PAIR-6 退出后迟到的 afterLogin/loadAll/doPair 响应无法恢复页面', async () => {
    /* a) afterLogin 的 profiles 在途登出，迟到响应被守卫丢弃 */
    const page = createPage();
    await page.settle();
    page.api.setUser('user-A');
    const p = page.ctx.afterLogin();
    await page.settle();
    const off = page.ctx.doLogout();
    await page.settle();
    await off;
    await page.settle();
    page.api.respond('select', 'profiles', { data: ROWS_A });   /* 迟到的登录期响应 */
    await p;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login', '迟到 afterLogin 不得恢复页面');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.S.allProfiles.length, 0);

    /* b) doPair 创建空间成功后读取资料在途时登出，迟到响应不得带回 app */
    const page2 = await reachPairPage('user-A');
    page2.el('pair-nick').value = '小鹿A';
    page2.el('pair-start').value = '70';
    page2.el('pair-target').value = '60';
    page2.el('pair-space').value = 'FIT-NEW001';
    const dp = page2.ctx.doPair();
    await page2.settle();   /* createSpace 自动答复 → doPair 进入 loadAll 的 select profiles */
    assert.strictEqual(page2.api.live(), 1, 'doPair 应停在读取资料这一步');
    const off2 = page2.ctx.doLogout();
    await page2.settle();
    await off2;
    await page2.settle();
    page2.api.respond('select', 'profiles', {
      data: [{ id: 3, owner_id: 'user-A', space_id: 'FIT-NEW001', nickname: '小鹿A' }]
    });
    await dp;
    await page2.settle();
    assert.strictEqual(page2.view(), 'view-login', '迟到的空间资料不得把页面带回 app');
    assert.strictEqual(page2.S.loggedIn, false);
    assert.strictEqual(page2.S.profiles.length, 0);
    assert.strictEqual(page2.S.space, '');
  });

  /* ---------------- PAIR-7 连续点击防重入 ---------------- */
  await test('PAIR-7 连续点击退出：一次登出请求、一次提示、状态不复活；完成后可再次登出', async () => {
    const page = await reachPairPage('user-A');
    page.api.holdSignOut();
    const first = page.el('btn-pair-logout').onclick();
    page.el('btn-pair-logout').onclick();   /* 首次尚未完成时的第 2 次点击 */
    page.el('btn-pair-logout').onclick();   /* 第 3 次点击 */
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 1, '同一会话代数内连续点击只应发一次登出请求');
    assert.strictEqual(page.api.live(), 1);

    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } });
    await first;
    await page.settle();
    assert.strictEqual(page.ui.toasts.length, 1, '只弹一次提示，实际：' + JSON.stringify(page.ui.toasts));
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.S.loggedIn, false);

    /* 完成后再次点击：允许新的登出（不是被防重入永久卡死） */
    const again = page.el('btn-pair-logout').onclick();
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 2, '完成后再次点击应允许新的登出');
    assert.strictEqual(page.api.live(), 1, '新登出应有一条在途 signOut');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } });
    await again;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
  });

  /* ---------------- PAIR-8 cloud 原契约 ---------------- */
  await test('PAIR-8 cloud 模式：退出调用 Mock SDK auth.signOut 原契约，适配层零调用', async () => {
    const mock = mockCloud();
    const page = createPage({ backend: 'cloud', cloud: mock });
    await page.settle();
    page.ctx.uid = 'user-A';
    page.ctx.S.loggedIn = true;
    page.ctx.S.profile = { id: 1, owner_id: 'user-A', space_id: 'FIT-A', nickname: '小鹿A' };
    page.ctx.S.myProfiles = [page.ctx.S.profile];
    page.ctx.show('view-pair');
    page.ctx.initPairForm(false);
    assert.strictEqual(page.view(), 'view-pair');

    const pr = page.el('btn-pair-logout').onclick();
    await page.settle();
    await pr;
    await page.settle();
    assert.deepStrictEqual(
      mock.calls.filter((c) => c[0] === 'auth.signOut'),
      [['auth.signOut']],
      'cloud 退出必须走 SDK auth.signOut（无参数变更）'
    );
    assert.strictEqual(page.api.count('signOut'), 0, 'local 适配层不得被调用');
    assert.strictEqual(page.api.calls.length, 0, 'local PostgREST 侧零请求');
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.S.profile, null);
    assert.strictEqual(page.ui.toasts.length, 0, 'cloud 分支保持原有行为：无额外提示');
  });

  /* ---------------- PAIR-9 pair 表单绑定不退化 ---------------- */
  await test('PAIR-9 创建/加入空间按钮与原有绑定不退化，退出后仍完好', async () => {
    const page = await reachPairPage('user-A');
    assert.strictEqual(page.el('btn-pair').onclick, page.ctx.doPair);
    assert.strictEqual(typeof page.el('btn-new-code').onclick, 'function');
    assert.strictEqual(typeof page.el('pair-space').oninput, 'function');
    assert.strictEqual(typeof page.el('btn-pair-back').onclick, 'function');

    await page.el('btn-pair-logout').onclick();
    await page.settle();
    assert.strictEqual(page.el('btn-pair').onclick, page.ctx.doPair, '退出后 pair 绑定不得被破坏');
    assert.strictEqual(typeof page.el('btn-new-code').onclick, 'function');
    assert.strictEqual(typeof page.el('pair-space').oninput, 'function');

    /* 源码级：模式切换与口令生成逻辑未被本轮改动削弱 */
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
    assert.ok(src.indexOf("document.querySelectorAll('#pair-seg .seg-btn')") > 0, 'seg 模式切换绑定仍在');
    assert.ok(src.indexOf("$('btn-new-code').onclick = function(){ $('pair-space').value = makeCode();") > 0, '换一个口令绑定仍在');
    assert.ok(src.indexOf('async function doPair()') > 0, 'doPair 主体仍在');
  });

  /* ---------------- PAIR-10 登录页 / app 退出入口 / M3 文案回归 ---------------- */
  await test('PAIR-10 登录页入口、app 设置退出入口与 M3 拒绝文案均不退化', async () => {
    const page = await reachPairPage('user-A');
    assert.strictEqual(page.el('btn-login').onclick, page.ctx.doLogin, '登录页主入口绑定不变');
    assert.strictEqual(page.el('btn-send-code').onclick, page.ctx.sendCode, '验证码入口绑定不变');

    /* app 主界面退出登录入口（设置面板） */
    await loginOk(page, 'user-A', ROWS_A, []);
    page.ctx.openSettings();
    assert.strictEqual(page.el('btn-logout').onclick, page.ctx.doLogout, 'app 内退出登录仍绑定既有 doLogout');

    /* M3 抽检：local 未适配提示与零写入不退化 */
    const n0 = page.api.calls.length;
    await page.el('btn-add-todo').onclick();
    await page.settle();
    assert.ok(UNSUP_LOCAL.test(page.lastToast()), 'M3 提示不退化，实际：' + page.lastToast());
    assert.strictEqual(page.api.calls.length, n0, 'M3 零写入不退化');
    assert.strictEqual(page.view(), 'app', 'M3 拒绝不改变视图');
  });

  /* ================================================================
   * H-3-PAIR-RACE：跨会话重叠登出（真实 doLogout + 手动 Promise，零 setTimeout）
   * 时序构造等价真实登录边界：doLogin 在进入 afterLogin 前 guard.bump()
   * （index.html「新的会话边界」），这里以 guard.bump() + afterLogin() 复现同一时序。
   * ================================================================ */

  /* 构造重叠：A 登录→登出挂起；B 新会话→登出挂起。返回两个登出 Promise。 */
  async function raceOverlap(page) {
    await loginOk(page, 'user-A', ROWS_A, []);
    page.ctx.openSettings();
    page.api.holdSignOut();
    const offA = page.el('btn-logout').onclick();          /* signOut#1 在途 */
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 1, 'A 应发出 1 次 signOut');
    assert.strictEqual(page.view(), 'view-login', 'A 同步段已切回登录页');

    page.api.setUser('user-B');
    page.ctx.guard.bump();                                  /* 等价 doLogin 的会话边界 */
    const pb = page.ctx.afterLogin();
    await page.settle();
    page.api.respond('select', 'profiles', { data: ROWS_B }, -1);
    await page.settle();
    page.api.respond('select', 'records', { data: [] }, -1);
    await page.settle();
    await pb;
    await page.settle();
    assert.strictEqual(page.view(), 'app', 'B 应进入 app');
    assert.strictEqual(page.uid, 'user-B');

    page.ctx.openSettings();
    const offB = page.el('btn-logout').onclick();          /* signOut#2 在途 */
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 2, 'B 应发出第 2 次 signOut（入口检查正确放行新会话）');
    assert.strictEqual(page.api.live(), 2, 'signOut#1 与 #2 同时在途');
    return { offA: offA, offB: offB };
  }

  /* ---------------- RACE-1 主缺陷时序 ---------------- */
  await test('RACE-1 A挂起→B登录→B挂起→A先完成→B再触发：signOut 恰 2 次（旧 finally 不清新锁）', async () => {
    const page = createPage();
    await page.settle();
    const r = await raceOverlap(page);
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, 0);   /* A 先完成 */
    await r.offA;
    await page.settle();
    const offB2 = page.el('btn-logout').onclick();          /* B 在途时再触发（等价排队点击） */
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 2, 'B 会话必须恰好 1 次 signOut，不得出现第 3 次');
    assert.strictEqual(page.api.live(), 1, 'B 的 signOut 仍在途');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);  /* B 完成 */
    await r.offB;
    try { await offB2; } catch (e) {}
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.uid, '');
  });

  /* ---------------- RACE-2 A 以网络错误结束 ---------------- */
  await test('RACE-2 A 旧登出以网络错误结束：旧 finally 仍不清 B 的锁，B 恰 1 次', async () => {
    const page = createPage();
    await page.settle();
    const r = await raceOverlap(page);
    page.api.netfail('signOut', null, 0);                   /* A 以网络错误收尾 */
    await r.offA;
    await page.settle();
    const cntBefore = page.api.count('signOut');
    const offB2 = page.el('btn-logout').onclick();
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), cntBefore, '网络错误路径的 finally 同样不得清 B 的锁');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);
    await r.offB;
    try { await offB2; } catch (e) {}
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
  });

  /* ---------------- RACE-3 旧提示不得落到新会话 ---------------- */
  await test('RACE-3 A 旧登出完成不向 B 当前页面追加旧 toast；B 完成后恰一条自己的提示', async () => {
    const page = createPage();
    await page.settle();
    const r = await raceOverlap(page);
    const toastsBefore = page.ui.toasts.length;
    assert.strictEqual(toastsBefore, 0, '重叠期间不应有任何提示');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, 0);
    await r.offA;
    await page.settle();
    assert.strictEqual(page.ui.toasts.length, 0, 'A 的旧提示不得出现（isCurrent 守卫）');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);
    await r.offB;
    await page.settle();
    assert.strictEqual(page.ui.toasts.length, 1, '只有 B 自己的登出提示');
    assert.strictEqual(page.lastToast(), '已退出（服务端会话已撤销）');
  });

  /* ---------------- RACE-4 锁最终释放，新会话可再登出 ---------------- */
  await test('RACE-4 B 登出完成后锁正常释放；新会话（C）可再次完成登录与登出', async () => {
    const page = createPage();
    await page.settle();
    const r = await raceOverlap(page);
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, 0);
    await r.offA;
    await page.settle();
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);
    await r.offB;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');

    page.api.setUser('user-C');
    page.ctx.guard.bump();
    const pc = page.ctx.afterLogin();
    await page.settle();
    page.api.respond('select', 'profiles', { data: [{ id: 3, owner_id: 'user-C', space_id: 'FIT-C', nickname: '小猫C' }] }, -1);
    await page.settle();
    page.api.respond('select', 'records', { data: [] }, -1);
    await page.settle();
    await pc;
    await page.settle();
    assert.strictEqual(page.view(), 'app', '新会话 C 应可正常登录');

    page.ctx.openSettings();
    const offC = page.el('btn-logout').onclick();
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 3, '新会话登出发出新的 signOut（A/B/C 各 1）');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);
    await offC;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.uid, '');
    assert.strictEqual(page.S.loggedIn, false);
  });

  /* ---------------- RACE-5 同会话连点不退化 ---------------- */
  await test('RACE-5 同一会话连续点击退出 5 次：仍只发送一次 signOut（修复不退化 PAIR-7）', async () => {
    const page = createPage();
    await page.settle();
    await loginOk(page, 'user-A', ROWS_A, []);
    page.ctx.openSettings();
    page.api.holdSignOut();
    const off = page.el('btn-logout').onclick();
    for (let i = 0; i < 4; i++) { page.el('btn-logout').onclick(); }
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 1, '同会话连点只发一次 signOut');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);
    await off;
    await page.settle();
    assert.strictEqual(page.ui.toasts.length, 1, '只弹一次提示');
    assert.strictEqual(page.view(), 'view-login');
  });

  /* ---------------- RACE-6 相反完成顺序（B 先、A 后） ---------------- */
  await test('RACE-6 B 先完成、A 后完成：无锁永久占用、无状态复活、无旧提示', async () => {
    const page = createPage();
    await page.settle();
    const r = await raceOverlap(page);
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);   /* B 先完成 */
    await r.offB;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.uid, '');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.ui.toasts.length, 1, '只有 B 的提示');

    const toastsAfterB = page.ui.toasts.length;
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, 0);    /* A 后完成 */
    await r.offA;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login', 'A 的迟到收尾不得恢复视图');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.uid, '');
    assert.strictEqual(page.ui.toasts.length, toastsAfterB, 'A 的旧提示不得追加');

    page.api.setUser('user-C');
    page.ctx.guard.bump();
    const pc = page.ctx.afterLogin();
    await page.settle();
    page.api.respond('select', 'profiles', { data: [{ id: 3, owner_id: 'user-C', space_id: 'FIT-C', nickname: '小猫C' }] }, -1);
    await page.settle();
    page.api.respond('select', 'records', { data: [] }, -1);
    await page.settle();
    await pc;
    await page.settle();
    page.ctx.openSettings();
    const offC = page.el('btn-logout').onclick();
    await page.settle();
    assert.strictEqual(page.api.count('signOut'), 3, '新会话登出未被旧锁卡死');
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);
    await offC;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
  });

  /* ---------------- RACE-7 cloud Mock SDK 重叠登出 ---------------- */
  await test('RACE-7 cloud Mock SDK：两个重叠登出遵守锁归属，auth.signOut 不重复调用', async () => {
    const mock = mockCloud();
    const page = createPage({ backend: 'cloud', cloud: mock });
    await page.settle();
    page.ctx.uid = 'user-A';
    page.ctx.S.loggedIn = true;
    page.ctx.S.profile = { id: 1, owner_id: 'user-A', space_id: 'FIT-A', nickname: '小鹿A' };
    page.ctx.S.myProfiles = [page.ctx.S.profile];
    page.ctx.show('app');
    page.ctx.openSettings();
    mock.holdSignOut();
    const offA = page.el('btn-logout').onclick();
    await page.settle();
    assert.strictEqual(mock.calls.filter((c) => c[0] === 'auth.signOut').length, 1, 'A 登出 1 次');

    page.ctx.guard.bump();                                   /* 等价登录边界 */
    page.ctx.uid = 'user-B';
    page.ctx.S.loggedIn = true;
    page.ctx.S.profile = { id: 2, owner_id: 'user-B', space_id: 'FIT-B', nickname: '小熊B' };
    page.ctx.S.myProfiles = [page.ctx.S.profile];
    page.ctx.show('app');
    page.ctx.openSettings();
    const offB = page.el('btn-logout').onclick();
    await page.settle();
    assert.strictEqual(mock.calls.filter((c) => c[0] === 'auth.signOut').length, 2, 'B 登出第 2 次');

    mock.releaseSignOut();                                   /* A 先完成 */
    await offA;
    await page.settle();
    const offB2 = page.el('btn-logout').onclick();
    await page.settle();
    assert.strictEqual(mock.calls.filter((c) => c[0] === 'auth.signOut').length, 2, 'cloud 不得重复调用 auth.signOut');
    mock.releaseSignOut();                                   /* B 完成 */
    await offB;
    try { await offB2; } catch (e) {}
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.api.calls.length, 0, 'local 适配层全程零调用');
  });

  /* ---------------- RACE-8 异常路径后的最终状态 ---------------- */
  await test('RACE-8 各异常路径结束后：uid/S/draft/视图符合当前有效会话，不被旧流程污染', async () => {
    const page = createPage();
    await page.settle();
    const r = await raceOverlap(page);
    page.api.netfail('signOut', null, 0);                    /* A 网络错误收尾 */
    await r.offA;
    await page.settle();
    page.api.respond('signOut', null, { data: { localCleared: true, serverRevoked: true } }, -1);   /* B 正常收尾 */
    await r.offB;
    await page.settle();
    assert.strictEqual(page.view(), 'view-login');
    assert.strictEqual(page.uid, '', 'uid 不得被旧流程写回');
    assert.strictEqual(page.S.loggedIn, false);
    assert.strictEqual(page.S.profile, null);
    assert.strictEqual(page.S.profiles.length, 0);
    assert.strictEqual(page.S.myProfiles.length, 0);
    assert.strictEqual(page.S.allRecords.length, 0);
    assert.strictEqual(page.S.space, '');
    assert.deepStrictEqual(page.S.draft, { weight: null, tags: [], todoDone: [], mood: null, note: '' }, 'draft 必须保持复位');
    assert.strictEqual(page.api.live(), 0, '不得残留未决请求');
  });

  console.log('\n===== SUMMARY =====');
  console.log('PASS=' + passed + ' FAIL=' + failed);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
