import {driveQuery, viewFormat, type DriveHit} from "../core/drive-search.ts";

// Searches the person's Google Drive and streams files for viewing straight from Google, with byte ranges so long
// videos seek instantly. Nothing is written to disk; the short-lived access token stays in the main process.

const API = "https://www.googleapis.com/drive/v3/files";
type Meta = {id:string;name:string;mimeType:string;size?:string;thumbnailLink?:string;webViewLink?:string};

export class DriveLive {
  private cached: {token:string;until:number}|null = null;
  private meta = new Map<string, Meta>();
  private session:()=>Promise<string|null>;
  private fetcher:typeof fetch;
  private service:string;
  constructor(session:()=>Promise<string|null>,fetcher:typeof fetch=fetch,service="https://mowrai.com"){this.session=session;this.fetcher=fetcher;this.service=service;}

  /** null means Drive isn't connected for this account. */
  private async token(force=false):Promise<string|null>{
    if(!force&&this.cached&&Date.now()<this.cached.until)return this.cached.token;
    const session=await this.session();if(!session)return null;
    const r=await this.fetcher(this.service+"/api/drive/token",{headers:{Authorization:"Bearer "+session,Origin:this.service},redirect:"error",signal:AbortSignal.timeout(20000)});
    if(r.status===400||r.status===404||r.status===401||r.status===500){const body=await r.json().catch(()=>({}));if(/connect google drive|reconnect|expired/i.test(body.error||"")){this.cached=null;return null;}throw Error(body.error||"Google Drive is unavailable right now.");}
    if(!r.ok)throw Error("Google Drive is unavailable right now.");
    const {accessToken,expiresIn}=await r.json();
    this.cached={token:accessToken,until:Date.now()+Math.max(60,Number(expiresIn)-120)*1000};
    return accessToken;
  }
  private async google(url:string,init:RequestInit={},retry=true):Promise<Response>{
    const token=await this.token();if(!token)throw Object.assign(Error("Connect Google Drive in Connectors first."),{code:"not_connected"});
    const r=await this.fetcher(url,{...init,headers:{...(init.headers as Record<string,string>||{}),Authorization:"Bearer "+token}});
    if(r.status===401&&retry){this.cached=null;return this.google(url,init,false);}
    return r;
  }
  async connected(){try{return !!await this.token();}catch{return false;}}

  async search(question:string):Promise<{connected:boolean;files:DriveHit[]}>{
    if(!await this.token())return {connected:false,files:[]};
    const url=new URL(API);
    url.search=new URLSearchParams({q:driveQuery(question),pageSize:"12",supportsAllDrives:"true",includeItemsFromAllDrives:"true",
      fields:"files(id,name,mimeType,modifiedTime,size,thumbnailLink,webViewLink,videoMediaMetadata(durationMillis))"}).toString();
    const r=await this.google(url.href,{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error("Google Drive search failed. Try again.");
    const files=((await r.json()).files||[]) as (Meta&{modifiedTime?:string;videoMediaMetadata?:{durationMillis?:string}})[];
    for(const f of files)this.meta.set(f.id,f);
    const hits:DriveHit[]=files.map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,modified:f.modifiedTime,size:f.size?Number(f.size):undefined,durationMs:f.videoMediaMetadata?.durationMillis?Number(f.videoMediaMetadata.durationMillis):undefined}));
    // A short excerpt of the best text matches helps the model pick the right file.
    await Promise.all(hits.slice(0,4).map(async h=>{h.excerpt=await this.excerpt(h).catch(()=>undefined);}));
    return {connected:true,files:hits};
  }
  private async excerpt(h:DriveHit){
    const google=/^application\/vnd\.google-apps\.(document|presentation)$/.test(h.mimeType);
    const plain=/^text\//.test(h.mimeType)&&(h.size??0)<500_000;
    if(!google&&!plain)return undefined;
    const r=await this.google(google?`${API}/${h.id}/export?mimeType=text/plain`:`${API}/${h.id}?alt=media`,{headers:plain?{Range:"bytes=0-4000"}:{},signal:AbortSignal.timeout(8000)});
    if(!r.ok)return undefined;
    return (await r.text()).slice(0,1500);
  }
  private async info(id:string){
    const known=this.meta.get(id);if(known)return known;
    const r=await this.google(`${API}/${id}?fields=id,name,mimeType,size,thumbnailLink,webViewLink&supportsAllDrives=true`,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error("This Drive file is unavailable.");
    const m=await r.json() as Meta;this.meta.set(id,m);return m;
  }
  /** Streams a file (or Google Docs/Slides/Sheets as PDF), passing Range through so video can seek. */
  async media(id:string,range:string|null):Promise<Response>{
    const m=await this.info(id),format=viewFormat(m.mimeType);
    const r=await this.google(format.export?`${API}/${id}/export?mimeType=${encodeURIComponent(format.export)}`:`${API}/${id}?alt=media&supportsAllDrives=true`,{headers:range&&!format.export?{Range:range}:{}});
    if(!r.ok&&r.status!==206)return Response.json({error:r.status===403?"This Drive file can't be opened here. Google may block downloads for it.":"This Drive file is unavailable."},{status:r.status===404?404:502});
    const headers=new Headers({"Content-Type":format.export||m.mimeType||r.headers.get("Content-Type")||"application/octet-stream","Cache-Control":"no-store","Accept-Ranges":format.export?"none":"bytes","X-Mowr-File-Name":encodeURIComponent(m.name+format.extension)});
    for(const h of ["Content-Length","Content-Range"]){const v=r.headers.get(h);if(v)headers.set(h,v);}
    return new Response(r.body,{status:r.status,headers});
  }
  /** Drive's thumbnail (needs the same sign-in), or 404 so the card falls back to its own poster. */
  async thumbnail(id:string):Promise<Response>{
    const m=await this.info(id).catch(()=>null);
    if(!m?.thumbnailLink)return new Response(null,{status:404});
    const r=await this.google(m.thumbnailLink.replace(/=s\d+$/,"=s640"),{signal:AbortSignal.timeout(15000)}).catch(()=>null);
    if(!r?.ok)return new Response(null,{status:404});
    return new Response(r.body,{headers:{"Content-Type":r.headers.get("Content-Type")||"image/jpeg","Cache-Control":"no-store"}});
  }
  async webLink(id:string){return (await this.info(id)).webViewLink||`https://drive.google.com/file/d/${id}/view`;}
}
