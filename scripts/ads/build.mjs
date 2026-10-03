// Captures and renders every short ad, one at a time (the fixture uses a fixed port).
import { execFileSync } from "node:child_process";
import { ADS } from "./ads.mjs";

for (const ad of Object.keys(ADS)) {
  execFileSync(process.execPath, ["scripts/ads/capture.mjs", ad], { stdio: "inherit" });
  execFileSync(process.execPath, ["scripts/ads/render.mjs", ad], { stdio: "inherit" });
}
