// A command that changes the server, from Telegram with the laptop off (docs/GUC-VPS-ENGINE.md "VPS"): Clem asks once,
// in one plain message with the exact command; the model reads whether the person's answer says yes (in any words) and
// runs it with vps.approve, then tells what it printed; anything else drops it. No word list answers in the model's
// place. Read-only commands run without asking. The worker runs in-process; its shell is this machine's `sh`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion, dangers } from "../core/vps/ask.ts";
import { classifyCommand } from "../core/vps/commands.ts";
import { heldAsk } from "../desktop/engine/thread-tools.ts";
import { baseDesk, startPair } from "./vps-pair.ts";

const req = (o: object) => JSON.stringify({ kinetra: o });

test("a held question runs only through approve, exactly as asked, once; a new question is never dropped for an old one; a day later it lapses", async () => {
  let held: any = { kind: "run", command: "echo one", at: 1000 };
  const ran: string[] = [];
  let now = 2000;
  const asks = heldAsk({ get: async () => held, set: async (a) => { held = a; } }, async (a: any) => { ran.push(a.command); return { exitCode: 0, output: "one" }; }, () => now);
  const p = (await asks.pending())!;
  assert.match(p.question, /echo one/);
  assert.match(JSON.stringify(await asks.approve(p.at)), /"ran":"echo one".*"output":"one"/);
  assert.deepEqual(ran, ["echo one"]);
  assert.match(JSON.stringify(await asks.approve(p.at)), /Nothing is waiting/, "once");
  held = { kind: "run", command: "echo two", at: 3000 };
  await asks.drop(1000);
  assert.ok(held, "dropping the old question leaves a new one");
  assert.match(JSON.stringify(await asks.approve(1000)), /Nothing is waiting/, "an old stamp never runs a new question");
  await asks.drop(3000);
  assert.equal(held, undefined);
  held = { kind: "run", command: "echo three", at: 3000 };
  now = 3000 + 24 * 3_600_000;
  assert.equal(await asks.pending(), null, "lapsed");
  assert.match(JSON.stringify(await asks.approve(3000)), /Nothing is waiting/);
  assert.deepEqual(ran, ["echo one"]);
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

test("on Telegram, a server change is asked once in words; the model reads the yes, runs it and tells the output; anything else drops it", { timeout: 120_000 }, async () => {
  const asked: string[] = [];
  const p = await startPair({
    complete: async ({ user }) => {
      asked.push(user);
      const said = /\[From Telegram\] (.*)$/m.exec(user)?.[1] || "";
      if (/Tool exchanges/.test(user)) {
        if (/"asked":true/.test(user)) return "That needs installing.";
        const out = /"output":"([^"\\]*)/.exec(user)?.[1];
        return out ? `It ran and printed: ${out}` : "Here's what it says.";
      }
      // The model's own reading of the answer: a yes in any words.
      if (/A server change is waiting for their answer/.test(user) && /^(yes|go for it)/i.test(said)) return req({ action: "vps.approve" });
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
    // "go for it" (a yes no word list caught): the model reads it, runs the command and tells what it printed.
    const done = await p.worker.host.converse!({ id: "3", text: "go for it" });
    assert.match(asked.at(-2)!, /A server change is waiting for their answer[\s\S]*echo installed htop/, "the model knew what was waiting");
    assert.equal(done.text, "It ran and printed: installed htop");
    // A second yes runs nothing: the question was answered.
    const again = await p.worker.host.converse!({ id: "4", text: "yes" });
    assert.doesNotMatch(asked.at(-1)!, /A server change is waiting/);
    assert.doesNotMatch(again.text, /installed htop/);

    // Anything else drops it, and a later yes doesn't run it.
    await p.worker.host.converse!({ id: "5", text: "clean up the disk on my vps" });
    await p.worker.host.converse!({ id: "6", text: "actually, not now" });
    const after = await p.worker.host.converse!({ id: "7", text: "yes" });
    assert.doesNotMatch(after.text, /freed 2 GB/);
    assert.doesNotMatch(asked.at(-1)!, /A server change is waiting/, "the question lapsed with the other answer");

    // The main thread shows the exchange (the window sees it when it opens).
    const main = (await p.worker.ws.state())!.chats.find((c: any) => c.kind === "main")!;
    assert.ok(main.messages.some((m: any) => m.role === "assistant" && /installed htop/.test(m.content)));
  } finally { await p.stop(); }
});
