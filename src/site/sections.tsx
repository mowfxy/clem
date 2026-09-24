import {Icon} from '../Icons';
import {Reveal} from './Reveal';
import {SupportLink} from '../support-link';

export const faqs=[
  ['What do I need?','A Windows 10 or 11 PC and an AI subscription you already use. ChatGPT is supported today.'],
  ['Where is my work stored?','On your PC, in Documents\\Mowr. Plain files you can open, move or back up.'],
  ['Is it really free?','Yes. No plan, no trial, no card. Donations keep it that way.'],
  ['Is my AI plan included?','No. Mowr is the workspace; you keep the plan you have.'],
];

export function PriceCard(){
  return <Reveal className="sx-price-card">
    <div>
      <span className="sx-plan">Mowr</span>
      <p className="sx-price">Free</p>
      <p>Everything included.</p>
      <a className="sx-btn sx-btn-primary sx-btn-lg" href="#/download?start">Download free<Icon name="download" size={18}/></a>
      <p className="sx-support">Like it? <SupportLink className="sx-link">Support Mowr on PayPal</SupportLink></p>
    </div>
    <ul>{['Unlimited projects and chats','Visuals for any idea','Spaced-repetition study','Word, PowerPoint and Excel files','Checked numbers and second opinions','Multi-step tasks','Support from the team'].map(x=><li key={x}><Icon name="check" size={16}/>{x}</li>)}</ul>
  </Reveal>;
}

export function Faq(){
  return <div className="sx-faq-list">{faqs.map(([q,a])=><details key={q}><summary>{q}<Icon name="plus" size={18}/></summary><p>{a}</p></details>)}</div>;
}
