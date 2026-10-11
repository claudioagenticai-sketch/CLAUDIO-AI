// /relay/oauth/callback — a stateless bounce back to the user's own machine, for networks whose developer portals
// won't accept an http://127.0.0.1 redirect URI.
//
// The user registers https://useclaudio.xyz/relay/oauth/callback in THEIR OWN developer app. Claudio Local or the
// CLI starts the flow with state = "<random>.<port>" (its loopback port, 1024–65535). This page is the same static
// bytes for every request: the server never reads, stores or logs the query string. Inline JS reads code / state /
// error from the URL in the browser and sends them on to http://127.0.0.1:<port>/oauth/callback, keeping every
// query parameter exactly as the network sent it. It only ever targets 127.0.0.1. The code alone is useless: the
// user's client secret / PKCE verifier never leave their machine, and the local app does the token exchange itself.
//
// If the redirect can't happen (bad state) it refuses. If the local app isn't running, the person can come Back to
// this page, which then shows the code to copy instead of bouncing again.
import type { Express } from "express";
import { createHash } from "crypto";

export const RELAY_OAUTH_PATH = "/relay/oauth/callback";

const STYLE = `
:root{color-scheme:dark;--bg:#120b10;--panel:#1b1118;--line:#34222e;--line2:#4a3141;--text:#f8ece8;--text2:#d6bfc7;--text3:#a48b96;--brand:#ff6fa5;--fill:#d63a76;--sell:#ff5a52}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:520px;margin:0 auto;padding:48px 16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px}
.brand img{width:36px;height:36px;border-radius:50%;object-fit:cover}
h1{font-size:24px;line-height:1.25;margin:28px 0 8px;letter-spacing:-.01em}
p{margin:8px 0;color:var(--text2)}
.card{margin-top:20px;border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:16px}
.muted{color:var(--text3);font-size:13px}
.err{color:var(--sell)}
code{display:block;margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--bg);border:1px solid var(--line);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;color:var(--text)}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
a.btn,button{appearance:none;display:inline-flex;align-items:center;height:40px;padding:0 14px;border-radius:10px;font:600 14px/1 inherit;font-family:inherit;cursor:pointer;text-decoration:none}
a.btn{background:var(--fill);color:#fff;border:1px solid var(--fill)}
button{background:transparent;color:var(--text2);border:1px solid var(--line2)}
button:hover{color:var(--text)}
.mt{margin-top:14px}
.foot{margin-top:32px}
.foot a{color:inherit}
[hidden]{display:none!important}
`.trim();

const SCRIPT = `
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var search = location.search && location.search.length > 1 ? location.search.slice(1) : "";
  var hash = location.hash && location.hash.length > 1 ? location.hash.slice(1) : "";
  var query = search || hash;
  var params = new URLSearchParams(query);
  var state = params.get("state") || "";
  var code = params.get("code") || "";
  var error = params.get("error") || "";
  var errorText = params.get("error_description") || "";

  var m = /^[A-Za-z0-9._~-]{1,1024}$/.test(state) ? /\\.([1-9][0-9]{3,4})$/.exec(state) : null;
  var port = m ? Number(m[1]) : 0;
  var target = null;
  if (port >= 1024 && port <= 65535) {
    try {
      var u = new URL("http://127.0.0.1:" + port + "/oauth/callback");
      u.search = query;
      if (u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port === String(port) && u.pathname === "/oauth/callback") target = u.href;
    } catch (e) { target = null; }
  }

  if (!target) {
    $("working").hidden = true;
    $("refused").hidden = false;
    return;
  }

  $("again").href = target;
  if (error) {
    $("neterr").hidden = false;
    $("neterr").textContent = "The network said: " + error + (errorText ? " — " + errorText : "");
  }
  if (code) {
    $("code").textContent = code;
    $("codebox").hidden = false;
  }
  $("port").textContent = String(port);

  var showFallback = function () {
    $("fallback").hidden = false;
  };
  var nav = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || null;
  var cameBack = nav && nav.type === "back_forward";
  window.addEventListener("pageshow", function (ev) { if (ev.persisted) showFallback(); });
  $("copy").addEventListener("click", function () {
    var done = function () { $("copy").textContent = "Copied"; setTimeout(function () { $("copy").textContent = "Copy code"; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () {});
  });

  if (cameBack) { showFallback(); return; }
  setTimeout(showFallback, 2500);
  // After load, so the browser keeps this page in history: if the local app isn't running, Back returns here and
  // shows the code instead of bouncing again.
  var go = function () { setTimeout(function () { location.assign(target); }, 30); };
  if (document.readyState === "complete") go(); else window.addEventListener("load", go);
})();
`.trim();

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>Connecting · Claudio</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="brand"><img src="/claudio/face-128.webp" alt="" width="36" height="36">Claudio</div>
  <section id="working">
    <h1>Taking you back to Claudio on this computer…</h1>
    <p>This page passes the sign-in result straight to the Claudio app running on your own machine (port <b id="port"></b>). Nothing is stored here.</p>
    <p id="neterr" class="err" hidden></p>
    <div id="fallback" class="card" hidden>
      <p><b>Nothing happened?</b> Make sure Claudio Local or the Claudio CLI is still running on this computer, then try again.</p>
      <div class="row"><a id="again" class="btn" href="#">Try again</a></div>
      <div id="codebox" hidden>
        <p class="muted mt">Or paste this code into the app. It only works together with the secret that stays on your machine, and it expires in a few minutes.</p>
        <code id="code"></code>
        <div class="row"><button id="copy" type="button">Copy code</button></div>
      </div>
    </div>
  </section>
  <section id="refused" hidden>
    <h1>This sign-in link isn't valid</h1>
    <p>The link didn't say which app on your computer to return to, so nothing was sent anywhere. Start connecting again from Claudio Local or the Claudio CLI.</p>
  </section>
  <p class="muted foot">useclaudio.xyz · <a href="/privacy">Privacy</a> · <a href="/docs/socials">How this works</a></p>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;

const CSP = [
  "default-src 'none'",
  `script-src ${sha(SCRIPT)}`,
  `style-src ${sha(STYLE)}`,
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function registerRelayOAuthRoutes(app: Express): void {
  // GET only; HEAD comes for free. The handler never touches req.query / req.url, and the request logger skips
  // /relay/oauth (server/index.ts), so the code in the query string is never written anywhere on this server.
  app.get(RELAY_OAUTH_PATH, (_req, res) => {
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.status(200).send(HTML);
  });
}
