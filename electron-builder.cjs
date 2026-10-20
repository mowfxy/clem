module.exports = {
  appId: "xyz.m4labs.clem",
  productName: "Clem",
  copyright: "Copyright © Clem",
  // CLEM_RELEASE_DIR lets a release build while a copy from release/win-unpacked is still open (Windows locks it).
  directories: { output: process.env.CLEM_RELEASE_DIR || "release", app: "desktop-package" },
  asar: true,
  electronVersion: "44.4.3",
  // Copy the Electron runtime npm already installed instead of re-extracting the zip; Windows antivirus
  // scanning of the freshly extracted electron.exe can block electron-builder's staging rename (EPERM).
  electronDist: process.env.CLEM_ELECTRON_DIST || "node_modules/electron/dist",
  extraResources:[{from:'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc',to:'codex',filter:['**/*']}],
  files: ["dist/**/*", "desktop-dist/**/*", "desktop/icon.ico", "licenses/**/*", "package.json","!node_modules/**/*"],
  extraMetadata: { main: "desktop-dist/main.cjs", author: { name: "Clem" } },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "desktop/icon.ico",
    signtoolOptions: { publisherName: "Clem" },
    artifactName: "Clem-Setup-${version}.${ext}",
  },
  // Double-clicking a shared study pack opens it in Clem for review before anything is added.
  fileAssociations: [{ ext: "clempack", name: "Clem study pack", description: "Clem study pack", icon: "desktop/icon.ico", role: "Viewer" }],
  nsis: {
    include: "desktop/installer.nsh",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
  },
  forceCodeSigning: process.env.CLEM_REQUIRE_SIGNING === "true",
};
