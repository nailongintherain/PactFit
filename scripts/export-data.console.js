/* =============================================================
 * scripts/export-data.console.js
 * 用途：在浏览器里，把当前登录账号能看到的全部数据导出成一份 JSON 备份。
 *
 * 怎么用：
 *   1. 用手机或电脑打开 https://fit-together-44172.app.workbuddy.host 并完成登录
 *   2. 打开开发者工具 → Console
 *   3. 整段粘贴本文件内容，回车
 *   4. 浏览器会自动下载 fit-together-backup-YYYYMMDD-HHmm.json
 *
 * 安全性：
 *   - 只做 select('*')，不写、不改、不删任何数据
 *   - 导出范围 = 当前账号的 RLS 可见范围（也就是你和搭档的全部记录）
 *   - 文件含体重与留言，属于隐私数据，别提交进 Git，别发群里
 *   - 若页面里没有 cloud 变量（被压缩改名），先跑 window.cloud 看看是否存在
 * ============================================================= */
(async function exportFitTogetherData() {
  'use strict';

  const TABLES = ['profiles', 'records', 'todos', 'tags', 'rewards', 'messages'];

  if (typeof cloud === 'undefined' || !cloud || !cloud.database) {
    console.error('找不到 cloud 实例。请确认：① 已登录 ② 页面没被改动过 ③ 在应用的 Console 里执行');
    return;
  }

  console.log('开始导出，不写入任何数据…');
  const dump = { exportedAt: new Date().toISOString(), source: location.origin, tables: {} };
  const summary = {};

  for (const t of TABLES) {
    try {
      const res = await cloud.database.from(t).select('*');
      if (res && res.error) throw res.error;
      const rows = (res && res.data) || [];
      dump.tables[t] = rows;
      summary[t] = rows.length;
      console.log(`  ${t}: ${rows.length} 行`);
    } catch (e) {
      dump.tables[t] = { __error: (e && e.message) || String(e) };
      summary[t] = 'FAILED';
      console.warn(`  ${t}: 失败 — ${(e && e.message) || e}`);
    }
  }

  // 会话信息（只取 id，不含手机号/邮箱）
  try {
    const sess = await cloud.auth.getSession();
    dump.account = { userId: sess && sess.data && sess.data.user && sess.data.user.id };
  } catch (e) {
    dump.account = { error: 'getSession failed' };
  }

  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-` +
                `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fit-together-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);

  console.table(summary);
  console.log('已下载备份。请存到两个地方：本地 + 网盘。不要提交进 Git。');
})();
