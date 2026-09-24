import {useEffect} from 'react';
import {SiteFooter,SiteHeader} from './SiteHeader';
import {Reveal} from './Reveal';
import {Faq,PriceCard} from './sections';

export function PricingPage(){
  useEffect(()=>{document.title='Mowr pricing — $2 a month';window.scrollTo(0,0);},[]);
  return <div className="sx-site">
    <SiteHeader/>
    <main>
      <section className="sx-page-hero"><Reveal><h1>Pricing</h1><p className="sx-lede">One plan. Everything included.</p></Reveal></section>
      <section className="sx-section sx-section-tight"><PriceCard/></section>
      <section className="sx-section"><Reveal className="sx-head"><h2>Questions.</h2></Reveal><Faq/></section>
    </main>
    <SiteFooter/>
  </div>;
}
