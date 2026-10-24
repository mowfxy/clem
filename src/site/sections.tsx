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

/** Questions as ruled lines: each opens beneath itself. */
export function Faq(){
  return <div className="cl-faq">{faqs.map(([q,a])=><details key={q}><summary><span>{q}</span><i aria-hidden="true"/></summary><p>{a}</p></details>)}</div>;
}
