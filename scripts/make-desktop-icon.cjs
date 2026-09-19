// Resize the application's logo and wrap its PNG in a Windows ICO container.
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
app.whenReady().then(async () => {
  const png = nativeImage
    .createFromPath("public/logo.png")
    .resize({ width: 256, height: 256 })
    .toPNG();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.writeFileSync("desktop/icon.ico", Buffer.concat([header, png]));
  app.quit();
});
