import {TrajectoryDiagram} from './TrajectoryDiagram';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Icon } from './Icons';
import { downloadMade } from './store';

type Data = { points:{x:number;y:number}[]; apex:{x:number;y:number};range:number;flightTime:number;maxHeight:number;svg:string;latex:string };
export default function Visual({compact=false}:{compact?:boolean}){
 const host=useRef<HTMLDivElement>(null);const [angle,setAngle]=useState(45);const [speed,setSpeed]=useState(15);const [data,setData]=useState<Data>();const [error,setError]=useState('');const [view,setView]=useState<'3d'|'diagram'>('3d');
 useEffect(()=>{const controller=new AbortController();setError('');fetch(`/api/diagram?angle=${angle}&speed=${speed}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('The diagram service is unavailable. Try again shortly.');return r.json();}).then(setData).catch(e=>{if(e.name!=='AbortError')setError('The diagram service is unavailable. Try again shortly.');});return()=>controller.abort();},[angle,speed]);
 useEffect(()=>{
  if(!host.current||!data||view!=='3d')return;
  const element=host.current;const scene=new THREE.Scene();scene.background=new THREE.Color('#1d1d1d');
  const camera=new THREE.PerspectiveCamera(36,1,0.1,500);const range=data.range;const scale=Math.max(range,data.maxHeight*2,10);camera.position.set(range*.56,scale*.7,scale*1.1);
  let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});}catch{setError('3D rendering is unavailable on this device. Choose Diagram for the accessible static view.');return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));element.appendChild(renderer.domElement);
  const labels=new CSS2DRenderer();labels.domElement.className='scene-labels';element.appendChild(labels.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(range*.48,data.maxHeight*.35,0);controls.enableDamping=false;controls.minDistance=5;controls.maxDistance=100;
  const grid=new THREE.GridHelper(Math.ceil(scale*1.5),12,'#4f4f4f','#333333');grid.position.x=range*.45;scene.add(grid);
  const points=data.points.map(p=>new THREE.Vector3(p.x,p.y,0));const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#b9b9b9'}));scene.add(line);
  const sphere=new THREE.SphereGeometry(scale*.009,16,12);const material=new THREE.MeshBasicMaterial({color:'#cfcfcf'});
  const addLabel=(text:string,x:number,y:number)=>{const dot=new THREE.Mesh(sphere,material);dot.position.set(x,y,0);scene.add(dot);const el=document.createElement('span');el.className='scene-label';el.textContent=text;const label=new CSS2DObject(el);label.position.set(x,y+scale*.035,0);scene.add(label);};
  addLabel('Launch',0,0);addLabel(`Apex · ${data.maxHeight.toFixed(2)} m`,data.apex.x,data.apex.y);addLabel(`${range.toFixed(2)} m`,range,0);
  scene.add(new THREE.ArrowHelper(new THREE.Vector3(Math.cos(angle*Math.PI/180),Math.sin(angle*Math.PI/180),0),new THREE.Vector3(),scale*.2,0xcfa184,scale*.04,scale*.02));
  const render=()=>{renderer.render(scene,camera);labels.render(scene,camera);};
  const observer=new ResizeObserver(()=>{const w=element.clientWidth,h=element.clientHeight;renderer.setSize(w,h);labels.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();});observer.observe(element);controls.addEventListener('change',render);controls.update();render();
  return()=>{observer.disconnect();controls.removeEventListener('change',render);controls.dispose();renderer.dispose();line.geometry.dispose();(line.material as THREE.Material).dispose();sphere.dispose();material.dispose();grid.geometry.dispose();if(Array.isArray(grid.material))grid.material.forEach(m=>m.dispose());else grid.material.dispose();element.replaceChildren();};
 },[data,view,angle]);
 return <section className={`visual-engine ${compact?'compact':''}`} aria-label="Interactive projectile motion">
  <div className="visual-heading"><span><Icon name="visuals"/> Projectile motion</span><div className="segmented"><button aria-pressed={view==='3d'} onClick={()=>setView('3d')}>Explore 3D</button><button aria-pressed={view==='diagram'} onClick={()=>setView('diagram')}>Diagram</button></div></div>
  {error&&<p className="inline-error" role="status">{error}</p>}
  {view==='3d'?<div className="scene" ref={host} aria-label="Three-dimensional trajectory. Drag to orbit, scroll to zoom."/>:data&&<TrajectoryDiagram {...data}/>}
  <div className="visual-controls"><label>Launch angle <span>{angle}°</span><input aria-label="Launch angle" type="range" min="10" max="80" value={angle} onChange={e=>setAngle(+e.target.value)}/></label><label>Initial speed <span>{speed} m/s</span><input aria-label="Initial speed" type="range" min="5" max="30" value={speed} onChange={e=>setSpeed(+e.target.value)}/></label></div>
  <div className="visual-caption">{data?`Flight time ${data.flightTime.toFixed(2)} s · Gravity 9.81 m/s² · No air resistance`:'Deterministic physics · Kinetra + Three.js'}<span>Drag to orbit</span></div>
  {!compact&&<div className="visual-exports"><button disabled={!data} onClick={()=>data&&downloadMade(new Blob([data.svg],{type:'image/svg+xml'}),'projectile.svg')}><Icon name="download" size={17}/> Save SVG</button><button disabled={!data} onClick={()=>data&&downloadMade(new Blob([data.latex],{type:'text/plain'}),'projectile.tex')}>LaTeX source</button><button disabled={!data} onClick={()=>{if(data)void import("./visual-pdf").then(m=>m.exportDiagramPdf(data.svg)).catch(()=>setError("Could not export PDF. Please try again."));}}>Save PDF</button></div>}
 </section>;
}
