'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const API = require('../client/pactfit-local-api');
const root = require('node:path').join(__dirname, '../..');
const config = {mode:'staging',supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',publicKey:'sb_publishable_test',redirectUrl:'https://pactfit-staging.pages.dev/'};
const response = (data,status=200)=>({ok:status===200,status,text:async()=>JSON.stringify(data)});
const requests=[];
const mock=async(url,init)=>{
  requests.push({url,init});
  if(url.endsWith('/user')) return response({id:'staging-user'});
  if(url.includes('/token?')) return response({access_token:'new-token',refresh_token:'refresh',user:{id:'staging-user'}});
  return response([]);
};
(async()=>{
  for(const patch of [
    {supabaseUrl:'http://abcdefghijklmnopqrst.supabase.co'}, {supabaseUrl:'https://example.com'},
    {supabaseUrl:config.supabaseUrl+'/auth/v1'}, {publicKey:'sb_secret_never'},
    {publicKey:'service_role'}, {publicKey:''}, {redirectUrl:'http://localhost:8899/'}, {redirectUrl:''}
  ]) assert.throws(()=>API.createLocalBackend({...config,...patch},mock));
  const serviceJWT='e30.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.sig';
  assert.throws(()=>API.createLocalBackend({...config,publicKey:serviceJWT},mock));
  for(const suffix of ['','/','/rest/v1','/rest/v1/']) {
    let req;
    const client=API.createLocalBackend({...config,supabaseUrl:config.supabaseUrl+suffix},async(url,init)=>{req={url,init};return response({});});
    await client.auth.requestEmailOtp('synthetic@example.invalid');
    assert.match(req.url,/\.supabase\.co\/auth\/v1\/otp\?/);
    assert.equal(req.init.headers.Authorization,undefined);
  }
  const api=API.createLocalBackend(config,mock);
  await api.auth.requestEmailOtp('synthetic@example.invalid');
  assert.match(requests[0].url,/\/auth\/v1\/otp\?redirect_to=https%3A%2F%2Fpactfit-staging.pages.dev%2F$/);
  await api.auth.consumeCallback('#access_token=synthetic-token&refresh_token=refresh');
  assert.equal(api.auth.getUserId(),'staging-user');
  await api.db.select('profiles');
  await api.createSpace({nickname:'Synthetic',startWeight:70,targetWeight:60});
  await api.auth.refreshSession();
  await api.auth.signOut();
  for(const {url,init} of requests) {
    assert.equal(new URL(url).origin,config.supabaseUrl);
    assert.equal(init.headers.apikey,config.publicKey);
  }
  assert.equal(requests.find(r=>r.url.includes('/rest/v1/profiles')).init.headers.Authorization,'Bearer synthetic-token');
  const denied=API.createLocalBackend(config,async()=>response({},401));
  await assert.rejects(denied.auth.consumeCallback('#access_token=bad'),/auth_callback_failed/);
  assert.equal(denied.auth.getUserId(),null);
  let finish;
  const race=API.createLocalBackend(config,()=>new Promise(resolve=>{finish=resolve;}));
  const callback=race.auth.consumeCallback('#access_token=late');
  await race.auth.signOut();
  finish(response({id:'late-user'}));
  await assert.rejects(callback,/session_stale/);
  execFileSync('node',['scripts/build-staging.js'],{cwd:root,env:{...process.env,PACTFIT_STAGING_SUPABASE_URL:config.supabaseUrl,PACTFIT_STAGING_PUBLIC_KEY:config.publicKey,PACTFIT_STAGING_APP_ORIGIN:config.redirectUrl}});
  try {
    const html=fs.readFileSync(root+'/dist/index.html','utf8');
    const modeScript=html.match(/<script data-page-node-id="pfBackendMode">([\s\S]*?)<\/script>/)[1];
    const loader=html.match(/<script data-page-node-id="pfBackendLoader">([\s\S]*?)<\/script>/)[1];
    for(const deployment of [config,undefined]) {
      const loaded=[];
      const context={window:{PACTFIT_DEPLOYMENT:deployment},document:{createElement:()=>({set src(v){this.outerHTML=v;}}),write:v=>loaded.push(v)}};
      vm.runInNewContext(modeScript,context);
      vm.runInNewContext(loader,context);
      assert.equal(context.window.__PACTFIT_BACKEND__,'local');
      assert.deepEqual(loaded,['./pactfit-local-api.js','./pactfit-be.js']);
      if(!deployment) assert.throws(()=>API.createLocalBackend(context.window.__PACTFIT_LOCAL_CFG__,mock));
    }
    for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    assert.match(fs.readFileSync(root+'/dist/_headers','utf8'),/connect-src 'self' https:\/\/abcdefghijklmnopqrst.supabase.co;/);
    assert.equal(fs.readFileSync(root+'/web/deployment-config.js','utf8').includes('sb_publishable'),false);
  } finally { fs.rmSync(root+'/dist',{recursive:true,force:true}); }
  console.log('PASS staging: gateway headers, callback validation/race, URL normalization, auth/RPC isolation, fail-closed build');
})().catch(e=>{console.error(e);process.exitCode=1;});
