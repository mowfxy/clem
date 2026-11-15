// A command that changes the server, from Telegram with the laptop off (docs/GUC-VPS-ENGINE.md "VPS"): Clem asks once,
// in one plain message with the exact command; "yes" runs it on the server and reports what it printed; anything else
// drops it. Read-only commands run without asking. The worker runs in-process; its shell is this machine's `sh`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion, dangers, isYes } from "../core/vps/ask.ts";
import { classifyCommand } from "../core/vps/commands.ts";
import { baseDesk, startPair } from "./vps-pair.ts";

const req = (o: object) => JSON.stringify({ kinetra: o });

test("yes, and only a plain yes, answers the question", () => {
  for (const y of ["yes", "Yes!", "ok", "go ahead", "do it", "yes please", "Yep."]) assert.ok(isYes(y), y);
  for (const n of ["no", "yes but first check the disk", "what will it do?", "not now", ""]) assert.ok(!isYes(n), n);
});

test("the question says exactly what will run, and plainly what could go wrong for Clem or the way in", () => {
  const install = askQuestion({ kind: "run", command: "sudo apt-get install -y htop", reason: classifyCommand("sudo apt-get install -y htop").reason, at: 0 });
  assert.match(install, /sudo apt-get install -y htop/);
  assert.match(install, /runs as the administrator/);
  assert.match(install, /Say yes to run it\.$/);
  assert.match(dangers("rm -rf ~/clem/owner-1/files").join(" "), /deletes Clem's own data/);
  assert.match(dangers("docker compose down -v").join(" "), /deletes Clem's own data/);
  assert.match(dangers("sudo systemctl restart sshd").join(" "), /lock you \(and Clem\) out/);
  assert.match(dangers("sudo reboot").join(" "), /unreachable/);
  assert.deepEqual(dangers("sudo systemctl restart nginx"), []);
  assert.match(askQuestion({ kind: "write", path: "/etc/motd", content: "hi", at: 0 }), /replace this file on your VPS: \/etc\/motd/);
});

test("on Telegram, a server change is asked once in words; yes runs it and reports the output; anything else drops it", { timeout: 120_000 }, async () => {
  const asked: string[] = [];
  const p = await startPair({
    complete: async ({ user }) => {
      asked.push(user);
      const said = /\[From Telegram\] (.*)$/.exec(user)?.[1] || "";
      if (/Tool exchanges/.test(user)) return /"asked":true/.test(user) ? "That needs installing." : "Here's what it says.";
      if (/^install htop/.test(said)) return req({ action: "vps.run_command", command: "sh -c 'echo installed htop'" });
      if (/^clean up the disk/.test(said)) return req({ action: "vps.run_command", command: "sh -c 'echo freed 2 GB'" });
      if (/^say hello/.test(said)) return req({ action: "vps.run_command", command: "echo hello from the server" });
      return "Okay.";
    },
  });
  try {
    await p.m.pushWorkspace(true, baseDesk());
    // A read-only command runs at once, no question.
    const hello = await p.worker.host.converse!({ id: "1", text: "say hello from my vps" });
    assert.doesNotMatch(hello.text, /Say yes/);
    assert.match(asked.at(-1)!, /hello from the server/, "it ran and the model saw its output");

    // A change: one plain message with the exact command, asked once.
    const q = await p.worker.host.converse!({ id: "2", text: "install htop on my vps" });
    assert.match(q.text, /^That needs installing\.\n\nTo do that I'll run this on your VPS/);
    assert.match(q.text, /sh -c 'echo installed htop'/);
    assert.equal((q.text.match(/Say yes/g) || []).length, 1, "asked once");
    const calls = asked.length;
    // "yes" runs it: the output is the answer, with no model call in between.
    const done = await p.worker.host.converse!({ id: "3", text: "yes" });
    assert.match(done.text, /^Done\.\n\n```\ninstalled htop\n```$/);
    assert.equal(asked.length, calls, "the yes ran the command itself");
    // A second yes runs nothing: the question was answered.
    await p.worker.host.converse!({ id: "4", text: "yes" });
    assert.equal(asked.length, calls + 1, "a later yes is an ordinary message");

    // Anything else drops it, and a later yes doesn't run it.
    await p.worker.host.converse!({ id: "5", text: "clean up the disk on my vps" });
    await p.worker.host.converse!({ id: "6", text: "actually, not now" });
    const after = await p.worker.host.converse!({ id: "7", text: "yes" });
    assert.doesNotMatch(after.text, /freed 2 GB/);

    // The main thread shows the exchange (the window sees it when it opens).
    const main = (await p.worker.ws.state())!.chats.find((c: any) => c.kind === "main")!;
    assert.ok(main.messages.some((m: any) => m.role === "assistant" && /installed htop/.test(m.content)));
  } finally { await p.stop(); }
});
