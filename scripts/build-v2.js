#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const API = require("../web/v2/api");
const root = path.resolve(__dirname, "..");
function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error("Missing isolated V2 build variable: " + name);
  return value;
}
const config = {
  mode: "v2-preview",
  supabaseUrl: required("PACTFIT_V2_SUPABASE_URL"),
  publicKey: required("PACTFIT_V2_PUBLIC_KEY"),
  appOrigin: required("PACTFIT_V2_APP_ORIGIN"),
};
API.validate(config, new URL(config.appOrigin).hostname);
const out = path.join(root, "v2/dist");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "web/v2"), out, { recursive: true });
fs.writeFileSync(
  path.join(out, "config.js"),
  "window.PACTFIT_V2_CONFIG = Object.freeze(" + JSON.stringify(config) + ");\n",
);
fs.writeFileSync(
  path.join(out, "_headers"),
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${new URL(config.supabaseUrl).origin}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cache-Control: no-store
`,
);
console.log(
  "V2-only output: v2/dist/index.html; V1 and existing staging unchanged",
);
