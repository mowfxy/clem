import {useEffect} from 'react';
import {Page} from './SiteHeader';
import {Arrive} from './motion';
import {REPO} from './sections';

/** Where people get help with Clem: email for the app and their account, GitHub for bugs and ideas. */
export function SupportPage(){
  useEffect(()=>{document.title='Support: Clem';window.scrollTo(0,0);},[]);
  return <Page title={['How can','we help?']} scene="lifebuoy" lede="Email for the app and your account; GitHub for bugs and ideas." next={['#/about','About']}>
    <Arrive as="ul" className="cl-rows">
      <li><b>Email us</b><span>Questions about the app or your account: <a href="mailto:support@m4labs.xyz">support@m4labs.xyz</a></span></li>
      <li><b>In the app</b><span>Settings, then Help &amp; support, opens a case that staff answer inside Clem.</span></li>
      <li><b>Report a bug</b><span>Something broken? <a href={REPO+'/issues/new/choose'}>Open an issue on GitHub</a>.</span></li>
      <li><b>Contribute</b><span>Clem is open source. Fixes and ideas are welcome on <a href={REPO}>GitHub</a>.</span></li>
    </Arrive>
  </Page>;
}
