const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "clemDesktop",
  Object.freeze({
    onAuth: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("clem:auth", handler);
      return () => ipcRenderer.removeListener("clem:auth", handler);
    },
    invoke: (request) => ipcRenderer.invoke("clem:request", request),
    startDrag: (path) => ipcRenderer.send("clem:drag", String(path)),
    setWindowTone: (tone) => ipcRenderer.send("clem:tone", String(tone)),
    background: (next) => ipcRenderer.invoke("clem:background", next && { keepRunning: next.keepRunning, startWithWindows: next.startWithWindows }),
    onChat: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:chat", handler);
      return () => ipcRenderer.removeListener("clem:chat", handler);
    },
    onCapture: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:capture", handler);
      return () => ipcRenderer.removeListener("clem:capture", handler);
    },
    onFolder: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:folder", handler);
      return () => ipcRenderer.removeListener("clem:folder", handler);
    },
    update: (request) => ipcRenderer.invoke("clem:update", request && typeof request === "object" ? (typeof request.automatic === "boolean" ? { automatic: request.automatic } : { op: String(request.op) }) : undefined),
    onUpdate: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:update", handler);
      return () => ipcRenderer.removeListener("clem:update", handler);
    },
    runCode: (request) => ipcRenderer.invoke("clem:code", request),
    onCode: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:code", handler);
      return () => ipcRenderer.removeListener("clem:code", handler);
    },
    onPack: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:pack", handler);
      return () => ipcRenderer.removeListener("clem:pack", handler);
    },
  }),
);
