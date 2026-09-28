import { BrowserWindow, desktopCapturer, ipcMain, screen } from "electron";
import { brandFontFaces } from "./brand-fonts.ts";

/** Quick capture: freeze the screen under the cursor, let the person drag a region, return PNG bytes.
 *  The overlay is a local page with no network access and a preload that exposes two calls. */
const page = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>${brandFontFaces()}
html,body{margin:0;height:100%;overflow:hidden;background:#000;cursor:crosshair;user-select:none;font-family:'Mowafy Sans',system-ui,sans-serif}
#shot{position:fixed;inset:0;width:100%;height:100%;object-fit:fill}
#dim{position:fixed;inset:0;background:#0000006b}
#sel{position:fixed;display:none;border:1.5px solid #f0efeb;border-radius:3px;box-shadow:0 0 0 9999px #0000006b}
#hint{position:fixed;top:22px;left:50%;transform:translateX(-50%);padding:9px 16px;border-radius:99px;background:#1b1b19ee;color:#f0efeb;font-size:13px;border:1px solid #3a3a36;box-shadow:0 12px 40px -10px #000}
#hint b{font-weight:700}
#size{position:fixed;display:none;padding:3px 7px;border-radius:5px;background:#1b1b19ee;color:#b5b4ad;font-size:11px}
</style></head><body><img id="shot" alt=""><div id="dim"></div><div id="sel"></div><div id="size"></div><div id="hint"><b>Drag</b> to capture · click for the whole screen · <b>Esc</b> to cancel</div>
<script>
const shot=document.getElementById('shot'),sel=document.getElementById('sel'),dim=document.getElementById('dim'),size=document.getElementById('size'),hint=document.getElementById('hint');
let start=null;
window.mowrCapture.image().then(src=>{shot.src=src;});
addEventListener('keydown',e=>{if(e.key==='Escape')window.mowrCapture.done(null);if(e.key==='Enter')window.mowrCapture.done({x:0,y:0,width:innerWidth,height:innerHeight});});
addEventListener('mousedown',e=>{start={x:e.clientX,y:e.clientY};sel.style.display='block';dim.style.display='none';hint.style.opacity='0';draw(e);});
addEventListener('mousemove',e=>{if(start)draw(e);});
addEventListener('mouseup',e=>{if(!start)return;const r=rect(e);start=null;window.mowrCapture.done(r.width<6||r.height<6?{x:0,y:0,width:innerWidth,height:innerHeight}:r);});
function rect(e){return {x:Math.min(start.x,e.clientX),y:Math.min(start.y,e.clientY),width:Math.abs(e.clientX-start.x),height:Math.abs(e.clientY-start.y)};}
function draw(e){const r=rect(e);Object.assign(sel.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});size.style.display='block';size.textContent=Math.round(r.width*devicePixelRatio)+' × '+Math.round(r.height*devicePixelRatio);size.style.left=(r.x)+'px';size.style.top=Math.max(4,r.y-24)+'px';}
</script></body></html>`;

let active = false;
export async function captureRegion(preload: string, hide?: BrowserWindow): Promise<Buffer | null> {
  if (active) return null;
  active = true;
  let overlay: BrowserWindow | null = null;
  const restore = hide && hide.isVisible() && !hide.isMinimized() && hide.isFocused();
  try {
    if (restore) { hide!.minimize(); await new Promise((r) => setTimeout(r, 320)); }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const pixels = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: pixels });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw Error("Windows did not allow Mowr to capture the screen.");
    const image = source.thumbnail;
    overlay = new BrowserWindow({
      x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
      frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: "#000000", hasShadow: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setBounds(display.bounds);
    const win = overlay;
    const result = await new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      const onImage = (event: Electron.IpcMainInvokeEvent) => (event.sender === win.webContents ? image.toDataURL() : "");
      const onDone = (event: Electron.IpcMainEvent, rect: unknown) => { if (event.sender !== win.webContents) return; finish(rect as never); };
      const finish = (rect: { x: number; y: number; width: number; height: number } | null) => {
        ipcMain.removeHandler("mowr:capture-image");
        ipcMain.removeListener("mowr:capture-done", onDone);
        resolve(rect);
      };
      ipcMain.removeHandler("mowr:capture-image");
      ipcMain.handle("mowr:capture-image", onImage);
      ipcMain.on("mowr:capture-done", onDone);
      win.on("closed", () => finish(null));
      win.on("blur", () => { if (!win.isDestroyed()) win.focus(); });
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page)).then(() => { win.show(); win.focus(); });
    });
    if (!result) return null;
    const scale = image.getSize().width / display.bounds.width;
    const crop = {
      x: Math.max(0, Math.round(result.x * scale)), y: Math.max(0, Math.round(result.y * scale)),
      width: Math.round(result.width * scale), height: Math.round(result.height * scale),
    };
    const size = image.getSize();
    crop.width = Math.max(1, Math.min(crop.width, size.width - crop.x));
    crop.height = Math.max(1, Math.min(crop.height, size.height - crop.y));
    return image.crop(crop).toPNG();
  } finally {
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    if (hide && !hide.isDestroyed()) { hide.restore(); hide.show(); hide.focus(); }
    active = false;
  }
}
