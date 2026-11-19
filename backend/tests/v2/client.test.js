"use strict";
const assert = require("node:assert/strict");
const API = require("../../../web/v2/api");
const M = require("../../../web/v2/model");
const config = {
  mode: "v2-preview",
  supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
  publicKey: "sb_publishable_test",
  appOrigin: "https://pactfit-v2-preview.pages.dev/",
};
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
});
(async () => {
  assert.throws(
    () =>
      API.validate(
        { ...config, supabaseUrl: "https://ksridewbjuwckuvougma.supabase.co" },
        "example.com",
      ),
    /existing_staging_forbidden/,
  );
  for (const patch of [
    { publicKey: "sb_secret_never" },
    { supabaseUrl: "http://abcdefghijklmnopqrst.supabase.co" },
    { supabaseUrl: "https://example.com" },
    { appOrigin: "http://example.com" },
  ])
    assert.throws(() => API.validate({ ...config, ...patch }, "example.com"));
  assert.throws(
    () =>
      API.validate(
        {
          mode: "local",
          authUrl: "http://127.0.0.1:19999",
          restUrl: "http://127.0.0.1:13000",
        },
        "example.com",
      ),
    /local_only/,
  );
  const calls = [];
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "synthetic@example.invalid",
  };
  const api = API.create(
    config,
    "pactfit-v2-preview.pages.dev",
    async (url, init) => {
      calls.push({ url, init });
      if (url.includes("/token?") || url.includes("/signup"))
        return response({
          access_token: "synthetic",
          refresh_token: "refresh",
          user,
        });
      if (url.endsWith("/v2_command"))
        return response({ ok: true, data: { space_id: "test-space" } });
      if (url.endsWith("/v2_snapshot"))
        return response({ space: { id: "test-space" } });
      if (url.endsWith("/v2_achievement_wall"))
        return response({ total: 60, earned: 0, items: [] });
      if (url.endsWith("/user"))
        return response({
          ...user,
          email: (init.body && JSON.parse(init.body).email) || user.email,
        });
      return response({});
    },
  );
  await api.login("synthetic@example.invalid", "test-password", true);
  assert.equal(api.hasSession(), true);
  await api.command("bootstrap");
  const firstSnapshot = await api.snapshot(null);
  assert.equal(firstSnapshot.achievement_wall.total, 60);
  await api.logout();
  assert.equal(api.hasSession(), false);
  await api.login("synthetic@example.invalid", "test-password", false);
  await api.command("checkin", { weight: null });
  await api.updateEmail("changed@example.invalid");
  assert.equal(api.email(), "changed@example.invalid");
  await api.updatePassword("new-test-password");
  await assert.rejects(
    api.updatePassword("short"),
    (e) => e.code === "weak_password",
  );
  for (const { url, init } of calls) {
    assert.equal(new URL(url).origin, config.supabaseUrl);
    assert.equal(init.headers.apikey, config.publicKey);
    assert.equal(url.includes("password="), false);
  }
  assert.ok(
    calls.find((c) => c.url.includes("/v2_command")).init.headers.Authorization,
  );
  // Session validation, then business envelope denial.
  const denied = API.create(config, "example.com", async (url) =>
    url.includes("/token?")
      ? response({ access_token: "x", user })
      : response({ ok: false, code: "space_limit" }),
  );
  await denied.login(user.email, "test-password", false);
  await assert.rejects(
    denied.command("create_space"),
    (e) => e.code === "space_limit",
  );
  let finish;
  const race = API.create(
    config,
    "example.com",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = race.login(user.email, "test-password", false);
  await race.logout();
  finish(response({ access_token: "x", user }));
  await assert.rejects(pending, (e) => e.code === "session_stale");
  assert.equal(race.hasSession(), false);
  assert.equal(
    await api.consumeCallback(
      "#access_token=callback&refresh_token=r&type=recovery",
    ),
    "recovery",
  );
  await assert.rejects(
    api.consumeCallback("#error=access_denied&error_description=SECRET"),
    (e) => e.code === "expired_link" && !e.message.includes("SECRET"),
  );
  const malformed = API.create(config, "example.com", async () => response({}));
  await assert.rejects(
    malformed.login(user.email, "test-password", true),
    (e) => e.code === "invalid_response",
  );
  assert.equal(malformed.hasSession(), false);
  let releaseRefresh,
    refreshCount = 0;
  const refreshing = API.create(config, "example.com", async (url) => {
    if (url.includes("grant_type=password"))
      return response({
        access_token: "expired",
        refresh_token: "refresh",
        user,
        expires_at: 1,
      });
    if (url.includes("grant_type=refresh_token")) {
      refreshCount++;
      return new Promise((resolve) => {
        releaseRefresh = resolve;
      });
    }
    return response({});
  });
  await refreshing.login(user.email, "test-password", false);
  const p1 = refreshing.snapshot(null),
    p2 = refreshing.snapshot(null);
  await refreshing.logout();
  releaseRefresh(response({ access_token: "late", user }));
  const stale = await Promise.allSettled([p1, p2]);
  assert.equal(refreshCount, 1);
  assert.ok(
    stale.every(
      (r) => r.status === "rejected" && r.reason.code === "session_stale",
    ),
  );
  assert.equal(refreshing.hasSession(), false);
  const removed = API.create(config, "example.com", async (url) =>
    url.includes("/token?")
      ? response({ access_token: "x", user })
      : response({ code: "P0001", message: "forbidden" }, 400),
  );
  await removed.login(user.email, "test-password", false);
  await assert.rejects(
    removed.snapshot("old-space"),
    (e) => e.code === "forbidden",
  );
  const d = {
    today: "2026-11-16",
    my_records: [
      { day: "2026-11-16", weight: null, mood: "很开心" },
      { day: "2026-11-15", weight: 69.5 },
      { day: "2026-11-10", weight: 70 },
    ],
    personal_checkins: [{ day: "2026-11-16" }, { day: "2026-11-15" }],
    my_checkins: [{ day: "2026-11-16", done_tasks: [] }],
    goal: { start_weight: 70, target_weight: 60 },
  };
  const trend = M.trend(d, 7);
  assert.equal(trend.weights.length, 2);
  assert.equal(trend.latest, 69.5);
  assert.equal(trend.streak, 2);
  assert.equal(trend.history.length, 3);
  assert.equal(trend.progress, 5);
  assert.equal(trend.rate, 29);
  assert.equal(M.today(d).health.weight, null);
  assert.equal(M.trend({ ...d, my_records: [], goal: null }).latest, null);
  assert.equal(M.visibleLength("👩‍👩‍👧‍👦搭子"), 3);
  assert.equal(M.esc("<img src=x>"), "&lt;img src=x&gt;");
  assert.equal(M.message({ message: "SECRET" }).includes("SECRET"), false);
  console.log(
    "PASS V2 client: isolated endpoints, password/session guards, gateway headers, command envelope, real-only trends, visible names",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
