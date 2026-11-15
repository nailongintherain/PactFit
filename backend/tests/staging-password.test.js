'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const API = require('../client/pactfit-local-api');
const UI = require('../../web/pactfit-staging-auth');
const config={mode:'staging',supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',publicKey:'sb_publishable_test',redirectUrl:'https://pactfit-staging.pages.dev/'};
const user={id:'00000000-0000-0000-0000-000000000001'};
const session={user,access_token:'synthetic-access',refresh_token:'synthetic-refresh'};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)});
(async()=>{
  const calls=[];
  let confirm=false;
  const api=API.createLocalBackend(config,async(url,init)=>{
    calls.push({url,init});
    if(url.includes('/signup')&&confirm) return response(user);
    if(url.endsWith('/recover?redirect_to='+encodeURIComponent(config.redirectUrl))) return response({});
    if(url.endsWith('/user')) return response(user);
    return response(session);
  });
  const password=' synthetic-password '; // preserve intentional password whitespace
  await api.auth.signUpWithPassword(' test@example.invalid ',password);
  assert.match(calls[0].url,/\/auth\/v1\/signup\?redirect_to=/);
  assert.deepEqual(JSON.parse(calls[0].init.body),{email:'test@example.invalid',password});
  assert.equal(api.auth.getUserId(),user.id);
  await api.auth.signOut();
  assert.equal(api.auth.getUserId(),null);
  for(let i=0;i<2;i++) {
    const signed=await api.auth.signInWithPassword('test@example.invalid',password);
    assert.equal(signed.data.confirmationRequired,false);
    assert.equal(api.auth.getUserId(),user.id);
    await api.auth.signOut();
  }
  confirm=true;
  const signup=await api.auth.signUpWithPassword('test@example.invalid',password);
  assert.equal(signup.data.confirmationRequired,true);
  assert.equal(api.auth.getUserId(),null);
  await api.auth.requestPasswordRecovery('test@example.invalid');
  assert.equal(await api.auth.consumeCallback('#access_token=recovery-session&refresh_token=synthetic-refresh&type=recovery'),'recovery');
  await api.auth.updatePassword('new-synthetic-password');
  const update=calls.find(c=>c.init.method==='PUT');
  assert.equal(update.init.headers.Authorization,'Bearer recovery-session');
  assert.deepEqual(JSON.parse(update.init.body),{password:'new-synthetic-password'});
  for(const call of calls) {
    assert.equal(new URL(call.url).origin,config.supabaseUrl);
    assert.equal(call.init.headers.apikey,config.publicKey);
    assert.equal(call.url.includes('/otp'),false);
    assert.equal(call.url.includes('password='),false);
  }
  const before=calls.length;
  await assert.rejects(api.auth.signUpWithPassword('bad','long-enough-password'),/bad_request/);
  await assert.rejects(api.auth.signUpWithPassword('test@example.invalid','short'),/bad_request/);
  assert.equal(calls.length,before);
  for(const [status,code,expected] of [[400,'invalid_credentials','invalid_credentials'],[400,'email_not_confirmed','email_not_confirmed'],[422,'user_already_exists','user_already_exists'],[429,'over_email_send_rate_limit','auth_rate_limited']]) {
    const bad=API.createLocalBackend(config,async()=>response({error_code:code,msg:'do not echo credentials'},status));
    await assert.rejects(bad.auth.signInWithPassword('test@example.invalid',password),e=>e.code===expected&&!e.message.includes(password)&&!e.message.includes('do not echo'));
    assert.equal(bad.auth.getUserId(),null);
  }
  let finish;
  const race=API.createLocalBackend(config,()=>new Promise(resolve=>{finish=resolve;}));
  const late=race.auth.signInWithPassword('test@example.invalid',password);
  await race.auth.signOut();
  finish(response(session));
  await assert.rejects(late,e=>e.code==='session_stale');
  assert.equal(race.auth.getUserId(),null);
  await assert.rejects(api.auth.consumeCallback('#error=access_denied&error_description=SECRET'),e=>e.code==='auth_callback_failed'&&!e.message.includes('SECRET'));
  await api.auth.signOut();
  await assert.rejects(api.auth.updatePassword('new-password'),e=>e.code==='unauthenticated');
  assert.match(UI.errorText({code:'invalid_credentials'}),/设置／找回密码/);
  assert.match(UI.errorText({code:'auth_rate_limited'}),/限额/);
  assert.match(UI.errorText({code:'auth_callback_failed'}),/邮件链接已使用或过期/);
  assert.equal(UI.errorText({message:'synthetic secret'}).includes('synthetic secret'),false);
  assert.equal(fs.readFileSync(require('node:path').join(__dirname,'../../web/pactfit-local-api.js'),'utf8'),fs.readFileSync(require('node:path').join(__dirname,'../client/pactfit-local-api.js'),'utf8'));
  console.log('PASS password auth: signup, repeat login, recovery/update, confirmation, rate limits, stale sessions, credential handling');
})().catch(e=>{console.error(e);process.exitCode=1;});
