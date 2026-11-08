import { useEffect } from 'react';
import { FEATURES, featureById, type Feature } from './features-data';
import { DownloadButton, SitePage, Window, usePageTitle } from './shell';

/** #/features, #/features/<id>, #/about and #/support. #/pricing goes to support, where the price is answered. */
export function Marketing({ route }: { route: string }) {
  const pricing = route === '/pricing';
  useEffect(() => { if (pricing) history.replaceState(null, '', location.pathname + location.search + '#/support'); }, [pricing]);
  if (pricing || route === '/support') return <Support />;
  if (route === '/about') return <About />;
  const feature = featureById(route.replace(/^\/features\/?/, '').split(/[?#/]/)[0]);
  return feature ? <FeaturePage feature={feature} /> : <Features />;
}

function Features() {
  usePageTitle('What Clem does', 'Nine things Clem does with your files and the AI plan you already have: learning, research, visuals, reports, analysis, slides, documents, folders and models.');
  return (
    <SitePage route="/features" className="cs-index">
      <header className="cs-page-head">
        <h1>What Clem does.</h1>
        <p className="cs-lede">One window for the work you bring to an AI: a course, a research question, a report, a pile of PDFs. Nine ways in.</p>
      </header>
      <ol className="cs-list">
        {FEATURES.map((f, i) => (
          <li key={f.id} data-arrive style={{ '--i': i } as React.CSSProperties}>
            <a href={`#/features/${f.id}`}>
              <span className="cs-list-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="cs-list-name">{f.name}</span>
              <span className="cs-list-title">{f.title}</span>
              <span className="cs-list-line">{f.line}</span>
            </a>
          </li>
        ))}
      </ol>
      <Window shot="subjects" alt="Clem’s Subjects page listing Biology 101 and Calculus II with their exam dates." caption={<><b>Subjects.</b> Where most of the nine meet: each course with its files, chats, cards and plan.</>} />
    </SitePage>
  );
}

function FeaturePage({ feature: f }: { feature: Feature }) {
  usePageTitle(`${f.name}: Clem`, f.line);
  const at = FEATURES.indexOf(f), next = FEATURES[(at + 1) % FEATURES.length], prev = FEATURES[(at + FEATURES.length - 1) % FEATURES.length];
  return (
    <SitePage route={`/features/${f.id}`} className="cs-feature">
      <header className="cs-page-head">
        <a className="cs-back" href="#/features">Features</a>
        <p className="cs-kicker">{f.name}</p>
        <h1>{f.title}</h1>
        <p className="cs-lede">{f.line}</p>
      </header>
      <Window shot={f.shot} eager alt={f.alt} />
      <section className="cs-feature-body">
        <div className="cs-prose">{f.body.map((p) => <p key={p}>{p}</p>)}</div>
      </section>
      {f.more?.map(([shot, alt]) => <div className="cs-more" key={shot}><Window shot={shot} alt={alt} /></div>)}
      <section className="cs-points" aria-label="Also">
        {f.points.map(([title, text], i) => <div key={title} data-arrive style={{ '--i': i } as React.CSSProperties}><h3>{title}</h3><p>{text}</p></div>)}
      </section>
      <nav className="cs-next" aria-label="More features">
        <a href={`#/features/${prev.id}`}><small>Previous</small>{prev.name}</a>
        <a href={`#/features/${next.id}`}><small>Next</small>{next.name}</a>
      </nav>
    </SitePage>
  );
}

function About() {
  usePageTitle('About Clem', 'Clem is the first app from M4 Labs: free, open source under the MIT License, and built to run on the AI plan you already have.');
  return (
    <SitePage route="/about" className="cs-about">
      <header className="cs-page-head">
        <h1>One quiet place for the work you bring to an AI.</h1>
        <p className="cs-lede">Clem is the first app from <a href="https://m4labs.xyz">M4 Labs</a>, an AI research lab that also builds apps.</p>
      </header>
      <section className="cs-prose-page">
        <h2>Why it exists</h2>
        <p>Most people who study with an AI keep it in a browser tab, and their course in a dozen other places. Clem puts the course, its files and the AI in one window, and has the AI answer from your files instead of from memory.</p>
        <p>It doesn't sell you another subscription. You connect the ChatGPT, Claude, Grok or Google AI plan you already pay for, and Clem works through that service's own official tool on your PC.</p>
        <h2>How it works</h2>
        <ol className="cs-steps">
          <li data-arrive style={{ '--i': 0 } as React.CSSProperties}><b>Your files</b><span>Kept in Documents\Clem as plain files. Linked folders are read where they are.</span></li>
          <li data-arrive style={{ '--i': 1 } as React.CSSProperties}><b>The app</b><span>A Windows app built with Electron, React and TypeScript.</span></li>
          <li data-arrive style={{ '--i': 2 } as React.CSSProperties}><b>Your AI</b><span>Codex, Claude Code, the Grok CLI or Antigravity, each working in a folder of your files with its tools kept inside it.</span></li>
          <li data-arrive style={{ '--i': 3 } as React.CSSProperties}><b>The account service</b><span>Only sign-in, support and your encrypted AI connections. Your chats and files stay on your PC.</span></li>
        </ol>
        <h2>Open source</h2>
        <p>Every line of Clem is on <a href="https://github.com/mowfxy/clem">GitHub</a> under the MIT License. Read it, build it yourself, or send a fix.</p>
        <h2>A preview</h2>
        <p>Most of Clem is used every day, but some flows are still being checked. The list of what is tested and what is not is <a href="https://github.com/mowfxy/clem/blob/main/docs/PRODUCTION-STATUS.md">in the repository</a>.</p>
      </section>
      <Window shot="home" alt="Clem’s home screen: a greeting, a message box, study activity, recent chats, the next exam and what is up next." />
    </SitePage>
  );
}

const QUESTIONS: [string, React.ReactNode][] = [
  ['What does Clem cost?', <>Nothing. There is no plan, no trial and no card. You use the AI plan you already have, and Clem adds nothing to it.</>],
  ['Which AI plans work?', <>ChatGPT through Codex, Claude through Claude Code, Grok through the Grok CLI, and Google AI through Antigravity. Connect them in Settings, under Models.</>],
  ['Where is my work kept?', <>On your PC, in Documents\Clem, as plain files. The account service only handles sign-in, support and your encrypted AI connections.</>],
  ['Windows warned me about the installer.', <>The installer is not code-signed yet, so SmartScreen may ask whether you trust it. The download page lists its SHA-256 checksum, so you can check the file is ours.</>],
  ['Does it run on a Mac?', <>Not yet. Clem is for Windows 10 and 11, 64-bit.</>],
  ['Is it finished?', <>It is a preview. Most of it is used every day; some flows are still being checked.</>],
];

function Support() {
  usePageTitle('Support: Clem', 'Help with Clem: write to support@m4labs.xyz, ask from Settings in the app, or report a problem on GitHub.');
  return (
    <SitePage route="/support" className="cs-support">
      <header className="cs-page-head">
        <h1>Ask, and someone from M4 Labs answers.</h1>
        <p className="cs-lede">Write to <a href="mailto:support@m4labs.xyz">support@m4labs.xyz</a>, or open Settings in Clem and choose Help &amp; support, where replies arrive in the app.</p>
      </header>
      <section className="cs-ways">
        <a href="mailto:support@m4labs.xyz" data-arrive style={{ '--i': 0 } as React.CSSProperties}><b>Email</b><span>support@m4labs.xyz</span></a>
        <div data-arrive style={{ '--i': 1 } as React.CSSProperties}><b>In the app</b><span>Settings, then Help &amp; support</span></div>
        <a href="https://github.com/mowfxy/clem/issues" data-arrive style={{ '--i': 2 } as React.CSSProperties}><b>A bug</b><span>GitHub issues</span></a>
      </section>
      <section className="cs-faq" aria-label="Common questions">
        {QUESTIONS.map(([q, a], i) => <div key={q} data-arrive style={{ '--i': i } as React.CSSProperties}><h2>{q}</h2><p>{a}</p></div>)}
      </section>
      <section className="cs-final is-quiet"><DownloadButton /></section>
    </SitePage>
  );
}
