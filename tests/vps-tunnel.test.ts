// The SSH tunnel must never crash the app when the connection to the VPS has dropped: ssh2's forwardOut throws
// "Not connected" from inside a socket event, which used to surface as an uncaught exception in the main process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { EventEmitter } from "node:events";
import { SshLink } from "../desktop/engine/vps/link.ts";

class DeadClient extends EventEmitter {
  calls = 0;
  forwardOut() { this.calls++; throw new Error("Not connected"); }
}
const make = (client: EventEmitter) => new (SshLink as unknown as new (s: unknown, fp: string, first: boolean) => SshLink)({ client, end: async () => {} }, "fp", false);
const hit = (port: number) => new Promise<string>((resolve) => {
  const s = connect(port, "127.0.0.1");
  s.on("error", () => resolve("error")); s.on("close", () => resolve("closed"));
});

test("a request through the tunnel after the SSH connection dropped is refused, not a crash", async () => {
  const client = new DeadClient();
  const link = make(client);
  const crashes: unknown[] = [];
  const onCrash = (e: unknown) => crashes.push(e);
  process.on("uncaughtException", onCrash);
  try {
    const t = await link.tunnel(8787);
    assert.ok(["closed", "error"].includes(await hit(t.port)));
    assert.equal(client.calls, 1);
    assert.equal(link.closed, true, "a throw marks the link dead so the manager reconnects");
    // Later requests are refused without touching the dead client.
    await hit(t.port);
    assert.equal(client.calls, 1);
    t.close();
  } finally { process.off("uncaughtException", onCrash); }
  assert.deepEqual(crashes, []);
});

test("the link notices when the SSH connection closes", () => {
  const client = new DeadClient();
  const link = make(client);
  assert.equal(link.closed, false);
  client.emit("close");
  assert.equal(link.closed, true);
});
