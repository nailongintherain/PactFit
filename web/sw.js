/* 减脂搭子 · service worker（H-3-M4 修订）
   核心规则：只有「页面导航」才允许离线回退到缓存的 index.html 应用外壳；
   JS/CSS/图片/字体/manifest/JSON 等非导航资源离线且无缓存时**明确失败**，
   绝不拿 HTML 冒充目标资源（旧版会返回 index.html，浏览器把它当 JS/CSS
   解析直接报语法错误，用户看到的是“白屏/报错”而不是“离线”）。

   请求分类（fetch）：
   - 非 GET：不拦截、不伪造（照原样放行给网络）；
   - 跨源（CDN 上的 Cloud SDK、GoTrue :9999、PostgREST :3000）：放行，
     不缓存、不兜底、不读缓存；
   - 同源 /.cloud/ 云端数据接口：放行，不缓存、不兜底；
   - 带 Authorization 头或敏感查询串（token/code 等）的同源请求：放行，
     但**不写入任何缓存**（OTP/会话凭据不落盘）；
   - 其余同源 GET：网络优先；成功(200 basic)才写运行时缓存；
     离线时导航回退应用外壳，非导航明确 503。

   生命周期：
   - install：addAll 全量预缓存**成功后**才 skipWaiting；任一资源失败 →
     install 整体失败 → 旧 SW 继续服务（绝不带病上岗、绝不清空旧缓存）；
   - activate：只回收本应用（fit-together- 前缀）的旧版本缓存，
     其他应用或无关缓存一律不动。 */
var CACHE = 'fit-together-v3';
var CACHE_PREFIX = 'fit-together-';
var PRECACHE = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './pactfit-be.js', './pactfit-local-api.js'
];

/* 敏感查询串：OTP / 会话类参数不进缓存键（不缓存 = 不落盘） */
var SENSITIVE_QUERY = /[?&](token|code|access_token|refresh_token|otp)=/i;

function isSensitive(req, url) {
  try {
    if (req.headers && req.headers.get && req.headers.get('authorization')) return true;
  } catch (e) {}
  return SENSITIVE_QUERY.test(url.search || '');
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        /* 只回收本应用前缀的旧版本；其他应用/无关缓存一律不动 */
        return (k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE)
          ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 明确失败：503 + 纯文本，绝不返回 HTML */
function offlineFail(pathname) {
  return new Response('offline: ' + pathname, {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 /* 非 GET：不拦截、不伪造离线成功 */

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  /* 跨源：SDK/GoTrue/PostgREST 全放行 */
  if (url.pathname.indexOf('/.cloud/') === 0) return; /* 云端数据接口：不缓存不兜底 */
  if (isSensitive(req, url)) {                      /* 敏感请求：照常发网络，但不写缓存 */
    e.respondWith(fetch(req));
    return;
  }

  var isNav = req.mode === 'navigate';

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      /* 网络不可用：先找本请求自己的缓存 */
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (!isNav) return offlineFail(url.pathname);   /* 非导航：绝不拿 HTML 冒充 */
        return caches.match('./index.html').then(function (shell) {
          if (shell) return shell;                      /* 导航：回退应用外壳 */
          return caches.match('./').then(function (root) {
            return root || offlineFail(url.pathname);   /* 连外壳都没有：明确失败 */
          });
        });
      });
    })
  );
});
