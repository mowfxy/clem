const { contextBridge, ipcRenderer } = require("electron");
// The capture overlay may only fetch its frozen screenshot and report the chosen region.
contextBridge.exposeInMainWorld(
  "clemCapture",
  Object.freeze({
    image: () => ipcRenderer.invoke("clem:capture-image"),
    done: (rect) => {
      const valid = rect && ["x", "y", "width", "height"].every((key) => Number.isFinite(rect[key]) && rect[key] >= 0 && rect[key] < 100000);
      ipcRenderer.send("clem:capture-done", valid ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null);
    },
  }),
);
