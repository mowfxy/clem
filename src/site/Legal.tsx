import { useEffect } from 'react';
import { SitePage, usePageTitle } from './shell';

/** Clem's privacy policy and terms live on m4labs.xyz with the rest of M4 Labs'. Vercel redirects /privacy and /terms;
 *  the old #/privacy and #/terms links land here and go on to the same pages. */
export function Legal({ route }: { route: string }) {
  const page = route.includes('terms') ? 'terms' : 'privacy', url = `https://m4labs.xyz/${page}`, name = page === 'terms' ? 'terms' : 'privacy policy';
  usePageTitle(page === 'terms' ? 'Terms: Clem' : 'Privacy: Clem');
  useEffect(() => { location.replace(url); }, [url]);
  return (
    <SitePage route={route} className="cs-legal">
      <header className="cs-page-head">
        <h1>Opening the {name}…</h1>
        <p className="cs-lede">Clem’s {name} is kept with M4 Labs’ at <a href={url}>{url.replace('https://', '')}</a>.</p>
      </header>
    </SitePage>
  );
}
