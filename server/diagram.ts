import { projectileAnalytics, projectilePosition, renderProjectile } from '../vendor/kinetra/packages/core/src/diagram/projectile.ts';
export function diagram(angle:number,speed:number){
 if(!Number.isFinite(angle)||angle<10||angle>80||!Number.isFinite(speed)||speed<5||speed>30)throw new Error('Angle must be 10–80° and speed 5–30 m/s.');
 const model={initialPosition:{x:0,y:0},initialSpeed:speed,launchAngleDeg:angle,gravity:9.81,width:800,height:460};
 const a=projectileAnalytics(model);const points=Array.from({length:121},(_,i)=>projectilePosition(model,a.flightTime*i/120));
 const svg=renderProjectile(model).replace(/font-family="[^"]*"/g,'font-family="Mowafy Serif, serif"');
 const coords=points.map(p=>`(${p.x.toFixed(5)},${p.y.toFixed(5)})`).join(' ');
 const latex=String.raw`\documentclass{article}
\usepackage{fontspec}
\setmainfont{MowafySerif-Regular.ttf}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage[margin=25mm]{geometry}
\begin{document}
\section*{Projectile motion}
Initial speed: ${speed} m/s. Launch angle: ${angle} degrees.
Constant gravity: 9.81 m/s$^2$. Ground-level launch, no air resistance.
\begin{center}\begin{tikzpicture}
\begin{axis}[width=14cm,axis equal image,axis lines=left,xlabel={$x$ (m)},ylabel={$y$ (m)},clip=false]
\addplot[thick] coordinates {${coords}};
\node[above] at (axis cs:${a.apex.position.x.toFixed(5)},${a.apex.position.y.toFixed(5)}) {Apex: ${a.maxHeight.toFixed(2)} m};
\end{axis}\end{tikzpicture}\end{center}
Flight time: ${a.flightTime.toFixed(3)} s. Range: ${a.range.distance.toFixed(3)} m.
\par Geometry calculated with Kinetra. Compile with XeLaTeX with the font TTF beside this file.
\end{document}`;
 return {points,apex:a.apex.position,range:a.range.distance,flightTime:a.flightTime,maxHeight:a.maxHeight,svg,latex};
}
