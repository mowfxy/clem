import { _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = await mkdtemp(join(tmpdir(), "mowr-migration-test-")),
  profile = join(root, "profile"),
  fixture = join(root, "seed.cjs");
await writeFile(
  fixture,
  `const {app,BrowserWindow,safeStorage}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(${JSON.stringify(join(root, "encrypted.bin"))},safeStorage.encryptString('migration-fixture'));new BrowserWindow({show:false}).loadURL('about:blank');});`,
);
let seed, migrated;
try {
  seed = await electron.launch({
    args: [fixture, "--user-data-dir=" + profile],
  });
  await seed.firstWindow();
  await seed.close();
  seed = null;
  migrated = await electron.launch({
    executablePath: resolve("release/win-unpacked/Mowr.exe"),
    args: ["--user-data-dir=" + profile],
  });
  await migrated.firstWindow();
  const ciphertext = [...(await readFile(join(root, "encrypted.bin")))];
  const verified = await migrated.evaluate(
    ({ safeStorage }, bytes) =>
      safeStorage.decryptString(Buffer.from(bytes)) === "migration-fixture",
    ciphertext,
  );
  assert.equal(verified, true);
  console.log(
    "PASS encrypted Local State key survives Documents storage migration",
  );
} finally {
  await seed?.close();
  await migrated?.close();
  await rm(root, { recursive: true, force: true });
}
