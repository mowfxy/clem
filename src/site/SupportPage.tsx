import {useEffect} from 'react';
import {Page} from './SiteHeader';
import {REPO} from './sections';

/** Where people get help with Clem: email for the app and their account, GitHub for bugs and ideas. */
export function SupportPage(){
  useEffect(()=>{document.title='Support: Clem';window.scrollTo(0,0);},[]);
  return <Page cmd="clem support" title="Help with the app, your account, or the code." next={['#/about','about']}>
    <ul className="cx-out">
      <li><span>email us</span><span>questions about the app or your account: <a href="mailto:support@m4labs.xyz">support@m4labs.xyz</a></span></li>
      <li><span>in the app</span><span>Settings, then Help &amp; support, opens a case that staff answer inside Clem</span></li>
      <li><span>report a bug</span><span>something broken? <a href={REPO+'/issues/new/choose'}>open an issue</a></span></li>
      <li><span>contribute</span><span>Clem is open source; fixes and ideas are welcome on <a href={REPO}>github</a></span></li>
    </ul>
  </Page>;
}
