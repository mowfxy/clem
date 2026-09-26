import {Icon} from '../Icons';
import {Reveal} from './Reveal';
import {PayPalMark,SupportLink} from '../support-link';

export const faqs=[
  ['What do I need?','A Windows 10 or 11 PC and an AI subscription you already use: ChatGPT, Claude or Grok (SuperGrok or X Premium+).'],
  ['Where is my work stored?','On your PC, in Documents\\Mowr. Plain files you can open, move or back up.'],
  ['Is it really free?','Yes. No plan, no trial, no card. Donations keep it that way.'],
  ['Is my AI plan included?','No. Mowr is the workspace; you keep the plan you have.'],
];

export function PayPalCard(){
  return <Reveal className="sx-paypal">
    <div className="sx-paypal-mark"><PayPalMark size={40}/></div>
    <div>
      <h2>PayPal</h2>
      <p>Support Mowr to help keep this service totally free.</p>
    </div>
    <SupportLink className="sx-btn sx-btn-primary sx-btn-lg"><PayPalMark size={18}/>Support with PayPal</SupportLink>
  </Reveal>;
}

export function Faq(){
  return <div className="sx-faq-list">{faqs.map(([q,a])=><details key={q}><summary>{q}<Icon name="plus" size={18}/></summary><p>{a}</p></details>)}</div>;
}
