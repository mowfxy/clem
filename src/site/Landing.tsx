import {useEffect,type ReactNode} from 'react';
import {Logo} from '../Icons';
import {ClaudeLogo,GeminiLogo,GrokLogo,OpenAILogo} from '../BrandLogos';
import {AnswerPanel,ExamPanel,ModelsPanel,PlanPanel} from './Panels';
import {DownloadButton,LAB,REPO,Shot,Site} from './Site';

const keys:[string[],string][]=[
  [['Ctrl','K'],'Jump to any chat, subject or setting'],
  [['Ctrl','Shift','F'],'Search chats, files and notes at once'],
  [['Ctrl','Shift','Space'],'Capture part of your screen from any app and ask about it'],
];

const facts:[string,ReactNode][]=[
  ['Cost','Free. No plan, no trial, no card.'],
  ['You need','Windows 10 or 11, and a paid ChatGPT, Claude, Grok or Google AI plan.'],
  ['Your files','On your PC, in plain formats. Our account service only handles sign-in, support and your encrypted AI connections.'],
  ['Source',<>All of it, <a href={REPO}>on GitHub</a> under the MIT License.</>],
  ['Stage','A preview. Most of it is used daily, and some flows are still being verified.'],
  ['Made by',<><a href={LAB}>M4 Labs</a>, an AI research lab that also builds apps.</>],
];

export function Landing(){
  useEffect(()=>{document.title='Clem: study, research and write on your own PC';},[]);
  return <Site page="home">
    <section className="o-open" aria-labelledby="o-title">
      <div className="o-open-line">
        <p>A quiet Windows app for study, research and writing, running on the AI plan you already pay for.</p>
        <DownloadButton/>
      </div>
      <h1 id="o-title">clem</h1>
    </section>

    <section className="o-window" aria-label="Clem's home screen">
      <Shot name="home-dark" eager alt="Clem's home screen at night: the greeting and message box over a sunrise set in type, with study activity, recent chats, the next exam and what's up next on sheets of glass"/>
      <p className="o-note">The real app, in a demo workspace. Whole windows on this page are captures; smaller panels are redrawn for the web.</p>
    </section>

    <section className="o-yours" aria-labelledby="o-yours-title">
      <h2 id="o-yours-title">Clem has no AI of its own. It uses your <span><OpenAILogo size={40}/>ChatGPT</span>, <span><ClaudeLogo size={40}/>Claude</span>, <span><GrokLogo size={40}/>Grok</span> or <span><GeminiLogo size={40}/>Gemini</span>.</h2>
      <p>Sign in once on your PC. There are no API keys and no second subscription, and when one account runs low Clem can move to another.</p>
      <ModelsPanel/>
    </section>

    <section className="o-course" aria-labelledby="o-course-title">
      <div className="o-course-text">
        <h2 id="o-course-title">Every course gets a place.</h2>
        <p>Slides, notes, chats, flashcards, quizzes and a plan to the exam, in one subject. Bring your decks from Anki or Quizlet, and FSRS spaced repetition paces every card to the date.</p>
      </div>
      <Shot name="subject-dark" className="o-course-window" alt="The Biology 101 subject: six cards to review, a midterm plan on track, recent chats and files"/>
      <ExamPanel/>
      <PlanPanel/>
    </section>

    <section className="o-doubt" aria-labelledby="o-doubt-title">
      <h2 id="o-doubt-title">Don’t take its word for it.</h2>
      <p>Press a citation and the source opens beside the answer. Clem recomputes the numbers itself, and any answer can go to a second model for another opinion.</p>
      <AnswerPanel/>
    </section>

    <section id="sunrise" className="o-sunrise" aria-labelledby="o-sunrise-title">
      <div className="o-sunrise-stick">
        <div className="o-sunrise-text">
          <h2 id="o-sunrise-title">Ask to see it.</h2>
          <p>Type <kbd>/visual</kbd> and anything you’re stuck on. Clem draws a plot with sliders, a 3D surface to turn or a diagram to step through.</p>
        </div>
        <div className="o-sunrise-pane">
          <Shot name="visual-dark" eager alt="A live graph of why a long cable rings, with a slider for the cable length and readouts for phase margin and overshoot"/>
          <Shot name="visual-light" eager alt="" className="o-sunrise-light"/>
        </div>
      </div>
    </section>

    <section className="o-folder" aria-labelledby="o-folder-title">
      <h2 id="o-folder-title">Documents\Clem</h2>
      <Shot name="files-light" className="o-folder-window" alt="Clem's Files page in the light theme: a report draft, slides, a spreadsheet, a PDF and a syllabus, all kept on this PC"/>
      <div className="o-folder-text">
        <p>That’s where your work lives: plain files you can open, move or back up without Clem.</p>
        <p>Link other folders on your PC or in Google Drive. Clem reads them in place, and nothing is written until you approve the change.</p>
      </div>
    </section>

    <section className="o-make" aria-labelledby="o-make-title">
      <h2 id="o-make-title">Ask for the file, not a paragraph.</h2>
      <ul aria-label="File types Clem makes"><li>PDF</li><li>Word</li><li>PowerPoint</li><li>Excel</li></ul>
      <p>Reports, worksheets and summaries come back as real files. Tell Clem what to change and the same file changes, with Before and After to compare and Undo if you disagree.</p>
    </section>

    <section className="o-keys" aria-labelledby="o-keys-title">
      <h2 id="o-keys-title">It’s a desktop app, and it acts like one.</h2>
      <ul>{keys.map(([combo,what])=><li key={what}><span>{combo.map(k=><kbd key={k}>{k}</kbd>)}</span>{what}</li>)}</ul>
    </section>

    <section className="o-facts" aria-labelledby="o-facts-title">
      <h2 id="o-facts-title">The short version.</h2>
      <dl>{facts.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>

    <section className="o-welcome" aria-labelledby="o-welcome-title">
      <div className="o-card">
        <Logo size={40}/>
        <h2 id="o-welcome-title">Welcome to Clem.</h2>
        <p>Windows 10 and 11. Sign in, connect your AI, and start with a subject or a chat.</p>
        <DownloadButton/>
      </div>
    </section>
  </Site>;
}
