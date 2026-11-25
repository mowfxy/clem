import { useRef, useState } from 'react';
import { DownloadButton, SitePage, Window, megabytes, usePageTitle, useRelease, type Shot } from './shell';

/** The home page is one screen of words and one real window: the app's sky behind, one sentence, the download, and the
 *  views of the app under it. Every picture is a whole window of the real desktop build (scripts/site/capture.mjs). */
const VIEWS: { id: string; label: string; line: string; shot: Shot; alt: string }[] = [
  { id: 'home', label: 'Home', line: 'What’s due, what’s next, and a box to ask anything.', shot: 'home', alt: 'Clem’s home screen: a greeting to Sam, a message box, study activity, recent chats, the next exam in 12 days and what is up next.' },
  { id: 'clem', label: 'Clem', line: 'It speaks first: your day planned, and what it moved to make it fit.', shot: 'thread', alt: 'Clem’s main thread: plain messages about the student’s day, written by Clem.' },
  { id: 'answers', label: 'Answers', line: 'Answers from your own files, with the page each claim came from.', shot: 'cited', alt: 'Clem explaining why a potato gains mass in pure water, with citations to pages of Lab handout.pdf and the handout open beside it.' },
  { id: 'visuals', label: 'Visuals', line: 'Type /visual for a 3D model, a plot or a diagram you can play with.', shot: 'visual', alt: 'Clem showing a 3D model of methane.' },
  { id: 'subjects', label: 'Subjects', line: 'Each course with its files, flashcards and a plan to the exam.', shot: 'subject', alt: 'The Biology 101 subject in Clem: six cards to review and the midterm plan on track.' },
];

export function Landing() {
  usePageTitle('Clem: it plans your day before you ask', 'Clem is a free Windows app for studying. It plans your day, keeps the plan on track, and answers from your own files, on the ChatGPT, Claude, Grok or Google AI plan you already have.');
  const release = useRelease(), [at, setAt] = useState(0), tabs = useRef<HTMLDivElement>(null);
  const go = (i: number) => { const n = (i + VIEWS.length) % VIEWS.length; setAt(n); tabs.current?.querySelectorAll('button')[n].focus(); };
  return (
    <SitePage route="/" className="cs-landing">
      <section className="cs-hero">
        <h1>It plans your day before you&nbsp;ask.</h1>
        <p className="cs-lede">Clem is a free study app for Windows. It runs on the AI plan you already pay&nbsp;for.</p>
        <DownloadButton />
      </section>

      <section className="cs-views" aria-label="What Clem looks like">
        <div className="cs-tabs" role="tablist" aria-label="Views" ref={tabs} onKeyDown={(e) => { if (e.key === 'ArrowRight') go(at + 1); if (e.key === 'ArrowLeft') go(at - 1); }}>
          {VIEWS.map((v, i) => <button key={v.id} type="button" role="tab" id={`view-${v.id}`} aria-controls="view-panel" aria-selected={at === i} tabIndex={at === i ? 0 : -1} onClick={() => setAt(i)}>{v.label}</button>)}
        </div>
        <div className="cs-stack" role="tabpanel" id="view-panel" aria-labelledby={`view-${VIEWS[at].id}`}>
          {VIEWS.map((v, i) => <div key={v.id} className={at === i ? 'is-on' : ''} aria-hidden={at !== i}><Window shot={v.shot} alt={v.alt} eager={i === 0} /></div>)}
        </div>
        <p className="cs-view-line">{VIEWS[at].line}</p>
      </section>

      <section className="cs-plain" aria-label="Good to know">
        <div><h2>Your AI</h2><p>ChatGPT, Claude, Grok or Google AI, signed in on your PC. Nothing new to pay.</p></div>
        <div><h2>Your files</h2><p>Plain files in Documents\Clem. Nothing in a linked folder changes until you say so.</p></div>
        <div><h2>Free and open</h2><p>No plan, no trial, no card. The code is <a href="https://github.com/mowfxy/clem">on GitHub</a>.</p></div>
      </section>

      <section className="cs-end">
        <DownloadButton />
        <p className="cs-small">{release ? `Preview ${release.version} · ${megabytes(release.size)} · ` : ''}Windows 10 and 11 · <a href="#/download">Details</a></p>
        <p className="cs-small">Screens show an invented student.</p>
      </section>
    </SitePage>
  );
}
