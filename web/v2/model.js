(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PF2Model = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const avatars = {
    leaf: "🌿",
    sun: "☀️",
    moon: "🌙",
    peach: "🍑",
    ocean: "🌊",
    flower: "🌷",
  };
  const errors = {
    config_missing: "尚未配置独立 V2 环境。",
    config_invalid: "预览环境配置无效。",
    local_only: "此配置只能在本机运行。",
    existing_staging_forbidden: "V2 必须连接独立项目，不能使用已有 staging。",
    public_key_required: "仅接受公开 publishable key。",
    unauthenticated: "请先登录。",
    invalid_credentials: "邮箱或密码不正确。",
    invalid_credentials_input: "请填写有效邮箱和密码；注册密码至少 8 位。",
    email_not_confirmed: "请先确认邮箱。",
    user_already_exists: "邮箱已注册，请登录或找回密码。",
    rate_limited: "请求过于频繁，请稍后重试。",
    over_email_send_rate_limit: "邮件发送已达限额，请稍后或配置 SMTP。",
    expired_link: "邮件链接已使用或过期，请用密码登录，或重新申请重置。",
    session_stale: "会话已变更，请重新登录。",
    invalid_nickname: "昵称需为 2～16 个可见字符。",
    nickname_rate_limit: "连续 7 天最多修改两次昵称。",
    invalid_avatar: "请选择官方预设头像。",
    space_limit: "已达到公共空间参与额度。",
    member_limit: "团队人数已满。",
    invalid_space_name: "空间名称需为 2～20 字，简介最多 300 字。",
    invalid_code: "口令无效或空间不可用。",
    already_member: "已经是团队成员。",
    duplicate_or_rate_limited:
      "已有待处理申请／邀请，或今天已经提醒过这位成员。",
    person_not_found: "未找到该个人 ID，请确认对方已进入 V2。",
    forbidden: "你没有执行此操作的权限，或空间已不可用。",
    not_a_member: "已不在该团队中。",
    space_unavailable: "空间已不可用。",
    request_expired: "此申请已处理、已过期或团队已解散。",
    confirmation_required: "请先完成二次确认。",
    use_leave: "请使用退出团队功能。",
    invalid_input: "输入不符合规则，请检查体重、目标和必填项。",
    invalid_tasks: "清单已变化，请刷新后重试。",
    task_limit: "当前清单最多 30 项。",
    already_checked_in: "这位成员今天已打卡，无需提醒。",
    reminders_disabled: "对方已关闭鼓励提醒。",
    product_not_configured: "商品价格或上限尚未确认，暂不开放兑换。",
    product_limit: "已达到该权益的兑换上限。",
    insufficient_gems: "宝石不足。",
    weak_password: "密码至少 8 位，并需符合项目的密码规则。",
    same_password: "新密码不能与旧密码相同。",
  };
  function message(e) {
    return errors[e && e.code] || "请求未完成，请检查网络后重试。";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function dayOffset(day, offset) {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }
  function visibleLength(s) {
    return typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(
            s.trim(),
          ),
        ].length
      : [...s.trim()].length;
  }
  function trend(data, range = 30) {
    const start = dayOffset(data.today, -(range - 1));
    const history = (data.my_records || [])
      .filter((r) => r.day >= start && r.day <= data.today)
      .slice()
      .sort((a, b) => a.day.localeCompare(b.day));
    const weights = history
      .filter((r) => r.weight !== null && r.weight !== undefined)
      .map((r) => ({ day: r.day, weight: Number(r.weight) }));
    const allWeights = (data.my_records || [])
      .filter((r) => r.weight !== null && r.weight !== undefined)
      .slice()
      .sort((a, b) => b.day.localeCompare(a.day));
    const checkins = (data.personal_checkins || []).filter(
      (c) => c.day >= start && c.day <= data.today,
    );
    const unique = new Set((data.personal_checkins || []).map((c) => c.day));
    let streak = 0,
      cursor = data.today;
    if (!unique.has(cursor)) cursor = dayOffset(cursor, -1);
    while (unique.has(cursor)) {
      streak++;
      cursor = dayOffset(cursor, -1);
    }
    const moods = {};
    history.forEach((r) => {
      if (r.mood) moods[r.mood] = (moods[r.mood] || 0) + 1;
    });
    const latest = allWeights.length ? Number(allWeights[0].weight) : null,
      goal = data.goal;
    const lost =
      goal && latest !== null ? Number(goal.start_weight) - latest : null;
    const progress =
      goal && lost !== null
        ? Math.max(
            0,
            Math.min(
              100,
              (lost /
                (Number(goal.start_weight) - Number(goal.target_weight))) *
                100,
            ),
          )
        : 0;
    return {
      history,
      weights,
      latest,
      latestDay: allWeights[0]?.day || null,
      streak,
      moods,
      progress,
      lost,
      rate: Math.round(
        (new Set(checkins.map((c) => c.day)).size / range) * 100,
      ),
      checkins,
    };
  }
  function today(data) {
    return {
      health: (data.my_records || []).find((r) => r.day === data.today) || null,
      checkin:
        (data.my_checkins || []).find((r) => r.day === data.today) || null,
    };
  }
  return { avatars, message, esc, dayOffset, visibleLength, trend, today };
});
