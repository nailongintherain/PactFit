/* Staging-only email/password UI. No persisted credentials; no OTP or WorkBuddy calls. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PactFitStagingAuth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function errorText(e) {
    var texts = {
      invalid_credentials: '邮箱或密码不正确。以前只点过邮件链接的账号，请先选择“设置／找回密码”。',
      email_not_confirmed: '邮箱尚未确认，请完成确认后再登录。若这是无需邮件确认的预生产测试，请检查 Supabase 的 Confirm email 设置。',
      user_already_exists: '该邮箱已注册，请选择登录；尚未设置密码请选择“设置／找回密码”。',
      signup_disabled: '当前项目未开放注册，请联系管理员。',
      weak_password: '密码强度不足，请使用至少 8 位的密码并符合项目密码规则。',
      same_password: '新密码不能与旧密码相同。',
      auth_rate_limited: 'Supabase 暂时限制了请求，请稍后再试。邮件操作还受发信限额影响，重复点击不会解除限制。',
      auth_callback_failed: '邮件链接已使用或过期。请使用邮箱和密码登录；尚未设置密码请选择“设置／找回密码”。',
      unauthenticated: '设置密码的会话已失效，请重新打开有效的密码重置链接。',
      auth_response_invalid: '服务器没有确认本次认证操作，请稍后重试。',
      session_stale: '登录状态已变更，请重新登录。',
      data_load_failed: '登录成功，但暂时无法读取空间和记录。请稍后重新登录；本次读取失败不会删除已保存数据。'
    };
    return texts[e && e.code] || '请求未完成，请检查网络后重试。';
  }

  function mount(opt) {
    var root = opt.root, auth = opt.auth;
    root.innerHTML = '<form data-auth-form novalidate>' +
      '<h2 data-title style="font-size:20px;margin:0 0 12px">邮箱登录</h2>' +
      '<p data-help class="tip" style="margin-bottom:14px"></p>' +
      '<div class="field" data-email-field><label for="staging-email">邮箱</label>' +
      '<input id="staging-email" class="input" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
      '<div class="field" data-password-field><label for="staging-password">密码</label>' +
      '<input id="staging-password" class="input" type="password" autocomplete="current-password" maxlength="128" required></div>' +
      '<div class="field hidden" data-confirm-field><label for="staging-password-confirm">确认密码</label>' +
      '<input id="staging-password-confirm" class="input" type="password" autocomplete="new-password" maxlength="128"></div>' +
      '<button class="btn" type="submit" data-submit>登录</button>' +
      '<div class="err-msg" data-message role="status" aria-live="polite"></div>' +
      '<button type="button" class="back-link" data-switch>没有账号？注册</button>' +
      '<button type="button" class="back-link" data-recover>设置／找回密码</button>' +
      '</form>';
    var q = function (s) { return root.querySelector(s); };
    var email = q('#staging-email'), password = q('#staging-password'), confirm = q('#staging-password-confirm');
    var mode = 'signin', busy = false, generation = 0;
    function clearSecrets() { password.value = ''; confirm.value = ''; }
    function setBusy(value) {
      busy = value;
      root.querySelectorAll('button, input').forEach(function (node) { node.disabled = value; });
      q('[data-submit]').textContent = value ? '处理中…' : ({ signin: '登录', signup: '注册', recover: '发送设置密码邮件', reset: '保存新密码' })[mode];
    }
    function setMode(next) {
      generation++;
      mode = next;
      clearSecrets();
      q('[data-message]').textContent = '';
      q('[data-title]').textContent = ({ signin: '邮箱登录', signup: '注册账号', recover: '设置／找回密码', reset: '设置新密码' })[mode];
      q('[data-help]').textContent = ({
        signin: '使用邮箱和密码登录，不需要验证码或登录邮件。',
        signup: '设置至少 8 位的密码。注册是否需要邮件确认由当前预生产项目设置决定。',
        recover: '以前通过邮件链接注册但没有密码的账号，也可在这里设置密码。此操作需要接收一封邮件。',
        reset: '请输入新密码，保存后即可使用邮箱和密码再次登录。'
      })[mode];
      q('[data-email-field]').classList.toggle('hidden', mode === 'reset');
      q('[data-password-field]').classList.toggle('hidden', mode === 'recover');
      q('[data-confirm-field]').classList.toggle('hidden', mode !== 'signup' && mode !== 'reset');
      password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
      q('[data-switch]').textContent = mode === 'signin' ? '没有账号？注册' : (mode === 'reset' ? '取消并退出' : '返回登录');
      q('[data-recover]').classList.toggle('hidden', mode !== 'signin');
      setBusy(false);
    }
    q('[data-switch]').onclick = async function () {
      if (busy) return;
      if (mode === 'reset') {
        setBusy(true);
        try { await auth.signOut(); } finally { setMode('signin'); }
      } else setMode(mode === 'signin' ? 'signup' : 'signin');
    };
    q('[data-recover]').onclick = function () { if (!busy) setMode('recover'); };
    q('[data-auth-form]').onsubmit = async function (event) {
      event.preventDefault();
      if (busy) return;
      var message = q('[data-message]');
      message.textContent = '';
      if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        message.textContent = '请输入正确的邮箱地址。'; return;
      }
      if (mode !== 'recover') {
        if (!password.value || password.value.length > 128 || (mode !== 'signin' && password.value.length < 8)) {
          message.textContent = mode === 'signin' ? '请输入密码。' : '密码须为 8–128 位。'; return;
        }
        if ((mode === 'signup' || mode === 'reset') && password.value !== confirm.value) {
          message.textContent = '两次输入的密码不一致。'; return;
        }
      }
      var ep = generation;
      setBusy(true);
      try {
        if (mode === 'recover') {
          await auth.requestPasswordRecovery(email.value.trim());
          if (ep !== generation) return;
          message.textContent = '如果该邮箱可接收重置邮件，将收到设置密码链接。请检查邮箱和垃圾邮件；旧链接不能重复使用。';
          return;
        }
        if (mode === 'reset') await auth.updatePassword(password.value);
        else {
          var result = mode === 'signup'
            ? await auth.signUpWithPassword(email.value.trim(), password.value)
            : await auth.signInWithPassword(email.value.trim(), password.value);
          if (ep !== generation) return;
          if (result.data.confirmationRequired) {
            setMode('signin');
            q('[data-message]').textContent = '注册请求已受理，项目仍要求邮箱确认。请确认邮件后用密码登录；已有账号请直接登录或设置密码。';
            return;
          }
        }
        if (ep !== generation) return;
        clearSecrets();
        await opt.onLogin();
      } catch (e) {
        if (ep === generation) { clearSecrets(); message.textContent = errorText(e); }
      } finally {
        if (ep === generation) setBusy(false);
      }
    };
    setMode('signin');
    return {
      reset: function () { email.value = ''; setMode('signin'); },
      showRecovery: function () { setMode('reset'); },
      showError: function (e) { setMode('signin'); q('[data-message]').textContent = errorText(e); }
    };
  }
  return { mount: mount, errorText: errorText };
});
