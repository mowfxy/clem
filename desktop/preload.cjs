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
    onOpen: (listener) => {
      const text = (v, re) => (typeof v === "string" && re.test(v) ? v : undefined);
      const handler = (_event, payload) => listener({ review: text(payload?.review, /^[\w-]{1,100}$/), route: text(payload?.route, /^#\/app\/[\w/%.:-]{0,200}$/), chat: text(payload?.chat, /^[\w-]{1,100}$/), message: text(payload?.message, /^[\w-]{1,100}$/) });
      ipcRenderer.on("clem:open", handler);
      return () => ipcRenderer.removeListener("clem:open", handler);
    },
    onTelegram: (listener) => {
      const handler = (_event, payload) => { if (payload && typeof payload.id === "string") listener(payload); };
      ipcRenderer.on("clem:telegram", handler);
      return () => ipcRenderer.removeListener("clem:telegram", handler);
    },
    onGuc: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:guc", handler);
      return () => ipcRenderer.removeListener("clem:guc", handler);
    },
    onVps: (listener) => {
      const handler = (_event, payload) => { if (payload && typeof payload.what === "string") listener({ what: payload.what.slice(0, 200) }); };
      ipcRenderer.on("clem:vps", handler);
      return () => ipcRenderer.removeListener("clem:vps", handler);
    },
    onPack: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("clem:pack", handler);
      return () => ipcRenderer.removeListener("clem:pack", handler);
    },
  }),
);
