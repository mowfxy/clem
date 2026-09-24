import {useEffect} from 'react';
import {SiteFooter,SiteHeader} from './SiteHeader';
import {Reveal} from './Reveal';
import {PayPalCard} from './sections';

/** Mowr is free for everyone; this page is where people can help keep it that way. */
export function SupportPage(){
  useEffect(()=>{document.title='Support Mowr';window.scrollTo(0,0);},[]);
  return <div className="sx-site">
    <SiteHeader/>
    <main>
      <section className="sx-page-hero"><Reveal><h1>Support</h1><p className="sx-lede">Mowr is free for everyone. Your support keeps it that way.</p></Reveal></section>
      <section className="sx-section sx-section-tight">
        <PayPalCard/>
        <p className="sx-fine">Need help with the app? Email <a href="mailto:support@mowrai.com">support@mowrai.com</a>.</p>
      </section>
    </main>
    <SiteFooter/>
  </div>;
}
