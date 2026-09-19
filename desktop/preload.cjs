const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mowrDesktop',Object.freeze({
 invoke:request=>ipcRenderer.invoke('mowr:request',request),
 onChat:listener=>{const handler=(_event,payload)=>listener(payload);ipcRenderer.on('mowr:chat',handler);return()=>ipcRenderer.removeListener('mowr:chat',handler);},
 onAttachment:listener=>{const handler=(_event,payload)=>listener(payload);ipcRenderer.on('mowr:attachment',handler);return()=>ipcRenderer.removeListener('mowr:attachment',handler);}
}));
