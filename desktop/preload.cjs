const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "mowrDesktop",
  Object.freeze({
    onAuth: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("mowr:auth", handler);
      return () => ipcRenderer.removeListener("mowr:auth", handler);
    },
    invoke: (request) => ipcRenderer.invoke("mowr:request", request),
    onChat: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("mowr:chat", handler);
      return () => ipcRenderer.removeListener("mowr:chat", handler);
    },
    onCapture: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("mowr:capture", handler);
      return () => ipcRenderer.removeListener("mowr:capture", handler);
    },
    onAttachment: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("mowr:attachment", handler);
      return () => ipcRenderer.removeListener("mowr:attachment", handler);
    },
  }),
);
