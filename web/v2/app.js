/* PactFit V2 Preview: one account store, one selected space, server-authoritative data. */
(function () {
  "use strict";
  const M = PF2Model,
    e = M.esc,
    $ = (s) => document.querySelector(s);
  const paths = {
    home: "M3 10 12 3l9 7v10H5V10m4 10v-7h6v7",
    trend: "M3 18 9 11l4 3 8-10M16 4h5v5",
    gem: "m3 8 4-5h10l4 5-9 13L3 8Zm0 0h18M7 3l5 18 5-18",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    menu: "M4 6h16M4 12h16M4 18h16",
    plus: "M12 4v16M4 12h16",
    chevron: "m9 5 7 7-7 7",
    more: "M5 12h.1M12 12h.1M19 12h.1",
    settings:
      "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
    close: "m6 6 12 12M6 18 18 6",
    check: "m5 12 4 4 10-10",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    lock: "M5 10h14v11H5V10Zm3 0V6a4 4 0 0 1 8 0v4",
    leaf: "M20 3C8 1 1 9 6 16s17 4 14-13ZM6 20 16 8",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    heart: "M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1C-1 11 12 21 12 21S25 11 20 5Z",
    copy: "M9 9h12v12H9V9ZM15 5V3H3v12h2",
    shield: "m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4Zm-4 10 3 3 5-6",
    logout: "M10 4H3v16h7m5-12 4 4-4 4M8 12h12",
    mail: "M3 5h18v14H3V5Zm0 0 9 8 9-8",
    clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7",
  };
  const icon = (name, size = 19) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.leaf}"/></svg>`;
  const avatar = (p, size = "", status) =>
    `<span class="avatar ${size}" aria-hidden="true">${M.avatars[p?.avatar] || "🌿"}${status === undefined ? "" : `<i class="dot ${status ? "done" : ""}"></i>`}</span>`;
  const btn = (label, action, attrs = "", style = "secondary") =>
    `<button class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
  const empty = (text) => `<div class="empty">${text}</div>`;
  const number = (v) =>
    v === null || v === undefined ? "—" : Number(v).toFixed(1);
  const art = `<div class="brand-art" aria-hidden="true"><svg viewBox="0 0 160 120" fill="none"><path d="M26 88c18-22 34-34 53-36 20-2 34 10 55-20" stroke="#b84a34" stroke-width="12" stroke-linecap="round"/><path d="M26 88c18-22 34-34 53-36 20-2 34 10 55-20" stroke="#fff8eb" stroke-width="5" stroke-linecap="round" stroke-dasharray="3 17"/><path d="M29 73c9 0 16 7 16 16s-7 16-16 16-16-7-16-16 7-16 16-16Z" fill="#f4b64f"/><path d="M122 18c12 0 21 9 21 21s-9 21-21 21-21-9-21-21 9-21 21-21Z" fill="#f47763"/><path d="m115 30 8 8 13-16" stroke="#fff8eb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="80" cy="110" rx="48" ry="4" fill="#ecd4c2"/></svg></div>`;
  const companionLabels = {
    default: "默认伙伴图标",
    waiting: "今天还没有记录",
    recorded: "今天的记录已保存",
    together: "我和搭子今天都已记录",
  };
  function companion(state = "default", size = "") {
    const waiting = state === "waiting",
      recorded = state === "recorded",
      together = state === "together";
    return `<span class="companion ${size}" data-companion-state="${state}" role="img" aria-label="${companionLabels[state]}"><svg viewBox="0 0 120 120" aria-hidden="true"><path class="companion-body" d="M31 17C42 9 78 9 89 17c8 6 10 20 12 35l7 43c2 12-8 18-20 16l-18-3c-6-1-14-1-20 0l-18 3c-12 2-22-4-20-16l7-43c2-15 4-29 12-35Z"/><path class="companion-dial" d="M28 49c2-20 14-30 32-30s30 10 32 30H28Z"/><path class="companion-tick" d="M60 25v8M40 30l6 6M80 30l-6 6"/><path class="companion-needle" d="M60 47 56 35l4-10 4 10-4 12Z" transform="${waiting ? "rotate(-32 60 47)" : ""}"/><path class="companion-foot" d="M27 82c12-9 54-9 66 0 5 4 4 14-3 17-18 7-42 7-60 0-7-3-8-13-3-17Z"/>${waiting ? '<path class="companion-face" d="M40 68h10M70 68h10"/>' : '<circle class="companion-eye" cx="45" cy="68" r="3.5"/><circle class="companion-eye" cx="75" cy="68" r="3.5"/>'}${recorded ? '<circle class="companion-status" cx="60" cy="89" r="5"/>' : ""}${together ? '<path class="companion-smile" d="M47 87c7 8 19 8 26 0"/><circle class="companion-status" cx="45" cy="87" r="4"/><circle class="companion-status" cx="75" cy="87" r="4"/>' : ""}</svg></span>`;
  }
  function dynamicCompanion() {
    try {
      return localStorage.getItem("pactfit_v2_dynamic_companion") !== "static";
    } catch (_) {
      return true;
    }
  }
  function companionState(d = st.data) {
    if (!d || !dynamicCompanion()) return "default";
    if (!M.today(d).checkin) return "waiting";
    if (
      d.space.kind === "team" &&
      d.members.some((m) => m.user_id !== d.me.user_id && m.checked_today)
    )
      return "together";
    return "recorded";
  }
  function milestoneIcon(kind, achieved = true, size = "") {
    const cls = `milestone-icon milestone-${kind} ${achieved ? "achieved" : "locked"} ${size}`;
    if (kind === "step")
      return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 80 80"><path class="milestone-step-shape" d="M50 13c10 7 8 19 2 28L38 59 22 48l10-21c5-11 10-19 18-14Z"/><path class="milestone-accent" d="m22 48 16 11-6 9c-4 5-12 4-17 0-5-4-6-10-3-15l10-5Z"/></svg></span>`;
    if (kind === "routine")
      return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 80 80"><path class="milestone-line" d="M15 29h50"/><path class="milestone-towel-back" d="M28 23h23c6 0 10 4 10 10v30H24l4-40Z"/><path class="milestone-towel" d="M34 21h22c5 0 7 3 7 8v34H29l5-42Z"/><path class="milestone-fold" d="M52 21v14h11"/><path class="milestone-hem" d="M30 55h33"/></svg></span>`;
    if (kind === "together")
      return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 80 80"><path class="milestone-ribbon-a" d="M10 54 30 32l14 12-20 22-14-12Z"/><path class="milestone-ribbon-b" d="m38 38 18-23 14 11-19 24-13-12Z"/><path class="milestone-knot" d="M23 29c7-7 14-7 21 0l9 9c5 5 3 14-3 18-5 3-10 2-14-2L23 42c-4-4-4-9 0-13Zm34 22c-7 7-14 7-21 0l-9-9c-5-5-3-14 3-18 5-3 10-2 14 2l13 12c4 4 4 9 0 13Z"/></svg></span>`;
    return `<span class="${cls}" aria-hidden="true">${icon("spark", 28)}</span>`;
  }
  function awardKind(award) {
    const code = typeof award === "string" ? award : award?.code;
    if (code === "first_checkin") return "step";
    if (code === "streak_7") return "routine";
    if (code === "team_together") return "together";
    return "other";
  }
  let api, toastTimer;
  const st = {
    data: null,
    space: null,
    page: "home",
    range: 30,
    messageTab: "pending",
    expanded: new Set(),
    loading: false,
    error: "",
    busy: false,
    epoch: 0,
    seq: 0,
    modal: null,
    modalData: null,
    authMode: "signin",
  };
  const pages = [
    ["home", "首页", "home"],
    ["trend", "趋势", "trend"],
    ["achievements", "成就", "gem"],
    ["messages", "消息", "bell"],
  ];
  function toast(text) {
    $("#toast").textContent = text;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      4500,
    );
  }
  function preferences() {
    const theme = localStorage.getItem("pactfit_v2_theme") || "system";
    document.documentElement.dataset.theme =
      theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.style.fontSize =
      (localStorage.getItem("pactfit_v2_font") || "15") + "px";
  }
  try {
    preferences();
  } catch (_) {}
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    try {
      preferences();
    } catch (_) {}
  });
  function setSidebar(open) {
    document.body.classList.toggle("sidebar-open", open);
    const layer = $(".drawer-layer"),
      workspace = $(".workspace");
    if (layer) layer.inert = !open;
    if (workspace) workspace.inert = open;
  }
  function errorNotice(text) {
    return `<div class="notice error row between" role="alert"><span>${e(text)}</span><button class="text-btn" data-action="refresh">重试</button></div>`;
  }
  function authView(message = "") {
    const mode = st.authMode;
    const titles = {
      signin: "欢迎回来",
      signup: "从今天，轻一点开始",
      recover: "设置／找回密码",
      reset: "设置你的新密码",
    };
    $("#app").innerHTML =
      `<div class="auth-layout"><section class="auth-story"><div class="row">${companion("default", "brand-companion")}<span class="brand">PactFit</span></div><h1>一起把日子<br>过轻一点。</h1><p>记录每一个小小的坚持，<br>也为同行的人，留一份鼓励。</p><div class="auth-art">${art}</div><p style="margin-top:30px">V2.0 Preview · 独立预览环境</p></section><section class="auth"><form id="auth-form"><span class="tag">${api ? "真实账号 · 独立数据服务" : "环境未就绪"}</span><h1 style="margin-top:20px">${titles[mode]}</h1><p>${mode === "recover" ? "输入账号邮箱，我们会发送设置密码链接。" : mode === "reset" ? "设置后可直接使用邮箱和密码登录。" : "从你的私人空间开始，也可以邀请搭子一起出发。"}</p>${mode !== "reset" ? '<label for="auth-email">邮箱地址</label><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com">' : ""}${mode !== "recover" ? `<label for="auth-password">密码</label><input id="auth-password" type="password" ${mode === "signup" || mode === "reset" ? 'minlength="8"' : ""} maxlength="128" autocomplete="${mode === "signin" ? "current-password" : "new-password"}" required placeholder="${mode === "signin" ? "输入你的密码" : "至少 8 位"}">` : ""}<div class="error-text" id="auth-error" role="alert">${e(message)}</div><button class="btn" type="submit" ${api ? "" : "disabled"}>${{ signin: "登录", signup: "创建账号", recover: "发送设置密码邮件", reset: "保存新密码" }[mode]} ${icon("arrow")}</button><div class="auth-links"><button type="button" class="text-btn" data-action="auth-mode" data-mode="${mode === "signin" ? "signup" : "signin"}">${mode === "signin" ? "还没有账号？注册" : "返回登录"}</button>${mode === "signin" ? '<button type="button" class="text-btn" data-action="auth-mode" data-mode="recover">忘记密码？</button>' : ""}</div><p style="margin-top:28px;font-size:.72rem">手机号与第三方登录未接入。登录凭据不写入本地存储。</p></form></section></div>`;
  }
  function sidebar() {
    const d = st.data;
    if (!d) return "";
    const teamSpaces = d.spaces.filter((s) => s.kind === "team");
    const spaceRow = (s) =>
      `<div class="space-row ${s.id === d.space.id ? "active" : ""}"><button class="space-select" data-action="switch-space" data-id="${s.id}" title="${e(s.name)}">${avatar(s, "sm")}<span class="truncate sidebar-text">${e(s.name)}</span></button>${s.kind === "team" ? `<button class="icon-btn" data-action="expand-space" data-id="${s.id}" aria-label="展开 ${e(s.name)} 的成员" aria-expanded="${st.expanded.has(s.id)}">${icon("chevron", 14)}</button><button class="icon-btn" data-action="space-details" data-id="${s.id}" aria-label="${e(s.name)} 详情">${icon("more", 16)}</button>` : ""}</div>${st.expanded.has(s.id) ? `<div class="sidebar-members">${s.members.map((m) => `<div class="row">${avatar(m, "sm")}<span class="small truncate">${e(m.nickname)}${m.captain ? " · 队长" : ""}</span></div>`).join("")}</div>` : ""}`;
    return `<div class="sidebar-brand row"><div class="row">${companion(companionState(d), "brand-companion")}<span class="brand">PactFit</span></div><button class="icon-btn" data-action="close-sidebar" aria-label="关闭侧边栏">${icon("close", 16)}</button></div><button class="row profile-block" data-action="profile">${avatar(d.me)}<span class="grow" style="text-align:left"><b class="truncate" style="display:block">${e(d.me.nickname)}</b><small>${e(d.me.public_id)}</small></span></button><div class="stack" style="gap:9px"><button class="btn full" data-action="create-space">${icon("plus")}<span class="sidebar-text">创建新空间</span></button><button class="btn ghost full" data-action="join-space">${icon("users")}<span class="sidebar-text">输入空间口令</span></button></div><div><div class="sidebar-label">只属于你 · PRIVATE</div>${d.spaces
      .filter((s) => s.kind === "private")
      .map(spaceRow)
      .join(
        "",
      )}</div><div><div class="sidebar-label row between"><span>一起坚持 · TEAMS</span><span>${teamSpaces.length} / ${d.space_limit}</span></div>${teamSpaces.length ? teamSpaces.map(spaceRow).join("") : '<p class="small muted" style="padding:8px 12px">还没有公共团队。<br>随时可以邀请搭子同行。</p>'}</div><div class="sidebar-bottom"><button class="btn ghost full" data-action="page" data-page="settings">${icon("settings")}<span class="sidebar-text">设置与隐私</span></button><p class="small muted sidebar-text" style="margin:15px 10px">为坚持留一点空间。<br><span style="font-size:.65rem">PactFit 2.0 Preview</span></p></div>`;
  }
  function shell() {
    const d = st.data;
    if (!d) return;
    const pending = d.requests.filter((r) => r.can_respond).length;
    const nav = () =>
      pages
        .map(
          ([id, title, ico]) =>
            `<button data-action="page" data-page="${id}" class="${st.page === id ? "active" : ""}">${icon(ico, 22)}<span>${title}${id === "messages" && pending ? " · " + pending : ""}</span></button>`,
        )
        .join("");
    $("#app").innerHTML =
      `<div class="shell"><div class="drawer-layer" ${document.body.classList.contains("sidebar-open") ? "" : "inert"}><div class="scrim" data-action="close-sidebar"></div><aside class="sidebar" aria-label="空间与账号">${sidebar()}</aside></div><div class="workspace" ${document.body.classList.contains("sidebar-open") ? "inert" : ""}><header class="topbar"><div class="row"><button class="icon-btn drawer-toggle" data-action="open-sidebar" aria-label="打开空间侧边栏">${icon("menu")}</button><div class="context"><span class="muted">${d.space.kind === "private" ? icon("lock", 15) : icon("users", 15)}</span><span class="truncate" style="max-width:220px">${e(d.space.name)}</span><span class="tag">${d.space.kind === "private" ? "私人" : "团队"}</span></div></div><div class="row"><button class="icon-btn" data-action="refresh" aria-label="刷新空间数据">${icon("clock")}</button><button class="icon-btn" data-action="page" data-page="messages" aria-label="查看消息">${icon("bell")}</button></div></header><main class="main" id="main-content">${st.error ? errorNotice(st.error) : ""}${st.loading ? '<div class="empty" role="status">正在读取空间…</div>' : pageView()}</main><nav class="bottom-nav" aria-label="主页面">${nav()}</nav>${st.page === "home" && !st.loading ? `<button class="btn float-add" data-action="record">${icon("plus", 21)} 添加今日记录</button>` : ""}</div></div>`;
  }
  function head(kicker, title, sub, action = "") {
    return `<header class="page-head"><div><div class="eyebrow">${kicker}</div><h1 style="margin-top:9px">${title}</h1><p>${sub}</p></div>${action}</header>`;
  }
  function pageView() {
    if (st.page === "trend") return trendView();
    if (st.page === "achievements") return achievementsView();
    if (st.page === "messages") return messagesView();
    if (st.page === "settings") return settingsView();
    return homeView();
  }
  function goalSummary() {
    const d = st.data,
      t = M.trend(d);
    return `<section class="card">${art}<div class="card-title"><h2>朝着自己的目标</h2><button class="text-btn" data-action="goal">${d.goal ? "编辑" : "设置目标"}</button></div>${d.goal ? `<div class="row between"><b>${number(t.latest ?? d.goal.start_weight)} <small>kg</small></b><small>目标 ${number(d.goal.target_weight)} kg</small></div><div class="progress"><i style="width:${t.progress}%"></i></div><p class="small muted">${t.latest === null ? "还没有体重记录，从一次轻松的打卡开始。" : `已完成 ${Math.round(t.progress)}%，每个小步都算数。`}</p>` : '<p class="small muted">一个温和、适合自己的目标，比急着到达更重要。</p>'}</section>`;
  }
  function taskCard() {
    const d = st.data,
      t = M.today(d),
      done = t.checkin?.done_tasks || [];
    return `<section class="card"><div class="card-title"><h2>${d.space.kind === "private" ? "我的" : "团队"}今日清单</h2>${d.space.captain_id === d.me.user_id ? '<button class="text-btn" data-action="tasks">管理</button>' : ""}</div>${d.tasks.length ? d.tasks.map((task) => `<div class="task ${done.includes(task.id) ? "completed" : ""}"><span class="check ${done.includes(task.id) ? "on" : ""}">${done.includes(task.id) ? icon("check", 15) : ""}</span><span class="grow">${e(task.title)}</span></div>`).join("") : empty("清单还是空的。<br>从一件容易坚持的小事开始。")}<div class="separator"></div><div class="row between"><small>${done.length} / ${d.tasks.length} 项已完成</small><button class="text-btn" data-action="record">${t.checkin ? "修改今日记录" : "记录完成情况"}</button></div></section>`;
  }
  function memberRows() {
    const d = st.data;
    return d.members
      .map(
        (m) =>
          `<div class="row member-row"><button class="row member-button" data-action="member" data-id="${m.user_id}">${avatar(m, "", m.checked_today)}<span class="grow"><b>${e(m.nickname)}</b>${m.captain ? ' <span class="tag">队长</span>' : ""}<small style="display:block">${m.checked_today ? "今天已打卡" : "今天还没有打卡"}</small></span></button>${m.user_id !== d.me.user_id && !m.checked_today ? `<button class="btn ghost sm" data-action="remind" data-id="${m.user_id}">鼓励一下</button>` : ""}</div>`,
      )
      .join("");
  }
  function homeView() {
    const d = st.data,
      today = M.today(d),
      trend = M.trend(d),
      team = d.space.kind === "team";
    const buddy = companionState(d),
      buddyArt = companion(buddy, "hero-companion");
    const hero = team
      ? `<section class="card hero" data-today-state="${buddy}"><div class="row between"><span class="eyebrow">TODAY, TOGETHER</span><span class="tag">${e(d.today)}</span></div><h2>今天，也一起迈出一小步</h2><p class="saved-hint">不必每天都掉秤，出现本身就值得鼓励。</p><div class="hero-status"><div class="weight-value">${d.members.filter((m) => m.checked_today).length}<em>/ ${d.members.length} 人已打卡</em></div>${buddyArt}</div><div class="row wrap">${d.members.map((m) => `<button data-action="member" data-id="${m.user_id}" aria-label="查看 ${e(m.nickname)}">${avatar(m, "", m.checked_today)}</button>`).join("")}</div></section>`
      : `<section class="card hero" data-today-state="${buddy}"><div class="row between"><span class="eyebrow">A LITTLE EVERY DAY</span><span class="tag">${today.checkin ? icon("check", 13) + " 今日已打卡" : "今天还未打卡"}</span></div><h2>${today.checkin ? "今天的坚持，已经记下了。" : "给今天，留一个小小的记录。"}</h2><div class="hero-status"><div class="weight-value">${today.health?.weight != null ? number(today.health.weight) : "—"}<em>kg · 今日体重</em></div>${buddyArt}</div><p class="saved-hint">${today.checkin ? "已保存到你的私人记录 · " + e(d.today) : "体重可以不填，心情与坚持也值得记录。"}</p></section>`;
    return (
      head(
        "YOUR DAILY SPACE",
        team ? "今天，我们一起" : `你好，${e(d.me.nickname)}`,
        `${e(d.today)} · ${team ? "为每一位同行的人加油" : "不赶路，慢慢来。"}`,
        team
          ? btn(icon("shield", 16) + " 共享设置", "privacy", "", "ghost")
          : btn(
              icon("trend", 16) + " 查看趋势",
              "page",
              'data-page="trend"',
              "ghost",
            ),
      ) +
      `<div class="home-grid"><div class="stack">${hero}${team ? `<section class="card"><details class="member-list"><summary>团队成员 · ${d.members.length} 人</summary>${memberRows()}</details></section>` : `<section class="card"><div class="card-title"><h2>今天的心情</h2><span class="small muted">只属于你</span></div>${today.health?.mood ? `<span class="mood-chip">${moodIcon(today.health.mood)} ${e(today.health.mood)}</span>` : empty("今天感觉怎么样？记录时选一个心情吧。")}${today.health?.note ? `<p class="note">${e(today.health.note)}</p>` : ""}</section>`}${taskCard()}</div><div class="stack">${team ? `<section class="card">${art}<h2>朝着同一个方向</h2><p class="small muted" style="margin:12px 0">${e(d.space.description) || "用陪伴，让坚持更容易一点。"}</p>${d.aggregate ? `<b>共同目标 ${number(d.aggregate.target_kg)} kg</b><div class="progress"><i style="width:${Math.min(100, (d.aggregate.lost_kg / d.aggregate.target_kg) * 100)}%"></i></div><small>${d.aggregate.participants} 位成员已授权参与汇总</small>` : '<div class="notice">先一起完成今日打卡。授权不足时，不展示团队减重数字。</div>'}<button class="text-btn" data-action="space-details" data-id="${d.space.id}" style="margin-top:15px">团队详情 ${icon("arrow", 14)}</button></section>` : goalSummary()}<section class="card"><div class="row">${icon("leaf", 22)}<h3>今天的小提醒</h3></div><p class="small muted" style="margin-top:12px">体重会自然起伏。规律饮食、睡眠和一点点行动，都是你在照顾自己的证据。</p><div class="separator"></div><div class="row between"><small>个人连续打卡</small><b>${trend.streak} 天</b></div></section></div></div>`
    );
  }
  function moodIcon(m) {
    return (
      { 很开心: "☀️", 还不错: "🌤", 有点累: "🌙", 需要鼓励: "🌱" }[m] || "🌿"
    );
  }
  function chart(weights) {
    if (!weights.length)
      return empty("还没有体重数据。<br>没有记录的日子，不会补造体重。");
    const W = 560,
      H = 200,
      L = 35,
      R = 540,
      T = 20,
      B = 165,
      values = weights.map((r) => r.weight),
      lo = Math.min(...values) - 0.5,
      hi = Math.max(...values) + 0.5;
    const start = new Date(weights[0].day + "T00:00:00Z").getTime(),
      end = new Date(weights.at(-1).day + "T00:00:00Z").getTime();
    const x = (r) =>
        start === end
          ? (L + R) / 2
          : L +
            ((new Date(r.day + "T00:00:00Z").getTime() - start) /
              (end - start)) *
              (R - L),
      y = (r) => B - ((r.weight - lo) / (hi - lo)) * (B - T);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="已记录体重趋势，缺失日期不填补">${[
      0, 1, 2, 3,
    ]
      .map((i) => {
        const yy = T + ((B - T) * i) / 3;
        return `<line x1="${L}" y1="${yy}" x2="${R}" y2="${yy}"/><text x="0" y="${yy + 4}">${(hi - ((hi - lo) * i) / 3).toFixed(1)}</text>`;
      })
      .join(
        "",
      )}<polyline points="${weights.map((r) => `${x(r)},${y(r)}`).join(" ")}"/>${weights.map((r) => `<circle cx="${x(r)}" cy="${y(r)}" r="3.5"><title>${r.day} · ${number(r.weight)} kg</title></circle>`).join("")}<text x="${L}" y="190">${e(weights[0].day.slice(5))}</text><text x="${R - 35}" y="190">${e(weights.at(-1).day.slice(5))}</text></svg><p class="small muted">${weights.length === 1 ? "已保存第一个点，继续记录就能看到变化。" : "仅连接实际记录点；空缺日期不会生成数据。"}</p>`;
  }
  function calendar(checkins) {
    const set = new Set(checkins.map((c) => c.day));
    return `<div class="calendar" aria-label="最近28天打卡日历">${Array.from(
      { length: 28 },
      (_, i) => {
        const date = M.dayOffset(st.data.today, i - 27);
        return `<span class="${set.has(date) ? "done" : ""}" title="${date}${set.has(date) ? " 已打卡" : " 未打卡"}">${Number(date.slice(8))}${set.has(date) ? " ·" : ""}</span>`;
      },
    ).join("")}</div>`;
  }
  function metrics(items) {
    return `<div class="metric-grid">${items.map(([name, value, unit]) => `<div class="metric"><small>${name}</small><b>${value}</b><small>${unit || ""}</small></div>`).join("")}</div>`;
  }
  function timeline(items) {
    return items.length
      ? `<div class="timeline">${items.map((a) => `<div class="timeline-item">${milestoneIcon(awardKind(a), true, "mini")}<div><small>${e((a.created_at || "").slice(0, 10))}</small><button class="text-btn" data-action="award-detail" data-id="${a.id || a.code}">${e(a.title)}</button></div></div>`).join("")}</div>`
      : empty("每一次坚持，都在为下一个里程碑铺路。");
  }
  function trendView() {
    const d = st.data,
      t = M.trend(d, st.range),
      team = d.space.kind === "team";
    const range = `<div class="chips">${[7, 30, 90].map((n) => `<button class="chip ${st.range === n ? "active" : ""}" data-action="range" data-range="${n}">${n} 天</button>`).join("")}</div>`;
    if (team) {
      const counts = d.checkin_counts.filter(
        (c) => c.day >= M.dayOffset(d.today, -st.range + 1),
      );
      return (
        head(
          "PROGRESS, NOT PERFECTION",
          "一起走过的路",
          "看见团队的坚持，也尊重每个人的边界。",
          range,
        ) +
        `<div class="stack">${
          d.aggregate
            ? metrics([
                [
                  "共同目标",
                  number(d.aggregate.target_kg),
                  "kg · 自愿授权成员",
                ],
                ["已一起减重", number(d.aggregate.lost_kg), "kg"],
                ["汇总参与者", d.aggregate.participants, "位"],
              ])
            : '<div class="notice">至少 3 位成员同时授权体重、目标与汇总后，才展示减重汇总；两人团队也不会绕过授权反推个人数字。</div>'
        }<section class="card"><div class="card-title"><h2>团队打卡趋势</h2><small>最近 ${st.range} 天</small></div>${counts.length ? counts.map((c) => `<div class="row" style="margin:12px 0"><small style="width:70px">${e(c.day.slice(5))}</small><div class="progress grow" style="margin:0"><i style="width:${Math.min(100, (c.count / Math.max(1, d.members.length)) * 100)}%"></i></div><small>${c.count} 人 · ${c.tasks_done} 项</small></div>`).join("") : empty("还没有团队打卡。先从今天开始。")}</section><section class="card"><div class="card-title"><h2>已授权的成员进度</h2>${btn("我的授权", "privacy", "", "ghost sm")}</div>${d.members.map((m) => `<div class="member-row"><div class="row">${avatar(m)}<div class="grow"><b>${e(m.nickname)}</b><div class="member-metrics">${m.weight == null ? "体重未公开" : number(m.weight) + " kg"} · ${m.goal ? "目标 " + number(m.goal.target_weight) + " kg" : "目标未公开"}</div></div></div>${m.weights?.length ? chart(m.weights.filter((w) => w.day >= M.dayOffset(d.today, -st.range + 1)).map((w) => ({ day: w.day, weight: Number(w.weight) }))) : ""}</div>`).join("")}</section><section class="card"><div class="card-title"><h2>团队里程碑</h2></div>${timeline(d.team_awards)}</section></div>`
      );
    }
    const goal = d.goal;
    return (
      head(
        "YOUR JOURNEY",
        "小小变化，正在发生",
        "不是一条完美的曲线，是你真实走过的路。",
        range,
      ) +
      `<div class="stack">${metrics([
        [
          "最近体重",
          number(t.latest),
          "kg" + (t.latestDay ? " · " + t.latestDay : ""),
        ],
        [
          "阶段变化",
          t.weights.length > 1
            ? (t.weights.at(-1).weight - t.weights[0].weight > 0 ? "+" : "") +
              number(t.weights.at(-1).weight - t.weights[0].weight)
            : "—",
          "kg · 所选时间范围",
        ],
        ["连续打卡", t.streak, "天"],
      ])}<section class="card"><div class="card-title"><h2>体重的变化</h2><span class="tag">最近 ${st.range} 天</span></div>${chart(t.weights)}</section><div class="grid"><section class="card"><div class="card-title"><h2>个人目标</h2><button class="text-btn" data-action="goal">${goal ? "编辑" : "设置"}</button></div>${goal ? `<div class="row between"><span>起始 ${number(goal.start_weight)} kg</span><b>目标 ${number(goal.target_weight)} kg</b></div><div class="progress"><i style="width:${t.progress}%"></i></div><small>目标进度 ${Math.round(t.progress)}% · 已变化 ${number(t.lost)} kg</small>` : empty("设置一个适合自己的减重目标。")}</section><section class="card"><h2>打卡日历</h2>${calendar(d.personal_checkins)}<p class="small muted" style="margin-top:15px">最近 ${st.range} 天完成率 ${t.rate}% · 最近28天日历</p></section></div><div class="grid"><section class="card"><div class="card-title"><h2>心情的天气</h2></div>${
        Object.entries(t.moods)
          .map(
            ([m, n]) =>
              `<div class="row between" style="margin:12px 0"><span>${moodIcon(m)} ${e(m)}</span><b>${n} 天</b></div>`,
          )
          .join("") || empty("还没有记录心情。")
      }</section><section class="card"><div class="card-title"><h2>清单完成统计</h2></div><div class="weight-value" style="font-size:2.5rem">${d.my_checkins.filter((c) => c.day >= M.dayOffset(d.today, -st.range + 1)).reduce((n, c) => n + c.done_tasks.length, 0)}<em>项</em></div><small>当前私人空间 · 最近 ${st.range} 天累计完成</small></section></div><section class="card"><div class="card-title"><h2>已保存的健康记录</h2><small>最近一年</small></div>${d.my_records.length ? d.my_records.map((r) => `<div class="history-row"><span>${e(r.day)}</span><b>${r.weight == null ? "未填体重" : number(r.weight) + " kg"}</b><small>${r.mood ? moodIcon(r.mood) + " " + e(r.mood) : "未填心情"}</small>${r.note ? `<p class="note" style="grid-column:1/-1;margin:0">${e(r.note)}</p>` : ""}</div>`).join("") : empty("此时间范围还没有记录。")}</section><section class="card"><div class="card-title"><h2>我的里程碑</h2></div>${timeline(d.awards.filter((a) => !a.space_id))}</section></div>`
    );
  }
  function achievementsView() {
    const d = st.data;
    const owned = new Set(
      d.awards.filter((a) => !a.space_id).map((a) => a.code),
    );
    const personal = [
      ["first_checkin", "迈出第一步", "完成第一次打卡", "step"],
      ["streak_7", "连续七天", "连续记录七天", "routine"],
    ];
    const together =
        d.team_awards.find((a) => a.code === "team_together") ||
        d.team_awards[0],
      teamActive = d.space.kind === "team";
    return (
      head(
        "EVERY EFFORT COUNTS",
        "每个坚持，都闪闪发光",
        "成就属于你，宝石也是。离开团队不会失去已获得的荣誉。",
      ) +
      `<div class="home-grid"><div class="stack"><section class="card"><div class="card-title"><h2>个人成就</h2><small>${owned.size} 项已解锁</small></div><div class="badge-grid">${personal.map(([code, title, sub, kind]) => `<button class="badge ${owned.has(code) ? "" : "locked"}" data-action="award-detail" data-id="${code}">${milestoneIcon(kind, owned.has(code))}<b>${title}</b><small>${owned.has(code) ? "已解锁" : sub}</small></button>`).join("")}</div></section><section class="card"><div class="card-title"><h2>团队成就</h2><small>${teamActive ? "当前团队" : "尚未进入团队"}</small></div><button class="team-milestone ${together ? "" : "locked"}" data-action="award-detail" data-id="${together?.id || "team_together"}" ${teamActive ? "" : "disabled"}>${milestoneIcon("together", Boolean(together), "team")}<span><b>${together ? e(together.title) : "同频的一天"}</b><small>${together ? e(together.created_at.slice(0, 10)) + " · 首次全员打卡" : teamActive ? "至少两位成员在同一天全部打卡" : "进入团队后可共同解锁"}</small></span></button></section><section class="card"><div class="card-title"><h2>我的历史荣誉墙</h2></div>${
        d.awards
          .filter((a) => a.space_id)
          .map(
            (a) =>
              `<div class="row member-row">${milestoneIcon(awardKind(a), true, "mini")}<div><b>${e(a.title)}</b><small style="display:block">${e(a.team_name)} · ${e(a.created_at.slice(0, 10))}</small></div></div>`,
          )
          .join("") || empty("曾经同行的光，会一直留在这里。")
      }</section><section class="card"><div class="card-title"><h2>任务与奖励</h2></div>${d.reward_rules.map((r) => `<div class="ledger-row"><span>${e(r.label)}</span><b>+${r.gems} ◇</b></div>`).join("")}<p class="small muted" style="margin-top:14px">Preview 测试积分规则，可配置。重复编辑、跨团队打卡或反复输入体重不会重复领取同一奖励。</p></section></div><div class="stack"><section class="card gem-card"><div class="row between"><h2>我的宝石</h2>${icon("gem", 25)}</div><div class="weight-value">${d.gems}<em>◇</em></div><p class="small muted">来自独立服务端流水 · Preview 测试积分</p><button class="text-btn" data-action="ledger" style="margin-top:16px">查看宝石明细 ${icon("arrow", 14)}</button></section><section class="card"><div class="card-title"><h2>宝石商店</h2><span class="tag warm">Preview</span></div>${d.catalog.map((c) => `<div class="shop-item"><span class="shop-ico">${icon(c.kind === "decoration" ? "spark" : "users", 25)}</span><div class="grow"><h3>${e(c.title)}</h3><p class="small muted">${e(c.description)}</p><div style="margin-top:10px">${c.enabled && c.price != null && c.max_quantity != null ? `<button class="btn secondary sm" data-action="purchase" data-product="${c.code}">${c.price} ◇ · 兑换</button>` : '<button class="btn ghost sm" disabled>价格／上限待确认</button>'}</div></div></div>`).join("")}</section></div></div>`
    );
  }
  function messagesView() {
    const d = st.data,
      tab = st.messageTab;
    const requests = d.requests;
    return (
      head(
        "A LITTLE CONNECTION",
        "消息与陪伴",
        "这里的消息属于你的账号，不随空间切换而丢失。",
      ) +
      `<div class="tabs" role="tablist">${[
        ["pending", "待处理"],
        ["activity", "好友动态"],
        ["notifications", "通知"],
      ]
        .map(
          ([id, title]) =>
            `<button role="tab" aria-selected="${tab === id}" class="${tab === id ? "active" : ""}" data-action="message-tab" data-tab="${id}">${title}${id === "pending" ? " · " + requests.filter((r) => r.can_respond).length : ""}</button>`,
        )
        .join("")}</div><div class="stack">${
        tab === "pending"
          ? requests.length
            ? requests
                .map(
                  (r) =>
                    `<article class="message-card"><span class="avatar">${r.kind === "invitation" ? "✉️" : "🌱"}</span><div class="grow"><div class="row between wrap"><h3>${r.kind === "invitation" ? "团队邀请" : "加入申请"} · ${e(r.space_name)}</h3><span class="tag">${{ pending: "待处理", accepted: "已通过", rejected: "已拒绝", expired: "已过期", cancelled: "已取消" }[r.status]}</span></div><p>${r.kind === "invitation" ? e(r.sender_name) + " 邀请 " + e(r.target_name) + " 加入团队" : e(r.target_name) + " 想和团队一起坚持。"}</p><small>有效期至 ${e(r.expires_at.slice(0, 10))}</small>${r.can_respond ? `<div class="actions">${btn("接受／通过", "respond", `data-id="${r.id}" data-accept="true"`, "sm")}${btn("拒绝", "respond", `data-id="${r.id}" data-accept="false"`, "ghost sm")}</div>` : r.status === "pending" ? '<p class="small muted">已提交，等待对方处理。</p>' : ""}</div></article>`,
                )
                .join("")
            : empty("暂时没有申请或邀请。去创建团队，或输入空间口令吧。")
          : tab === "activity"
            ? d.events.length
              ? d.events
                  .map(
                    (a) =>
                      `<article class="message-card">${avatar(a)}<div class="grow"><h3>${e(a.nickname)}</h3><p>解锁了「${e(a.title)}」</p><div class="row between"><small>${e(a.created_at.slice(0, 10))}</small><button class="chip ${a.liked ? "active" : ""}" data-action="like" data-id="${a.id}" data-liked="${!a.liked}">${icon("heart", 14)} ${a.likes} · ${a.liked ? "已喜欢" : "为 TA 点赞"}</button></div></div></article>`,
                  )
                  .join("")
              : empty(
                  "这里展示已授权的共同成员成就。<br>默认不公开体重、目标或具体减重数字。",
                )
            : `<div class="row between"><small>最近 100 条账号通知</small><button class="text-btn" data-action="read-notifications">全部标为已读</button></div>${d.notifications.length ? d.notifications.map((n) => `<article class="message-card ${n.read_at ? "" : "unread"}"><span class="avatar">${icon(n.important ? "shield" : n.kind === "gems" ? "gem" : "bell")}</span><div class="grow"><div class="row between wrap"><h3>${e(n.title)}</h3>${n.important ? '<span class="tag important">重要系统通知</span>' : ""}</div>${n.body ? `<p>${e(n.body)}</p>` : ""}<small>${e(n.created_at.slice(0, 10))}</small></div></article>`).join("") : empty("暂时没有新通知。")}`
      }</div>`
    );
  }
  function settingsView() {
    const d = st.data;
    const theme = localStorage.getItem("pactfit_v2_theme") || "system",
      font = localStorage.getItem("pactfit_v2_font") || "15",
      movingCompanion = dynamicCompanion();
    return (
      head("MAKE IT YOURS", "设置与隐私", "用你舒服的方式，继续这段旅程。") +
      `<div class="grid"><div class="stack"><section class="card"><div class="row">${avatar(d.me, "lg")}<div class="grow"><h2>${e(d.me.nickname)}</h2><small>${e(d.me.public_id)}</small></div><button class="text-btn" data-action="profile">编辑</button></div><div class="separator"></div><div class="row between"><small>个人 ID · 不可修改</small>${btn(icon("copy", 14) + " 复制", "copy-id", "", "ghost sm")}</div><p class="small muted" style="margin-top:13px">昵称可以重复。最近 7 天还可修改 ${d.nickname_changes_remaining} 次。头像与昵称同步至所有空间。</p></section><section class="card"><h2>账号与安全</h2><div class="settings-row"><span class="small truncate">${e(api.email())}</span><button class="text-btn" data-action="change-email">更换邮箱</button></div><div class="settings-row"><span class="small">登录密码</span><button class="text-btn" data-action="change-password">修改密码</button></div><div class="settings-row"><div><span class="small">注销账号</span><small style="display:block">需要身份管理服务端，Preview 尚未接入</small></div><button class="text-btn" disabled>暂不可用</button></div><button class="btn ghost full" data-action="logout" style="margin-top:18px">${icon("logout")} 退出登录</button></section><section class="card"><h2>隐私与数据</h2><div class="settings-row"><span class="small">当前团队的共享授权</span>${d.space.kind === "team" ? '<button class="text-btn" data-action="privacy">管理</button>' : "<small>私人空间不向他人共享</small>"}</div><p class="small muted" style="margin-top:15px">你的体重和目标只有得到此团队单独授权才可见。撤销后，服务端停止返回受限数据。</p><button class="text-btn" data-action="erase-health" style="margin-top:16px;color:var(--danger)">删除我的个人健康记录</button>${d.past_spaces.length ? '<div class="separator"></div><h3>历史团队数据</h3>' + d.past_spaces.map((s) => `<div class="settings-row"><span class="small">${e(s.name)} · ${s.archived ? "已解散" : "已退出"}</span><button class="text-btn" data-action="erase-history" data-id="${s.id}">删除我的打卡历史</button></div>`).join("") : ""}</section></div><div class="stack"><section class="card"><h2>外观与阅读</h2><label class="settings-row"><span class="small">显示主题</span><select id="theme-select" aria-label="显示主题">${[
        ["system", "跟随系统"],
        ["light", "浅色"],
        ["dark", "深色"],
      ]
        .map(
          ([v, l]) =>
            `<option value="${v}" ${v === theme ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="settings-row"><span class="small">字体大小</span><select id="font-select" aria-label="字体大小">${[
        ["15", "标准"],
        ["17", "大"],
        ["19", "特大"],
      ]
        .map(
          ([v, l]) =>
            `<option value="${v}" ${v === font ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="settings-row"><span><span class="small">伙伴图标随今日状态变化</span><small style="display:block">仅改变应用内图标；关闭后保持默认表情</small></span><input class="switch" id="dynamic-companion" type="checkbox" ${movingCompanion ? "checked" : ""}></label></section><section class="card"><h2>通知与动态</h2><form id="preferences-form"><label class="settings-row"><span class="small">接收搭子鼓励提醒</span><input class="switch" type="checkbox" name="encouragement" ${d.me.preferences.encouragement ? "checked" : ""}></label><label class="settings-row"><span class="small">成就与宝石通知</span><input class="switch" type="checkbox" name="achievements" ${d.me.preferences.achievements ? "checked" : ""}></label><label class="settings-row"><span class="small">向共同成员公开个人成就动态</span><input class="switch" type="checkbox" name="share_activity" ${d.me.share_activity ? "checked" : ""}></label><small style="display:block;margin-top:14px">不公开体重数字。重要系统通知始终保留。</small><button class="btn secondary sm" style="margin-top:17px">保存偏好</button></form></section><section class="card">${art}<h2>关于 PactFit</h2><p class="small muted" style="margin:12px 0">一起把日子过轻一点。<br>V2.0 Preview · 独立分支 · 真实数据服务</p><p class="small muted">宝石使用可配置的 Preview 测试奖励。商店价格与上限未确认的商品不开放兑换。</p><a class="text-btn" href="https://github.com/nailongintherain/PactFit/issues" target="_blank" rel="noopener noreferrer">意见反馈与问题记录 ↗</a></section></div></div>`
    );
  }
  const field = (label, name, type = "text", value = "", extra = "") =>
    `<label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${e(value)}" ${extra}>`;
  const avatarPicker = (value) =>
    `<label>官方预设头像</label><div class="avatar-picker">${Object.entries(
      M.avatars,
    )
      .map(
        ([key]) =>
          `<label><input type="radio" name="avatar" value="${key}" ${key === value ? "checked" : ""} aria-label="${key}">${avatar({ avatar: key })}</label>`,
      )
      .join("")}</div>`;
  function modalBody(name, data) {
    const d = st.data,
      t = M.today(d);
    if (name === "create-space")
      return `<p class="notice">公共空间最多默认 6 人；你最多参与 ${d.space_limit} 个。无需现在邀请成员。</p>${field("空间名称", "name", "text", "", 'required maxlength="512" placeholder="比如：一起慢慢来"')}<label for="field-description">简介（选填）</label><textarea name="description" id="field-description" maxlength="300" placeholder="写下你希望这里成为的样子"></textarea>${avatarPicker("leaf")}`;
    if (name === "join-space")
      return `<p class="notice">提交申请后，由队长审批。通过前不会加入团队，也无法访问团队内容。</p>${field("空间口令", "code", "text", "", 'required maxlength="32" placeholder="PF-…" autocomplete="off"')}`;
    if (name === "profile")
      return `${field("昵称（2～16 个可见字符）", "nickname", "text", d.me.nickname, 'required maxlength="512"')}<small>7 天内最多改 2 次；当前剩余 ${d.nickname_changes_remaining} 次。昵称可以重复。</small>${avatarPicker(d.me.avatar)}<div class="notice">个人 ID：${e(d.me.public_id)} · 不可更改</div>`;
    if (name === "goal")
      return `<p class="notice">这是统一的个人减重目标。默认不会向团队公开。</p>${field("起始体重（kg）", "start_weight", "number", d.goal?.start_weight ?? "", 'required min="20" max="400" step="0.1"')}${field("目标体重（kg）", "target_weight", "number", d.goal?.target_weight ?? "", 'required min="20" max="400" step="0.1"')}<small>首版聚焦减重，目标需低于起始体重。</small>`;
    if (name === "record")
      return `<div class="row between"><span class="tag">${e(d.today)}</span><small>${t.checkin ? "今天已保存，可修改" : "填写区 · 尚未保存"}</small></div><p class="notice" style="margin-top:15px">体重与心情存为一份私人原始记录；只更新当前空间的清单。体重选填，打卡不要求下降。</p>${field("今日体重（kg，选填）", "weight", "number", t.health?.weight ?? "", 'min="20" max="400" step="0.1" placeholder="今天不称重也可以"')}<label for="field-mood">今日心情（选填）</label><select name="mood" id="field-mood"><option value="">暂不填写</option>${["很开心", "还不错", "有点累", "需要鼓励"].map((m) => `<option ${m === t.health?.mood ? "selected" : ""}>${m}</option>`).join("")}</select>${d.tasks.length ? "<label>当前空间的今日清单</label>" + d.tasks.map((task) => `<label class="task"><input name="task" type="checkbox" value="${task.id}" ${(t.checkin?.done_tasks || []).includes(task.id) ? "checked" : ""}><span>${e(task.title)}</span></label>`).join("") : ""}<label for="field-note">私人备注（选填，不向团队共享）</label><textarea name="note" id="field-note" maxlength="1000">${e(t.health?.note || "")}</textarea>`;
    if (name === "privacy") {
      const sharing = d.sharing || {};
      return `<div class="notice">仅针对「${e(d.space.name)}」。默认全部关闭，撤销后服务端停止返回对应数据。</div>${[
        [
          "share_weight",
          "公开我的体重",
          "允许当前团队成员查看最近体重及趋势。",
        ],
        [
          "share_goal",
          "公开我的减重目标",
          "允许查看起始体重、目标与个人目标进度。",
        ],
        [
          "share_aggregate",
          "参与可见的团队减重汇总",
          "还需同时公开体重和目标；不足 3 位授权者不展示汇总。",
        ],
      ]
        .map(
          ([key, title, sub]) =>
            `<label class="privacy-option"><input class="switch" type="checkbox" name="${key}" ${sharing[key] ? "checked" : ""}><span>${title}<small>${sub}</small></span></label>`,
        )
        .join("")}`;
    }
    if (name === "invite")
      return `<p class="notice">向目标账号发送邀请，接受后才会正式加入。有效期 7 天。</p>${field("对方的个人 ID", "public_id", "text", "", 'required placeholder="PF-…" maxlength="30"')}`;
    if (name === "tasks")
      return `<p class="small muted">${d.space.kind === "team" ? "团队清单由队长维护，成员独立记录完成情况。" : "选一件容易完成的小事开始。"}删除清单不会删除历史打卡。</p>${d.tasks.map((task) => `<div class="settings-row"><span class="small grow">${e(task.title)}</span><button type="button" class="text-btn" data-action="remove-task" data-id="${task.id}">移除</button></div>`).join("")}${field("新增清单项", "title", "text", "", 'required maxlength="80" placeholder="比如：饭后走一小会儿"')}`;
    if (name === "member") {
      const m = d.members.find((x) => x.user_id === data.userId);
      return m
        ? `<div class="row">${avatar(m, "lg")}<div><h2>${e(m.nickname)}</h2><small>${e(m.public_id)}${m.captain ? " · 队长" : ""}</small></div></div><div class="separator"></div><p>${m.checked_today ? "今天已打卡" : "今天尚未打卡"}</p><p class="small muted" style="margin-top:14px">${m.weight == null ? "体重未公开" : "最近体重 " + number(m.weight) + " kg"} · ${m.goal ? "目标 " + number(m.goal.target_weight) + " kg" : "个人目标未公开"}</p>${m.user_id !== d.me.user_id && !m.checked_today ? `<div class="actions">${btn("送一句鼓励", "remind", `data-id="${m.user_id}"`)}</div><small>同一成员每天最多提醒一次。</small>` : ""}`
        : empty("成员已不在当前团队。");
    }
    if (name === "space-details") {
      const snapshot = data.snapshot,
        s = snapshot.space,
        captain = s.captain_id === d.me.user_id;
      return `<div class="row">${avatar(s, "lg")}<div class="grow"><h2>${e(s.name)}</h2><small>${snapshot.members.length} / ${s.limit} 人 · ${captain ? "我是队长" : "我是成员"}</small></div></div><p class="note">${e(s.description) || "还没有团队简介。"}</p><div class="separator"></div><h3>团队口令</h3>${s.code ? `<div class="row between" style="margin:12px 0"><b class="mono" style="overflow-wrap:anywhere">${e(s.code)}</b><button type="button" class="icon-btn" data-action="copy-code" data-code="${e(s.code)}" aria-label="复制口令">${icon("copy")}</button></div>` : '<p class="small muted" style="margin:12px 0">队长未开放成员查看口令。</p>'}${captain ? `<label class="privacy-option"><input class="switch" id="member-code-permission" type="checkbox" ${s.members_can_copy ? "checked" : ""} data-space="${s.id}"><span>允许普通成员查看和复制口令<small>关闭不会自动重置已泄露的口令。</small></span></label><div class="row wrap" style="margin:15px 0">${btn("重置口令", "reset-code", `data-space="${s.id}"`, "ghost sm")}${btn("邀请成员", "invite", `data-space="${s.id}"`, "secondary sm")}${btn("修改团队资料", "space-edit", `data-space="${s.id}"`, "ghost sm")}</div>` : ""}<div class="separator"></div><h3>成员</h3>${snapshot.members.map((m) => `<div class="row member-row">${avatar(m, "sm")}<div class="grow"><span>${e(m.nickname)}</span>${m.captain ? ' <span class="tag">队长</span>' : ""}</div>${captain && m.user_id !== d.me.user_id ? `<button type="button" class="text-btn" data-action="remove-member" data-space="${s.id}" data-id="${m.user_id}" data-name="${e(m.nickname)}">移除</button>` : ""}</div>`).join("")}<div class="separator"></div><div class="row wrap">${btn("退出团队", "leave", `data-space="${s.id}"`, "ghost sm")}${captain ? btn("解散团队", "dissolve", `data-space="${s.id}"`, "danger sm") : ""}</div><p class="small muted" style="margin-top:13px">队长退出时会由最早加入的现存成员接任；无其他成员时团队关闭。私人记录、个人宝石和已获荣誉不会被删除。</p>`;
    }
    if (name === "space-edit")
      return `${field("团队名称", "name", "text", data.space.name, 'required maxlength="512"')}<label for="field-description">团队简介</label><textarea id="field-description" name="description" maxlength="300">${e(data.space.description)}</textarea>${avatarPicker(data.space.avatar)}`;
    if (name === "ledger")
      return `<p class="notice">宝石来自服务端独立流水。以下为最近 100 笔，Preview 积分不代表正式运营规则。</p>${d.ledger.map((l) => `<div class="ledger-row"><span>${e({ daily_checkin: "每日打卡", first_checkin: "首次打卡", streak_7: "连续七天", team_together: "团队成就" }[l.reason] || l.reason)}<small style="display:block">${e(l.created_at.slice(0, 10))}</small></span><b class="${l.amount > 0 ? "positive" : ""}">${l.amount > 0 ? "+" : ""}${l.amount} ◇</b></div>`).join("") || empty("还没有宝石流水。")}`;
    if (name === "award-detail") {
      const award =
        d.awards.find((a) => a.id === data.id || a.code === data.id) ||
        d.team_awards.find((a) => a.id === data.id || a.code === data.id);
      return award
        ? `<div class="award-detail">${milestoneIcon(awardKind(award), true, "detail")}<h2>${e(award.title)}</h2><p class="small muted">${e(award.created_at.slice(0, 10))}${award.team_name ? " · " + e(award.team_name) : ""}</p><p class="notice">荣誉已保存到个人账号，不随退出或解散团队而收回。</p></div>`
        : `<div class="award-detail">${milestoneIcon(awardKind(data.id), false, "detail")}<h2>${data.id === "streak_7" ? "连续七天" : data.id === "team_together" ? "同频的一天" : "迈出第一步"}</h2><p class="notice">${data.id === "streak_7" ? "连续完成 7 天个人打卡即可解锁，不要求填写或降低体重。" : data.id === "team_together" ? "至少两位团队成员在同一天全部打卡即可解锁，不要求公开体重。" : "完成首次打卡即可解锁，体重可以留空。"}</p></div>`;
    }
    if (name === "change-email")
      return `<p class="notice">此操作由认证服务处理，可能需要确认邮件。不要把密码或邮件链接发给他人。</p>${field("新的邮箱地址", "email", "email", "", 'required autocomplete="email"')}`;
    if (name === "change-password")
      return `${field("新密码", "password", "password", "", 'required minlength="8" maxlength="128" autocomplete="new-password"')}${field("再次输入新密码", "confirm_password", "password", "", 'required minlength="8" maxlength="128" autocomplete="new-password"')}`;
    if (name === "confirm")
      return `<p class="note">${e(data.body)}</p><div class="notice" style="margin-top:17px">${e(data.note || "请确认后再继续。")}</div>`;
    return "";
  }
  let previousFocus = null;
  function openModal(name, data = {}) {
    st.modal = name;
    st.modalData = data;
    previousFocus = document.activeElement;
    const titles = {
      "create-space": "创建一个新空间",
      "join-space": "申请加入团队",
      profile: "个人资料",
      goal: "设定个人目标",
      record: "记录今天",
      privacy: "我的团队共享授权",
      invite: "用个人 ID 邀请",
      tasks: "管理今日清单",
      "space-details": "空间详情",
      "space-edit": "编辑团队资料",
      member: "搭子资料",
      ledger: "宝石明细",
      "award-detail": "成就详情",
      "change-email": "更换邮箱",
      "change-password": "修改密码",
      confirm: data.title || "请再次确认",
    };
    const readOnly = [
      "space-details",
      "member",
      "ledger",
      "award-detail",
    ].includes(name);
    $("#modal-root").innerHTML =
      `<div class="modal-scrim" data-action="modal-scrim"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-head"><h2 id="modal-title">${titles[name]}</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon("close")}</button></div><form id="modal-form" data-form="${name}">${modalBody(name, data)}<div class="error-text" data-form-error role="alert"></div>${readOnly ? "" : `<div class="actions"><button class="btn ghost" type="button" data-action="close-modal">取消</button><button class="btn ${name === "confirm" ? "danger" : ""}" type="submit">${{ record: "保存今日打卡", "create-space": "创建并进入", "join-space": "提交申请", invite: "发送邀请", tasks: "添加清单项", confirm: data.confirmLabel || "确认" }[name] || "保存"}</button></div>`}</form></section></div>`;
    requestAnimationFrame(() => {
      $(
        "#modal-root input:not([type=checkbox]):not([type=radio]),#modal-root button",
      )?.focus();
    });
  }
  function closeModal() {
    st.modal = null;
    st.modalData = null;
    $("#modal-root").innerHTML = "";
    previousFocus?.focus?.();
  }
  function confirmAction(title, body, action, args, success, note) {
    openModal("confirm", { title, body, action, args, success, note });
  }
  async function showSpaceDetails(id) {
    const ep = st.epoch;
    try {
      const snapshot = await api.snapshot(id);
      if (ep === st.epoch) openModal("space-details", { snapshot });
    } catch (err) {
      toast(M.message(err));
    }
  }
  async function load(space = st.space, quiet = false) {
    const seq = ++st.seq,
      ep = st.epoch;
    if (!quiet) {
      st.loading = true;
      if (st.data) shell();
    }
    try {
      const data = await api.snapshot(space);
      if (seq !== st.seq || ep !== st.epoch) return;
      const changed = JSON.stringify(data) !== JSON.stringify(st.data);
      st.data = data;
      st.space = data.space.id;
      st.error = "";
      st.loading = false;
      try {
        localStorage.setItem(
          "pactfit_v2_space_" + data.me.public_id,
          data.space.id,
        );
      } catch (_) {}
      if (!quiet || changed) shell();
    } catch (err) {
      if (seq !== st.seq || ep !== st.epoch) return;
      if (space && ["forbidden", "space_unavailable"].includes(err.code)) {
        st.space = null;
        toast("空间已不可用，已回到私人空间。");
        return load(null);
      }
      st.error = M.message(err);
      st.loading = false;
      if (st.data) shell();
      else authView(st.error + " 请确认已在独立数据库执行 V2 迁移。");
    }
  }
  async function enter() {
    const ep = ++st.epoch;
    st.page = "home";
    st.space = null;
    st.data = null;
    await api.command("bootstrap", {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    if (ep !== st.epoch) return;
    const data = await api.snapshot(null);
    if (ep !== st.epoch) return;
    st.data = data;
    st.space = data.space.id;
    let remembered;
    try {
      remembered = localStorage.getItem(
        "pactfit_v2_space_" + data.me.public_id,
      );
    } catch (_) {}
    if (remembered && data.spaces.some((s) => s.id === remembered))
      st.space = remembered;
    await load(st.space);
  }
  async function run(action, args = {}, success = "已保存") {
    if (st.busy) return;
    st.busy = true;
    const ep = st.epoch;
    const buttons = document.querySelectorAll(
      "#modal-root button[type=submit]",
    );
    buttons.forEach((b) => {
      b.disabled = true;
      b.textContent = "处理中…";
    });
    try {
      const result = await api.command(action, args);
      if (ep !== st.epoch) return;
      closeModal();
      if (result.space_id) st.space = result.space_id;
      await load(st.space);
      if (ep === st.epoch) toast(success);
      return result;
    } catch (err) {
      if (ep !== st.epoch) return;
      if (
        ["forbidden", "space_unavailable", "not_a_member"].includes(err.code)
      ) {
        closeModal();
        await load(st.space);
        toast(M.message(err));
        return;
      }
      const el = $("[data-form-error]");
      if (el) el.textContent = M.message(err);
      else toast(M.message(err));
    } finally {
      if (ep === st.epoch) {
        st.busy = false;
        buttons.forEach((b) => {
          b.disabled = false;
          b.textContent = "重试";
        });
      }
    }
  }
  async function logout() {
    st.epoch++;
    st.seq++;
    st.data = null;
    st.space = null;
    st.busy = false;
    closeModal();
    setSidebar(false);
    st.authMode = "signin";
    const pending = api.logout();
    authView();
    try {
      await pending;
    } catch (_) {
      toast("本机已退出，服务端撤销暂未确认。");
    }
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch (_) {
      openModal("confirm", {
        title: "请手动复制",
        body: text,
        confirmLabel: "关闭",
        action: null,
      });
    }
  }
  document.addEventListener("click", async (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "modal-scrim" && event.target !== el) return;
    event.preventDefault();
    if (st.busy && a !== "logout") return;
    if (a === "auth-mode") {
      st.authMode = el.dataset.mode;
      authView();
      return;
    }
    if (a === "close-modal" || a === "modal-scrim") {
      closeModal();
      return;
    }
    if (a === "open-sidebar") {
      setSidebar(true);
      return;
    }
    if (a === "close-sidebar") {
      setSidebar(false);
      return;
    }
    if (!st.data) return;
    const d = st.data,
      sp = d.space.id;
    if (a === "page") {
      st.page = el.dataset.page;
      setSidebar(false);
      shell();
      window.scrollTo(0, 0);
      return;
    }
    if (a === "switch-space") {
      setSidebar(false);
      st.space = el.dataset.id;
      await load(st.space);
      return;
    }
    if (a === "expand-space") {
      st.expanded.has(el.dataset.id)
        ? st.expanded.delete(el.dataset.id)
        : st.expanded.add(el.dataset.id);
      shell();
      return;
    }
    if (a === "range") {
      st.range = Number(el.dataset.range);
      shell();
      return;
    }
    if (a === "message-tab") {
      st.messageTab = el.dataset.tab;
      shell();
      return;
    }
    if (a === "refresh") {
      await load();
      return;
    }
    if (
      [
        "create-space",
        "join-space",
        "profile",
        "goal",
        "record",
        "privacy",
        "tasks",
        "ledger",
        "change-email",
        "change-password",
      ].includes(a)
    ) {
      setSidebar(false);
      openModal(a);
      return;
    }
    if (a === "space-details") {
      setSidebar(false);
      await showSpaceDetails(el.dataset.id);
      return;
    }
    if (a === "space-edit") {
      const s = st.modalData.snapshot.space;
      openModal("space-edit", { space: s });
      return;
    }
    if (a === "invite") {
      openModal("invite", { spaceId: el.dataset.space });
      return;
    }
    if (a === "member") {
      openModal("member", { userId: el.dataset.id });
      return;
    }
    if (a === "award-detail") {
      openModal("award-detail", { id: el.dataset.id });
      return;
    }
    if (a === "copy-id") {
      await copy(d.me.public_id);
      return;
    }
    if (a === "copy-code") {
      await copy(el.dataset.code);
      return;
    }
    if (a === "respond") {
      await run(
        "respond",
        { request_id: el.dataset.id, accept: el.dataset.accept === "true" },
        el.dataset.accept === "true"
          ? "已接受／通过，成员关系已更新。"
          : "已拒绝",
      );
      return;
    }
    if (a === "like") {
      await run(
        "like",
        { event_id: el.dataset.id, liked: el.dataset.liked === "true" },
        el.dataset.liked === "true" ? "已送出喜欢" : "已取消喜欢",
      );
      return;
    }
    if (a === "read-notifications") {
      await run("read_notifications", {}, "通知已标为已读");
      return;
    }
    if (a === "remind") {
      await run(
        "remind",
        { space_id: sp, user_id: el.dataset.id },
        "鼓励已送达。每位搭子每天最多提醒一次。",
      );
      return;
    }
    if (a === "remove-task") {
      confirmAction(
        "移除清单项",
        "只移除此清单项，不会删除历史打卡。",
        "remove_task",
        { space_id: sp, task_id: el.dataset.id },
        "清单已更新",
      );
      return;
    }
    if (a === "reset-code") {
      confirmAction(
        "重置空间口令",
        "旧口令将立即失效；已发出的有效申请仍需正常审批。",
        "reset_code",
        { space_id: el.dataset.space },
        "口令已重置，请重新打开空间详情查看。",
      );
      return;
    }
    if (a === "remove-member") {
      confirmAction(
        "移除成员",
        `确认将「${el.dataset.name}」移出此团队？对方会收到通知。`,
        "remove_member",
        {
          space_id: el.dataset.space,
          user_id: el.dataset.id,
          confirm: "REMOVE",
        },
        "成员已移除",
        "不会删除对方的私人记录、宝石或历史荣誉。",
      );
      return;
    }
    if (a === "leave") {
      confirmAction(
        "退出团队",
        "退出后将无法继续查看团队内容。若你是队长，将由最早加入的现存成员接任；没有其他成员则关闭团队。",
        "leave",
        { space_id: el.dataset.space, confirm: "LEAVE" },
        "已退出团队",
        "历史共享打卡默认保留；可在设置中单独删除自己的历史打卡。",
      );
      return;
    }
    if (a === "dissolve") {
      confirmAction(
        "解散团队",
        "所有成员将立即失去团队入口，没有恢复期，也不提供恢复申请。",
        "dissolve",
        { space_id: el.dataset.space, confirm: "DISSOLVE" },
        "团队已解散",
        "不会影响任何成员的私人健康记录、个人宝石和已获荣誉。",
      );
      return;
    }
    if (a === "erase-health") {
      confirmAction(
        "删除我的健康记录",
        "这会删除全部个人体重、心情、私人备注和个人目标，无法恢复。",
        "erase_health",
        { confirm: "DELETE_HEALTH" },
        "个人健康记录已删除",
        "不会删除团队成员数据、打卡状态、宝石或荣誉。",
      );
      return;
    }
    if (a === "erase-history") {
      confirmAction(
        "删除我的团队打卡历史",
        "只删除你在选定历史团队中的打卡状态和清单完成历史。",
        "erase_team_history",
        { space_id: el.dataset.id, confirm: "DELETE_HISTORY" },
        "历史打卡已删除",
        "不会影响私人健康数据或其他成员。",
      );
      return;
    }
    if (a === "purchase") {
      const product = d.catalog.find((c) => c.code === el.dataset.product);
      if (
        !product?.enabled ||
        product.price == null ||
        product.max_quantity == null
      ) {
        toast("商品规则尚未配置。");
        return;
      }
      confirmAction(
        "确认兑换",
        `使用 ${product.price} 宝石兑换「${product.title}」？`,
        "purchase",
        {
          space_id: sp,
          product: product.code,
          request_key: crypto.randomUUID(),
        },
        "权益已生效",
        "空间席位扩容只绑定当前团队；普通空间名额属于个人。",
      );
      return;
    }
    if (a === "logout") {
      await logout();
    }
  });
  document.addEventListener("change", async (event) => {
    const t = event.target;
    if (t.id === "theme-select") {
      localStorage.setItem("pactfit_v2_theme", t.value);
      preferences();
    }
    if (t.id === "font-select") {
      localStorage.setItem("pactfit_v2_font", t.value);
      preferences();
    }
    if (t.id === "dynamic-companion") {
      localStorage.setItem(
        "pactfit_v2_dynamic_companion",
        t.checked ? "dynamic" : "static",
      );
      shell();
      toast(t.checked ? "伙伴会跟随今天的记录变化" : "已保持默认伙伴图标");
    }
    if (t.id === "member-code-permission") {
      await run(
        "code_permission",
        { space_id: t.dataset.space, allow: t.checked },
        "成员口令权限已更新",
      );
    }
  });
  document.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === "auth-form") {
      if (st.busy || !api) return;
      st.busy = true;
      const ep = st.epoch;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      button.textContent = "处理中…";
      const email = $("#auth-email")?.value.trim() || "",
        password = $("#auth-password")?.value || "";
      try {
        if (st.authMode === "recover") {
          await api.recover(email);
          authView(
            "如果账号可接收恢复邮件，链接将发送至邮箱。请检查垃圾邮件。",
          );
        } else if (st.authMode === "reset") {
          await api.updatePassword(password);
          await enter();
        } else {
          const result = await api.login(
            email,
            password,
            st.authMode === "signup",
          );
          if (ep !== st.epoch) return;
          if (result.confirmationRequired)
            authView("注册请求已受理，请按项目设置完成邮箱确认后登录。");
          else await enter();
        }
      } catch (err) {
        if ($("#auth-error")) $("#auth-error").textContent = M.message(err);
        else toast(M.message(err));
      } finally {
        st.busy = false;
        const input = $("#auth-password");
        if (input) input.value = "";
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = "重试";
        }
      }
      return;
    }
    if (!st.data || st.busy) return;
    if (form.id === "preferences-form") {
      const fd = new FormData(form);
      await run(
        "settings",
        {
          encouragement: fd.has("encouragement"),
          achievements: fd.has("achievements"),
          share_activity: fd.has("share_activity"),
        },
        "偏好已保存",
      );
      return;
    }
    if (form.id !== "modal-form") return;
    const fd = new FormData(form),
      mode = form.dataset.form,
      sp = st.data.space.id,
      values = Object.fromEntries(fd.entries());
    if (
      mode === "profile" &&
      (M.visibleLength(values.nickname) < 2 ||
        M.visibleLength(values.nickname) > 16)
    ) {
      $("[data-form-error]").textContent = "昵称需为 2～16 个可见字符。";
      return;
    }
    if (
      mode === "create-space" &&
      (M.visibleLength(values.name) < 2 || M.visibleLength(values.name) > 20)
    ) {
      $("[data-form-error]").textContent = "空间名称需为 2～20 个可见字符。";
      return;
    }
    if (
      mode === "goal" &&
      Number(values.target_weight) >= Number(values.start_weight)
    ) {
      $("[data-form-error]").textContent = "减重目标应低于起始体重。";
      return;
    }
    if (mode === "change-password" || mode === "change-email") {
      if (
        mode === "change-password" &&
        values.password !== values.confirm_password
      ) {
        $("[data-form-error]").textContent = "两次输入的密码不一致。";
        return;
      }
      st.busy = true;
      try {
        if (mode === "change-password") {
          await api.updatePassword(values.password);
          toast("密码已更新");
        } else {
          const user = await api.updateEmail(values.email);
          toast(
            user.email === values.email
              ? "邮箱已更新"
              : "更改请求已提交，请检查邮箱确认邮件。",
          );
        }
        closeModal();
        shell();
      } catch (err) {
        $("[data-form-error]").textContent = M.message(err);
        form
          .querySelectorAll("input[type=password]")
          .forEach((i) => (i.value = ""));
      } finally {
        st.busy = false;
      }
      return;
    }
    const ops = {
      "create-space": ["create_space", values, "空间已创建"],
      "join-space": ["apply", values, "申请已提交，等待队长审批。"],
      profile: ["profile", values, "资料已同步至所有空间"],
      goal: ["goal", values, "个人目标已保存"],
      record: [
        "checkin",
        {
          space_id: sp,
          weight: values.weight || null,
          mood: values.mood || null,
          note: values.note || "",
          done_tasks: fd.getAll("task"),
        },
        "今日打卡已保存",
      ],
      privacy: [
        "sharing",
        {
          space_id: sp,
          share_weight: fd.has("share_weight"),
          share_goal: fd.has("share_goal"),
          share_aggregate: fd.has("share_aggregate"),
        },
        "共享授权已更新",
      ],
      tasks: [
        "add_task",
        { space_id: sp, title: values.title },
        "清单项已添加",
      ],
      invite: [
        "invite",
        { space_id: st.modalData?.spaceId || sp, public_id: values.public_id },
        "邀请已发送，等待对方接受",
      ],
      "space-edit": [
        "space_profile",
        { space_id: st.modalData?.space?.id, ...values },
        "团队资料已更新",
      ],
    };
    if (mode === "confirm") {
      const data = st.modalData;
      if (!data.action) {
        closeModal();
        return;
      }
      await run(data.action, data.args, data.success);
      return;
    }
    if (ops[mode]) await run(...ops[mode]);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !st.busy) {
      if (st.modal) closeModal();
      else setSidebar(false);
    }
    if (event.key === "Tab" && st.modal) {
      const nodes = [
        ...document.querySelectorAll(
          ".modal button:not([disabled]),.modal input:not([disabled]),.modal select,.modal textarea,.modal summary",
        ),
      ].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  function refreshIfIdle() {
    if (st.data && !st.loading && !st.busy && !st.modal && !document.hidden)
      load(st.space, true);
  }
  setInterval(refreshIfIdle, 20000);
  document.addEventListener("visibilitychange", refreshIfIdle);
  window.addEventListener("focus", refreshIfIdle);
  (async () => {
    try {
      api = PF2Api.create(window.PACTFIT_V2_CONFIG, location.hostname);
      const hash = location.hash;
      history.replaceState(null, "", location.pathname);
      const cb = await api.consumeCallback(hash);
      if (cb === "recovery") {
        st.authMode = "reset";
        authView();
      } else if (api.hasSession()) await enter();
      else authView();
    } catch (err) {
      authView(M.message(err));
    }
  })();
})();
