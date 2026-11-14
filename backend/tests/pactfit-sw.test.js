/* =============================================================================
 * PactFit · Service Worker Mock 测试（H-3-M4，零依赖，Node 18+ 直接运行）
 *   node backend/tests/pactfit-sw.test.js
 *
 * 运行的是真实 web/sw.js 源码（vm + 隔离 CacheStorage Mock），
 * Response/Headers 用受控实现以暴露 type/status/headers 供断言。
 *
 * 覆盖 16 项：
 *   SW-1  导航在线成功            SW-2  导航离线回退外壳
 *   SW-3  导航离线无缓存→503      SW-4  JS 离线有缓存→原内容
 *   SW-5  JS 离线无缓存→503       SW-6  CSS/图片/manifest
 *   SW-7  JSON 失败不回 HTML      SW-8  非 GET 不拦截
 *   SW-9  GoTrue/PostgREST/CDN    SW-10 敏感请求不进缓存
 *   SW-11 install 全成功          SW-12 install 失败可识别
 *   SW-13 activate 只清自己的缓存 SW-14 升级/回滚演练
 *   SW-15 local 不注册 SW         SW-16 cloud 加载契约不变
 *
 * 边界：本文件只能证明 Service Worker **代码逻辑**；
 * 真实 Chromium 的 CacheStorage、生命周期与离线行为须另行授权复测。
 * 测试不记录敏感请求头原文、不落盘任何凭据、不触碰真实浏览器缓存。
 * ============================================================================= */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', '..', 'web');
const SW_SRC = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

const BASE = 'http://127.0.0.1:8899/';

let passed = 0, failed = 0;

function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('用例超时 ' + ms + 'ms：有 Promise 未结算 [' + label + ']')), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); },
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

function flush() { return new Promise((r) => setImmediate(r)); }

/* ---------- 受控 Response（暴露 type/status/headers 供断言） ---------- */
class MockResponse {
  constructor(body, init) {
    init = init || {};
    this.body = body == null ? '' : String(body);
    this.status = init.status === undefined ? 200 : init.status;
    this.type = init.type === undefined ? 'basic' : init.type;
    this.headers = new Headers(init.headers || {});
    this.ok = this.status >= 200 && this.status < 300;
  }
  clone() {
    const h = {};
    this.headers.forEach((v, k) => { h[k] = v; });
    return new MockResponse(this.body, { status: this.status, type: this.type, headers: h });
  }
  text() { return Promise.resolve(this.body); }
}

/* ---------- 静态资源服务（可指定缺失资源制造离线/404） ---------- */
const ASSET_BODIES = {
  '': { body: 'SHELL-ROOT', ct: 'text/html; charset=utf-8' },
  'index.html': { body: '<!doctype html>SHELL', ct: 'text/html; charset=utf-8' },
  'manifest.json': { body: '{"name":"减脂搭子"}', ct: 'application/manifest+json' },
  'icons/icon-192.png': { body: 'PNG192', ct: 'image/png' },
  'icons/icon-512.png': { body: 'PNG512', ct: 'image/png' },
  'pactfit-be.js': { body: '/*PACTFIT-BE*/', ct: 'application/javascript' },
  'pactfit-local-api.js': { body: '/*LOCAL-API*/', ct: 'application/javascript' },
  'api/private': { body: 'PRIVATE-OK', ct: 'application/json' }
};

function assetServer(opts) {
  opts = opts || {};
  const offline = new Set(opts.offline || []);   /* 这些 URL 网络层失败 */
  return function (input) {
    const url = String(input.url !== undefined ? input.url : input);
    const q = url.indexOf('?');
    const pathOnly = q >= 0 ? url.slice(0, q) : url;
    const p = pathOnly.indexOf(BASE) === 0 ? pathOnly.slice(BASE.length) : pathOnly;
    if (offline.has(p)) return Promise.reject(new TypeError('Failed to fetch'));
    const a = ASSET_BODIES[p];
    if (!a) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new MockResponse(a.body, { headers: { 'Content-Type': a.ct } }));
  };
}
function offlineFetch() { return Promise.reject(new TypeError('Failed to fetch')); }

/* ---------- 隔离 CacheStorage Mock ---------- */
function makeCaches(fetchImpl) {
  const stores = new Map();                    /* name -> Map(absoluteUrl -> Response) */
  let currentFetch = fetchImpl;                /* 允许后续重绑（升级/回滚演练共用一套缓存） */
  function keyOf(req) { return typeof req === 'string' ? new URL(req, BASE).toString() : req.url; }
  return {
    _stores: stores,
    _setFetch(fn) { currentFetch = fn; },
    open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return Promise.resolve({
        /* 真实 addAll 语义：任一资源失败 → 整体失败；网络层拒绝也要可识别 */
        async addAll(urls) {
          for (const u of urls) {
            let res;
            try {
              res = await currentFetch(new URL(u, BASE).toString());
            } catch (e) {
              throw new Error('addAll failed: ' + u + ' :: ' + (e && e.message));
            }
            if (!res || res.status !== 200) {
              throw new Error('addAll failed: ' + u + ' status=' + (res && res.status));
            }
            store.set(new URL(u, BASE).toString(), res);
          }
          return urls;
        },
        put(req, res) { store.set(keyOf(req), res); return Promise.resolve(); },
        match(req) { return Promise.resolve(store.get(keyOf(req)) || null); }
      });
    },
    match(req) {
      const k = keyOf(req);
      for (const store of stores.values()) {
        if (store.has(k)) return Promise.resolve(store.get(k));
      }
      return Promise.resolve(null);
    },
    keys() { return Promise.resolve(Array.from(stores.keys())); },
    delete(name) { stores.delete(name); return Promise.resolve(true); }
  };
}

/* ---------- 把真实 web/sw.js 跑进隔离沙箱 ---------- */
function loadSW(opts) {
  opts = opts || {};
  const fetchImpl = opts.fetch || offlineFetch;
  const cachesMock = opts.caches || makeCaches(fetchImpl);
  if (opts.caches && opts.caches._setFetch) opts.caches._setFetch(fetchImpl);
  const listeners = {};
  const state = { skipWaiting: false, claim: false };
  const sandbox = {
    caches: cachesMock,
    fetch: fetchImpl,
    URL: URL,
    Response: MockResponse,
    Headers: Headers,
    Promise: Promise,
    console: { log() {}, warn() {}, error() {} }
  };
  sandbox.self = {
    addEventListener(type, fn) { listeners[type] = fn; },
    location: { origin: 'http://127.0.0.1:8899', hostname: '127.0.0.1' },
    skipWaiting() { state.skipWaiting = true; return Promise.resolve(); },
    clients: { claim() { state.claim = true; return Promise.resolve(); } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(opts.src || SW_SRC, sandbox, { filename: opts.filename || 'web/sw.js' });
  return { listeners: listeners, state: state, caches: cachesMock, sandbox: sandbox };
}

/* ---------- 最小请求构造（真实 Headers + 真实 URL 解析） ---------- */
function req(url, opts) {
  opts = opts || {};
  return {
    url: new URL(url, BASE).toString(),
    method: opts.method || 'GET',
    mode: opts.mode || 'cors',
    destination: opts.destination || '',
    headers: new Headers(opts.headers || {})
  };
}

/* ---------- fetch 事件分发：返回 respondWith 的结果；未拦截返回 null ---------- */
async function dispatch(sw, request) {
  let responded = null;
  const waited = [];
  const e = {
    request: request,
    respondWith(p) { responded = Promise.resolve(p); },
    waitUntil(p) { waited.push(Promise.resolve(p)); }
  };
  assert.ok(sw.listeners.fetch, 'sw.js 必须注册 fetch 监听');
  sw.listeners.fetch(e);
  if (responded) return responded;
  await Promise.all(waited);
  return null;
}

async function runInstall(sw) {
  const waited = [];
  assert.ok(sw.listeners.install, 'sw.js 必须注册 install 监听');
  sw.listeners.install({ waitUntil(p) { waited.push(Promise.resolve(p)); } });
  await Promise.all(waited);
}

async function runActivate(sw) {
  const waited = [];
  assert.ok(sw.listeners.activate, 'sw.js 必须注册 activate 监听');
  sw.listeners.activate({ waitUntil(p) { waited.push(Promise.resolve(p)); } });
  await Promise.all(waited);
}

function isHtmlLike(res) {
  const ct = res.headers.get('content-type') || '';
  return ct.indexOf('text/html') >= 0 || /<!doctype|<html/i.test(res.body || '');
}

/* ========================================================================= */
(async () => {

  /* ---------------- SW-1 页面导航在线成功 ---------------- */
  await test('SW-1 导航在线：原样透传，并把响应写入运行时缓存', async () => {
    const sw = loadSW({ fetch: assetServer() });
    const res = await dispatch(sw, req('./', { mode: 'navigate', destination: 'document' }));
    assert.ok(res, '导航必须被 respondWith');
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.text()), 'SHELL-ROOT');
    await flush(); await flush();
    const store = sw.caches._stores.get('fit-together-v3');
    assert.ok(store && store.has(BASE), '在线成功的 200 basic 响应应进入运行时缓存');
    /* 预缓存仍在：install 未执行时运行时缓存即 v3 */
  });

  /* ---------------- SW-2 导航离线，缓存外壳可用 ---------------- */
  await test('SW-2 导航离线：优先本请求缓存，再回退 index.html 外壳', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    sw.sandbox.fetch = offlineFetch;           /* 离线 */
    /* 深层路由：没有精确缓存 → 必须回退外壳 */
    const deep = await dispatch(sw, req('/some/deep/route', { mode: 'navigate', destination: 'document' }));
    assert.ok(deep, '离线导航必须被兜底');
    assert.strictEqual(deep.status, 200);
    assert.strictEqual(deep.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.strictEqual(await deep.text(), '<!doctype html>SHELL');
    /* 根路径：有精确缓存 → 返回本请求缓存 */
    const root = await dispatch(sw, req('./', { mode: 'navigate', destination: 'document' }));
    assert.strictEqual(await root.text(), 'SHELL-ROOT');
  });

  /* ---------------- SW-3 导航离线、无任何页面缓存 ---------------- */
  await test('SW-3 导航离线且无外壳缓存：明确 503，不虚构 HTML', async () => {
    const sw = loadSW({ fetch: offlineFetch });
    const res = await dispatch(sw, req('/whatever', { mode: 'navigate', destination: 'document' }));
    assert.ok(res, '必须有明确答复（而不是把 promise reject 掉装作没看见）');
    assert.strictEqual(res.status, 503, '必须是 503 明确失败');
    assert.strictEqual(isHtmlLike(res), false, '不得返回 HTML');
    assert.strictEqual((await res.text()).indexOf('offline:'), 0);
  });

  /* ---------------- SW-4 JS 离线且有缓存 ---------------- */
  await test('SW-4 JS 离线且有缓存：返回原 JS 内容，绝不返回 index.html', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    sw.sandbox.fetch = offlineFetch;
    const res = await dispatch(sw, req('./pactfit-be.js', { mode: 'no-cors', destination: 'script' }));
    assert.ok(res);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/javascript');
    assert.strictEqual(await res.text(), '/*PACTFIT-BE*/');
    assert.strictEqual(isHtmlLike(res), false, '不得冒充 HTML');
  });

  /* ---------------- SW-5 JS 离线且无缓存 ---------------- */
  await test('SW-5 JS 离线且无缓存：明确 503，不返回 HTML', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    sw.sandbox.fetch = offlineFetch;
    const res = await dispatch(sw, req('./extra.js', { mode: 'no-cors', destination: 'script' }));
    assert.ok(res);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(isHtmlLike(res), false, '绝不能用 index.html 冒充 JS');
  });

  /* ---------------- SW-6 CSS / 图片 / manifest 离线 ---------------- */
  await test('SW-6 CSS/图片/manifest：有缓存返回原资源，缺失明确 503', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    sw.sandbox.fetch = offlineFetch;
    /* manifest：已预缓存 → 原样返回 */
    const mf = await dispatch(sw, req('./manifest.json', { destination: 'manifest' }));
    assert.strictEqual(mf.status, 200);
    assert.strictEqual(mf.headers.get('content-type'), 'application/manifest+json');
    assert.strictEqual(await mf.text(), '{"name":"减脂搭子"}');
    /* 图标：已预缓存 → 原样返回 */
    const icon = await dispatch(sw, req('./icons/icon-512.png', { destination: 'image' }));
    assert.strictEqual(icon.status, 200);
    assert.strictEqual(icon.headers.get('content-type'), 'image/png');
    assert.strictEqual(await icon.text(), 'PNG512');
    /* CSS：未预缓存且离线 → 明确 503，不回 HTML */
    const css = await dispatch(sw, req('./style.css', { destination: 'style' }));
    assert.strictEqual(css.status, 503);
    assert.strictEqual(isHtmlLike(css), false);
  });

  /* ---------------- SW-7 JSON 请求失败 ---------------- */
  await test('SW-7 JSON 请求离线失败：不返回 HTML', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    sw.sandbox.fetch = offlineFetch;
    const res = await dispatch(sw, req('./data.json', { destination: '' }));
    assert.ok(res);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(isHtmlLike(res), false, 'JSON 不得被 index.html 冒充');
    const ct = res.headers.get('content-type') || '';
    assert.ok(ct.indexOf('json') < 0 || res.status === 503, '失败响应不得伪装成 JSON 成功');
  });

  /* ---------------- SW-8 非 GET 不拦截 ---------------- */
  await test('SW-8 POST/PATCH/DELETE：不被 SW 离线兜底、不转成缓存读取', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    sw.sandbox.fetch = offlineFetch;
    for (const m of ['POST', 'PATCH', 'DELETE']) {
      const r = await dispatch(sw, req('./anything', { method: m }));
      assert.strictEqual(r, null, m + ' 不得被 respondWith（不得离线伪造成功）');
    }
    assert.strictEqual(sw.caches._stores.get('fit-together-v3').size, 7, '非 GET 不得写缓存');
  });

  /* ---------------- SW-9 GoTrue / PostgREST / CDN ---------------- */
  await test('SW-9 跨源 API 与 /.cloud/：不缓存、不回退、原样放行', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    const before = JSON.stringify([...sw.caches._stores].map(([k, v]) => [k, v.size]));
    for (const u of [
      'http://127.0.0.1:9999/otp',
      'http://127.0.0.1:9999/verify?token=REDACTED&type=signup',
      'http://127.0.0.1:3000/records',
      'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js',
      BASE + '.cloud/db'
    ]) {
      const r = await dispatch(sw, req(u));
      assert.strictEqual(r, null, u + ' 必须原样放行（不得 respondWith）');
    }
    const after = JSON.stringify([...sw.caches._stores].map(([k, v]) => [k, v.size]));
    assert.strictEqual(after, before, '放行的请求不得写任何缓存');
  });

  /* ---------------- SW-10 敏感请求不进缓存 ---------------- */
  await test('SW-10 Authorization/敏感查询：照常放行但不写入任何缓存', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    /* 带 Authorization 头：200 成功也不得写缓存 */
    const auth = req('./api/private', { headers: { Authorization: 'Bearer (redacted)' } });
    const r1 = await dispatch(sw, auth);
    assert.ok(r1 && r1.status === 200, '敏感请求仍应正常放行拿到响应');
    await flush(); await flush();
    assert.strictEqual(sw.caches._stores.get('fit-together-v3').has(BASE + 'api/private'), false,
      '带 Authorization 的响应不得进入静态缓存');
    /* 带 token 查询串：不缓存 */
    const tok = await dispatch(sw, req('./api/private?token=REDACTED&type=signup'));
    assert.ok(tok && tok.status === 200);
    await flush(); await flush();
    assert.strictEqual([...sw.caches._stores.get('fit-together-v3').keys()]
      .some((k) => k.indexOf('token=') >= 0), false, '凭据不得成为缓存键的一部分');
    /* 离线时敏感请求：明确网络失败，不回退外壳 */
    sw.sandbox.fetch = offlineFetch;
    await assert.rejects(
      () => dispatch(sw, req('./api/private', { headers: { Authorization: 'Bearer (redacted)' } })),
      (e) => /Failed to fetch/.test(e.message),
      '敏感请求离线时不得用外壳兜底'
    );
  });

  /* ---------------- SW-11 install 全部资源存在 ---------------- */
  await test('SW-11 install/addAll 全部资源存在：安装成功并 skipWaiting', async () => {
    const sw = loadSW({ fetch: assetServer() });
    await runInstall(sw);
    assert.strictEqual(sw.state.skipWaiting, true, '预缓存成功后应 skipWaiting');
    const store = sw.caches._stores.get('fit-together-v3');
    assert.ok(store, '应建立 v3 缓存');
    for (const u of ['./', './index.html', './manifest.json', './icons/icon-192.png',
                     './icons/icon-512.png', './pactfit-be.js', './pactfit-local-api.js']) {
      assert.ok(store.has(new URL(u, BASE).toString()), '预缓存应包含 ' + u);
    }
    assert.strictEqual(store.size, 7);
    /* 正文逐个核对，不只是 promise resolved */
    assert.strictEqual(await (await store.get(BASE)).text(), 'SHELL-ROOT');
    assert.strictEqual(await (await store.get(BASE + 'pactfit-be.js')).text(), '/*PACTFIT-BE*/');
  });

  /* ---------------- SW-12 install 含不存在资源 ---------------- */
  await test('SW-12 install 资源缺失：安装失败可识别，不得 skipWaiting', async () => {
    const sw = loadSW({ fetch: assetServer({ offline: ['icons/icon-512.png'] }) });
    await assert.rejects(() => runInstall(sw),
      (e) => /addAll failed/.test(e.message), '缺失资源必须让 install 整体失败');
    assert.strictEqual(sw.state.skipWaiting, false, '安装失败绝不能 skipWaiting（旧 SW 要继续服务）');
    const store = sw.caches._stores.get('fit-together-v3');
    assert.ok(store && store.size < 7, '缓存只能是部分写入（真实浏览器会丢弃失败安装）');
  });

  /* ---------------- SW-13 activate 只清理本应用旧缓存 ---------------- */
  await test('SW-13 activate：只回收 fit-together-* 旧版本，不动无关缓存', async () => {
    const cachesMock = makeCaches(offlineFetch);
    /* 预置：旧版本、其他应用、无关数据 */
    const old = await cachesMock.open('fit-together-v2');
    await old.put(req('./index.html'), new MockResponse('OLD'));
    const other = await cachesMock.open('other-app-v1');
    await other.put(req('./x'), new MockResponse('OTHER'));
    const misc = await cachesMock.open('unrelated-data');
    await misc.put(req('./y'), new MockResponse('MISC'));

    const sw = loadSW({ caches: cachesMock });
    await runActivate(sw);
    const keys = await cachesMock.keys();
    assert.ok(keys.indexOf('fit-together-v2') < 0, '本应用旧版本应被回收');
    assert.ok(keys.indexOf('other-app-v1') >= 0, '其他应用的缓存不得删除');
    assert.ok(keys.indexOf('unrelated-data') >= 0, '无关缓存不得删除');
    assert.strictEqual((await cachesMock.match(req('./x'))).body, 'OTHER', '其他应用数据必须原样保留');
    assert.strictEqual(sw.state.claim, true, 'activate 后应 clients.claim');
  });

  /* ---------------- SW-14 新旧版本安装与回滚演练 ---------------- */
  await test('SW-14 升级与回滚演练：版本互斥回收，资源不串版本', async () => {
    const cachesMock = makeCaches(offlineFetch);
    const other = await cachesMock.open('other-app-v1');
    await other.put(req('./x'), new MockResponse('OTHER'));

    /* 阶段 1：安装 v3（当前源码）并 activate */
    const v3 = loadSW({ fetch: assetServer(), caches: cachesMock });
    await runInstall(v3);
    await runActivate(v3);
    assert.deepStrictEqual((await cachesMock.keys()).sort(), ['fit-together-v3', 'other-app-v1']);
    assert.strictEqual(cachesMock._stores.get('fit-together-v3').size, 7);

    /* 阶段 2：回滚部署旧版（v2 + 旧 ASSETS 5 项），同一存储环境 */
    const v2src = SW_SRC
      .replace("var CACHE = 'fit-together-v3';", "var CACHE = 'fit-together-v2';")
      .replace(/var PRECACHE = \[[\s\S]*?\];/, [
        'var PRECACHE = [',
        "  './', './index.html', './manifest.json',",
        "  './icons/icon-192.png', './icons/icon-512.png'",
        '];'
      ].join('\n'));
    assert.ok(v2src.indexOf('fit-together-v2') >= 0, '回滚源码必须切回 v2');
    const v2 = loadSW({ fetch: assetServer(), caches: cachesMock, src: v2src, filename: 'web/sw.js@v2' });
    await runInstall(v2);
    await runActivate(v2);
    const keys = await cachesMock.keys();
    assert.deepStrictEqual(keys.sort(), ['fit-together-v2', 'other-app-v1'],
      '回滚版 activate 应回收 v3，且不动无关缓存');
    const v2store = cachesMock._stores.get('fit-together-v2');
    assert.ok(v2store, '回滚后应存在 v2 缓存');
    assert.strictEqual(v2store.size, 5, '回滚版只预缓存旧清单的 5 项');
    assert.strictEqual(v2store.has(BASE + 'pactfit-be.js'), false,
      '回滚版不得混入新版本才有的资源');
    assert.strictEqual(await (await v2store.get(BASE + 'index.html')).text(), '<!doctype html>SHELL');
  });

  /* ---------------- SW-15 local 模式不注册 SW（真实 index.html 代码） ---------------- */
  await test('SW-15 local 不注册 SW 且清理旧注册；cloud 才注册 sw.js', async () => {
    /* 从 index.html 原文截取真实的注册代码块（不改一字） */
    const start = INDEX_SRC.indexOf("/* ---------- service worker ---------- */");
    assert.ok(start > 0, 'index.html 必须含 SW 注册段');
    const end = INDEX_SRC.lastIndexOf('}');
    const snippet = INDEX_SRC.slice(start, end + 1);

    function regPage(backend) {
      const registered = [], unregistered = [];
      const regs = [{ unregister() { unregistered.push(1); } }];
      const sandbox = {
        navigator: {
          serviceWorker: {
            register(url) { registered.push(url); return Promise.resolve({}); },
            getRegistrations() { return Promise.resolve(regs); }
          }
        },
        BACKEND: backend
      };
      sandbox.window = {
        addEventListener(type, fn) { sandbox._load = (type === 'load') ? fn : null; }
      };
      vm.createContext(sandbox);
      vm.runInContext(snippet, sandbox, { filename: 'web/index.html#sw-register' });
      return { registered: registered, unregistered: unregistered, load: () => { if (sandbox._load) sandbox._load(); } };
    }

    /* local：不注册，并清理同源旧注册 */
    const local = regPage('local');
    await flush(); await flush();
    assert.deepStrictEqual(local.registered, [], 'local 模式不得注册 SW');
    assert.strictEqual(local.unregistered.length, 1, 'local 模式应清理旧注册');

    /* cloud：load 后注册 sw.js */
    const cloud = regPage('cloud');
    await flush();
    assert.deepStrictEqual(cloud.registered, [], 'cloud 也要等 load 事件');
    cloud.load();
    await flush();
    assert.deepStrictEqual(cloud.registered, ['sw.js'], 'cloud 模式应注册 sw.js');
  });

  /* ---------------- SW-16 cloud 加载契约不变（真实 loader 代码） ---------------- */
  await test('SW-16 脚本加载契约：cloud 走原 CDN，local 走本地适配层，pactfit-be 两模式共用', async () => {
    const m = /<script data-page-node-id="pfBackendLoader">([\s\S]*?)<\/script>/.exec(INDEX_SRC);
    assert.ok(m, 'index.html 必须含 pfBackendLoader 块');
    const loaderSrc = m[1];

    function runLoader(backend) {
      const writes = [];
      const sandbox = {
        document: {
          createElement() {
            return { src: '', get outerHTML() { return '<script src="' + this.src + '"><' + '/script>'; } };
          },
          write(s) { writes.push(s); }
        }
      };
      sandbox.window = { __PACTFIT_BACKEND__: backend };
      vm.createContext(sandbox);
      vm.runInContext(loaderSrc, sandbox, { filename: 'web/index.html#pfBackendLoader' });
      return writes;
    }

    const cloud = runLoader('cloud');
    assert.strictEqual(cloud.length, 2, 'cloud 必须恰好加载两个脚本');
    assert.ok(cloud[0].indexOf('https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js') >= 0,
      'cloud 第一个必须是原 CDN SDK');
    assert.ok(cloud[1].indexOf('./pactfit-be.js') >= 0, '第二个是两模式共用的接线层');

    const local = runLoader('local');
    assert.ok(local[0].indexOf('./pactfit-local-api.js') >= 0, 'local 第一个是本地适配层');
    assert.ok(local[1].indexOf('./pactfit-be.js') >= 0);
    assert.ok(JSON.stringify(local).indexOf('cdn.jsdelivr') < 0, 'local 不得加载 Cloud SDK');
  });

  console.log('\n===== SUMMARY =====');
  console.log('PASS=' + passed + ' FAIL=' + failed);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
