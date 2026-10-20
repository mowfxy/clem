import {Prompt} from './SiteHeader';

/** Clem's public source repository. */
export const REPO='https://github.com/mowfxy/clem';

export const faqs=[
  ['What do I need?','A Windows 10 or 11 PC and an AI subscription you already use: ChatGPT, Claude, Grok (SuperGrok or X Premium+) or Gemini (a Google AI plan).'],
  ['Where is my work stored?','On your PC, in Documents\\Clem. Plain files you can open, move or back up.'],
  ['Is it really free?','Yes. No plan, no trial, no card, and no paid tier waiting later.'],
  ['Is Clem open source?','Yes. The whole app, the website and the account service are on GitHub under the MIT License. Read it, build it yourself or send a fix.'],
  ['Is my AI plan included?','No. Clem is the workspace; you keep the plan you have.'],
  ['Who makes Clem?','M4 Labs, an AI research lab that also builds apps. Clem is its first.'],
];

/** The open-source pitch: where the code lives and what the license lets people do. */
export function OpenSource(){
  return <>
    <Prompt>cat LICENSE | head -1</Prompt>
    <h2>Open source. All of it.</h2>
    <ul className="cx-out">
      <li><span>license</span><span>MIT</span></li>
      <li><span>code</span><span>every line of the app, the site and the account service</span></li>
      <li><span>yours to</span><span>read, build, fork and improve</span></li>
      <li><span>repo</span><a href={REPO}>github.com/mowfxy/clem</a></li>
    </ul>
  </>;
}

export function Faq(){
  return <div className="cx-faq">{faqs.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>;
}
