import {Icon} from '../Icons';
import {Reveal} from './Reveal';
import {Illustration} from '../Illustrations';
import {PayPalMark,SupportLink} from '../support-link';

/** Mowr's public source repository. */
export const REPO='https://github.com/mowfxy/mowr';

export const faqs=[
  ['What do I need?','A Windows 10 or 11 PC and an AI subscription you already use: ChatGPT, Claude or Grok (SuperGrok or X Premium+).'],
  ['Where is my work stored?','On your PC, in Documents\\Mowr. Plain files you can open, move or back up.'],
  ['Is it really free?','Yes. No plan, no trial, no card. Donations keep it that way.'],
  ['Is Mowr open source?','Yes. The whole app, the website and the account service are on GitHub under the MIT License. Read it, build it yourself or send a fix.'],
  ['Is my AI plan included?','No. Mowr is the workspace; you keep the plan you have.'],
];

export function PayPalCard(){
  return <Reveal className="sx-paypal">
    <div className="sx-paypal-mark"><PayPalMark size={40}/></div>
    <div>
      <h2>PayPal</h2>
      <p>Support Mowr to help keep it free and open source.</p>
    </div>
    <SupportLink className="sx-btn sx-btn-primary sx-btn-lg"><PayPalMark size={18}/>Support with PayPal</SupportLink>
  </Reveal>;
}

/** The open-source pitch: where the code lives and what the license lets people do. */
export function OpenSource(){
  return <Reveal className="sx-local sx-open">
    <div className="sx-local-art"><Illustration scene="sprout"/></div>
    <div>
      <span className="sx-eyebrow">MIT License</span>
      <h2>Open source. All of it.</h2>
      <ul className="sx-checks">
        <li><Icon name="check" size={17}/>Every line of the app is on GitHub.</li>
        <li><Icon name="check" size={17}/>Read how your files are handled.</li>
        <li><Icon name="check" size={17}/>Build it yourself, fork it, improve it.</li>
      </ul>
      <div className="sx-cta-row"><a className="sx-btn sx-btn-ghost sx-btn-lg" href={REPO}><Icon name="github" size={18}/>View on GitHub</a></div>
    </div>
  </Reveal>;
}

export function Faq(){
  return <div className="sx-faq-list">{faqs.map(([q,a])=><details key={q}><summary>{q}<Icon name="plus" size={18}/></summary><p>{a}</p></details>)}</div>;
}
