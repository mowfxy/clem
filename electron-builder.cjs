module.exports = {
  appId: "com.mowrai.desktop",
  productName: "Mowr",
  copyright: "Copyright © Mowr Ai",
  directories: { output: "release", app: "desktop-package" },
  asar: true,
  electronVersion: "44.4.3",
  // Copy the Electron runtime npm already installed instead of re-extracting the zip; Windows antivirus
  // scanning of the freshly extracted electron.exe can block electron-builder's staging rename (EPERM).
  electronDist: process.env.MOWR_ELECTRON_DIST || "node_modules/electron/dist",
  extraResources:[{from:'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc',to:'codex',filter:['**/*']}],
  files: ["dist/**/*", "desktop-dist/**/*", "desktop/icon.ico", "licenses/**/*", "package.json","!node_modules/**/*"],
  extraMetadata: { main: "desktop-dist/main.cjs", author: { name: "Mowr Ai" } },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "desktop/icon.ico",
    signtoolOptions: { publisherName: "Mowr Ai" },
    artifactName: "Mowr-Setup-${version}.${ext}",
  },
  // Double-clicking a shared study pack opens it in Mowr for review before anything is added.
  fileAssociations: [{ ext: "mowrpack", name: "Mowr study pack", description: "Mowr study pack", icon: "desktop/icon.ico", role: "Viewer" }],
  nsis: {
    include: "desktop/installer.nsh",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
  },
  forceCodeSigning: process.env.MOWR_REQUIRE_SIGNING === "true",
};
