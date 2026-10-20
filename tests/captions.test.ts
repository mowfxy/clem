import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCaptions,transcriptText,pickTrack,videoContext,videoContentIntent,stamp,decodeEntities} from '../core/captions.ts';
import {youtubeCaptions,embeddedJson} from '../desktop/video-captions.ts';
import {DriveLive,findUrl} from '../desktop/drive-live.ts';
import {clemSkillsFor,clemSkillText,capabilityIndex} from '../core/clem-skills.ts';

test('every caption format YouTube and Drive serve becomes the same cues',()=>{
  const want=[{start:1.2,text:"Today we'll look at derivatives"},{start:4.5,text:'The slope & the tangent'}];
  const srv1=`<?xml version="1.0" encoding="utf-8" ?><transcript><text start="1.2" dur="3.3">Today we&amp;#39;ll look at derivatives</text><text start="4.5" dur="2">The slope &amp;amp; the tangent</text></transcript>`;
  const srv3=`<timedtext format="3"><body><p t="1200" d="3300"><s>Today</s><s> we'll look at derivatives</s></p><p t="4500" d="2000">The slope &amp; the tangent</p></body></timedtext>`;
  const json3=JSON.stringify({events:[{tStartMs:0,dDurationMs:10},{tStartMs:1200,segs:[{utf8:'Today '},{utf8:"we'll look at derivatives"}]},{tStartMs:4500,segs:[{utf8:'The slope & the tangent'}]}]});
  const vtt=`WEBVTT\nKind: captions\nLanguage: en\n\n00:00:01.200 --> 00:00:04.500 align:start position:0%\nToday we'll look at <c>derivatives</c>\n\n00:00:04.500 --> 00:00:06.500\nThe slope &amp; the tangent\n`;
  const srt=`1\r\n00:00:01,200 --> 00:00:04,500\r\nToday we'll look at derivatives\r\n\r\n2\r\n00:00:04,500 --> 00:00:06,500\r\nThe slope & the tangent\r\n`;
  const sbv=`0:00:01.200,0:00:04.500\nToday we'll look at derivatives\n\n0:00:04.500,0:00:06.500\nThe slope & the tangent`;
  for(const [name,raw] of Object.entries({srv1,srv3,json3,vtt,srt,sbv}))assert.deepEqual(parseCaptions(raw),want,name);
  assert.deepEqual(parseCaptions(''),[]);assert.deepEqual(parseCaptions('<html>error</html>'),[]);
});

test('rolling automatic captions keep only the new words',()=>{
  const vtt=`WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nthe chain rule\n\n00:00:02.000 --> 00:00:04.000\nthe chain rule says that\n\n00:00:04.000 --> 00:00:04.010\nthe chain rule says that\n\n00:00:04.010 --> 00:00:06.000\nyou multiply the derivatives`;
  assert.deepEqual(parseCaptions(vtt).map(c=>c.text),['the chain rule','says that','you multiply the derivatives']);
});

test('transcripts are paragraphs that start with their time',()=>{
  const cues=[{start:0,text:'a'},{start:10,text:'b'},{start:31,text:'c'},{start:3725,text:'d'}];
  assert.equal(transcriptText(cues),'[00:00] a b\n[00:31] c\n[1:02:05] d');
  assert.equal(stamp(725),'12:05');
  assert.equal(decodeEntities('&amp;#39;&#x41;&quot;'),`'A"`);
});

test('human captions in the wanted language win, then automatic ones',()=>{
  const t=(lang:string,auto=false)=>({url:lang+(auto?'-asr':''),lang,auto});
  assert.deepEqual(pickTrack([t('de'),t('en',true),t('en-GB'),t('fr',true)],['en-US']).map(x=>x.url),['en-GB','en-asr','de','fr-asr']);
  assert.deepEqual(pickTrack([t('ar',true),t('en',true)],['ar-EG','en']).map(x=>x.url),['ar-asr','en-asr']);
});

test('asking what a video says is told apart from asking for videos',()=>{
  for(const s of ['make notes from this video','summarize https://youtu.be/abcdefghijk','what does the lecture say about entropy?','key points of these videos','flashcards from the recording','what is at 12:30']) assert.equal(videoContentIntent(s),true,s);
  for(const s of ['find me youtube videos on entropy','play the lecture','hello']) assert.equal(videoContentIntent(s),false,s);
});

test('the model gets the transcript, how it was made and what was left out',()=>{
  const long=Array.from({length:400},(_,i)=>`[${stamp(i*30)}] words of part ${i} `.padEnd(120,'x')).join('\n');
  const text=videoContext([
    {source:'youtube',id:'abcdefghijk',title:'Entropy',channel:'MIT',durationSec:3000,transcript:long,auto:true,language:'English (auto-generated)'},
    {source:'drive',id:'vid1234567890',title:'Lecture 4.mp4',transcript:'',error:'Google Drive has no captions for this video yet.'},
  ],20000);
  assert.match(text,/VIDEO TRANSCRIPTS/);
  assert.match(text,/https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk · 50:00 long/);
  assert.match(text,/automatic \(speech recognition/);
  assert.match(text,/\[… the transcript from about [\d:]+ to [\d:]+ was left out/);
  assert.match(text,/words of part 0 /);assert.match(text,/words of part 399 /);
  assert.match(text,/drive:vid1234567890[\s\S]*Captions: not available\. Google Drive has no captions/);
  assert.ok(text.length<22000);
  assert.equal(videoContext([]),'');
});

test('the notes playbook comes with transcripts and the old "cannot transcribe" rule is gone',()=>{
  assert.ok(clemSkillsFor('hi',{videos:true}).some(s=>s.id==='video-notes'));
  assert.ok(clemSkillsFor('make notes on this lecture video').some(s=>s.id==='video-notes'));
  assert.ok(!clemSkillsFor('what is entropy').some(s=>s.id==='video-notes'));
  assert.doesNotMatch(clemSkillText('give me a youtube video on this and make notes'),/Clem cannot watch or transcribe/i);
  assert.ok(capabilityIndex.length<2200);
});

// A fake YouTube: the watch page (with a European consent step), the Android player endpoint and a caption track.
const PAGE=`<html><script>var ytcfg={"INNERTUBE_API_KEY": "KEY_123"};var ytInitialPlayerResponse = {"videoDetails":{"title":"Page title","author":"Chan","lengthSeconds":"600"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[]}}};var other={"a":"}"};</script></html>`;
function fakeYouTube(opts:{consent?:boolean;player?:unknown;track?:string;status?:number}={}){
  const calls:{url:string;init:RequestInit}[]=[];
  let consented=!opts.consent;
  const fetcher=(async(input:any,init:any={})=>{
    const url=String(input);calls.push({url,init});
    if(opts.status)return new Response('',{status:opts.status});
    if(url.startsWith('https://www.youtube.com/watch')){
      if(!consented&&!/CONSENT=YES\+abc/.test(init.headers.Cookie))return new Response(`<form action="https://consent.youtube.com/s"><input name="v" value="abc"></form>`);
      return new Response(PAGE);
    }
    if(url.startsWith('https://www.youtube.com/youtubei/v1/player?key=KEY_123')){
      assert.equal(JSON.parse(init.body).context.client.clientName,'ANDROID');
      return Response.json(opts.player??{videoDetails:{title:'Entropy &amp; you',author:'MIT',lengthSeconds:'3000',shortDescription:'About entropy'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[
        {baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=de&fmt=srv3',languageCode:'de',name:{runs:[{text:'German'}]}},
        {baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr&fmt=srv3',languageCode:'en',kind:'asr',name:{runs:[{text:'English (auto-generated)'}]}},
      ]}}});
    }
    if(url.startsWith('https://www.youtube.com/api/timedtext')){
      assert.doesNotMatch(url,/fmt=srv3/);
      return new Response(opts.track??(url.includes('lang=en')?`<transcript><text start="0" dur="2">entropy measures</text><text start="45" dur="2">disorder</text></transcript>`:''));
    }
    return new Response('nope',{status:404});
  }) as typeof fetch;
  return {calls,fetcher};
}

test('YouTube captions: consent page, Android player, best track, transcript',async()=>{
  const {fetcher,calls}=fakeYouTube({consent:true});
  const out=await youtubeCaptions('abcdefghijk',{fetcher,languages:['en-US']});
  assert.equal(out.error,undefined);
  assert.equal(out.title,'Entropy & you');assert.equal(out.channel,'MIT');assert.equal(out.durationSec,3000);
  assert.equal(out.transcript,'[00:00] entropy measures\n[00:45] disorder');
  assert.equal(out.auto,true);assert.equal(out.language,'English (auto-generated)');
  assert.equal(calls.filter(c=>c.url.includes('/watch')).length,2,'the consent cookie is sent on a second visit');
});

test('YouTube problems come back as reasons, never as a crash',async()=>{
  const none=await youtubeCaptions('abcdefghijk',{fetcher:fakeYouTube({player:{videoDetails:{title:'Silent film',lengthSeconds:'60',shortDescription:'A film'},captions:{}}}).fetcher});
  assert.match(none.error!,/no captions/);assert.equal(none.title,'Silent film');assert.equal(none.description,'A film');
  const age=await youtubeCaptions('abcdefghijk',{fetcher:fakeYouTube({player:{playabilityStatus:{status:'LOGIN_REQUIRED',reason:'This video may be inappropriate for some users.'}}}).fetcher});
  assert.match(age.error!,/signed-in adults/);
  const busy=await youtubeCaptions('abcdefghijk',{fetcher:fakeYouTube({status:429}).fetcher});
  assert.match(busy.error!,/limiting requests/);
  const offline=await youtubeCaptions('abcdefghijk',{fetcher:(async()=>{throw new TypeError('fetch failed');}) as typeof fetch});
  assert.match(offline.error!,/couldn't be reached/);
  assert.match((await youtubeCaptions('bad')).error!,/isn't a YouTube/);
});

test('the page player JSON is read even with braces inside strings',()=>{
  assert.equal((embeddedJson(PAGE,'ytInitialPlayerResponse') as any).videoDetails.title,'Page title');
  assert.equal(findUrl({a:[{timedTextDetails:{timedTextBaseUrl:'https://drive.google.com/timedtext?id=1'}}]}),'https://drive.google.com/timedtext?id=1');
});

// A fake of clem.m4labs.xyz's token endpoint, the Drive API, Drive's playback service and its timed text.
function fakeDrive(opts:{playback?:'auth'|'key'|'none';sidecar?:boolean}={}){
  const calls:string[]=[];
  const fetcher=(async(input:any,init:any={})=>{
    const url=String(input),u=new URL(url),auth=(init.headers||{}).Authorization;calls.push(url);
    if(url.endsWith('/api/drive/token'))return Response.json({accessToken:'tok',expiresIn:3300});
    if(u.pathname==='/drive/v3/files/vid1234567890')return Response.json({id:'vid1234567890',name:'Lecture 4.mp4',mimeType:'video/mp4',parents:['folder123456'],videoMediaMetadata:{durationMillis:'3600000'}});
    if(u.pathname==='/drive/v3/files/doc1234567890')return Response.json({id:'doc1234567890',name:'Notes',mimeType:'application/vnd.google-apps.document'});
    if(u.host==='content-workspacevideo-pa.googleapis.com'){
      const ok=opts.playback==='auth'?auth==='Bearer tok':opts.playback==='key'?u.searchParams.get('key')&&!auth:false;
      return ok?Response.json({mediaStreamingData:{},timedTextDetails:{timedTextBaseUrl:'https://drive.google.com/timedtext?id=vid1234567890&vid=abc&sig=1'}}):Response.json({error:{code:403}},{status:403});
    }
    if(u.host==='drive.google.com'&&u.pathname==='/timedtext'){
      assert.equal(u.searchParams.get('sig'),'1');
      if(u.searchParams.get('type')==='list')return new Response(`<?xml version="1.0"?><transcript_list docid="1"><track id="0" name="" lang_code="en" lang_original="English" lang_translated="English" kind="asr"/></transcript_list>`);
      if(u.searchParams.get('type')==='track'&&u.searchParams.get('lang')==='en'&&u.searchParams.get('kind')==='asr')return new Response(`WEBVTT\n\n00:00:03.000 --> 00:00:05.000\nwelcome to lecture four`);
      return new Response('');
    }
    if(u.pathname==='/drive/v3/files'){
      assert.match(u.searchParams.get('q')!,/name contains 'Lecture 4' and \('folder123456' in parents\)/);
      return Response.json({files:opts.sidecar?[{id:'cap1234567890',name:'Lecture 4.en.srt',mimeType:'application/x-subrip',size:'100'},{id:'txt1234567890',name:'Lecture 4 transcript.txt',mimeType:'text/plain',size:'50'},{id:'vid1234567890',name:'Lecture 4.mp4',mimeType:'video/mp4'}]:[]});
    }
    if(u.pathname==='/drive/v3/files/cap1234567890')return new Response(`1\n00:01:00,000 --> 00:01:02,000\nfrom the srt file`);
    return new Response('nope',{status:404});
  }) as typeof fetch;
  return {calls,drive:new DriveLive(async()=>'session',fetcher,'https://clem.example')};
}

test("Drive captions: the video's own track, signed in or as the public player",async()=>{
  for(const playback of ['auth','key'] as const){
    const {drive}=fakeDrive({playback});
    const out=await drive.captions('vid1234567890',['en-US']);
    assert.equal(out.error,undefined,playback);
    assert.equal(out.transcript,'[00:03] welcome to lecture four');
    assert.equal(out.title,'Lecture 4.mp4');assert.equal(out.durationSec,3600);assert.equal(out.auto,true);
  }
});

test('Drive captions: a caption file beside the video, then a clear reason',async()=>{
  const side=await fakeDrive({playback:'none',sidecar:true}).drive.captions('vid1234567890');
  assert.equal(side.transcript,'[01:00] from the srt file');assert.equal(side.from,'Lecture 4.en.srt');
  const none=await fakeDrive({playback:'none'}).drive.captions('vid1234567890');
  assert.equal(none.transcript,'');assert.match(none.error!,/no captions for this video yet/);
  const doc=await fakeDrive().drive.captions('doc1234567890');
  assert.match(doc.error!,/isn't a video/);
});
