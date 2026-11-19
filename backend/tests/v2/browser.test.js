"use strict";
// Real local GoTrue/PostgREST/PostgreSQL, synthetic accounts only. Run scripts/v2-up.sh first.
const assert = require("node:assert/strict");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (_) {
  ({ chromium } = require("../../../v2/node_modules/playwright"));
}
const BASE = "http://127.0.0.1:18899/v2/";
const PASSWORD = "V2-preview-test-password-2026";
const suffix = Date.now();
const emails = ["a", "b", "c"].map(
  (c) => `v2-preview-${suffix}-${c}@example.test`,
);
const sessions = new Map(),
  errors = [],
  forbidden = [];
const launch = { headless: true, args: ["--no-sandbox"] };
if (process.env.CHROMIUM_PATH)
  launch.executablePath = process.env.CHROMIUM_PATH;
async function snapshot(email, space = null) {
  const res = await fetch("http://127.0.0.1:13000/rpc/v2_snapshot", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + sessions.get(email).access_token,
    },
    body: JSON.stringify({ p_space: space }),
  });
  assert.equal(res.status, 200);
  return res.json();
}
(async () => {
  const browser = await chromium.launch(launch);
  const pages = [];
  try {
    for (const email of emails) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("response", async (res) => {
        if (res.url().startsWith("http://127.0.0.1:19999/signup")) {
          const value = await res.json();
          if (value.access_token) sessions.set(email, value);
        }
      });
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (["127.0.0.1", "localhost"].includes(u.hostname))
          return route.continue();
        if (/workbuddy|ksridewbjuwckuvougma/.test(u.hostname))
          forbidden.push(u.hostname);
        return route.abort();
      });
      await page.goto(BASE);
      await page
        .locator('[data-action="auth-mode"][data-mode="signup"]')
        .click();
      await page.locator("#auth-email").fill(email);
      await page.locator("#auth-password").fill(PASSWORD);
      await page.locator("#auth-form button[type=submit]").click();
      await page.locator(".bottom-nav").waitFor();
      pages.push(page);
    }
    const [a, b, c] = pages;
    async function action(page, name, attrs = "") {
      if (
        [
          "profile",
          "create-space",
          "join-space",
          "switch-space",
          "expand-space",
          "space-details",
        ].includes(name) &&
        !(await page.evaluate(() =>
          document.body.classList.contains("sidebar-open"),
        ))
      ) {
        await page.locator('[data-action="open-sidebar"]').click();
      }
      await page
        .locator(
          `${name === "close-sidebar" ? "button" : ""}[data-action="${name}"]${attrs}:visible`,
        )
        .first()
        .click();
    }
    async function submit(page) {
      await page.locator("#modal-form button[type=submit]").click();
      try {
        await page.locator("#modal-root .modal").waitFor({ state: "detached" });
        await page
          .locator("#main-content .empty")
          .filter({ hasText: "正在读取空间" })
          .waitFor({ state: "detached" });
      } catch (err) {
        throw new Error(
          "Modal did not finish: " +
            (await page.locator("[data-form-error]").innerText()) +
            "; page errors: " +
            errors.join("; "),
        );
      }
    }
    async function refresh(page) {
      await action(page, "refresh");
      await page
        .locator("#main-content .empty")
        .filter({ hasText: "正在读取空间" })
        .waitFor({ state: "detached" });
    }
    async function setPage(page, name) {
      if (
        name === "settings" &&
        !(await page.evaluate(() =>
          document.body.classList.contains("sidebar-open"),
        ))
      )
        await action(page, "open-sidebar");
      await action(page, "page", `[data-page="${name}"]`);
    }
    async function switchSpace(page, id) {
      await action(page, "switch-space", `[data-id="${id}"]`);
      await page
        .locator("#main-content .empty")
        .filter({ hasText: "正在读取空间" })
        .waitFor({ state: "detached" });
    }
    async function record(page, weight = "") {
      await action(page, "record");
      await page.locator("#field-weight").fill(weight);
      await page.locator("#field-mood").selectOption("还不错");
      await submit(page);
    }
    await a.locator('[data-today-state="waiting"]').waitFor();
    assert.equal(
      await a.locator('.hero [data-companion-state="waiting"]').count(),
      1,
    );
    await action(a, "profile");
    await a.locator("#field-nickname").fill("晨光搭子");
    await submit(a);
    await action(a, "goal");
    await a.locator("#field-start_weight").fill("70");
    await a.locator("#field-target_weight").fill("60");
    await submit(a);
    await action(a, "tasks");
    await a.locator("#field-title").fill("饭后散步十分钟");
    await submit(a);
    await action(a, "record");
    await a.locator("#field-mood").selectOption("很开心");
    await a.locator('[name="task"]').check();
    await a.locator("#field-note").fill("只在私人记录里的备注");
    await submit(a);
    await a.locator('[data-today-state="recorded"]').waitFor();
    let state = await snapshot(emails[0]);
    assert.equal(state.my_records[0].weight, null);
    assert.equal(state.gems, 2);
    await record(a, "69.8");
    state = await snapshot(emails[0]);
    assert.equal(Number(state.my_records[0].weight), 69.8);
    assert.equal(state.gems, 2);
    await setPage(a, "trend");
    assert.match(await a.locator("#main-content").innerText(), /69.8/);
    assert.match(
      await a.locator("#main-content").innerText(),
      /已保存的健康记录/,
    );
    const privateA = state.space.id;
    await action(a, "create-space");
    await a.locator("#field-name").fill("晨光同行");
    await a
      .locator("#field-description")
      .fill("照顾好自己，也为搭子留一句鼓励。");
    await submit(a);
    state = await snapshot(emails[0]);
    const team = state.spaces.find((s) => s.name === "晨光同行").id;
    const code = (await snapshot(emails[0], team)).space.code;
    await action(b, "join-space");
    await b.locator("#field-code").fill(code);
    await submit(b);
    assert.equal((await snapshot(emails[1])).spaces.length, 1);
    await refresh(a);
    await setPage(a, "messages");
    await action(a, "respond", '[data-accept="true"]');
    await refresh(b);
    await switchSpace(b, team);
    await setPage(b, "trend");
    let member = (await snapshot(emails[1], team)).members.find(
      (m) => m.user_id === sessions.get(emails[0]).user.id,
    );
    assert.equal(member.weight, null);
    assert.equal(member.goal, null);
    assert.equal(member.weights, null);
    assert.equal((await snapshot(emails[1], team)).space.code, null);
    assert.equal(
      (await b.locator("#main-content").innerText()).includes("69.8"),
      false,
    );
    // Direct table access is still RLS-protected, not just omitted by a UI.
    const direct = await fetch(
      "http://127.0.0.1:13000/v2_daily?user_id=eq." +
        sessions.get(emails[0]).user.id,
      {
        headers: {
          Authorization: "Bearer " + sessions.get(emails[1]).access_token,
        },
      },
    );
    assert.deepEqual(await direct.json(), []);
    await setPage(a, "home");
    await action(a, "privacy");
    await a.locator('[name="share_weight"]').check();
    await submit(a);
    await refresh(b);
    member = (await snapshot(emails[1], team)).members.find(
      (m) => m.user_id === sessions.get(emails[0]).user.id,
    );
    assert.equal(Number(member.weight), 69.8);
    assert.equal(member.goal, null);
    await action(a, "privacy");
    await a.locator('[name="share_weight"]').uncheck();
    await submit(a);
    await refresh(b);
    assert.equal(
      (await snapshot(emails[1], team)).members.find(
        (m) => m.user_id === sessions.get(emails[0]).user.id,
      ).weight,
      null,
    );
    await action(a, "space-details", `[data-id="${team}"]`);
    await a.locator("#member-code-permission").check();
    await a.locator("#modal-root .modal").waitFor({ state: "detached" });
    await refresh(b);
    assert.equal((await snapshot(emails[1], team)).space.code, code);
    await action(b, "space-details", `[data-id="${team}"]`);
    await b.locator('[data-action="copy-code"]').waitFor();
    assert.equal(await b.locator('[data-action="reset-code"]').count(), 0);
    assert.equal(await b.locator('[data-action="copy-code"]').count(), 1);
    await action(b, "close-modal");
    const idC = (await snapshot(emails[2])).me.public_id;
    await action(a, "space-details", `[data-id="${team}"]`);
    await action(a, "invite");
    await a.locator("#field-public_id").fill(idC);
    await submit(a);
    await refresh(c);
    await setPage(c, "messages");
    await action(c, "respond", '[data-accept="true"]');
    await switchSpace(c, team);
    await setPage(a, "home");
    await record(a, "69.8");
    await setPage(b, "home");
    await record(b);
    await setPage(c, "home");
    await record(c);
    await refresh(a);
    await a.locator('[data-today-state="together"]').waitFor();
    await setPage(a, "achievements");
    assert.equal(await a.locator(".achievement-tabs button").count(), 6);
    assert.equal(await a.locator(".achievement-card").count(), 10);
    assert.equal(
      await a.locator('.achievement-card[data-id="first_checkin"].earned').count(),
      1,
    );
    await action(
      a,
      "achievement-category",
      '[data-category="weight_journey"]',
    );
    assert.match(
      await a.locator('.achievement-card[data-id="weight_up_1"]').innerText(),
      /隐藏彩蛋|等待偶遇/,
    );
    assert.doesNotMatch(
      await a.locator('.achievement-card[data-id="weight_up_1"]').innerText(),
      /体重较上一次记录上升/,
    );
    await action(
      a,
      "achievement-category",
      '[data-category="buddy_collaboration"]',
    );
    assert.equal(
      await a.locator('.achievement-card[data-id="team_together"].earned').count(),
      1,
    );
    await action(a, "award-detail", '[data-id="team_together"]');
    assert.match(await a.locator("#modal-root").innerText(), /全员同日打卡/);
    await action(a, "close-modal");
    state = await snapshot(emails[0], team);
    assert.equal(state.gems, 3);
    assert.ok(state.team_awards.some((award) => award.code === "team_together"));
    assert.equal(await a.locator('[data-action="purchase"]').count(), 0);
    assert.match(
      await a.locator("#main-content").innerText(),
      /价格／上限待确认/,
    );
    await setPage(b, "messages");
    await action(b, "message-tab", '[data-tab="activity"]');
    await action(b, "like", '[data-liked="true"]');
    await action(b, "like", '[data-liked="false"]');
    await action(a, "space-details", `[data-id="${team}"]`);
    await action(a, "leave");
    await submit(a);
    assert.equal((await snapshot(emails[0])).my_records.length, 1);
    assert.equal((await snapshot(emails[0])).gems, 3);
    await refresh(b);
    assert.equal(
      (await snapshot(emails[1], team)).space.captain_id,
      sessions.get(emails[1]).user.id,
    );
    await action(b, "space-details", `[data-id="${team}"]`);
    await action(b, "remove-member");
    await submit(b);
    await refresh(c);
    await setPage(c, "messages");
    await action(c, "message-tab", '[data-tab="notifications"]');
    assert.match(
      await c.locator("#main-content").innerText(),
      /你已被移出团队/,
    );
    await action(b, "space-details", `[data-id="${team}"]`);
    await action(b, "dissolve");
    await submit(b);
    assert.equal((await snapshot(emails[1])).spaces.length, 1);
    await refresh(a);
    await switchSpace(a, privateA);
    await setPage(a, "home");
    assert.match(await a.locator("#main-content").innerText(), /69.8/);
    assert.ok(
      (await snapshot(emails[0])).awards.some(
        (x) => x.space_id && x.code === "team_together",
      ),
    );
    // Desktop/tablet viewports must retain the same single-column phone UI.
    for (const width of [320, 390, 768, 1440]) {
      await a.setViewportSize({ width, height: 900 });
      const app = await a.locator("#app").boundingBox();
      const nav = await a.locator(".bottom-nav").boundingBox();
      assert.equal(Math.round(app.width), Math.min(width, 430));
      assert.ok(
        Math.abs(
          app.x -
            ((await a.evaluate(() => document.documentElement.clientWidth)) -
              app.width) /
              2,
        ) < 1,
      );
      assert.ok(
        Math.abs(nav.x - app.x) < 1 && Math.abs(nav.width - app.width) < 1,
      );
      assert.equal(await a.locator(".desktop-tabs").count(), 0);
      assert.equal(await a.locator(".sidebar").isVisible(), false);
      assert.equal(
        await a
          .locator(".home-grid")
          .evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
          ),
        1,
      );
      await action(a, "open-sidebar");
      const drawer = await a.locator(".drawer-layer").boundingBox();
      assert.ok(
        Math.abs(drawer.x - app.x) < 1 &&
          Math.abs(drawer.width - app.width) < 1,
      );
      assert.equal(
        await a.locator(".workspace").evaluate((el) => el.inert),
        true,
      );
      await action(a, "close-sidebar");
      await action(a, "record");
      const sheet = await a.locator(".modal-scrim").boundingBox();
      assert.ok(
        Math.abs(sheet.x - app.x) < 1 && Math.abs(sheet.width - app.width) < 1,
      );
      await action(a, "close-modal");
    }
    // Large fonts, long names and appearance preferences on the same phone layout.
    await a.setViewportSize({ width: 390, height: 844 });
    await action(a, "open-sidebar");
    await action(a, "page", '[data-page="settings"]');
    await a.locator("#font-select").selectOption("19");
    await a.locator("#theme-select").selectOption("dark");
    assert.equal(
      await a.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    assert.ok(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await a.locator("#font-select").selectOption("15");
    await a.locator("#theme-select").selectOption("light");
    await a.locator("#dynamic-companion").uncheck();
    await setPage(a, "home");
    await a.locator('[data-today-state="default"]').waitFor();
    await setPage(a, "settings");
    await a.locator("#dynamic-companion").check();
    await setPage(a, "home");
    await a.screenshot({
      path: process.env.V2_SCREENSHOT_DIR
        ? process.env.V2_SCREENSHOT_DIR + "/v2-mobile.png"
        : "/tmp/pactfit-v2-mobile.png",
      fullPage: true,
    });
    await a.setViewportSize({ width: 1440, height: 1000 });
    await a.screenshot({
      path: process.env.V2_SCREENSHOT_DIR
        ? process.env.V2_SCREENSHOT_DIR + "/v2-desktop.png"
        : "/tmp/pactfit-v2-desktop.png",
      fullPage: true,
    });
    await a.setViewportSize({ width: 390, height: 844 });
    await action(a, "open-sidebar");
    await action(a, "profile");
    await a.locator("#field-nickname").fill("晨光".repeat(8));
    await submit(a);
    await action(a, "open-sidebar");
    await action(a, "create-space");
    await a.locator("#field-name").fill("同行".repeat(10));
    await submit(a);
    await action(a, "open-sidebar");
    await setPage(a, "settings");
    await a.locator("#font-select").selectOption("19");
    await setPage(a, "home");
    assert.ok(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "long names / large text overflow",
    );
    await setPage(a, "settings");
    await a.locator("#font-select").selectOption("15");
    assert.deepEqual(forbidden, []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS V2 live browser: real signup, private/teams, application/invitation approval, optional-weight records, RLS/privacy revocation, captain succession, removal/dissolution, honors/ledger, likes, phone-width canvas on all screens, drawers/sheets/navigation, dark/font settings",
    );
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
