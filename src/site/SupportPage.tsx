import {useEffect} from 'react';
import {SiteFooter,SiteHeader} from './SiteHeader';
import {Reveal} from './Reveal';
import {Icon} from '../Icons';
import {REPO} from './sections';

/** Where people get help with Mowr: email for the app and their account, GitHub for bugs and ideas. */
export function SupportPage(){
  useEffect(()=>{document.title='Support Mowr';window.scrollTo(0,0);},[]);
  return <div className="sx-site">
    <SiteHeader/>
    <main>
      <section className="sx-page-hero"><Reveal><h1>Support</h1><p className="sx-lede">Help with the app, your account, or the code.</p></Reveal></section>
      <section className="sx-section sx-section-tight">
        <div className="sx-help">
          <Reveal className="sx-help-card"><Icon name="mail" size={22}/><h2>Email us</h2><p>Questions about the app or your account.</p><a className="sx-btn sx-btn-primary" href="mailto:support@mowrai.com">support@mowrai.com</a></Reveal>
          <Reveal className="sx-help-card" delay={90}><Icon name="bug" size={22}/><h2>Report a bug</h2><p>Something broken? Tell us on GitHub.</p><a className="sx-btn sx-btn-ghost" href={REPO+'/issues/new/choose'}>Open an issue</a></Reveal>
          <Reveal className="sx-help-card" delay={180}><Icon name="github" size={22}/><h2>Contribute</h2><p>Mowr is open source. Fixes and ideas are welcome.</p><a className="sx-btn sx-btn-ghost" href={REPO}>View on GitHub</a></Reveal>
        </div>
      </section>
    </main>
    <SiteFooter/>
  </div>;
}
