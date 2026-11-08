import { useEffect, useState } from 'react';
import { SecuritySettings } from '../AccountSettings';
import { getSupabase } from '../supabase';
import { DownloadButton, SitePage, Window, megabytes, usePageTitle, useRelease } from './shell';

/** The download page, shown for every route the site does not otherwise name. #/download?start starts the installer at
 *  once; #/desktop-return welcomes someone back from the browser sign-in; #/app adds account security for a signed-in
 *  web visitor (the workspace itself is the desktop app). */
export function Download({ account, returning }: { account: boolean; returning: boolean }) {
  usePageTitle('Download Clem for Windows', 'Download Clem for Windows 10 and 11: free, open source, and running on the AI plan you already have.');
  const release = useRelease(), [signedIn, setSignedIn] = useState<boolean | null>(null), [started, setStarted] = useState(false);
  const route = location.hash.slice(1);
  useEffect(() => {
    if (!release || started || !/[?&]start\b/.test(location.hash)) return;
    setStarted(true);
    location.href = release.url;
  }, [release, started]);
  useEffect(() => {
    if (!account) return;
    const client = getSupabase();
    if (!client) { setSignedIn(false); return; }
    void client.auth.getSession().then(({ data }) => setSignedIn(!!data.session)).catch(() => setSignedIn(false));
  }, [account]);
  return (
    <SitePage route={route.startsWith('/download') ? '/download' : route} className="cs-download">
      <header className="cs-page-head">
        {returning ? <>
          <h1>Welcome back.</h1>
          <p className="cs-lede">You are signed in. Switch back to Clem on your PC to carry on; you can close this tab. If Clem isn’t on this PC yet, it is right here.</p>
        </> : <>
          <h1>Clem for Windows.</h1>
          <p className="cs-lede">Free, open source, and running on the ChatGPT, Claude, Grok or Google AI plan you already have.</p>
        </>}
        <div className="cs-actions"><DownloadButton /></div>
        {started && <p className="cs-small" role="status">Your download should start in a moment. If it doesn’t, use the button.</p>}
      </header>
      {account && <section className="cs-account" aria-labelledby="h-account">
        <h2 id="h-account">Your account</h2>
        {signedIn === null ? <p className="cs-small">Checking your sign-in…</p> : signedIn ? <div className="cs-account-panel"><SecuritySettings /></div> : <p className="cs-small"><a href="#/login">Sign in</a> to change your account’s security settings.</p>}
      </section>}
      <section className="cs-install">
        <dl className="cs-facts">
          <div><dt>Version</dt><dd>{release ? `${release.version} preview` : '…'}</dd></div>
          <div><dt>Released</dt><dd>{release?.released ? new Date(release.released + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '…'}</dd></div>
          <div><dt>Size</dt><dd>{release ? megabytes(release.size) : '…'}</dd></div>
          <div><dt>Needs</dt><dd>Windows 10 or 11, 64-bit</dd></div>
        </dl>
        {release && <p className="cs-sum"><span>SHA-256</span><code>{release.sha256}</code></p>}
        {release && !release.signed && <p className="cs-small">The installer is not code-signed yet, so Windows SmartScreen may ask whether you trust it. Choose More info, then Run anyway, after checking the SHA-256 above.</p>}
        <ol className="cs-steps">
          <li data-arrive style={{ '--i': 0 } as React.CSSProperties}><b>Install</b><span>Run the installer. Clem opens when it is done.</span></li>
          <li data-arrive style={{ '--i': 1 } as React.CSSProperties}><b>Sign in</b><span>With your browser, once.</span></li>
          <li data-arrive style={{ '--i': 2 } as React.CSSProperties}><b>Connect your AI</b><span>Clem finds what is already on your PC and connects it in one click.</span></li>
        </ol>
      </section>
      <Window shot="welcome" alt="The first thing Clem shows: “Welcome to Clem. A calm place for your projects, study and documents.” on a sheet of glass over the sunrise, with Sign in with browser." caption={<><b>The first screen,</b> here in Windows’ light mode: one sheet of glass and the sunrise behind it.</>} />
      <p className="cs-small cs-older"><a href="https://github.com/mowfxy/clem-releases/releases">Release notes and earlier versions</a></p>
    </SitePage>
  );
}
