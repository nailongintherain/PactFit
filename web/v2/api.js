(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PF2Api = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function failure(code) {
    const e = new Error(code);
    e.code = code;
    return e;
  }
  function validate(config, hostname) {
    if (!config) throw failure("config_missing");
    if (config.mode === "local") {
      if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname))
        throw failure("local_only");
      for (const key of ["authUrl", "restUrl"]) {
        const u = new URL(config[key]);
        if (
          u.protocol !== "http:" ||
          !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
          u.username ||
          u.password ||
          u.search ||
          u.hash ||
          u.pathname !== "/"
        )
          throw failure("config_invalid");
      }
      return {
        authUrl: new URL(config.authUrl).origin,
        restUrl: new URL(config.restUrl).origin,
      };
    }
    if (config.mode !== "v2-preview") throw failure("config_invalid");
    const u = new URL(config.supabaseUrl);
    if (
      u.protocol !== "https:" ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.port ||
      u.pathname !== "/"
    )
      throw failure("config_invalid");
    if (u.hostname === "ksridewbjuwckuvougma.supabase.co")
      throw failure("existing_staging_forbidden");
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publicKey || ""))
      throw failure("public_key_required");
    const redirect = new URL(config.appOrigin);
    if (
      redirect.protocol !== "https:" ||
      redirect.username ||
      redirect.password ||
      redirect.search ||
      redirect.hash ||
      redirect.pathname !== "/"
    )
      throw failure("config_invalid");
    return {
      authUrl: u.origin + "/auth/v1",
      restUrl: u.origin + "/rest/v1",
      publicKey: config.publicKey,
      redirectUrl: redirect.href,
    };
  }
  function create(config, hostname, fetcher) {
    const c = validate(config, hostname);
    const f = fetcher || fetch;
    let session = null,
      generation = 0,
      refreshing = null;
    async function http(base, path, body, method = "POST", token) {
      const headers = { "Content-Type": "application/json" };
      if (c.publicKey) headers.apikey = c.publicKey;
      if (token) headers.Authorization = "Bearer " + token;
      const res = await f(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        referrerPolicy: "no-referrer",
      });
      let data;
      try {
        data = JSON.parse(await res.text());
      } catch (_) {
        data = null;
      }
      if (!res.ok) {
        let code = data && (data.error_code || data.code);
        if (
          code === "P0001" &&
          [
            "forbidden",
            "space_unavailable",
            "unauthenticated",
            "bootstrap_required",
          ].includes(data.message)
        )
          code = data.message;
        if (res.status === 429) code = "rate_limited";
        throw failure(typeof code === "string" ? code : "request_failed");
      }
      return data;
    }
    function establish(data) {
      if (!data || !data.access_token || !data.user || !data.user.id)
        throw failure("invalid_session");
      session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
        expires_at:
          data.expires_at ||
          Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      };
      generation++;
      return true;
    }
    async function readyToken() {
      if (!session) throw failure("unauthenticated");
      if (
        session.expires_at <= Date.now() / 1000 + 45 &&
        session.refresh_token
      ) {
        if (!refreshing) {
          const ep = generation;
          const refresh = session.refresh_token;
          const pending = http(c.authUrl, "/token?grant_type=refresh_token", {
            refresh_token: refresh,
          })
            .then((data) => {
              if (ep !== generation) throw failure("session_stale");
              establish(data);
            })
            .finally(() => {
              if (refreshing === pending) refreshing = null;
            });
          refreshing = pending;
        }
        await refreshing;
      }
      if (!session) throw failure("unauthenticated");
      return session.access_token;
    }
    function callbackUrl(path) {
      return (
        path +
        "?redirect_to=" +
        encodeURIComponent(c.redirectUrl || location.origin + "/v2/")
      );
    }
    return {
      validate: () => true,
      hasSession: () => !!session,
      email: () => (session && session.user.email) || "",
      async login(email, password, signup) {
        if (
          typeof email !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
          typeof password !== "string" ||
          !password.length ||
          (signup && password.length < 8)
        )
          throw failure("invalid_credentials_input");
        const ep = ++generation;
        const data = await http(
          c.authUrl,
          signup ? callbackUrl("/signup") : "/token?grant_type=password",
          { email: email.trim(), password },
        );
        if (ep !== generation) throw failure("session_stale");
        if (signup && !data?.access_token) {
          if (data?.id || data?.user?.id) return { confirmationRequired: true };
          throw failure("invalid_response");
        }
        establish(data);
        return { confirmationRequired: false };
      },
      async consumeCallback(hash) {
        const p = new URLSearchParams((hash || "").replace(/^#/, ""));
        if (p.has("error")) throw failure("expired_link");
        if (!p.get("access_token")) return false;
        const ep = generation,
          access = p.get("access_token");
        const user = await http(c.authUrl, "/user", undefined, "GET", access);
        if (ep !== generation) throw failure("session_stale");
        establish({
          access_token: access,
          refresh_token: p.get("refresh_token"),
          user,
        });
        return p.get("type") === "recovery" ? "recovery" : true;
      },
      async recover(email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw failure("invalid_credentials_input");
        await http(c.authUrl, callbackUrl("/recover"), { email });
      },
      async updatePassword(password) {
        if (
          typeof password !== "string" ||
          password.length < 8 ||
          password.length > 128
        )
          throw failure("weak_password");
        await http(c.authUrl, "/user", { password }, "PUT", await readyToken());
      },
      async updateEmail(email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw failure("invalid_credentials_input");
        const token = await readyToken();
        const ep = generation;
        const user = await http(c.authUrl, "/user", { email }, "PUT", token);
        if (ep !== generation || !session) throw failure("session_stale");
        if (!user?.id) throw failure("invalid_response");
        session.user = user;
        return user;
      },
      async logout() {
        const token = session && session.access_token;
        session = null;
        generation++;
        if (token) await http(c.authUrl, "/logout", undefined, "POST", token);
      },
      async command(action, args = {}) {
        const data = await http(
          c.restUrl,
          "/rpc/v2_command",
          { p_action: action, p_args: args },
          "POST",
          await readyToken(),
        );
        if (!data || data.ok !== true)
          throw failure((data && data.code) || "invalid_response");
        return data.data;
      },
      async snapshot(space) {
        return http(
          c.restUrl,
          "/rpc/v2_snapshot",
          { p_space: space || null },
          "POST",
          await readyToken(),
        );
      },
    };
  }
  return { create, validate };
});
