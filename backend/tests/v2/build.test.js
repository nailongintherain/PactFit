"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const files = [
  "web/index.html",
  "web/pactfit-local-api.js",
  "wrangler.toml",
  "compose.yaml",
];
const originals = new Map(
  files.map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]),
);
const env = {
  ...process.env,
  PACTFIT_V2_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  PACTFIT_V2_PUBLIC_KEY: "sb_publishable_test",
  PACTFIT_V2_APP_ORIGIN: "https://pactfit-v2-preview.pages.dev/",
};
function run(extra) {
  return spawnSync("node", ["scripts/build-v2.js"], {
    cwd: root,
    env: { ...env, ...extra },
    encoding: "utf8",
  });
}
for (const bad of [
  { PACTFIT_V2_SUPABASE_URL: "" },
  { PACTFIT_V2_SUPABASE_URL: "https://ksridewbjuwckuvougma.supabase.co" },
  { PACTFIT_V2_PUBLIC_KEY: "sb_secret_never" },
  { PACTFIT_V2_APP_ORIGIN: "http://example.com" },
])
  assert.notEqual(run(bad).status, 0);
assert.equal(run({}).status, 0);
try {
  const output = path.join(root, "v2/dist");
  const index = fs.readFileSync(path.join(output, "index.html"), "utf8");
  assert.match(index, /PactFit/);
  assert.match(index, /\.\/app\.js/);
  const config = fs.readFileSync(path.join(output, "config.js"), "utf8");
  assert.ok(config.includes(env.PACTFIT_V2_SUPABASE_URL));
  assert.equal(config.includes("service_role"), false);
  const headers = fs.readFileSync(path.join(output, "_headers"), "utf8");
  assert.ok(headers.includes("script-src 'self';"));
  assert.ok(
    headers.includes("connect-src 'self' " + env.PACTFIT_V2_SUPABASE_URL),
  );
  for (const file of ["app.js", "model.js", "api.js", "style.css"])
    assert.ok(fs.existsSync(path.join(output, file)));
  const frameDir = path.join(output, "assets/achievement-frames");
  for (const rank of [
    "starter",
    "advanced",
    "rare",
    "epic",
    "legendary",
    "hidden",
  ]) {
    const frame = fs.readFileSync(path.join(frameDir, rank + ".svg"), "utf8");
    assert.match(frame, /^<svg[^>]+viewBox="0 0 160 190"/);
    assert.doesNotMatch(frame, /<script|<foreignObject|javascript:/i);
  }
  const app = fs.readFileSync(path.join(output, "app.js"), "utf8");
  assert.match(app, /assets\/achievement-frames\/legendary\.svg/);
  assert.doesNotMatch(app, /<svg class="achievement-frame"/);
  const style = fs.readFileSync(path.join(output, "style.css"), "utf8");
  assert.match(style, /--phone-width:\s*430px/);
  assert.match(style, /width:\s*min\(100%,\s*var\(--phone-width\)\)/);
  assert.doesNotMatch(style, /@media\s*\(min-width:/);
  assert.match(index, /name="theme-color" content="#b84a34"/);
  assert.equal(fs.existsSync(path.join(output, "pactfit-be.js")), false);
  for (const [f, before] of originals)
    assert.equal(fs.readFileSync(path.join(root, f), "utf8"), before);
  console.log(
    "PASS V2 build: own entry, isolated endpoint, fail-closed secrets/URLs, CSP, no V1 changes",
  );
} finally {
  fs.rmSync(path.join(root, "v2/dist"), { recursive: true, force: true });
}
