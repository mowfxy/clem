import {createServer, type Server} from "node:http";
import {randomBytes} from "node:crypto";
import {Readable} from "node:stream";
import {driveQuery, driveTerms, viewFormat, type DriveHit} from "../core/drive-search.ts";

// Google Drive, live: search, browse folders (with subfolders and thumbnails), read text and stream files straight from
// Google with byte ranges so long videos seek instantly. Nothing is written to disk; the short-lived access token stays
// in the main process.

const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
type Meta = {id:string;name:string;mimeType:string;size?:string;thumbnailLink?:string;webViewLink?:string;modifiedTime?:string;iconLink?:string;videoMediaMetadata?:{durationMillis?:string};shortcutDetails?:{targetId?:string;targetMimeType?:string}};
const SHORTCUT = "application/vnd.google-apps.shortcut";
/** A Drive shortcut stands for what it points to: a shortcut to a folder opens that folder, one to a file opens the file. */
const resolve = <T extends Meta>(f: T): T => f.mimeType === SHORTCUT && f.shortcutDetails?.targetId && f.shortcutDetails.targetMimeType
  ? { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType, size: undefined, thumbnailLink: f.shortcutDetails.targetMimeType === FOLDER ? undefined : f.thumbnailLink }
  : f;
/** A file or folder as the app shows it. `path` is the subfolder it sits in, inside a linked folder. */
export type DriveItem = {id:string;name:string;mimeType:string;size?:number;modified?:string;thumbnail?:boolean;durationMs?:number;path?:string;folder?:boolean};
const FIELDS = "id,name,mimeType,size,modifiedTime,thumbnailLink,hasThumbnail,webViewLink,iconLink,videoMediaMetadata(durationMillis),shortcutDetails(targetId,targetMimeType)";
const quote = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const item = (f: Meta & {hasThumbnail?:boolean}, path?: string): DriveItem => ({
  id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ? Number(f.size) : undefined, modified: f.modifiedTime,
  thumbnail: !!f.thumbnailLink || !!f.hasThumbnail, durationMs: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : undefined,
  ...(path ? {path} : {}), ...(f.mimeType === FOLDER ? {folder: true} : {}),
});

export class DriveLive {
  private cached: {token:string;until:number}|null = null;
  private meta = new Map<string, Meta>();
  private session:()=>Promise<string|null>;
  private fetcher:typeof fetch;
  private service:string;
  private known: {connected:boolean;at:number}|null = null;
  private trees = new Map<string, {at:number;items:DriveItem[];folders:string[]}>();
  constructor(session:()=>Promise<string|null>,fetcher:typeof fetch=fetch,service="https://mowrai.com"){this.session=session;this.fetcher=fetcher;this.service=service;}

  /** null means Drive isn't connected for this account. */
  private async token(force=false):Promise<string|null>{
    if(!force&&this.cached&&Date.now()<this.cached.until)return this.cached.token;
    const session=await this.session();if(!session)return null;
    // A sign-out or account switch during this request must not leave the previous person's token behind.
    const generation=this.generation;
    const r=await this.fetcher(this.service+"/api/drive/token",{headers:{Authorization:"Bearer "+session,Origin:this.service},redirect:"error",signal:AbortSignal.timeout(20000)});
    if(r.status===400||r.status===404||r.status===401||r.status===500){const body=await r.json().catch(()=>({}));if(/connect google drive|reconnect|expired/i.test(body.error||"")){if(generation===this.generation){this.cached=null;this.known={connected:false,at:Date.now()};}return null;}throw Error(body.error||"Google Drive is unavailable right now.");}
    if(!r.ok)throw Error("Google Drive is unavailable right now.");
    const {accessToken,expiresIn}=await r.json();
    if(generation!==this.generation)throw Error("The account changed. Try again.");
    this.cached={token:accessToken,until:Date.now()+Math.max(60,Number(expiresIn)-120)*1000};
    this.known={connected:true,at:Date.now()};
    return accessToken;
  }
  private async google(url:string,init:RequestInit={},retry=true):Promise<Response>{
    const token=await this.token();if(!token)throw Object.assign(Error("Connect Google Drive in Settings → Connectors first."),{code:"not_connected"});
    const r=await this.fetcher(url,{...init,headers:{...(init.headers as Record<string,string>||{}),Authorization:"Bearer "+token}});
    if(r.status===401&&retry){this.cached=null;return this.google(url,init,false);}
    return r;
  }
  async connected(){try{return !!await this.token();}catch{return false;}}
  /** The connection as last confirmed. A network hiccup keeps the last answer instead of asking to reconnect. */
  async state(refresh=false):Promise<{connected:boolean;checked:boolean;error?:string}>{
    if(!refresh&&this.known&&Date.now()-this.known.at<5*60_000)return {connected:this.known.connected,checked:true};
    try{const connected=!!await this.token(refresh);return {connected,checked:true};}
    catch(error){return this.known?{connected:this.known.connected,checked:true,error:(error as Error).message}:{connected:false,checked:false,error:(error as Error).message};}
  }
  private generation=0;
  /** Drops everything held for the signed-in person (token, connection state, folder trees, file details). */
  forget(){this.generation++;this.cached=null;this.known=null;this.trees.clear();this.meta.clear();}

  async search(question:string):Promise<{connected:boolean;files:DriveHit[]}>{
    if(!await this.token())return {connected:false,files:[]};
    const url=new URL(API);
    url.search=new URLSearchParams({q:driveQuery(question),pageSize:"12",supportsAllDrives:"true",includeItemsFromAllDrives:"true",
      fields:`files(${FIELDS})`}).toString();
    const r=await this.google(url.href,{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error("Google Drive search failed. Try again.");
    const files=(((await r.json()).files||[]) as Meta[]).map(resolve).filter(f=>f.mimeType!==SHORTCUT&&f.mimeType!==FOLDER);
    for(const f of files)this.meta.set(f.id,f);
    const hits:DriveHit[]=files.map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,modified:f.modifiedTime,size:f.size?Number(f.size):undefined,durationMs:f.videoMediaMetadata?.durationMillis?Number(f.videoMediaMetadata.durationMillis):undefined}));
    // A short excerpt of the best text matches helps the model pick the right file.
    await Promise.all(hits.slice(0,4).map(async h=>{h.excerpt=await this.excerpt(h).catch(()=>undefined);}));
    return {connected:true,files:hits};
  }

  /** One page of a folder ("root" is My Drive, "shared" is Shared with me), folders first; or a search across Drive. */
  async list({folder="root",page,query,kind="all"}:{folder?:string;page?:string;query?:string;kind?:"all"|"folders"}={}){
    if(!await this.token())return {connected:false,files:[] as DriveItem[]};
    const clauses=["trashed = false"];
    const words=(query||"").trim();
    if(words)clauses.push(`name contains ${quote(words.slice(0,100))}`);
    else if(folder==="shared")clauses.push("sharedWithMe = true");
    else clauses.push(`${quote(folder)} in parents`);
    if(kind==="folders")clauses.push(`(mimeType = '${FOLDER}' or mimeType = '${SHORTCUT}')`);
    const url=new URL(API);
    url.search=new URLSearchParams({q:clauses.join(" and "),pageSize:"100",supportsAllDrives:"true",includeItemsFromAllDrives:"true",
      ...(words?{}:{orderBy:"folder,name_natural"}),fields:`nextPageToken,files(${FIELDS})`,...(page?{pageToken:page}:{})}).toString();
    const r=await this.google(url.href,{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error(r.status===404?"This Drive folder is no longer available.":"Google Drive could not list these files.");
    const body=await r.json() as {files?:Meta[];nextPageToken?:string};
    const resolved=(body.files||[]).map(resolve).filter(f=>f.mimeType!==SHORTCUT&&(kind!=="folders"||f.mimeType===FOLDER));
    for(const f of resolved)this.meta.set(f.id,f);
    const files=resolved.map(f=>item(f)).sort((a,b)=>Number(!!b.folder)-Number(!!a.folder));
    return {connected:true,files,next:body.nextPageToken};
  }

  /** Everything inside a linked folder and its subfolders (5 levels, 1500 items), read live and kept for two minutes. */
  async tree(folderId:string,refresh=false){
    const cached=this.trees.get(folderId);
    if(!refresh&&cached&&Date.now()-cached.at<120_000)return cached;
    const generation=this.generation;
    if(!await this.token())throw Object.assign(Error("Connect Google Drive in Settings → Connectors first."),{code:"not_connected"});
    const items:DriveItem[]=[],folders=[folderId],paths=new Map<string,string>([[folderId,""]]),seen=new Set([folderId]);
    let level=[folderId];
    for(let depth=0;depth<5&&level.length&&items.length<1500;depth++){
      const next:string[]=[];
      // Drive accepts several parents in one query, so a whole level is listed in a few requests.
      for(let i=0;i<level.length&&items.length<1500;i+=15){
        const group=level.slice(i,i+15);
        let page:string|undefined;
        do{
          const url=new URL(API);
          url.search=new URLSearchParams({q:`trashed = false and (${group.map(id=>`${quote(id)} in parents`).join(" or ")})`,pageSize:"200",supportsAllDrives:"true",includeItemsFromAllDrives:"true",
            fields:`nextPageToken,files(${FIELDS},parents)`,...(page?{pageToken:page}:{})}).toString();
          const r=await this.google(url.href,{signal:AbortSignal.timeout(25000)});
          if(!r.ok)throw Error(r.status===404?"The linked Drive folder is no longer available.":"Google Drive could not list the linked folder.");
          const body=await r.json() as {files?:(Meta&{parents?:string[]})[];nextPageToken?:string};
          for(const raw of body.files||[]){
            const parent=raw.parents?.find(p=>paths.has(p))||group[0],path=paths.get(parent)||"";
            const f=resolve(raw);
            if(f.mimeType===SHORTCUT||seen.has(f.id))continue;
            seen.add(f.id);
            this.meta.set(f.id,f);
            if(f.mimeType===FOLDER){paths.set(f.id,path?path+" / "+f.name:f.name);next.push(f.id);folders.push(f.id);}
            items.push(item(f,path));
          }
          page=body.nextPageToken;
        }while(page&&items.length<1500);
      }
      level=next;
    }
    const value={at:Date.now(),items,folders};
    if(generation===this.generation)this.trees.set(folderId,value);
    return value;
  }

  /**
   * What a question needs from a linked folder: every item (for browsing), plus the files that best match the
   * question, ranked by name and by Drive's own full-text index, with a short excerpt where Drive can give text.
   */
  async folder(folderId:string,question="",refresh=false){
    const tree=await this.tree(folderId,refresh);
    const files=tree.items.filter(i=>!i.folder);
    const terms=driveTerms(question);
    const score=new Map<string,number>();
    for(const f of files){const name=(f.path+" "+f.name).toLowerCase();const n=terms.reduce((s,t)=>s+(name.includes(t)?3:0),0);if(n)score.set(f.id,n);}
    if(terms.length){
      const text=terms.map(t=>`fullText contains ${quote(t)}`).join(" or ");
      for(let i=0;i<tree.folders.length&&i<60;i+=20){
        const url=new URL(API);
        url.search=new URLSearchParams({q:`trashed = false and (${text}) and (${tree.folders.slice(i,i+20).map(id=>`${quote(id)} in parents`).join(" or ")})`,pageSize:"30",supportsAllDrives:"true",includeItemsFromAllDrives:"true",fields:"files(id)"}).toString();
        const r=await this.google(url.href,{signal:AbortSignal.timeout(15000)}).catch(()=>null);
        if(!r?.ok)continue;
        for(const f of ((await r.json()).files||[]) as {id:string}[])score.set(f.id,(score.get(f.id)||0)+2);
      }
    }
    const hits:DriveHit[]=[...score.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([id])=>files.find(f=>f.id===id)!).filter(Boolean)
      .map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,modified:f.modified,size:f.size,durationMs:f.durationMs}));
    await Promise.all(hits.slice(0,4).map(async h=>{h.excerpt=await this.excerpt(h).catch(()=>undefined);}));
    return {items:tree.items,hits,checked:tree.at};
  }

  private async excerpt(h:DriveHit){
    const text=await this.text(h.id,4000).catch(()=>undefined);
    return text?.slice(0,1500);
  }
  /** Text Drive can give directly: Google Docs, Slides and Sheets, and plain text files. Others return undefined. */
  async text(id:string,limit=60000):Promise<string|undefined>{
    const m=await this.info(id);
    const google=/^application\/vnd\.google-apps\.(document|presentation|spreadsheet)$/.test(m.mimeType);
    const plain=/^text\/|json|csv|markdown/.test(m.mimeType)&&Number(m.size||0)<2_000_000;
    if(!google&&!plain)return undefined;
    const as=m.mimeType.endsWith("spreadsheet")?"text/csv":"text/plain";
    const r=await this.google(google?`${API}/${id}/export?mimeType=${encodeURIComponent(as)}`:`${API}/${id}?alt=media&supportsAllDrives=true`,{headers:plain?{Range:`bytes=0-${limit}`}:{},signal:AbortSignal.timeout(20000)});
    if(!r.ok&&r.status!==206)return undefined;
    return (await r.text()).slice(0,limit);
  }
  private async info(id:string){
    const known=this.meta.get(id);if(known)return known;
    const r=await this.google(`${API}/${id}?fields=${FIELDS}&supportsAllDrives=true`,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error("This Drive file is unavailable.");
    const m=await r.json() as Meta;this.meta.set(id,m);return m;
  }
  /** Streams a file (or Google Docs/Slides/Sheets as PDF), passing Range through so video can seek. */
  async media(id:string,range:string|null):Promise<Response>{
    const m=await this.info(id),format=viewFormat(m.mimeType);
    const r=await this.google(format.export?`${API}/${id}/export?mimeType=${encodeURIComponent(format.export)}`:`${API}/${id}?alt=media&supportsAllDrives=true&acknowledgeAbuse=false`,{headers:range&&!format.export?{Range:range}:{}});
    if(!r.ok&&r.status!==206)return Response.json({error:r.status===403?"This Drive file can't be opened here. Google may block downloads for it.":"This Drive file is unavailable."},{status:r.status===404?404:502});
    const headers=new Headers({"Content-Type":playableType(format.export||m.mimeType||r.headers.get("Content-Type")||"application/octet-stream",m.name),"Cache-Control":"no-store","Accept-Ranges":format.export?"none":"bytes","X-Mowr-File-Name":encodeURIComponent(m.name+format.extension)});
    for(const h of ["Content-Length","Content-Range"]){const v=r.headers.get(h);if(v)headers.set(h,v);}
    return new Response(r.body,{status:r.status,headers});
  }
  /** Size and playable type of a file that can be read in byte ranges; null for Google formats, which are exported whole. */
  async stat(id:string):Promise<{size:number;type:string}|null>{
    const m=await this.info(id);
    return viewFormat(m.mimeType).export||!Number(m.size)?null:{size:Number(m.size),type:playableType(m.mimeType,m.name)};
  }
  /** Bytes start..end of a file, straight from Google. Errors carry the HTTP status the player should get. */
  async bytes(id:string,start:number,end:number):Promise<ReadableStream<Uint8Array>>{
    const r=await this.google(`${API}/${id}?alt=media&supportsAllDrives=true&acknowledgeAbuse=false`,{headers:{Range:`bytes=${start}-${end}`}});
    // A plain 200 is the whole file, which is only the right bytes when the range starts at 0.
    if(r.body&&(r.status===206||(r.status===200&&start===0)))return r.body;
    void r.body?.cancel();
    throw Object.assign(Error(r.status===403?"Google blocks downloads for this Drive file.":"This Drive file is unavailable."),{status:r.status===403||r.status===404?r.status:502});
  }
  /** Drive's thumbnail (needs the same sign-in), or 404 so the card falls back to its own poster. */
  async thumbnail(id:string,size=640):Promise<Response>{
    const m=await this.info(id).catch(()=>null);
    if(!m?.thumbnailLink)return new Response(null,{status:404});
    const r=await this.google(m.thumbnailLink.replace(/=s\d+$/,"=s"+size),{signal:AbortSignal.timeout(15000)}).catch(()=>null);
    if(!r?.ok)return new Response(null,{status:404});
    return new Response(r.body,{headers:{"Content-Type":r.headers.get("Content-Type")||"image/jpeg","Cache-Control":"private, max-age=600"}});
  }
  async webLink(id:string){return (await this.info(id)).webViewLink||`https://drive.google.com/file/d/${id}/view`;}
}

/** Chromium plays MP4/WebM/Ogg. Drive sometimes labels them generically, which makes <video> refuse to start. */
export function playableType(mime:string,name:string){
  if(mime&&mime!=="application/octet-stream"&&mime!=="video/*")return mime==="video/quicktime"&&/\.mp4$/i.test(name)?"video/mp4":mime;
  const ext=name.toLowerCase().split(".").pop()||"";
  return ({mp4:"video/mp4",m4v:"video/mp4",mov:"video/mp4",webm:"video/webm",ogv:"video/ogg",mp3:"audio/mpeg",m4a:"audio/mp4",wav:"audio/wav",ogg:"audio/ogg"} as Record<string,string>)[ext]||mime||"application/octet-stream";
}

const BLOCK = 1 << 20, RUN = 8, KEEP = 64;
type Pending = {promise: Promise<Uint8Array>; resolve: (b: Uint8Array) => void; reject: (e: unknown) => void};
const pending = (): Pending => { let resolve!: Pending["resolve"], reject!: Pending["reject"]; const promise = new Promise<Uint8Array>((y, n) => { resolve = y; reject = n; }); promise.catch(() => {}); return {promise, resolve, reject}; };

/**
 * Video and audio from Drive play through a private server on 127.0.0.1. Chromium's media player needs real HTTP
 * range responses to start and seek long files; a custom protocol can stall on them. Every URL carries a random
 * key made for this run, so no other program on the PC can use it.
 *
 * Before a long video shows its first frame Chromium opens dozens of range requests a few hundred KB apart, and each
 * one sent straight to Google waits half a second or more, so a lecture took minutes to start. Instead the file is
 * read from Google in 8 MiB runs into 1 MiB blocks held in memory (the last 64 MiB, never on disk), those nearby
 * requests are answered from memory, and the next run starts while the current one plays.
 *
 * Some recorders also write a video as thousands of small mdat boxes, and Chromium reads the header of every top-level
 * box of an MP4 before its first frame: hundreds of range requests across the whole file. See `layout`.
 */
export class DriveMediaServer {
  private server?: Server;
  private ready?: Promise<number>;
  private key = randomBytes(24).toString("hex");
  private drive: DriveLive;
  private allowed: () => Promise<boolean>;
  private blocks = new Map<string, Promise<Uint8Array>>();
  private layouts = new Map<string, Promise<{at: number; bytes: Uint8Array} | null>>();
  constructor(drive: DriveLive, allowed: () => Promise<boolean>) { this.drive = drive; this.allowed = allowed; }
  /** Block i of a file; a missing block starts a run from it up to the next block already held. */
  private block(id: string, size: number, i: number) {
    const key = id + ":" + i, held = this.blocks.get(key);
    if (held) { this.blocks.delete(key); this.blocks.set(key, held); return held; }
    // The opening run is short: a player that jumps straight to an index at the end shouldn't wait behind 8 MiB.
    const last = Math.ceil(size / BLOCK) - 1, run: Pending[] = [], most = i === 0 ? 2 : RUN;
    for (let j = i; j <= last && run.length < most && (j === i || !this.blocks.has(id + ":" + j)); j++) { const p = pending(); run.push(p); this.blocks.set(id + ":" + j, p.promise); }
    void this.fill(id, size, i, run);
    for (const old of this.blocks.keys()) { if (this.blocks.size <= KEEP) break; this.blocks.delete(old); }
    return run[0].promise;
  }
  private async fill(id: string, size: number, first: number, run: Pending[]) {
    const length = (k: number) => Math.min(BLOCK, size - (first + k) * BLOCK);
    let k = 0;
    try {
      const reader = (await this.drive.bytes(id, first * BLOCK, Math.min(size, (first + run.length) * BLOCK) - 1)).getReader();
      let buffer = new Uint8Array(length(0)), at = 0;
      while (k < run.length) {
        const {done, value} = await reader.read();
        if (done) throw Error("Drive stopped sending this file.");
        for (let off = 0; off < value.length && k < run.length;) {
          const take = Math.min(value.length - off, buffer.length - at);
          buffer.set(value.subarray(off, off + take), at); at += take; off += take;
          if (at === buffer.length) { run[k++].resolve(buffer); if (k < run.length) { buffer = new Uint8Array(length(k)); at = 0; } }
        }
      }
      void reader.cancel().catch(() => {});
    } catch (error) {
      for (; k < run.length; k++) { run[k].reject(error); if (this.blocks.get(id + ":" + (first + k)) === run[k].promise) this.blocks.delete(id + ":" + (first + k)); }
    }
  }
  private async read(id: string, size: number, at: number, length: number) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length;) { const p = at + i, data = await this.block(id, size, Math.floor(p / BLOCK)), o = p % BLOCK, n = Math.min(length - i, data.length - o); out.set(data.subarray(o, o + n), i); i += n; }
    return out;
  }
  /**
   * When an MP4's index (moov) comes before its media and the file isn't fragmented, the first mdat is presented as
   * running to the end of the file. Every byte stays where the index says it is; the later mdat headers become unread
   * bytes inside the first one, so Chromium stops after one box instead of walking the whole file. Returns the bytes
   * to overwrite, or null to serve the file unchanged.
   */
  private layout(id: string, size: number) {
    let known = this.layouts.get(id);
    if (!known) this.layouts.set(id, known = (async () => {
      const header = async (at: number) => {
        const h = await this.read(id, size, at, Math.min(16, size - at)), v = new DataView(h.buffer);
        const type = String.fromCharCode(...h.subarray(4, 8)), large = v.getUint32(0) === 1;
        return {type, head: large ? 16 : 8, box: large ? Number(v.getBigUint64(8)) : v.getUint32(0)};
      };
      let moov = false;
      for (let at = 0, n = 0; at + 8 <= size && n < 16; n++) {
        const {type, head, box} = await header(at);
        if (box < head || at + box > size) return null;
        if (type === "moov") {
          for (let c = at + head, k = 0; c + 8 <= at + box && k < 64; k++) { const child = await header(c); if (child.type === "mvex") return null; if (child.box < child.head) return null; c += child.box; }
          moov = true;
        }
        if (type === "mdat") {
          if (!moov || at + box >= size) return null;
          const bytes = new Uint8Array(head === 16 ? 8 : 4), v = new DataView(bytes.buffer);
          if (head === 16) v.setBigUint64(0, BigInt(size - at)); else v.setUint32(0, size - at > 0xffffffff ? 0 : size - at);
          return {at: head === 16 ? at + 8 : at, bytes};
        }
        at += box;
      }
      return null;
    })().catch(() => { this.layouts.delete(id); return null; }));
    return known;
  }
  /** Answers one range request from the blocks, keeping the next run loading while the player reads. */
  private async stream(id: string, file: {size: number; type: string}, range: string | undefined, head: boolean, res: import("node:http").ServerResponse) {
    const {size} = file, m = /^bytes=(\d*)-(\d*)$/.exec(range || "");
    let start = 0, end = size - 1;
    if (m && m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    else if (m && m[2]) start = Math.max(0, size - Number(m[2]));
    if (start >= size || start > end) { res.writeHead(416, {"Content-Range": `bytes */${size}`}).end(); return; }
    const from = Math.floor(start / BLOCK), to = Math.floor(end / BLOCK);
    // The first block is awaited before answering, so a file Google refuses gets a real error status.
    await this.block(id, size, from);
    const fix = /mp4|quicktime/.test(file.type) ? await this.layout(id, size) : null;
    res.writeHead(m ? 206 : 200, {"Content-Type": file.type, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "no-store", ...(m ? {"Content-Range": `bytes ${start}-${end}/${size}`} : {})});
    if (head) { res.end(); return; }
    let closed = false; res.on("close", () => { closed = true; });
    for (let i = from; i <= to && !closed; i++) {
      const data = await this.block(id, size, i);
      // One Google connection gives 1-3 MB/s, so up to three runs load side by side ahead of the player.
      for (let ahead = i + RUN / 2; ahead <= Math.min(to, i + RUN / 2 + 2 * RUN); ahead += RUN) void this.block(id, size, ahead).catch(() => {});
      let chunk = data.subarray(i === from ? start - i * BLOCK : 0, i === to ? end - i * BLOCK + 1 : data.length);
      const at = i === from ? start : i * BLOCK;
      if (fix && fix.at < at + chunk.length && fix.at + fix.bytes.length > at) { chunk = chunk.slice(); fix.bytes.forEach((b, j) => { if (fix.at + j >= at && fix.at + j < at + chunk.length) chunk[fix.at + j - at] = b; }); }
      if (!res.write(chunk) && !closed) await new Promise<void>((go) => { const done = () => { res.off("drain", done); res.off("close", done); go(); }; res.on("drain", done); res.on("close", done); });
    }
    res.end();
  }
  private start() {
    if (this.ready) return this.ready;
    this.ready = new Promise<number>((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          const match = /^\/drive\/([\w-]{10,150})$/.exec(url.pathname);
          if (req.method !== "GET" && req.method !== "HEAD" || !match || url.searchParams.get("k") !== this.key || !await this.allowed()) { res.writeHead(404).end(); return; }
          const file = await this.drive.stat(match[1]);
          if (file) { await this.stream(match[1], file, typeof req.headers.range === "string" ? req.headers.range : undefined, req.method === "HEAD", res); return; }
          const upstream = await this.drive.media(match[1], typeof req.headers.range === "string" ? req.headers.range : null);
          const headers: Record<string, string> = {};
          upstream.headers.forEach((value, name) => { if (name !== "x-mowr-file-name") headers[name] = value; });
          res.writeHead(upstream.status, headers);
          if (req.method === "HEAD" || !upstream.body) { res.end(); return; }
          const body = Readable.fromWeb(upstream.body as never);
          req.on("close", () => body.destroy());
          body.on("error", () => res.destroy());
          body.pipe(res);
        } catch (error) { if (res.headersSent) res.destroy(); else res.writeHead((error as {status?: number}).status || 502).end(); }
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => { this.server = server; resolve((server.address() as {port:number}).port); });
    });
    return this.ready;
  }
  async url(id: string) { return `http://127.0.0.1:${await this.start()}/drive/${id}?k=${this.key}`; }
  /** Drops media read for the previous account; the server keeps running. */
  forget() { this.blocks.clear(); this.layouts.clear(); }
  stop() { this.server?.close(); this.forget(); }
}
