#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const API = require('../backend/client/pactfit-local-api.js');
function requiredBuildInput(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Missing build environment variable: ' + name +
      '. Check the Pages environment used by this deployment, save variables, then start a new deployment.');
  }
  const value = raw.trim();
  if (/[\r\n]/.test(value)) throw new Error('Build environment variable contains a line break: ' + name);
  return value;
}
console.log('[staging] Build configuration from Pages environment; branch=' +
  (process.env.CF_PAGES_BRANCH || '(not supplied)'));
const cfg = {
  mode: 'staging',
  supabaseUrl: requiredBuildInput('PACTFIT_STAGING_SUPABASE_URL'),
  publicKey: requiredBuildInput('PACTFIT_STAGING_PUBLIC_KEY'),
  redirectUrl: requiredBuildInput('PACTFIT_STAGING_APP_ORIGIN')
};
try { new URL(cfg.supabaseUrl); }
catch (_) { throw new Error('Invalid URL in PACTFIT_STAGING_SUPABASE_URL; enter the plain HTTPS project URL without quotes or Markdown.'); }
console.log('[staging] All three required build variables are present (values omitted).');
API.createLocalBackend(cfg, () => { throw new Error('build must not send requests'); });
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'web'), out, { recursive: true });
fs.writeFileSync(path.join(out, 'deployment-config.js'), 'window.PACTFIT_DEPLOYMENT = Object.freeze(' + JSON.stringify(cfg) + ');\n');
const index = path.join(out, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('/* STAGING_BUILD_GUARD */',
  "window.__PACTFIT_BACKEND__ = 'local'; window.__PACTFIT_LOCAL_CFG__ = {mode:'staging'}; return;"));
const origin = new URL(cfg.supabaseUrl).origin;
fs.writeFileSync(path.join(out, '_headers'), `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${origin}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
/index.html
  Cache-Control: no-store
/deployment-config.js
  Cache-Control: no-store
/sw.js
  Cache-Control: no-cache
`);
console.log('Staging static output: dist/index.html (source: web/index.html)');
