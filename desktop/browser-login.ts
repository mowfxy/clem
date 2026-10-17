import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { brandFontFaces } from "./brand-fonts.ts";

/** A short-lived, single-use loopback receiver. Credentials never enter the renderer. */
export async function browserLogin(
  accept: (tokens: {
    access_token: string;
    refresh_token: string;
  }) => Promise<void>,
  completed: () => void,
) {
  const path = "/signin/" + randomBytes(32).toString("hex");
  let used = false;
  let active = true;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'none'",
    );
    if (req.url !== path) {
      res.writeHead(404).end("Not found.");
      return;
    }
    if (
      req.url !== path ||
      req.method !== "POST" ||
      !["https://mowrai.com", "null"].includes(req.headers.origin || "") ||
      used ||
      !active
    ) {
      res
        .writeHead(403)
        .end("Sign-in request expired. Open Mowr and try again.");
      return;
    }
    if (
      !req.headers["content-type"]?.startsWith(
        "application/x-www-form-urlencoded",
      )
    ) {
      res.writeHead(415).end();
      return;
    }
    used = true;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 24000) throw Error("Too large");
      }
      const fields = new URLSearchParams(body);
      const access_token = fields.get("access_token"),
        refresh_token = fields.get("refresh_token");
      // The unguessable callback is a capability; opaque browser origins also
      // prove possession in the POST body. Never accept absent/foreign origins.
      if (
        req.headers.origin === "null" &&
        fields.get("state") !== path.split("/").at(-1)
      )
        throw Error("Invalid return state");
      if (!access_token || !refresh_token) throw Error("Missing session");
      if (!active) throw Error("Expired");
      await accept({ access_token, refresh_token });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed in — Mowr</title><style>' + brandFontFaces() + 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121211;color:#f0efeb;font:15px/1.6 "Mowafy Sans",system-ui,sans-serif;overflow:hidden}.g{position:fixed;inset:-20% -10% auto;height:80%;background:radial-gradient(40% 45% at 50% 30%,#f0efeb0d,transparent 70%);pointer-events:none}main{position:relative;text-align:center;padding:24px}main>*{animation:r .7s cubic-bezier(.2,.8,.2,1) both}main>:nth-child(2){animation-delay:.1s}main>:nth-child(3){animation-delay:.2s}main>:nth-child(4){animation-delay:.3s}.m{width:64px;height:64px;margin:0 auto 22px;fill:none;stroke:#b56c4b;stroke-width:14.5;stroke-linecap:round;overflow:visible}.m g{transform-origin:72px 72px;animation:p 3.6s cubic-bezier(.4,0,.2,1) infinite}.m g:nth-child(2){animation-delay:.1s}.m g:nth-child(3){animation-delay:.2s}h1{font:400 34px/1.15 "Mowafy Serif",Georgia,serif;letter-spacing:-.02em;margin:0 0 10px;display:flex;align-items:center;justify-content:center;gap:12px}.c{width:28px;height:28px;fill:none;stroke:#f0efeb;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.c circle{stroke:#f0efeb;fill:#63635e;fill-opacity:.35;stroke-dasharray:76;stroke-dashoffset:76;animation:d .7s .3s forwards}.c path{stroke-dasharray:20;stroke-dashoffset:20;animation:d .45s .8s forwards}p{color:#a3a3a0;margin:0}small{display:block;margin-top:26px;color:#6f6e68;font-size:12.5px}@keyframes r{from{opacity:0;transform:translateY(12px)}}@keyframes d{to{stroke-dashoffset:0}}@keyframes p{0%,12%,100%{transform:scale(1)}40%,54%{transform:scale(.72) rotate(12deg)}}@media (prefers-reduced-motion:reduce){main>*,.m g{animation:none}.c circle,.c path{animation:none;stroke-dashoffset:0}}</style></head><body><div class="g"></div><main><svg class="m" viewBox="8.5 4.5 122 122" aria-hidden="true"><g><path transform="rotate(0 72 72)" d="M62 87C60.6 83 55.2 70.5 53.5 63C51.8 55.5 51.1 48.2 52 42C52.9 35.8 55.3 30 59 26C62.7 22 69.2 18.8 74 18C78.8 17.2 84.5 19 88 21C91.5 23 93.7 26.7 95 30C96.3 33.3 95.8 39.2 96 41"/></g><g><path transform="rotate(120 72 72)" d="M62 87C60.6 83 55.2 70.5 53.5 63C51.8 55.5 51.1 48.2 52 42C52.9 35.8 55.3 30 59 26C62.7 22 69.2 18.8 74 18C78.8 17.2 84.5 19 88 21C91.5 23 93.7 26.7 95 30C96.3 33.3 95.8 39.2 96 41"/></g><g><path transform="rotate(240 72 72)" d="M62 87C60.6 83 55.2 70.5 53.5 63C51.8 55.5 51.1 48.2 52 42C52.9 35.8 55.3 30 59 26C62.7 22 69.2 18.8 74 18C78.8 17.2 84.5 19 88 21C91.5 23 93.7 26.7 95 30C96.3 33.3 95.8 39.2 96 41"/></g></svg><h1><svg class="c" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12"/><path d="M8.5 14.5l3.5 3.5 7.5-8"/></svg>You’re signed in.</h1><p>Return to Mowr to continue.</p><small>You can close this tab.</small></main></body></html>',
      );
      completed();
    } catch {
      res
        .writeHead(400)
        .end("Could not sign in. Return to Mowr and try again.");
    } finally {
      stop();
    }
  });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const timer = setTimeout(() => stop(), 5 * 60 * 1000);
  timer.unref();
  function stop() {
    active = false;
    clearTimeout(timer);
    server.close();
  }
  return {
    url: `https://mowrai.com/#/desktop-signin?callback=${encodeURIComponent(`http://127.0.0.1:${port}${path}`)}`,
    stop,
  };
}
