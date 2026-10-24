import {lazy,Suspense,useEffect,useState} from 'react';
import {Icon,Logo} from '../Icons';
import {ClaudeLogo,GeminiLogo,GrokLogo,OpenAILogo} from '../BrandLogos';
import {features} from '../features';
import {Illustration} from '../Illustrations';
import {AsciiField} from '../chat/AsciiField';
import '../chat/ascii-field.css';
import type {Scene} from '../vectorFilm';
import {useClock} from './clock';
import {Arrive,Underline,useSeen,Written} from './motion';
import {InkFilm} from './InkFilm';
import {Demo} from './Story';
import {Site} from './SiteHeader';
import {Faq,REPO} from './sections';

const SpecDemo=lazy(()=>import('./SpecDemo'));

// Provider-specific pages are not part of the product story.
export const shown=features.filter(f=>f.id!=='multi-model-work');
/** Each feature's plate: the ink drawing that acts it out. */
export const plates:Record<string,Scene>={'financial-analysis':'balance','physics-diagrams':'build','technical-reports':'pencil',research:'telescope',learning:'sprout',presentations:'kite','professional-documents':'checklist','connected-work':'bridge'};

/** Clem's thinking: three cursors hopping in turn, with what it is doing beside them. */
export function Thinking({label}:{label:string}){return <span className="cl-thinking" role="status"><Logo size={22} thinking/><span>{label}</span></span>;}

const demos:{ask:string;spec:string;doing:string}[]=[
  {ask:'why a long cable rings',spec:'ringing',doing:'drawing the response'},
  {ask:'partial derivatives in 3D',spec:'partials',doing:'drawing the surface'},
  {ask:'a methane molecule',spec:'methane',doing:'placing the atoms'},
];
/** The real visual engine, the one the app runs, loaded as its section comes near. */
function VisualDemo(){
  const [ref,near]=useSeen<HTMLDivElement>('400px'),[pick,setPick]=useState(0),demo=demos[pick];
  return <div ref={ref} className="cl-visual">
    <div className="cl-visual-asks" role="tablist" aria-label="Choose a visual">{demos.map((d,i)=><button key={d.ask} type="button" role="tab" aria-selected={pick===i} onClick={()=>setPick(i)}><span>/visual</span> {d.ask}</button>)}</div>
    <div className="cl-visual-stage">{near?<Suspense fallback={<div className="cl-visual-wait"><Thinking label={demo.doing}/></div>}><SpecDemo key={demo.spec} name={demo.spec}/></Suspense>:<div className="cl-visual-wait"><Thinking label={demo.doing}/></div>}</div>
  </div>;
}

const providers=[
  {name:'ChatGPT',plan:'A paid ChatGPT plan',logo:<OpenAILogo size={34}/>},
  {name:'Claude',plan:'Pro or Max',logo:<ClaudeLogo size={34}/>},
  {name:'Grok',plan:'SuperGrok or X Premium+',logo:<GrokLogo size={34}/>},
  {name:'Gemini',plan:'A Google AI plan',logo:<GeminiLogo size={34}/>},
];

function Download({label='Download for Windows'}:{label?:string}){
  return <a className="cl-btn" href="/download/windows"><svg className="cl-win-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2.6 6.6 1.8v5.4H1zM7.4 1.7 15 .6v6.6H7.4zM1 8h5.6v5.4L1 12.6zm6.4 0H15v6.6l-7.6-1.1z"/></svg>{label}</a>;
}

export function Landing(){
  const {greeting}=useClock();
  useEffect(()=>{document.title='Clem: your space to think';},[]);
  return <Site>
    <section className="cl-hero" aria-labelledby="cl-hero-title">
      <AsciiField/>
      <div className="cl-wrap cl-hero-inner">
        <p className="cl-greet cl-hero-greet"><Logo size={34} still/>{greeting}, thinker.</p>
        <h1 id="cl-hero-title" className="cl-display"><span className="cl-line"><span>Your space</span></span><span className="cl-line"><span>to <Underline>think.</Underline></span></span></h1>
        <p className="cl-lede cl-hero-lede">Clem is a calm desktop workspace for study, research and writing. It keeps your notes, chats, flashcards and drafts together, and answers with the AI plan you already have.</p>
        <div className="cl-actions"><Download/><a className="cl-link" href={REPO}><Icon name="github" size={18}/>View source</a></div>
        <p className="cl-fine">Free · Open source · Windows 10 and 11</p>
      </div>
    </section>

    <section className="cl-section cl-film-section" id="film" aria-label="The film">
      <div className="cl-wrap"><InkFilm/></div>
    </section>

    <section className="cl-section" id="how" aria-labelledby="how-title">
      <div className="cl-wrap">
        <div className="cl-head">
          <p className="cl-kicker">How it works</p>
          <Written as="h2" lines={['One question,','all the way through.']} className="cl-h2"/>
          <p className="cl-lede" id="how-title">A real study question, from the first line typed to the report handed in. Pick any step, or let it play.</p>
        </div>
        <Demo/>
      </div>
    </section>

    <section className="cl-section cl-band" id="visuals" aria-labelledby="visuals-title">
      <div className="cl-wrap cl-visual-grid">
        <div className="cl-head">
          <p className="cl-kicker">/visual</p>
          <Written as="h2" lines={['See it','move.']} className="cl-h2"/>
          <p className="cl-lede" id="visuals-title">Ask for any idea and Clem draws it as something you can play with: sliders with consequences, 3D you can turn, steps you can replay. This is the same engine the app runs. Try it.</p>
          <Illustration scene="build" className="cl-plate cl-visual-plate"/>
        </div>
        <VisualDemo/>
      </div>
    </section>

    <section className="cl-section" id="features" aria-labelledby="features-title">
      <div className="cl-wrap">
        <div className="cl-head cl-head-row">
          <Written as="h2" lines={['Bring any kind','of work.']} className="cl-h2"/>
          <p className="cl-lede" id="features-title">Subjects and projects hold your files, chats and drafts together, so the next question starts where the last one ended.</p>
        </div>
        <Arrive as="ul" className="cl-plates" step={60}>{shown.map((f,i)=><li key={f.id}><a href={'#/features/'+f.id}>
          <Illustration scene={plates[f.id]} className="cl-plate"/>
          <span className="cl-num">{String(i+1).padStart(2,'0')}</span>
          <h3>{f.title}</h3>
          <p>{f.line}</p>
          <span className="cl-more">Read more<Icon name="arrow" size={16}/></span>
        </a></li>)}</Arrive>
      </div>
    </section>

    <section className="cl-section cl-band" id="ai" aria-labelledby="ai-title">
      <div className="cl-wrap cl-ai">
        <div className="cl-head">
          <Written as="h2" lines={['Bring the AI you','already pay for.']} className="cl-h2"/>
          <p className="cl-lede" id="ai-title">Clem is the workspace. The thinking comes from the plan you have, signed in on your PC. No second subscription, no API keys.</p>
        </div>
        <Illustration scene="plug" className="cl-plate cl-ai-plate"/>
        <Arrive as="ul" className="cl-providers" step={80}>{providers.map(p=><li key={p.name}>{p.logo}<b>{p.name}</b><span>{p.plan}</span></li>)}</Arrive>
      </div>
    </section>

    <section className="cl-section" id="yours" aria-label="Yours, and open">
      <div className="cl-wrap cl-pair">
        <div>
          <Illustration scene="house" className="cl-plate"/>
          <Written as="h2" lines={['Yours.','On your PC.']} className="cl-h3x"/>
          <p className="cl-body">Every chat, card and draft is a plain file in <code>Documents\Clem</code>. Open it, move it, back it up. Only what you choose is sent, and only to the AI you choose.</p>
        </div>
        <div>
          <Illustration scene="key" className="cl-plate"/>
          <Written as="h2" lines={['Open source.','All of it.']} className="cl-h3x"/>
          <p className="cl-body">The app, the website and the account service are on GitHub under the MIT License. Read every line, build it yourself or send a fix.</p>
          <a className="cl-link" href={REPO}><Icon name="github" size={18}/>github.com/mowfxy/clem</a>
        </div>
      </div>
    </section>

    <section className="cl-section" id="faq" aria-labelledby="faq-title">
      <div className="cl-wrap cl-faq-grid">
        <div className="cl-head"><Written as="h2" lines={['Questions.']} className="cl-h2"/><p className="cl-lede" id="faq-title">Anything else: <a href="mailto:support@m4labs.xyz">support@m4labs.xyz</a></p></div>
        <Faq/>
      </div>
    </section>

    <section className="cl-section cl-final" aria-label="Download Clem">
      <div className="cl-wrap">
        <Illustration scene="plane" className="cl-plate cl-final-plate"/>
        <Written as="h2" lines={['What’s on','your mind?']} className="cl-display cl-final-title"/>
        <div className="cl-actions"><Download/></div>
        <p className="cl-fine">Free and open source. Windows 10 and 11, 64-bit.</p>
      </div>
    </section>
  </Site>;
}
