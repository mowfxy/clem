import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playlistFromData,youtubePlaylist} from '../desktop/video-captions.ts';
import {videoDocument,videoRecord,linkDocument,linkRecord,readsLive,captionsLabel,saveVideos,transcriptOf,videoFileName,readVideoLink,shownName} from '../src/files/saved-video.ts';

test('both playlist page layouts give the videos in order, the title and the next page',()=>{
  const old={metadata:{playlistMetadataRenderer:{title:'Unit 2 &amp; more'}},contents:[{playlistVideoRenderer:{videoId:'aaaaaaaaaa1',title:{runs:[{text:'First'}]},shortBylineText:{runs:[{text:'Chan'}]},lengthSeconds:'61'}},{playlistVideoRenderer:{videoId:'bbbbbbbbbb2',title:{simpleText:'Gone'},isPlayable:false}},{playlistVideoRenderer:{videoId:'aaaaaaaaaa1'}},{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'NEXT'}}}}]};
  assert.deepEqual(playlistFromData(old),{title:'Unit 2 & more',videos:[{id:'aaaaaaaaaa1',title:'First',channel:'Chan',durationSec:61}],next:'NEXT'});
  const lockup={header:{playlistHeaderRenderer:{title:{simpleText:'New layout'}}},items:[{lockupViewModel:{contentId:'ccccccccccc',contentType:'LOCKUP_CONTENT_TYPE_VIDEO',metadata:{lockupMetadataViewModel:{title:{content:'Third'},metadata:{contentMetadataViewModel:{metadataRows:[{metadataParts:[{text:{content:'Other'}}]}]}}}}}},{lockupViewModel:{contentId:'PLnotavideo',contentType:'LOCKUP_CONTENT_TYPE_PLAYLIST'}}]};
  assert.deepEqual(playlistFromData(lockup),{title:'New layout',videos:[{id:'ccccccccccc',title:'Third',channel:'Other'}],next:undefined});
});

test('a playlist is read from its page and then a page at a time',async()=>{
  const page=(n:number,from:number)=>({playlistVideoRenderer:{videoId:String(from+n).padStart(11,'v'),title:{simpleText:'Video '+(from+n)}}});
  const first={metadata:{playlistMetadataRenderer:{title:'Long'}},contents:[...Array.from({length:3},(_,i)=>page(i,0)),{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'T1'}}}}]};
  const html=`<script>var ytInitialData = ${JSON.stringify(first)};</script>"INNERTUBE_API_KEY":"KEY","INNERTUBE_CLIENT_VERSION":"2.1"`;
  const calls:string[]=[];
  const fetcher=(async(url:string,init?:RequestInit)=>{calls.push(url);if(url.includes('/browse'))return new Response(JSON.stringify({onResponseReceivedActions:[{appendContinuationItemsAction:{continuationItems:[page(0,10),page(1,10)]}}]}));return new Response(html);}) as typeof fetch;
  const list=await youtubePlaylist('PLlongplaylist',{fetcher});
  assert.equal(list.title,'Long');
  assert.deepEqual(list.videos.map(v=>v.title),['Video 0','Video 1','Video 2','Video 10','Video 11']);
  assert.equal(calls.filter(c=>c.includes('/browse')).length,1,'stops when a page has no next');
  assert.match((await youtubePlaylist('RDmixmixmix',{fetcher})).error||'',/mixes/);
});

test('a saved video is a Markdown file with its transcript, read by the viewer',()=>{
  const c={source:'youtube' as const,id:'abcdefghijk',title:'Osmosis: a/b?',channel:'Cell Lab',durationSec:125,transcript:'[00:00] Water moves.\n[00:31] Cells swell.',language:'English',auto:true};
  const doc=videoDocument(c,{id:'PLxxxxxxxxxx',title:'Unit 2'});
  assert.match(doc,/^# Osmosis: a\/b\?\n\nYouTube video by Cell Lab · 02:05 long\nLink: https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk\nPlaylist: Unit 2/);
  assert.match(doc,/Captions: automatic .* · English\n\n## Transcript\n\n\[00:00\] Water moves\.\n\n\[00:31\] Cells swell\.\n$/);
  assert.deepEqual(transcriptOf(doc),[{start:0,text:'Water moves.'},{start:31,text:'Cells swell.'}]);
  assert.deepEqual(videoRecord(c),{id:'abcdefghijk',channel:'Cell Lab',durationSec:125,captions:'auto',language:'English'});
  assert.equal(videoFileName(c.title),'Osmosis a b.md');
  assert.equal(shownName({name:'Osmosis a b.md',video:videoRecord(c)}),'Osmosis a b');
});

test('a saved video keeps its details and link, never a transcript',async()=>{
  const c={source:'youtube' as const,id:'abcdefghijk',title:'Osmosis',channel:'Cell Lab',durationSec:125,transcript:'[00:00] Water moves.',description:'About water.'};
  const doc=linkDocument(c,{id:'PLxxxxxxxxxx',title:'Unit 2'});
  assert.match(doc,/^# Osmosis\n\nYouTube video by Cell Lab · 02:05 long\nLink: https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk\nPlaylist: Unit 2/);
  assert.match(doc,/Transcript: not kept in this file\. Clem reads the video's captions when it is asked about/);
  assert.doesNotMatch(doc,/Water moves/);
  assert.deepEqual(transcriptOf(doc),[]);
  const record=linkRecord(c,{id:'PLxxxxxxxxxx',title:'Unit 2'});
  assert.deepEqual(record,{id:'abcdefghijk',channel:'Cell Lab',durationSec:125,captions:'live',playlist:{id:'PLxxxxxxxxxx',title:'Unit 2'}});
  assert.ok(readsLive(record));assert.equal(captionsLabel(record),'Link');
  // Older saves: a kept transcript is read from the file; one saved without captions is read live now.
  assert.ok(!readsLive(videoRecord(c)));assert.ok(readsLive({id:'abcdefghijk',captions:'none'}));
  // A playlist's videos are saved from what the playlist lists: no captions are read and no transcript is stored.
  const stored:string[]=[];
  const {files}=await saveVideos([{id:'abcdefghijk',title:'One',channel:'C',durationSec:60},{id:'bcdefghijkl',title:'Two'}],{place:null,playlist:{id:'PLxxxxxxxxxx',title:'Unit 2'},existing:[],store:async(_id,blob)=>{stored.push(await blob.text());}});
  assert.deepEqual(files.map(f=>[f.name,f.video?.captions]),[['One.md','live'],['Two.md','live']]);
  assert.ok(stored.every(t=>/Transcript: not kept/.test(t)&&!/## Transcript/.test(t)));
});

test('a video with no captions is kept and says it has no transcript',()=>{
  const c={source:'youtube' as const,id:'abcdefghijk',title:'Silent',transcript:'',error:'This video has no captions.',description:'Shot in the lab.'};
  const doc=videoDocument(c);
  assert.match(doc,/Captions: not available\. This video has no captions\. There is no transcript/);
  assert.match(doc,/## Description\n\nThe video's own description, not a transcript:\n\nShot in the lab\./);
  assert.doesNotMatch(doc,/## Transcript/);
  assert.deepEqual(transcriptOf(doc),[]);
  assert.equal(videoRecord(c).captions,'none');
});

test('pasted links: a video, a playlist, or a video inside a playlist',()=>{
  assert.equal(readVideoLink('https://youtu.be/abcdefghijk')?.video?.id,'abcdefghijk');
  assert.equal(readVideoLink('https://www.youtube.com/playlist?list=PL1234567890')?.playlist?.id,'PL1234567890');
  const both=readVideoLink(' https://www.youtube.com/watch?v=abcdefghijk&list=PL1234567890 ');
  assert.equal(both?.video?.id,'abcdefghijk');assert.equal(both?.playlist?.id,'PL1234567890');
  assert.equal(readVideoLink('https://vimeo.com/123'),null);
  // A video opened from a Mix is just the video: Mixes can't be saved.
  const mix=readVideoLink('https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk&start_radio=1');
  assert.equal(mix?.video?.id,'abcdefghijk');
  assert.equal(mix?.playlist,undefined);
});
