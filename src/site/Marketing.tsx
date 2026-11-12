import {useEffect} from 'react';
import {Icon} from '../Icons';
import {Card,DownloadButton,LAB,REPO,Site} from './Site';

/** Clem's features, in the order of the app's own sidebar. */
const rooms:{id:string;icon:string;name:string;line:string;points:string[]}[]=[
  {id:'chat',icon:'chat',name:'Chat',line:'Answers from your own files.',points:['Citations link each claim to the file it came from.','Check sources tests an answer against your files, claim by claim.','Calculations end with a check that Clem recomputes itself.','Second opinion sends an answer to another connected model.','Chats run side by side, each answering on its own.']},
  {id:'visuals',icon:'visuals',name:'Visuals',line:'Ideas you can move.',points:['Type /visual and any topic, or just ask in plain words.','Plots with sliders, 3D surfaces to turn, diagrams to step through.','Export as PNG, SVG or PDF.','Saved visuals collect on their own page.']},
  {id:'projects',icon:'projects',name:'Projects',line:'Long work, kept together.',points:['A project holds its files, chats and instructions.','Link a folder from your PC or Google Drive.','A coordinator can hand parts of a job to agents and bring the results back, each on the model you choose.']},
  {id:'subjects',icon:'subjects',name:'Subjects',line:'A course from first lecture to exam.',points:['Overview, Chats, Plan, Flashcards, Quizzes, Files, Visuals and Memory.','Flashcards, quizzes and worksheets made from your own material.','FSRS spaced repetition, paced to your exam date.','Import decks from Anki and Quizlet.','Study reminders from Windows, and a subject you can share as one file.']},
  {id:'files',icon:'files',name:'Files',line:'Real files, on your PC.',points:['Everything lives in Documents\\Clem as plain files.','Typeset PDFs and real Word, PowerPoint and Excel files.','Tell Clem what to change: the same file changes, with Before, After and Undo.','Edits to linked folders arrive as changes you approve.','Encrypted backups, from Settings.']},
];
/** Links to the pages this replaced still land on the right room. */
const moved:Record<string,string>={'physics-diagrams':'visuals','technical-reports':'files','professional-documents':'files',presentations:'files',research:'chat','financial-analysis':'chat',learning:'subjects','connected-work':'projects'};

function Features({route}:{route:string}){
  const part=route.split('/')[2],target=part?moved[part]||part:'';
  useEffect(()=>{document.title='What Clem does';if(target)document.getElementById(target)?.scrollIntoView();else window.scrollTo(0,0);},[target]);
  return <div className="o-rooms">
    <nav className="o-glass o-rail" aria-label="Features">{rooms.map(r=><a key={r.id} href={'#/features/'+r.id} aria-current={target===r.id?'true':undefined}><Icon name={r.icon} size={18}/>{r.name}</a>)}</nav>
    <div>
      <h1>What Clem does.</h1>
      {rooms.map(r=><section key={r.id} id={r.id} aria-labelledby={r.id+'-title'}>
        <h2 id={r.id+'-title'}>{r.line}</h2>
        <p className="o-fine">{r.name}</p>
        <ul>{r.points.map(p=><li key={p}>{p}</li>)}</ul>
      </section>)}
      <p className="o-rooms-end"><DownloadButton/></p>
    </div>
  </div>;
}

function About(){
  useEffect(()=>{document.title='About Clem';window.scrollTo(0,0);},[]);
  return <Card title="About Clem.">
    <p>Clem is one quiet window for the work you bring to an AI: a course, a research question, a report, a pile of PDFs.</p>
    <p>It’s the first app from <a href={LAB}>M4 Labs</a>, a research lab studying how AI can work alongside people. It’s free, and <a href={REPO}>the code is open</a>.</p>
  </Card>;
}

/** Where people get help with Clem: email for the app and their account, GitHub for bugs and ideas. */
function Support(){
  useEffect(()=>{document.title='Support: Clem';window.scrollTo(0,0);},[]);
  return <Card title="Support.">
    <p>In the app, Settings, then Help &amp; support, opens a case that staff answer inside Clem.</p>
    <div className="o-card-links">
      <a href="mailto:support@m4labs.xyz"><Icon name="mail" size={18}/>support@m4labs.xyz</a>
      <a href={REPO+'/issues/new/choose'}><Icon name="github" size={18}/>Report a bug on GitHub</a>
    </div>
  </Card>;
}

export function Marketing({route}:{route:string}){
  const page=route==='/about'?<About/>:route==='/support'||route==='/pricing'?<Support/>:<Features route={route}/>;
  return <Site page={route}>{page}</Site>;
}
