import { Descent } from './Descent';
import { DownloadButton, SitePage, Window, megabytes, usePageTitle, useRelease } from './shell';

/** The home page. Every picture of Clem is a whole window of the real desktop build; nothing of the app is rebuilt. */
export function Landing() {
  usePageTitle('Clem: study with the AI you already pay for', 'Clem is a free Windows app for subjects, plans, flashcards and answers that cite your own files, running on the ChatGPT, Claude, Grok or Google AI plan you already have.');
  const release = useRelease();
  return (
    <SitePage route="/" className="cs-landing">
      <Descent
        copy={<>
          <h1>Study with the AI you already pay&nbsp;for.</h1>
          <p className="cs-lede">Clem is a free Windows app for subjects, plans, flashcards and answers that cite your own files. It runs on the ChatGPT, Claude, Grok or Google AI plan you have now.</p>
          <div className="cs-actions">
            <DownloadButton />
            <a className="cs-link" href="#/features">What it does</a>
          </div>
          <p className="cs-meta">Free · Windows 10 and 11 · {release ? `Preview ${release.version}` : 'Preview'}</p>
        </>}
        arrival={<Window shot="home" eager alt="Clem’s home screen at night: the greeting “Late night, Sam.”, a message box, study activity, recent chats, the next exam in 11 days, and what is up next." caption={<><b>Home.</b> Your greeting, the message box, and what is due, counted from your own work.</>} />}
      />

      <section className="cs-chapter cs-split" aria-labelledby="h-research">
        <div className="cs-words">
          <h2 id="h-research">Answers that open your file at the page.</h2>
          <p>Ask about your reading and every claim carries its page. Click one and the PDF opens beside the chat, right there. Under each answer, Clem checks which claims your files actually support.</p>
          <a className="cs-link" href="#/features/research">Research in Clem</a>
        </div>
        <Window shot="cited" alt="A Clem chat explaining why a potato gains mass in pure water, with three citations to Lab handout.pdf and the handout open beside it." />
      </section>

      <section className="cs-chapter cs-centred" aria-labelledby="h-play">
        <div className="cs-words is-centred">
          <h2 id="h-play">Type /visual, then turn the idea over.</h2>
          <p>Ask why methane is a tetrahedron and Clem builds the molecule in 3D, from real bond lengths and angles, for you to turn.</p>
          <a className="cs-link" href="#/features/physics-diagrams">Visuals in Clem</a>
        </div>
        <Window shot="visual" alt="Clem showing a 3D model of methane: a carbon atom with four hydrogens at the corners of a tetrahedron, in the chat that asked why methane has that shape." />
      </section>

      <section className="cs-chapter cs-split" aria-labelledby="h-study">
        <div className="cs-words">
          <h2 id="h-study">A subject that knows when the exam&nbsp;is.</h2>
          <p>Each course gets a subject: its files, its chats, its flashcards and a plan for the weeks before the exam. Cards are scheduled with FSRS spaced repetition, so the six due today are the six worth doing.</p>
          <a className="cs-link" href="#/features/learning">Learning in Clem</a>
        </div>
        <Window shot="subject" alt="The Biology 101 subject: six cards to review, the midterm plan 25% done and on track, recent chats and recent files." />
      </section>

      <section className="cs-chapter cs-split is-flipped" aria-labelledby="h-plans">
        <div className="cs-words">
          <h2 id="h-plans">No new subscription.</h2>
          <p>Clem works through the official tools of the AI you already pay for, signed in on your PC: Codex, Claude Code, the Grok CLI and Antigravity. Pick a model per chat, ask another for a second opinion, and keep going when one account runs low.</p>
          <a className="cs-link" href="#/features/multi-model-work">Multi-model work</a>
        </div>
        <Window shot="models" alt="Clem’s Settings on the Models page, with ChatGPT, Claude, Grok and Gemini, one ChatGPT account in use, and automatic account switching on." />
      </section>

      <section className="cs-chapter cs-split" aria-labelledby="h-files">
        <div className="cs-words">
          <h2 id="h-files">Your work stays in Documents\Clem.</h2>
          <p>Chats, files, flashcards and drafts are plain files on your PC. Link a folder, here or in Google Drive, and Clem reads it in place. When it wants to change a file, it shows you first.</p>
          <a className="cs-link" href="#/features/connected-work">Connected work</a>
        </div>
        <Window shot="files" alt="Clem’s Files page: everything you have added, kept on this PC, private to the device." />
      </section>

      <section className="cs-chapter cs-open" aria-labelledby="h-open">
        <p className="cs-quote" id="h-open">“Make room for doubt. Check the things that matter.”</p>
        <p className="cs-quote-note">The line under every message box in Clem. The same goes for the app: every line of it is on GitHub under the MIT License.</p>
        <a className="cs-link" href="https://github.com/mowfxy/clem">Read the source</a>
      </section>

      <section className="cs-chapter cs-final" aria-labelledby="h-final">
        <h2 id="h-final">Clem for Windows.</h2>
        <DownloadButton />
        <dl className="cs-facts">
          <div><dt>Price</dt><dd>Free, no card</dd></div>
          <div><dt>Version</dt><dd>{release ? `${release.version} preview` : 'Preview'}</dd></div>
          <div><dt>Size</dt><dd>{release ? megabytes(release.size) : '—'}</dd></div>
          <div><dt>Needs</dt><dd>Windows 10 or 11, 64-bit, and an AI plan</dd></div>
        </dl>
        <p className="cs-small">{release && !release.signed ? 'The installer is not code-signed yet, so Windows may ask whether you trust it. ' : ''}<a href="#/download">Checksums and details</a></p>
      </section>
    </SitePage>
  );
}
