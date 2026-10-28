import { test } from "node:test";
import assert from "node:assert/strict";
import { orphanedAgents } from "../../desktop/agent-sweep.ts";

const root = String.raw`C:\Users\p\AppData\Roaming\clem-desktop\runtime\engines\antigravity`;
const agent = root + String.raw`\1.4.3\agy_acp_server.exe`, helper = root + String.raw`\1.4.3\localharness_external.exe`;

test("only agents from Clem's engines folder whose parent has gone are ended", () => {
  const processes = [
    { pid: 10, ppid: 1, path: "" }, // Clem
    { pid: 11, ppid: 10, path: agent }, // the launcher Clem started
    { pid: 12, ppid: 11, path: agent }, // the agent it started
    { pid: 13, ppid: 12, path: helper },
    { pid: 20, ppid: 999, path: agent }, // left by a Clem that closed
    { pid: 21, ppid: 20, path: helper },
    { pid: 30, ppid: 998, path: String.raw`C:\Other\antigravity\agy_acp_server.exe` }, // another program's copy
    { pid: 31, ppid: 997, path: "" }, // any other process whose parent has gone
    { pid: 40, ppid: 996, path: root + String.raw`-old\agy_acp_server.exe` }, // a folder that only starts like it
  ];
  assert.deepEqual(orphanedAgents(processes, root), [20]);
});

test("a helper whose agent has gone is ended too, and nothing is ended when every parent runs", () => {
  assert.deepEqual(orphanedAgents([{ pid: 5, ppid: 4, path: helper }], root), [5]);
  assert.deepEqual(orphanedAgents([{ pid: 4, ppid: 1, path: "" }, { pid: 5, ppid: 4, path: agent }], root), []);
});
