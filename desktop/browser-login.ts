import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

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
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
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
        '<!doctype html><html><title>Signed in — Mowr</title><body style="margin:0;padding:24px;box-sizing:border-box;background:#141414;color:#eeece4;font:14px/1.6 system-ui;display:grid;place-content:center;min-height:100vh;text-align:center"><div style="margin:0 auto 20px;width:44px;height:44px;border:1px solid #42423c;border-radius:50%;display:grid;place-items:center;font-size:22px">&#10003;</div><h1 style="font:400 30px Georgia;margin:0 0 12px">You’re signed in.</h1><p style="color:#a3a39a;margin:0">Return to Mowr to continue.<br>You can close this tab.</p></body></html>',
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
