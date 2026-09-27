// Microsoft Store build: an MSIX package that the Store signs. The website .exe keeps using electron-builder.cjs.
// Build with `npm run desktop:store`; the upload lands in release-store/.
const { readFileSync, writeFileSync } = require("node:fs");
const base = require("./electron-builder.cjs");

// Product identity from Partner Center (Product management > Product identity). Copy these exactly.
const identity = {
  name: "MohamedMowafy.Mowr",
  publisher: "CN=51F1E357-5A17-4C1A-9BD4-3A0AB1A520B4",
  publisherDisplayName: "Mohamed Mowafy",
};
// The Store needs four numeric parts with the last one 0, and each new submission must be higher than the last.
const storeVersion = process.env.MOWR_STORE_VERSION || "1.0.0.0";

// No signing here: the Store signs the package after certification (scripts/store-test-sign.ps1 signs a local test copy).
const { nsis, forceCodeSigning, ...shared } = base;
module.exports = {
  ...shared,
  directories: { ...base.directories, output: process.env.MOWR_RELEASE_DIR || "release-store" },
  win: {
    icon: base.win.icon,
    target: [{ target: "appx", arch: ["x64"] }],
    // makeappx writes the same MSIX format whatever the extension; .msix is what Partner Center expects to see.
    artifactName: "Mowr-Store-" + storeVersion + ".msix",
  },
  appx: {
    identityName: identity.name,
    publisher: identity.publisher,
    publisherDisplayName: identity.publisherDisplayName,
    applicationId: "Mowr",
    displayName: "Mowr",
    backgroundColor: "#121211",
    showNameOnTiles: false,
    languages: ["en-US"],
    // runFullTrust is added automatically (every Electron app needs it); internetClient is for reaching Mowr's servers and AI providers.
    capabilities: ["internetClient"],
    minVersion: "10.0.17763.0",
    maxVersionTested: "10.0.26100.0",
  },
  appxManifestCreated(manifest) {
    const xml = readFileSync(manifest, "utf8");
    writeFileSync(manifest, xml.replace(/(<Identity\b[^>]*?\bVersion=")[^"]*"/, `$1${storeVersion}"`));
  },
};
