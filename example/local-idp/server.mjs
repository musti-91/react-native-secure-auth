// Local OpenID Connect provider for testing the example app. DEVELOPMENT ONLY:
// plain HTTP, in-memory storage, any username/password is accepted.
//
//   npm install && npm start
//   Android emulator/device: adb reverse tcp:3000 tcp:3000  (so the device reaches localhost)
//   iOS simulator: works as is.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import http from 'node:http';
import Provider from 'oidc-provider';

const PORT = Number(process.env.PORT || 3000);
const ISSUER = process.env.ISSUER || `http://localhost:${PORT}`;
const ACCESS_TOKEN_TTL = Number(process.env.ACCESS_TOKEN_TTL || 120); // short, to exercise refresh
const REDIRECT_URIS = (
  process.env.REDIRECT_URIS ||
  'com.rnappauthexample://login/callback,com.rnappauthexample://login'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Fresh signing key per run. Tokens from a previous run are invalid after a restart.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingKey = {
  ...privateKey.export({ format: 'jwk' }),
  kid: randomUUID(),
  use: 'sig',
  alg: 'RS256',
};

/** Headers of the latest /auth request, shown on the login page (checks customHeaders / userAgent). */
let lastAuthorizeHeaders = {};

const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

const configuration = {
  clients: [
    {
      // Matches example/localIdp.ts (clientAuthMethod: 'post').
      client_id: 'example-app',
      client_secret: 'local-test-secret', // dummy, local only
      token_endpoint_auth_method: 'client_secret_post',
      application_type: 'native',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: REDIRECT_URIS,
      post_logout_redirect_uris: REDIRECT_URIS,
    },
    {
      // Public client: PKCE only, no secret.
      client_id: 'example-public',
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: REDIRECT_URIS,
      post_logout_redirect_uris: REDIRECT_URIS,
    },
  ],
  jwks: { keys: [signingKey] },
  cookies: { keys: ['local-idp-development-only'] },
  pkce: { required: () => true },
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  claims: {
    openid: ['sub'],
    profile: ['name', 'preferred_username'],
    email: ['email', 'email_verified'],
  },
  features: {
    devInteractions: { enabled: false }, // we render our own pages below
    revocation: { enabled: true },
    introspection: { enabled: true },
    userinfo: { enabled: true },
    rpInitiatedLogout: {
      enabled: true,
      logoutSource: async (ctx, form) => {
        ctx.type = 'html';
        ctx.body = page(
          'Sign out',
          `${form}
           <p>End the session at the local IdP?</p>
           <button form="op.logoutForm" name="logout" value="yes" class="primary">Yes, sign out</button>
           <button form="op.logoutForm" class="secondary">No, stay signed in</button>`,
        );
      },
      postLogoutSuccessSource: async ctx => {
        ctx.type = 'html';
        ctx.body = page(
          'Signed out',
          '<p>You are signed out. You can close this window.</p>',
        );
      },
    },
  },
  // Always issue a refresh token (no offline_access / consent prompt needed), so refresh() can be tested.
  issueRefreshToken: async (ctx, client) =>
    client.grantTypeAllowed('refresh_token'),
  ttl: {
    AccessToken: ACCESS_TOKEN_TTL,
    IdToken: 3600,
    RefreshToken: 24 * 3600,
    Interaction: 600,
    Session: 24 * 3600,
    Grant: 24 * 3600,
  },
  interactions: {
    url: (ctx, interaction) => `/interaction/${interaction.uid}`,
  },
  findAccount: async (ctx, id) => ({
    accountId: id,
    claims: async () => ({
      sub: id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      preferred_username: id,
      email: `${id}@local.test`,
      email_verified: true,
    }),
  }),
  renderError: async (ctx, out) => {
    ctx.type = 'html';
    ctx.body = page('Error', `<pre>${esc(JSON.stringify(out, null, 2))}</pre>`);
  },
};

const provider = new Provider(ISSUER, configuration);
provider.on('server_error', (ctx, error) =>
  console.error('[idp] server_error', error),
);
provider.on('grant.error', (ctx, error) =>
  console.error(
    '[idp] grant.error',
    error.message,
    error.error_description || '',
  ),
);
provider.on('authorization.error', (ctx, error) =>
  console.error(
    '[idp] authorization.error',
    error.message,
    error.error_description || '',
  ),
);

// ---- Pages -----------------------------------------------------------------------------------

function page(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Local IdP</title>
<style>
  :root { color-scheme: light dark; --bg:#f8fafc; --fg:#0f172a; --muted:#64748b; --card:#fff; --line:#e2e8f0; --accent:#1e3a8a; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b1120; --fg:#e2e8f0; --muted:#94a3b8; --card:#111827; --line:#1f2937; --accent:#60a5fa; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; font:15px/1.45 -apple-system,system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  h1 { font-size:20px; margin:0 0 4px; } .muted { color:var(--muted); font-size:13px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; margin-top:12px; }
  label { display:block; font-size:13px; color:var(--muted); margin-top:8px; }
  input { width:100%; padding:10px; border-radius:8px; border:1px solid var(--line); background:transparent; color:inherit; font-size:16px; }
  button, .btn { display:block; width:100%; margin-top:10px; padding:12px; border-radius:10px; border:0; font-size:15px; font-weight:600; text-align:center; text-decoration:none; cursor:pointer; }
  .primary { background:var(--accent); color:#fff; } .secondary { background:transparent; color:var(--accent); border:1px solid var(--line); }
  pre, code { font:12px/1.4 ui-monospace,Menlo,monospace; white-space:pre-wrap; word-break:break-all; }
  .ok { color:#16a34a; } .warn { color:#d97706; }
</style></head>
<body><h1>${esc(title)}</h1><div class="muted">Local test IdP · ${esc(ISSUER)}</div>${body}</body></html>`;
}

function loginPage(uid, details) {
  const { params, prompt } = details;
  const redirectScheme = (() => {
    try {
      return new URL(params.redirect_uri).protocol.replace(':', '');
    } catch {
      return 'com.rnappauthexample';
    }
  })();
  const deepLink = `${redirectScheme}://auth?code=demo-${Date.now()}&state=from-page`;
  const headers = Object.entries(lastAuthorizeHeaders)
    .filter(
      ([k]) =>
        ![
          'host',
          'connection',
          'accept',
          'accept-encoding',
          'accept-language',
          'cookie',
          'upgrade-insecure-requests',
          'sec-fetch-site',
          'sec-fetch-mode',
          'sec-fetch-dest',
          'sec-fetch-user',
          'priority',
        ].includes(k),
    )
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  return page(
    'Sign in',
    `
<div class="card">
  <div><b>Client</b> <code>${esc(params.client_id)}</code></div>
  <div><b>Scopes</b> <code>${esc(params.scope)}</code></div>
  <div><b>Prompt</b> <code>${esc(prompt.name)}</code>${params.prompt ? ` · requested <code>${esc(params.prompt)}</code>` : ''}</div>
  <div id="embed" class="warn">Detecting app bridge…</div>
</div>

<form class="card" method="post" action="/interaction/${esc(uid)}/login" autocomplete="off">
  <label for="username">Username (any; becomes the <code>sub</code>)</label>
  <input id="username" name="username" value="${esc(params.login_hint || 'alice')}" autocapitalize="off" required>
  <label for="password">Password (anything)</label>
  <input id="password" name="password" type="password" value="password">
  <button type="submit" class="primary">Sign in</button>
  <a class="btn secondary" href="/interaction/${esc(uid)}/abort">Cancel (access_denied)</a>
</form>

<div class="card" id="bridge-tools" hidden>
  <b>App bridge</b>
  <button type="button" class="secondary" onclick="send({ type: 'ready', from: 'local-idp' })">Send "ready" to app</button>
  <button type="button" class="secondary" onclick="send({ type: 'close' })">Send "close" to app</button>
  <a class="btn secondary" href="${esc(deepLink)}">Navigate to deep link <code>${esc(redirectScheme)}://auth?code=…</code></a>
  <a class="btn secondary" href="https://example.org/">Open a host outside webViewAllowedHosts</a>
</div>

<div class="card"><b>Messages from the app</b><pre id="inbox">none yet</pre></div>
<div class="card"><b>Headers on the authorize request</b><pre>${esc(headers || '(none)')}</pre></div>

<script>
  var bridge = null, inbox = [];
  function findBridge() {
    var names = Object.keys(window);
    for (var i = 0; i < names.length; i++) {
      try { var o = window[names[i]]; if (o && o.__installed && o.isEmbedded) return { name: names[i], api: o }; } catch (e) {}
    }
    return null;
  }
  function send(msg) {
    var target = (bridge && bridge.api) || window.ReactNativeWebView;
    if (!target) { alert('No app bridge on this page'); return; }
    target.postMessage(JSON.stringify(msg));
  }
  function show(entry) {
    inbox.unshift(entry);
    document.getElementById('inbox').textContent = inbox.slice(0, 20).join('\\n');
  }
  window.addEventListener('message', function (event) {
    var data = event.data, msg = data;
    try { msg = JSON.parse(data); } catch (e) {}
    show(new Date().toLocaleTimeString() + '  ' + (typeof data === 'string' ? data : JSON.stringify(data)));
    if (msg && msg.type === 'prefill' && msg.loginHint) document.getElementById('username').value = msg.loginHint;
    if (msg && msg.type === 'deeplink') show('  ↳ deep link received, code=' + (msg.code || '-') + ' state=' + (msg.state || '-'));
  });
  var tries = 0;
  (function detect() {
    bridge = findBridge();
    var el = document.getElementById('embed');
    if (bridge) {
      el.className = 'ok';
      el.textContent = 'Embedded: window.' + bridge.name + ' (platform ' + bridge.api.platform + ')';
      document.getElementById('bridge-tools').hidden = false;
      send({ type: 'ready', from: 'local-idp' });
    } else if (tries++ < 25) {
      setTimeout(detect, 200);
    } else {
      el.textContent = 'Not embedded (system browser, SFSafariViewController or Custom Tab without a channel)';
    }
  })();
</script>`,
  );
}

// ---- Interaction routes (login + auto consent) -------------------------------------------------

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Object.fromEntries(
    new URLSearchParams(Buffer.concat(chunks).toString('utf8')),
  );
}

async function handleInteraction(req, res, url) {
  const [, , uid, action] = url.pathname.split('/');
  const details = await provider.interactionDetails(req, res);
  if (details.uid !== uid) throw new Error('interaction mismatch');

  if (req.method === 'GET' && !action) {
    if (details.prompt.name === 'login') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(loginPage(uid, details));
      return;
    }
    if (details.prompt.name === 'consent') {
      // Auto-approve everything that was requested.
      const { params, session, prompt } = details;
      const grant = details.grantId
        ? await provider.Grant.find(details.grantId)
        : new provider.Grant({
            accountId: session.accountId,
            clientId: params.client_id,
          });
      if (prompt.details.missingOIDCScope)
        grant.addOIDCScope(prompt.details.missingOIDCScope.join(' '));
      if (prompt.details.missingOIDCClaims)
        grant.addOIDCClaims(prompt.details.missingOIDCClaims);
      for (const [indicator, scopes] of Object.entries(
        prompt.details.missingResourceScopes || {},
      )) {
        grant.addResourceScope(indicator, scopes.join(' '));
      }
      const grantId = await grant.save();
      await provider.interactionFinished(
        req,
        res,
        { consent: details.grantId ? {} : { grantId } },
        { mergeWithLastSubmission: true },
      );
      return;
    }
  }
  if (req.method === 'POST' && action === 'login') {
    const { username } = await readForm(req);
    const accountId =
      String(username || 'alice')
        .trim()
        .toLowerCase() || 'alice';
    console.log(`[idp] login as "${accountId}"`);
    await provider.interactionFinished(
      req,
      res,
      { login: { accountId } },
      { mergeWithLastSubmission: false },
    );
    return;
  }
  if (req.method === 'GET' && action === 'abort') {
    await provider.interactionFinished(
      req,
      res,
      {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      },
      { mergeWithLastSubmission: false },
    );
    return;
  }
  res.writeHead(404).end();
}

// ---- Server ------------------------------------------------------------------------------------

const oidc = provider.callback();

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, ISSUER);
    const ua = String(req.headers['user-agent'] || '').slice(0, 60);
    console.log(
      `[idp] ${req.method} ${url.pathname}${url.pathname === '/auth' ? `  client=${url.searchParams.get('client_id')} prompt=${url.searchParams.get('prompt') || '-'}` : ''}  ua="${ua}"`,
    );
    try {
      if (url.pathname === '/auth') lastAuthorizeHeaders = req.headers;
      if (url.pathname.startsWith('/interaction/')) {
        await handleInteraction(req, res, url);
        return;
      }
      oidc(req, res);
    } catch (error) {
      console.error('[idp]', error);
      if (!res.headersSent)
        res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        page(
          'Error',
          `<pre>${esc(error.message)}</pre><p class="muted">The interaction may have expired. Start the login again from the app.</p>`,
        ),
      );
    }
  })
  .listen(PORT, () => {
    console.log(`
Local IdP running at ${ISSUER}
  Discovery    ${ISSUER}/.well-known/openid-configuration
  Clients      example-app (secret "local-test-secret", client_secret_post), example-public (PKCE only)
  Redirects    ${REDIRECT_URIS.join(', ')}
  Access TTL   ${ACCESS_TOKEN_TTL}s

Android: run "adb reverse tcp:${PORT} tcp:${PORT}" so the emulator/device can reach localhost.
`);
  });
